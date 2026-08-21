// REAL functional test of `po end` (scripts/end-project.mjs, Revisione 38)
// — spawns the actual CLI script as a child process (execFileSync/spawnSync,
// exactly as an operator would run it from a shell) against a REAL
// orchestrator.db seeded through the REAL extensions/orchestrator.ts tools
// (run_create/spec_create/ticket_create/ticket_claim/ticket_complete, same
// dynamic-import technique as e2e-full-flow.mjs) over a REAL local mosquitto
// broker. Never a hand-copied mirror of end-project.mjs's own logic — this
// exercises the real CLI end to end, including its own SQL against the same
// schema extensions/orchestrator.ts writes.
//
// Usage: node --experimental-strip-types scripts/smoke-test-end-project.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileP = promisify(execFile);
const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const BROKER_URL = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";
const END_SCRIPT = path.join(PROJECT_ROOT, "scripts", "end-project.mjs");

let PASS = 0;
function ok(cond, msg) {
	if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
	PASS++;
	console.log(`   OK — ${msg}`);
}

async function git(args, cwd) {
	return execFileP("git", args, { cwd });
}

function makeFakePi(flagValues) {
	const hooks = new Map();
	const tools = new Map();
	const appendedEntries = [];
	const pi = {
		registerFlag() {},
		getFlag(name) {
			return flagValues[name];
		},
		registerTool(def) {
			tools.set(def.name, def);
		},
		on(event, handler) {
			hooks.set(event, handler);
		},
		registerCommand() {},
		appendEntry(kind, data) {
			appendedEntries.push({ kind, data });
		},
		sendMessage() {},
	};
	return { pi, hooks, tools, appendedEntries };
}

function makeCtx(cwd) {
	return { cwd, hasUI: false, ui: undefined, sessionManager: { getBranch() { return []; } } };
}

// Seeds a scratch project with two "active" runs via the REAL orchestrator
// tools: run A has no tickets at all; run B has 2 tickets, one "done" one
// left "pending" — deliberately NOT auto-completed by ticket_complete
// (which only closes a run once EVERY ticket is done), so both stay
// "active" for `po end` to find, exactly the real-world case (a task
// abandoned mid-way) this command exists for.
async function seedProject() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-end-smoke-"));
	await git(["init", "-q", "-b", "main"], dir);
	await git(["config", "user.email", "smoke@test.local"], dir);
	await git(["config", "user.name", "Smoke Test"], dir);
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "end-project-smoke" }, null, 2));
	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	fs.writeFileSync(path.join(dir, "agents", "roles.yaml"), "roles: {}\n");
	await git(["add", "-A"], dir);
	await git(["commit", "-q", "-m", "init"], dir);

	const modUrl = pathToFileURL(path.join(PROJECT_ROOT, "extensions", "orchestrator.ts")).href;
	const mod = await import(modUrl);
	const harness = makeFakePi({ instance: "planner-01", role: "planner", broker: BROKER_URL });
	mod.default(harness.pi);
	const ctx = makeCtx(dir);
	await harness.hooks.get("session_start")({}, ctx);
	const deadline = Date.now() + 8000;
	while (Date.now() < deadline && !harness.appendedEntries.some((e) => e.data?.event === "connected")) {
		await new Promise((r) => setTimeout(r, 50));
	}
	if (!harness.appendedEntries.some((e) => e.data?.event === "connected")) {
		throw new Error(`seedProject: never saw MQTT "connected" event — is mosquitto running on ${BROKER_URL}?`);
	}

	async function call(name, params) {
		const t = harness.tools.get(name);
		if (!t) throw new Error(`no tool registered named "${name}"`);
		return t.execute("smoke-" + Math.random().toString(36).slice(2), params);
	}

	await call("orchestrator_init", {});
	const runA = (await call("run_create", { objective: "Run A — no tickets, stays active" })).details.run;
	const runB = (await call("run_create", { objective: "Run B — one done, one pending ticket" })).details.run;
	const specB = (await call("spec_create", { run_id: runB.id, title: "spec B", content: "spec body" })).details.spec;
	// Revisione 42: the planner may no longer ticket_claim/ticket_complete(done)
	// its own tickets (see extensions/orchestrator.ts, ticket_claim/
	// ticket_complete) — a second fake instance (role coder), sharing the same
	// scratch project directory/orchestrator.db over the same real broker,
	// does the actual claim+complete instead, exactly as a real coder would.
	const ticket1 = (await call("ticket_create", { run_id: runB.id, spec_id: specB.id, title: "ticket 1", required_capabilities: ["coder"], depends_on: [] })).details.ticket;
	await call("ticket_create", { run_id: runB.id, spec_id: specB.id, title: "ticket 2", required_capabilities: ["planner"], depends_on: [] });

	const coderHarness = makeFakePi({ instance: "coder-01", role: "coder", broker: BROKER_URL });
	mod.default(coderHarness.pi);
	await coderHarness.hooks.get("session_start")({}, ctx);
	const coderDeadline = Date.now() + 8000;
	while (Date.now() < coderDeadline && !coderHarness.appendedEntries.some((e) => e.data?.event === "connected")) {
		await new Promise((r) => setTimeout(r, 50));
	}
	if (!coderHarness.appendedEntries.some((e) => e.data?.event === "connected")) {
		throw new Error(`seedProject: coder-01 never saw MQTT "connected" event — is mosquitto running on ${BROKER_URL}?`);
	}
	async function coderCall(name, params) {
		const t = coderHarness.tools.get(name);
		if (!t) throw new Error(`no tool registered named "${name}"`);
		return t.execute("smoke-" + Math.random().toString(36).slice(2), params);
	}
	await coderCall("ticket_claim", { ticket_id: ticket1.id });
	await coderCall("ticket_complete", { ticket_id: ticket1.id, status: "done" });
	const coderShutdownHook = coderHarness.hooks.get("session_shutdown");
	if (coderShutdownHook) await coderShutdownHook({}, ctx);

	const shutdownHook = harness.hooks.get("session_shutdown");
	if (shutdownHook) await shutdownHook({}, ctx);

	return { dir, runA: runA.id, runB: runB.id };
}

function runEnd(cwd, args, input) {
	return execFileSync("node", [END_SCRIPT, ...args], { cwd, encoding: "utf8", input, stdio: input !== undefined ? ["pipe", "pipe", "pipe"] : undefined });
}

function readDbRows(dbPath) {
	const out = execFileSync("node", ["-e", `
		const { DatabaseSync } = require("node:sqlite");
		const db = new DatabaseSync(process.argv[1]);
		const runs = db.prepare("SELECT id, status FROM runs ORDER BY created_at ASC").all();
		const events = db.prepare("SELECT run_id, type FROM events WHERE type = 'run_closed_by_operator'").all();
		console.log(JSON.stringify({ runs, events }));
	`, dbPath], { encoding: "utf8" });
	// node:sqlite prints an ExperimentalWarning to stderr only, stdout is clean JSON.
	return JSON.parse(out.trim().split("\n").pop());
}

async function main() {
	console.log("\n=== TEST 1 — non-initialized directory refuses ===");
	const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-end-bare-"));
	let refused = false;
	try {
		runEnd(bareDir, []);
	} catch (err) {
		refused = err.status === 1;
	}
	ok(refused, "po end exits 1 in a directory with no project markers");

	console.log("\n=== TEST 2 — initialized project, no orchestrator.db yet ===");
	const noDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-end-nodb-"));
	fs.mkdirSync(path.join(noDbDir, "agents"), { recursive: true });
	fs.writeFileSync(path.join(noDbDir, "agents", "roles.yaml"), "roles: {}\n");
	const noDbOut = runEnd(noDbDir, []);
	ok(/niente da chiudere/.test(noDbOut), "po end reports nothing to close when orchestrator.db doesn't exist yet, without erroring");

	console.log("\n=== TEST 3 — --status validation ===");
	let badStatus = false;
	try {
		runEnd(noDbDir, ["--status", "bogus"]);
	} catch (err) {
		badStatus = err.status === 1;
	}
	ok(badStatus, "po end rejects an invalid --status value with exit 1");

	console.log("\n=== TEST 4 — --list is read-only ===");
	const { dir, runA, runB } = await seedProject();
	const dbPath = path.join(dir, ".pi", "extensions", "multiAgentOrchestrator", "orchestratorStorage", "orchestrator.db");
	const listOut = runEnd(dir, ["--list"]);
	ok(listOut.includes(runA) && listOut.includes(runB), "--list shows both seeded runs");
	ok(/1 done, 0 failed, 0 running, 1 pending/.test(listOut), "--list shows the correct ticket status breakdown for run B");
	{
		const { runs } = readDbRows(dbPath);
		ok(runs.every((r) => r.status === "active"), "--list left both runs untouched (still active)");
	}

	console.log("\n=== TEST 5 — declined confirmation makes no changes ===");
	runEnd(dir, [], "n\n");
	{
		const { runs } = readDbRows(dbPath);
		ok(runs.every((r) => r.status === "active"), "declining the prompt leaves both runs active");
	}

	console.log("\n=== TEST 6 — --run closes exactly one run, records the audit event ===");
	const singleOut = runEnd(dir, ["--run", runB, "--yes"]);
	ok(/segnato "completed"/.test(singleOut), "--run --yes reports the run as closed");
	{
		const { runs, events } = readDbRows(dbPath);
		const a = runs.find((r) => r.id === runA);
		const b = runs.find((r) => r.id === runB);
		ok(a.status === "active", "run A untouched by closing run B specifically");
		ok(b.status === "completed", "run B is now completed");
		ok(events.some((e) => e.run_id === runB), "a run_closed_by_operator event was recorded for run B");
	}

	console.log("\n=== TEST 7 — already-closed --run is a no-op, not an error ===");
	const alreadyOut = runEnd(dir, ["--run", runB]);
	ok(/già concluso/.test(alreadyOut), "re-closing an already-completed run reports it as already concluded, without prompting");

	console.log("\n=== TEST 8 — bare --yes closes every remaining active run ===");
	const allOut = runEnd(dir, ["--yes"]);
	ok(allOut.includes(runA), "bare po end (no --run) lists the remaining active run");
	{
		const { runs } = readDbRows(dbPath);
		ok(runs.every((r) => r.status === "completed"), "every run is now completed");
	}

	console.log("\n=== TEST 9 — nothing left to close ===");
	const finalOut = runEnd(dir, []);
	ok(/nessun run "active"/.test(finalOut), "po end reports no active runs left, without prompting");

	console.log(`\n${PASS} assertions passed.`);
}

main()
	.then(() => {
		console.log("END-PROJECT SMOKE TEST PASSED");
		process.exit(0);
	})
	.catch((err) => {
		console.error("\nEND-PROJECT SMOKE TEST FAILED:", err);
		process.exit(1);
	});
