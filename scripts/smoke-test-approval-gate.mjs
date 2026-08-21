// REAL e2e test of the durable human-approval gate (firstmate decision-hold
// pattern) — decision_hold_create / decision_hold_list / decision_hold_resolve.
//
// Follows the Revisione 25/26 discipline: dynamically imports the REAL
// extensions/orchestrator.ts and drives it through the same FakeInstance
// harness, against a REAL broker and a REAL on-disk SQLite database. The
// resumability case (a hold must survive a "restart") is simulated like the
// ticket engine does: open a hold, then build a brand-new FakeInstance
// against the SAME project directory and assert the hold is still open —
// proving it is persisted (a row), never held in planner memory.
//
// What this verifies:
//   - decision_hold_create is planner-only (non-planner refused)
//   - an opened hold is a row in orchestrator.db and shows status "open"
//   - the hold SURVIVES a process restart (fresh instance, same on-disk db)
//   - decision_hold_list returns it, and run_status surfaces open holds
//   - decision_hold_resolve closes it exactly once (resolved_by + decision
//     persisted) and refuses a second resolution
//   - resolution records a decision_hold_resolved event on the run
//
// Usage: node --experimental-strip-types scripts/smoke-test-approval-gate.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import mqtt from "mqtt";

const execFileP = promisify(execFile);
const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const BROKER_URL = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";

let PASS = 0;
function ok(cond, msg) {
	if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
	PASS++;
	console.log(`   OK — ${msg}`);
}

async function git(args, cwd) {
	return execFileP("git", args, { cwd });
}

async function bootstrapScratchRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-approval-gate-"));
	await git(["init", "-q", "-b", "main"], dir);
	await git(["config", "user.email", "smoke@test.local"], dir);
	await git(["config", "user.name", "Smoke Test"], dir);
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "approval-gate-smoke" }, null, 2));
	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	fs.writeFileSync(path.join(dir, "agents", "roles.yaml"), "roles: {}\n");
	await git(["add", "-A"], dir);
	await git(["commit", "-q", "-m", "init"], dir);
	return dir;
}

// ━━ Fake pi / ctx harness — same shape as smoke-test-ticket-engine.mjs ━━━━

let modPromiseCache = null;
const ALL_INSTANCES = [];
const SWALLOW = new Set(["open", "connected"]);
const subClient = null; // force-closed in main()'s finally via ALL_INSTANCES

class FakeInstance {
	constructor(label, flagValues, cwd) {
		this.label = label;
		this.flagValues = flagValues;
		this.cwd = cwd;
		this.harness = makeFakePi(flagValues);
		this.ctx = makeCtx(cwd);
	}

	async start() {
		const modUrl = pathToFileURL(path.join(PROJECT_ROOT, "extensions", "orchestrator.ts")).href;
		if (!modPromiseCache) modPromiseCache = import(modUrl);
		const mod = await modPromiseCache;
		mod.default(this.harness.pi);
		const sessionStart = this.harness.hooks.get("session_start");
		await sessionStart({}, this.ctx);
		const deadline = Date.now() + 8000;
		while (Date.now() < deadline) {
			if (this.harness.appendedEntries.some((e) => e.data?.event === "connected")) return this;
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`${this.label}: never saw MQTT "connected" event within 8s — is mosquitto running on ${BROKER_URL}?`);
	}

	tool(name) {
		const t = this.harness.tools.get(name);
		if (!t) throw new Error(`${this.label}: no tool registered named "${name}"`);
		return t;
	}

	async call(name, params = {}) {
		const t = this.tool(name);
		return t.execute("call-" + Math.random().toString(36).slice(2), params);
	}

	async callExpectError(name, params = {}) {
		try {
			await this.call(name, params);
			throw new Error(`${this.label}: expected "${name}" to throw, but it succeeded`);
		} catch (err) {
			return err;
		}
	}

	async shutdown() {
		const hook = this.harness.hooks.get("session_shutdown");
		if (hook) await hook({}, this.ctx);
	}
}

async function makeInstance(label, instance, role, cwd, project) {
	const fi = new FakeInstance(label, { instance, role, project, broker: BROKER_URL, "config-dir": "agents", "prompts-dir": "prompts" }, cwd);
	ALL_INSTANCES.push(fi);
	await fi.start();
	return fi;
}

function makeFakePi(flagValues) {
	const tools = new Map();
	const hooks = new Map();
	const appendedEntries = [];
	const pi = {
		registerFlag() {},
		getFlag(name) { return flagValues[name]; },
		registerTool(def) { tools.set(def.name, def); },
		on(event, handler) { hooks.set(event, handler); },
		registerCommand() {},
		appendEntry(kind, data) { appendedEntries.push({ kind, data }); },
		sendMessage() {},
	};
	return { pi, tools, hooks, appendedEntries };
}

function makeCtx(cwd) {
	const widgets = new Map();
	return {
		cwd,
		hasUI: false,
		ui: { notify() {}, setWidget(name, factory, opts) { widgets.set(name, { factory, opts }); } },
		sessionManager: { getBranch() { return []; } },
	};
}

// ━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
	console.log("Approval gate smoke test — REAL extensions/orchestrator.ts (decision-hold pattern).\n");
	const cwd = await bootstrapScratchRepo();
	console.log(`scratch repo: ${cwd}\n`);

	console.log("=== PART 1 — planner opens a durable hold, non-planner refused ===");
	const planner = await makeInstance("planner", "planner-01", "planner", cwd, "approval-smoke");
	await planner.call("orchestrator_init", {});
	const run = (await planner.call("run_create", { objective: "Preflight credenziali" })).details.run;

	const coder = await makeInstance("coder", "coder-01", "coder", cwd, "approval-smoke");
	const refuseErr = await coder.callExpectError("decision_hold_create", { question: "serve GitHub?", run_id: run.id });
	ok(/only the planner/.test(refuseErr.message), "decision_hold_create is refused for a non-planner instance");

	const created = await planner.call("decision_hold_create", { question: "Vuoi fornire le credenziali GitHub ora (wait) o in parallelo (async)?", run_id: run.id, ticket_id: null, context: { missing: ["gh/cred"] } });
	const holdId = created.details.hold.id;
	ok(holdId.startsWith("hold_"), "created hold gets a stable hold_ id");
	ok(created.details.hold.status === "open", "created hold is status open");
	ok(created.details.hold.run_id === run.id, "hold is attached to the run");

	// The durable part: the event is recorded on the run.
	const eventsAfter = JSON.stringify((await planner.call("run_status", { run_id: run.id })).details.recent_events);
	ok(eventsAfter.includes("decision_hold_opened"), "decision_hold_opened event recorded on the run");

	console.log("\n=== PART 2 — the hold SURVIVES a simulated restart ===");
	// A FRESH instance against the same on-disk DB (the way a new `pi`
	// process would after a crash) must still see the open hold. This is the
	// whole point of the durable gate: it is a row, not planner memory.
	await planner.shutdown();
	const planner2 = await makeInstance("planner-2", "planner-01", "planner", cwd, "approval-smoke");
	await planner2.call("orchestrator_init", {});

	const listed = await planner2.call("decision_hold_list", { run_id: run.id });
	ok(listed.details.holds.some((h) => h.id === holdId && h.status === "open"), "hold is still open after a restart (persisted in SQLite, not planner memory)");

	const statusAfterRestart = await planner2.call("run_status", { run_id: run.id });
	ok(statusAfterRestart.details.open_holds.some((h) => h.id === holdId), "run_status surfaces the open hold after restart");

	console.log("\n=== PART 3 — resolve closes it exactly once, with the explicit decision ===");
	const resolved = await planner2.call("decision_hold_resolve", { hold_id: holdId, decision: "wait" });
	ok(resolved.details.hold.status === "resolved", "resolve flips the hold to resolved");
	ok(resolved.details.hold.resolved_by === "planner-01", "resolve records the resolving instance");
	ok(resolved.details.hold.decision === "wait", "resolve records the explicit operator decision text");

	const secondResolveErr = await planner2.callExpectError("decision_hold_resolve", { hold_id: holdId, decision: "async" });
	ok(/already .*resolved/.test(secondResolveErr.message), "a resolved hold cannot be resolved again — closes exactly once");

	const eventsResolved = JSON.stringify((await planner2.call("run_status", { run_id: run.id })).details.recent_events);
	ok(eventsResolved.includes("decision_hold_resolved"), "decision_hold_resolved event recorded on the run");

	const closedHolds = (await planner2.call("decision_hold_list", { run_id: run.id })).details.holds.filter((h) => h.id === holdId);
	ok(closedHolds.length === 1 && closedHolds[0].status === "resolved", "list reflects the resolved state");

	console.log(`\n${PASS} assertions passed.`);
	console.log("APPROVAL GATE SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error(`\nAPPROVAL GATE SMOKE TEST FAILED: ${err.message}\n${err.stack || ""}`);
	process.exit(1);
});

process.on("exit", () => {
	for (const fi of ALL_INSTANCES) {
		try { fi.shutdown(); } catch { /* ignore */ }
	}
});
