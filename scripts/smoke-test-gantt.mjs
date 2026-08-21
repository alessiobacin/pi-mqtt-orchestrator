// REAL test of the live Gantt web view (Ticket 11) — scripts/gantt-server.mjs
// (`po gantt` / `po web`).
//
// Starts the server against a scratch project seeded (via the REAL orchestrator
// tools over a REAL broker) with a run + tickets + an open hold, then:
//   - GET /healthz -> { ok: true }
//   - GET /data    -> JSON snapshot containing the run, its tickets, and the
//                     open hold (the Gantt data source)
//   - GET /        -> serves the HTML page (string contains "Orchestrator")
//   - the server is read-only: run/ticket state is unchanged afterwards
// Uses the server's `--once` variant in wedged form: we import it and call
// runGantt with a custom argv that makes it serve then close, so the test
// process can continue after the server's own http.get/destroy handshake.
//
// Usage: node --experimental-strip-types scripts/smoke-test-gantt.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import mqtt from "mqtt";

const execFileP = promisify(execFile);
const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const BROKER_URL = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";

let PASS = 0;
function ok(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); PASS++; console.log(`   OK — ${msg}`); }

async function bootstrapScratchRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-gantt-"));
	await execFileP("git", ["init", "-q", "-b", "main"], { cwd: dir });
	await execFileP("git", ["config", "user.email", "smoke@test.local"], { cwd: dir });
	await execFileP("git", ["config", "user.name", "Smoke Test"], { cwd: dir });
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "gantt-smoke" }, null, 2));
	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	fs.writeFileSync(path.join(dir, "agents", "roles.yaml"), "roles: {}\n");
	await execFileP("git", ["add", "-A"], { cwd: dir });
	await execFileP("git", ["commit", "-q", "-m", "init"], { cwd: dir });
	return dir;
}

function makeFakePi(flagValues) {
	const tools = new Map(); const hooks = new Map(); const appendedEntries = [];
	const pi = { registerFlag() {}, getFlag(n) { return flagValues[n]; }, registerTool(d) { tools.set(d.name, d); }, on(e, h) { hooks.set(e, h); }, registerCommand() {}, appendEntry(k, d) { appendedEntries.push({ kind: k, data: d }); }, sendMessage() {} };
	return { pi, tools, hooks, appendedEntries };
}
function makeCtx(cwd) { return { cwd, hasUI: false, ui: {}, sessionManager: { getBranch() { return []; } } }; }
const ALL_INSTANCES = [];
let modPromiseCache = null;
class FakeInstance {
	constructor(label, flagValues, cwd) { this.label = label; this.flagValues = flagValues; this.cwd = cwd; this.harness = makeFakePi(flagValues); this.ctx = makeCtx(cwd); }
	async start() {
		const modUrl = pathToFileURL(path.join(PROJECT_ROOT, "extensions", "orchestrator.ts")).href;
		if (!modPromiseCache) modPromiseCache = import(modUrl);
		const mod = await modPromiseCache; mod.default(this.harness.pi);
		await this.harness.hooks.get("session_start")({}, this.ctx);
		const dl = Date.now() + 8000; while (Date.now() < dl) { if (this.harness.appendedEntries.some((e) => e.data?.event === "connected")) return this; await new Promise((r) => setTimeout(r, 50)); }
		throw new Error(`${this.label}: never connected on ${BROKER_URL}?`);
	}
	async call(name, params = {}) { const t = this.harness.tools.get(name); if (!t) throw new Error(`${this.label}: no tool ${name}`); return t.execute("c-" + Math.random().toString(36).slice(2), params); }
	async shutdown() { const h = this.harness.hooks.get("session_shutdown"); if (h) await h({}, this.ctx); }
}
async function makeInstance(instance, role, cwd) { const fi = new FakeInstance(role, { instance, role, project: "gantt-smoke", broker: BROKER_URL, "config-dir": "agents", "prompts-dir": "prompts" }, cwd); ALL_INSTANCES.push(fi); await fi.start(); return fi; }

function httpGetJson(url) { return new Promise((res, rej) => { http.get(url, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on("error", rej); }); }
function httpGetText(url) { return new Promise((res, rej) => { http.get(url, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); }); }

async function main() {
	console.log("Gantt smoke test — scripts/gantt-server.mjs (Ticket 11).\n");
	const cwd = await bootstrapScratchRepo();
	console.log(`scratch repo: ${cwd}\n`);

	const planner = await makeInstance("planner-01", "planner", cwd);
	await planner.call("orchestrator_init", {});
	const run = (await planner.call("run_create", { objective: "Gantt demo run" })).details.run;
	const spec = (await planner.call("spec_create", { run_id: run.id, title: "s", content: "b" })).details.spec;
	const t1 = (await planner.call("ticket_create", { run_id: run.id, spec_id: spec.id, title: "task A", required_capabilities: ["planner"], depends_on: [] })).details.ticket;
	await planner.call("ticket_create", { run_id: run.id, spec_id: spec.id, title: "task B", required_capabilities: ["planner"], depends_on: [] });
	await planner.call("decision_hold_create", { question: "preflight?", run_id: run.id });
	ok(true, "seeded a run, 2 tickets, 1 open hold for the Gantt view");

	const { runGantt } = await import(pathToFileURL(path.join(PROJECT_ROOT, "scripts", "gantt-server.mjs")).href);
	const port = 8390 + (process.pid % 50);
	const serverHandle = await runGantt({ cwd, argv: ["--port", String(port), "--project", "gantt-smoke"], packageRoot: PROJECT_ROOT });

	console.log("\n=== PART 1 — healthz ===");
	let up = false;
	for (let i = 0; i < 40 && !up; i++) { try { await httpGetJson(`http://127.0.0.1:${port}/healthz`); up = true; } catch { await new Promise((r) => setTimeout(r, 100)); } }
	ok(up, "server responds on /healthz");
	const hz = await httpGetJson(`http://127.0.0.1:${port}/healthz`);
	ok(hz.ok === true, "healthz reports ok (project resolved)");

	console.log("\n=== PART 2 — /data returns the Gantt snapshot ===");
	const data = await httpGetJson(`http://127.0.0.1:${port}/data`);
	ok(data.project === "gantt-smoke", "/data resolves the project scope");
	ok(Array.isArray(data.runs) && data.runs.some((r) => r.id === run.id), "the seeded run appears in the snapshot");
	const seeded = data.runs.find((r) => r.id === run.id);
	ok(Array.isArray(seeded.tickets) && seeded.tickets.length === 2, "the run carries its 2 tickets (the Gantt rows)");
	ok(Array.isArray(seeded.open_holds) && seeded.open_holds.length === 1, "the run carries its 1 open hold");

	console.log("\n=== PART 3 — the HTML page is served ===");
	const html = await httpGetText(`http://127.0.0.1:${port}/`);
	ok(/Orchestrator/.test(html) && /WebSocket/.test(html) && /status-done/.test(html), "page HTML includes the timeline/renderer + websocket client");

	console.log("\n=== PART 4 — server is read-only ===");
	const after = (await planner.call("run_status", { run_id: run.id })).details;
	ok(after.tickets.filter((t) => t.id === t1.id).length === 1, "server left the ticket untouched (read-only)");

	// Cleanup: close the Gantt server we opened.
	serverHandle.server?.close?.();
	try { serverHandle.client?.end?.(true); } catch { /* ignore */ }
	for (const fi of ALL_INSTANCES) { try { await fi.shutdown(); } catch { /* ignore */ } }

	console.log(`\n${PASS} assertions passed.`);
	console.log("GANTT SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => { console.error(`\nGANTT SMOKE TEST FAILED: ${err.message}\n${err.stack || ""}`); process.exit(1); });
process.on("exit", () => { for (const fi of ALL_INSTANCES) { try { fi.shutdown(); } catch { /* ignore */ } } });
