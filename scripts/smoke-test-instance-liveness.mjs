// REAL test of the Revisione 42 "instance liveness" hardening — a real
// incident (progetto "code-mem", see docs/development-notes.md, Revisione 42)
// where a coder instance was missing (no herdr tab, no `pi` process at all)
// and the restarted planner just did the coding work itself instead of
// relaunching one. Three independent fixes are covered here:
//
//   1. moaFindOrphanedTickets()/the watchdog's orphan sweep — a RUNNING
//      ticket whose assigned instance has no live MQTT presence (offline or
//      never seen) is detected immediately (no elapsed-time threshold),
//      auto-marked "failed", and the planner is woken with a MANDATORY
//      relaunch instruction — never a suggestion to do the work itself.
//   2. ticket_claim refuses the planner role outright — a structural
//      guardrail, not just prompt text (ticket_complete is UNCHANGED: the
//      planner calling it, including with status "done", is the normal,
//      by-design flow documented in prompts/planner.md, not the incident
//      this closes — the incident was the planner doing substantive work
//      itself via Bash/Edit, never going through ticket_claim at all).
//   3. agent_terminate + handleTerminate — the code-level "kill" mechanism:
//      publishing a terminate control message makes the target run
//      cleanShutdown() for real (verified via its retained "offline"
//      presence) — process.exit() itself is skipped under
//      PI_ORCH_TEST_NO_EXIT=1 (see the test seam note in
//      extensions/orchestrator.ts, handleTerminate) since every fake
//      "instance" here is a closure sharing this one test process.
//
// Same FakeInstance harness pattern as scripts/smoke-test-watchdog.mjs —
// dynamically imports the REAL extensions/orchestrator.ts, drives it through
// fake pi/ctx objects, against a REAL local mosquitto broker.
//
// Usage: node --experimental-strip-types scripts/smoke-test-instance-liveness.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import mqtt from "mqtt";

const execFileP = promisify(execFile);
const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const BROKER_URL = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";

// Fast enough to keep this test quick; large enough the sweep gets several
// chances without racing it. Orphan detection itself needs NO threshold (see
// module comment above) — this only paces the background sweep interval.
process.env.PI_ORCH_WATCHDOG_INTERVAL_MS = "150";
process.env.PI_ORCH_WATCHDOG_STALL_MS = "100000"; // deliberately high — TEST 1 must not be confused with the ordinary stall path
process.env.PI_ORCH_WATCHDOG_FINALIZE_GRACE_MS = "100000";
process.env.PI_ORCH_TEST_NO_EXIT = "1"; // see handleTerminate's test-seam comment

let PASS = 0;
function ok(cond, msg) {
	if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
	PASS++;
	console.log(`   OK — ${msg}`);
}
async function expectError(promise, msgIncludes, label) {
	try {
		await promise;
	} catch (err) {
		if (msgIncludes && !String(err.message).includes(msgIncludes)) {
			throw new Error(`${label}: threw, but message didn't include "${msgIncludes}" — got: ${err.message}`);
		}
		PASS++;
		console.log(`   OK — ${label}`);
		return;
	}
	throw new Error(`ASSERTION FAILED: ${label} — expected a throw, got success`);
}

async function git(args, cwd) {
	return execFileP("git", args, { cwd });
}

async function bootstrapScratchRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-liveness-"));
	await git(["init", "-q"], dir);
	await git(["config", "user.email", "liveness-test@test.local"], dir);
	await git(["config", "user.name", "Liveness Test"], dir);
	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	for (const f of ["agents.yaml", "roles.yaml"]) {
		fs.copyFileSync(path.join(PROJECT_ROOT, "agents", f), path.join(dir, "agents", f));
	}
	fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\nlogs/\n.pi/\n");
	await git(["add", "-A"], dir);
	await git(["commit", "-q", "-m", "initial scratch repo (instance-liveness test)"], dir);
	return dir;
}

function makeFakePi(flagValues) {
	const tools = new Map();
	const hooks = new Map();
	const commands = new Map();
	const appendedEntries = [];
	const sentMessages = [];
	const pi = {
		registerFlag() {},
		getFlag(name) { return flagValues[name]; },
		registerTool(def) { tools.set(def.name, def); },
		on(event, handler) { hooks.set(event, handler); },
		registerCommand(name, def) { commands.set(name, def); },
		appendEntry(kind, data) { appendedEntries.push({ kind, data }); },
		sendMessage(msg, opts) { sentMessages.push({ msg, opts }); },
	};
	return { pi, tools, hooks, commands, appendedEntries, sentMessages };
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

let modPromiseCache = null;
const ALL_INSTANCES = [];
let subClient = null;

class FakeInstance {
	constructor(label, flagValues, cwd) {
		this.label = label;
		this.flagValues = flagValues;
		this.cwd = cwd;
		this.harness = makeFakePi(flagValues);
		this.ctx = makeCtx(cwd);
		this.shutdownCalled = false;
	}

	async start() {
		const modUrl = pathToFileURL(path.join(PROJECT_ROOT, "extensions", "orchestrator.ts")).href;
		if (!modPromiseCache) modPromiseCache = import(modUrl);
		const mod = await modPromiseCache;
		mod.default(this.harness.pi);
		const sessionStart = this.harness.hooks.get("session_start");
		if (!sessionStart) throw new Error(`${this.label}: session_start hook not registered`);
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

	watchdogMessages() {
		return this.harness.sentMessages.filter((m) => m.msg?.customType === "orchestrator-watchdog");
	}

	async shutdown() {
		if (this.shutdownCalled) return;
		this.shutdownCalled = true;
		const hook = this.harness.hooks.get("session_shutdown");
		if (hook) await hook({}, this.ctx);
	}

	// Simulates the instance vanishing WITHOUT a clean shutdown (crash, pane
	// closed, herdr tab killed) — the exact real-incident scenario. Marks it
	// so the test's own cleanup pass in main() doesn't ALSO try a clean
	// shutdown afterwards (which would double-publish/close an already-dead
	// MQTT client).
	async simulateHardCrash() {
		this.shutdownCalled = true;
		try { await this.harness.hooks.get("session_shutdown")?.({}, this.ctx); } catch { /* best-effort */ }
	}
}

async function makeInstance(label, instance, role, cwd, project) {
	const fi = new FakeInstance(label, { instance, role, project, broker: BROKER_URL, "config-dir": "agents", "prompts-dir": "prompts" }, cwd);
	ALL_INSTANCES.push(fi);
	await fi.start();
	return fi;
}

async function waitUntil(predicate, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 40));
	}
	throw new Error(`waitUntil timed out: ${label}`);
}

async function runScenario(cwd, project) {
	console.log("\n=== TEST 1 — an orphaned ticket (assigned instance confirmably offline) is auto-failed and the planner is woken with a MANDATORY relaunch instruction ===");
	const planner = await makeInstance("planner", "planner-01", "planner", cwd, project);
	const coder = await makeInstance("coder", "coder-01", "coder", cwd, project);

	subClient = await mqtt.connectAsync(BROKER_URL, { protocolVersion: 5 });
	const seenRunEvents = [];
	subClient.on("message", (_topic, payload) => {
		try { seenRunEvents.push(JSON.parse(payload.toString("utf-8"))); } catch { /* ignore */ }
	});

	const runResult = await planner.call("run_create", { objective: "instance-liveness test objective", domain: "software" });
	const runId = runResult.details.run.id;
	await subClient.subscribeAsync(`pi/${project}/runs/${runId}/events`, { qos: 0 });

	const ticketResult = await planner.call("ticket_create", { run_id: runId, title: "orphan-on-purpose ticket" });
	const ticketId = ticketResult.details.ticket.id;

	await coder.call("ticket_claim", { ticket_id: ticketId });

	const preCrashCheck = await planner.call("run_watchdog_check", { run_id: runId });
	ok(preCrashCheck.details.orphaned.length === 0, "run_watchdog_check: a ticket whose instance is still live is never reported orphaned");

	// The real incident: coder-01's herdr tab/process just disappears — no
	// ticket_complete, no clean shutdown from the coder's own side. We
	// simulate this with a REAL clean disconnect (publishes real "offline"
	// presence over MQTT, closes the real client) rather than faking the
	// presence map directly — the orphan check reads the SAME presence Map
	// the rest of the extension does, populated only by real MQTT messages.
	await coder.simulateHardCrash();

	await waitUntil(
		() => planner.watchdogMessages().some((m) => m.msg?.details?.ticket_id === ticketId && m.msg?.content?.includes("OFFLINE")),
		5000,
		"planner receives a mandatory-relaunch orchestrator-watchdog message once coder-01's offline presence propagates (no elapsed-time wait needed)",
	);
	const orphanMsg = planner.watchdogMessages().find((m) => m.msg?.details?.ticket_id === ticketId && m.msg?.content?.includes("OFFLINE"));
	ok(orphanMsg.msg.display === true, "the orphan alert is display:true (visible to the operator)");
	ok(orphanMsg.opts.deliverAs === "followUp" && orphanMsg.opts.triggerTurn === true, "delivered as followUp+triggerTurn — actually wakes the planner's turn, not a passive log line");
	ok(orphanMsg.msg.content.includes("coder-01"), "the message names the actual offline instance");
	ok(orphanMsg.msg.content.includes("NON eseguire tu il lavoro"), "the message EXPLICITLY forbids the planner from doing the ticket's work itself — the exact real incident this closes");
	ok(orphanMsg.msg.content.toLowerCase().includes("rilanci"), "the message gives a mandatory instruction to relaunch the instance, not just a passive warning");

	await waitUntil(
		() => seenRunEvents.some((e) => e.type === "ticket_failed" && e.payload?.ticket_id === ticketId),
		3000,
		"a real ticket_failed event (auto-generated by the orphan sweep) arrives on the run's MQTT events topic",
	);

	const statusAfter = await planner.call("run_status", { run_id: runId });
	const ticketAfter = statusAfter.details.tickets.find((t) => t.id === ticketId);
	ok(ticketAfter.status === "failed", "the orphaned ticket was automatically flipped from running to failed by the watchdog — no waiting for a human/LLM decision");
	ok(ticketAfter.result_summary.includes("offline"), "the auto-generated result_summary explains WHY it was failed (instance offline), for the audit trail");

	const postCheck = await planner.call("run_watchdog_check", { run_id: runId });
	ok(postCheck.details.orphaned.length === 0, "run_watchdog_check: once auto-failed, the ticket is no longer 'running' so it drops out of the orphaned list too");

	console.log("\n=== TEST 2 — ticket_claim structurally refuses the planner role — no prompt-only rule to forget ===");
	const ticket2 = (await planner.call("ticket_create", { run_id: runId, title: "planner must never claim this" })).details.ticket;
	await expectError(planner.call("ticket_claim", { ticket_id: ticket2.id }), "the planner role may never claim a ticket", "ticket_claim: refused outright for the planner role");

	console.log("\n=== TEST 3 — ticket_complete is UNCHANGED: the planner completing someone else's ticket (done or failed) is still the normal, by-design flow ===");
	const coder2 = await makeInstance("coder2", "coder-02", "coder", cwd, project);
	await coder2.call("ticket_claim", { ticket_id: ticket2.id });
	const plannerDoneOverride = await planner.call("ticket_complete", { ticket_id: ticket2.id, status: "done", result_summary: "planner satisfied with coder-02's work, closing per the normal plan_advance flow" });
	ok(plannerDoneOverride.details.ticket.status === "done", "ticket_complete: the planner marking someone else's ticket 'done' is a regression guard, not a new restriction — this is the documented normal flow (prompts/planner.md), not the Revisione 42 incident (which never went through ticket_claim/ticket_complete at all)");

	console.log("\n=== TEST 4 — agent_terminate: a real control message forces the target through a real clean shutdown ===");
	const coder3 = await makeInstance("coder3", "coder-03", "coder", cwd, project);
	await waitUntil(async () => (await planner.call("agent_list")).details.agents.some((a) => a.instance === "coder-03" && a.status !== "offline"), 3000, "planner sees coder-03 as live via real presence before terminating it");

	const terminateResult = await planner.call("agent_terminate", { target_instance: "coder-03", reason: "smoke test: verifying the kill mechanism" });
	ok(terminateResult.details.target === "coder-03" && terminateResult.details.was_live === true, "agent_terminate reports it found a live target before sending");

	await waitUntil(
		async () => (await planner.call("agent_list")).details.agents.some((a) => a.instance === "coder-03" && a.status === "offline"),
		3000,
		"coder-03's REAL retained MQTT presence flips to offline after receiving the terminate control message — cleanShutdown() actually ran",
	);
	coder3.shutdownCalled = true; // already went through its own real shutdown via handleTerminate — don't double-shutdown in main()'s cleanup pass

	await expectError(planner.call("agent_terminate", { target_instance: "planner-01" }), "refusing to terminate yourself", "agent_terminate: refuses to target yourself");

	console.log("\n=== TEST 5 — agent_list stays crash-free reading a genuinely offline peer (Revisione 41 regression guard) ===");
	const listAfterOffline = await planner.call("agent_list");
	ok(Array.isArray(listAfterOffline.details.agents), "agent_list still returns cleanly after multiple peers (coder-01, coder-03) went offline in this same scenario");
}

async function main() {
	console.log("Instance-liveness smoke test (Revisione 42) — REAL extensions/orchestrator.ts, REAL SQLite, REAL MQTT broker.\n");
	const project = "liveness-test-" + Math.random().toString(36).slice(2, 8);
	const cwd = await bootstrapScratchRepo();
	console.log(`scratch repo: ${cwd}`);
	try {
		await runScenario(cwd, project);
		console.log(`\n${PASS} assertions passed.`);
		console.log("INSTANCE LIVENESS SMOKE TEST PASSED");
	} catch (err) {
		console.error("\nINSTANCE LIVENESS SMOKE TEST FAILED:", err);
		process.exitCode = 1;
	} finally {
		for (const inst of ALL_INSTANCES) {
			try { await inst.shutdown(); } catch { /* best-effort */ }
		}
		if (subClient) {
			try { await subClient.endAsync(true); } catch { /* best-effort */ }
		}
		try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best-effort */ }
	}
}

main();
