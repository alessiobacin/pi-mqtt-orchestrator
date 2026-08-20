// REAL test of the stall-detection watchdog (Revisione 29) — the feature
// added after a real incident: a worker's single LLM turn hung/got truncated
// by the model provider with NOT ONE tool call along the way (no
// report_append, no retry, nothing), and nothing in the system ever noticed
// or told the planner. Presence/heartbeat could NOT have caught this (the
// process's event loop stays alive during an in-flight HTTP call, so it kept
// publishing "status: working" the whole time) — the only externally
// observable signal is wall-clock time on the ticket layer itself.
//
// Follows the Revisione 25/26 discipline (see scripts/e2e-full-flow.mjs,
// scripts/smoke-test-ticket-engine.mjs): dynamically imports the REAL
// extensions/orchestrator.ts and drives it through a FakeInstance harness,
// against a REAL local mosquitto broker and a REAL SQLite database on disk.
//
// What this DOES verify: the automatic background sweep (planner-only)
// detects a ticket stuck "running" past the stall threshold, records a
// ticket_stalled SQLite event, publishes it on run_events (real MQTT),
// wakes the planner's own turn via pi.sendMessage with an actionable
// message, and escalates again (not a duplicate no-op) if the same running
// episode crosses a second stall-threshold multiple unresolved. Also
// verifies the manual run_watchdog_check tool reports the same state
// on-demand, and that a ticket already completed is never reported stalled.
//
// What this does NOT verify: re-arming after a ticket is reassigned to a
// fresh running episode (the per-episode dedupe key is `ticket_id::
// running_since` — exercised by code reading, not by a second full
// wait-cycle here, to keep this test's runtime reasonable); an actual
// truncated/hung LLM turn (out of scope for a tool-level test — this
// verifies the detection/escalation machinery around a ticket that is
// genuinely stuck in "running", regardless of why).
//
// Usage: node --experimental-strip-types scripts/smoke-test-watchdog.mjs

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

// Small enough to keep this test fast, large enough that the sweep interval
// (below) gets several chances to observe each threshold crossing without
// racing it.
process.env.PI_ORCH_WATCHDOG_STALL_MS = "400";
process.env.PI_ORCH_WATCHDOG_INTERVAL_MS = "120";

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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-watchdog-"));
	await git(["init", "-q"], dir);
	await git(["config", "user.email", "watchdog-test@test.local"], dir);
	await git(["config", "user.name", "Watchdog Test"], dir);
	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	for (const f of ["agents.yaml", "roles.yaml"]) {
		fs.copyFileSync(path.join(PROJECT_ROOT, "agents", f), path.join(dir, "agents", f));
	}
	fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\nlogs/\n.pi/\n");
	await git(["add", "-A"], dir);
	await git(["commit", "-q", "-m", "initial scratch repo (watchdog test)"], dir);
	return dir;
}

// ━━ Fake pi / ctx harness — same shape as scripts/e2e-full-flow.mjs, plus
// capturing sendMessage() calls (a no-op stub in the sibling smoke tests,
// since none of them need to observe it — this one specifically verifies
// the watchdog wakes the planner's own turn through it). ━━━━━━━━━━━━━━━━━━━

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
		ui: {
			notify() {},
			setWidget(name, factory, opts) { widgets.set(name, { factory, opts }); },
		},
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

async function waitUntil(predicate, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((r) => setTimeout(r, 40));
	}
	throw new Error(`waitUntil timed out: ${label}`);
}

// ━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runScenario(cwd, project) {
	console.log("\n=== TEST 1 — a ticket claimed and left running triggers the automatic watchdog ===");
	const planner = await makeInstance("planner", "planner-01", "planner", cwd, project);
	const coder = await makeInstance("coder", "coder-01", "coder", cwd, project);

	// Real MQTT subscriber, independent of the extension's own client, to
	// verify run_events actually carries the ticket_stalled event — not just
	// that SQLite/pi.sendMessage saw it (same technique as
	// scripts/smoke-test-ticket-engine.mjs TEST 2).
	subClient = await mqtt.connectAsync(BROKER_URL, { protocolVersion: 5 });
	const seenRunEvents = [];
	subClient.on("message", (_topic, payload) => {
		try { seenRunEvents.push(JSON.parse(payload.toString("utf-8"))); } catch { /* ignore */ }
	});

	const runResult = await planner.call("run_create", { objective: "watchdog test objective", domain: "software" });
	const runId = runResult.details.run.id;
	await subClient.subscribeAsync(`pi/${project}/runs/${runId}/events`, { qos: 0 });

	const ticketResult = await planner.call("ticket_create", { run_id: runId, title: "stuck-on-purpose ticket" });
	const ticketId = ticketResult.details.ticket.id;

	// run_watchdog_check on a ticket that isn't even claimed yet: never stalled.
	const preClaimCheck = await planner.call("run_watchdog_check", { run_id: runId });
	ok(preClaimCheck.details.stalled.length === 0, "run_watchdog_check: an unclaimed (pending) ticket is never reported stalled");

	const claimedAt = Date.now();
	await coder.call("ticket_claim", { ticket_id: ticketId });
	// Simulate exactly the real incident: the worker claims the ticket, then
	// its turn hangs/gets truncated — it never calls ticket_complete, never
	// calls anything else. From here on, coder-01 is simply never touched
	// again; only planner-01's background watchdog is expected to notice.

	const freshCheck = await planner.call("run_watchdog_check", { run_id: runId });
	ok(freshCheck.details.stalled.length === 0, "run_watchdog_check: a just-claimed ticket is not yet stalled");

	await waitUntil(
		() => planner.watchdogMessages().length >= 1,
		5000,
		"planner receives a first orchestrator-watchdog pi.sendMessage() within 5s of the ticket going stale",
	);
	const firstAlertAt = Date.now();
	ok(firstAlertAt - claimedAt >= 400, "the first alert did not fire before the configured stall threshold (400ms)");

	const firstMsg = planner.watchdogMessages()[0];
	ok(firstMsg.msg.display === true, "the watchdog message is marked display:true (visible to the operator, not silent)");
	ok(firstMsg.opts.deliverAs === "followUp" && firstMsg.opts.triggerTurn === true, "the watchdog message is delivered exactly like an incoming agent_send (followUp + triggerTurn) — the same mechanism that already wakes an idle planner turn");
	ok(firstMsg.msg.content.includes(ticketId) && firstMsg.msg.content.includes("coder-01"), "the injected message names the specific stuck ticket and its assigned instance, not a generic alert");
	ok(firstMsg.msg.details.ticket_id === ticketId && firstMsg.msg.details.run_id === runId, "the watchdog message details carry ticket_id/run_id for programmatic handling too");

	await waitUntil(
		() => seenRunEvents.some((e) => e.type === "ticket_stalled" && e.payload?.ticket_id === ticketId),
		3000,
		"a real ticket_stalled event arrives on the run's MQTT events topic",
	);
	ok(true, "ticket_stalled published on the real run_events MQTT topic (not just recorded locally)");

	const statusAfterFirstAlert = await planner.call("run_status", { run_id: runId });
	const stalledInStatus = statusAfterFirstAlert.details.stalled_tickets;
	ok(stalledInStatus.length === 1 && stalledInStatus[0].ticket_id === ticketId, "run_status also surfaces the stalled ticket directly, without a separate run_watchdog_check call");
	const recentEventTypes = statusAfterFirstAlert.details.recent_events.map((e) => e.type);
	ok(recentEventTypes.includes("ticket_stalled"), "ticket_stalled is a real persisted SQLite event, visible in run_status's recent_events (audit trail)");

	console.log("\n=== TEST 2 — an unresolved stall escalates again, it does not just repeat silently or spam every tick ===");
	await waitUntil(
		() => planner.watchdogMessages().length >= 2,
		5000,
		"a SECOND orchestrator-watchdog message fires once the ticket has been stuck for a second full stall period",
	);
	const secondMsg = planner.watchdogMessages()[1];
	ok(secondMsg.msg.details.threshold_level === 2, "the second alert is recorded as escalation level 2 (crossed a second WATCHDOG_STALL_MS multiple), not a duplicate of level 1");
	// Give the sweep a few more idle ticks (well under a third threshold
	// crossing) to prove it does NOT fire on every single interval tick once
	// past a level — only on crossing a NEW multiple.
	await new Promise((r) => setTimeout(r, 300));
	ok(planner.watchdogMessages().length === 2, "no spam: the watchdog does not re-alert on every sweep tick while still below the next threshold multiple");

	console.log("\n=== TEST 3 — resolving the ticket clears it from both the manual check and run_status ===");
	await planner.call("ticket_complete", { ticket_id: ticketId, status: "failed", result_summary: "simulated stuck worker, marked failed by the test" });
	const postCompleteCheck = await planner.call("run_watchdog_check", { run_id: runId });
	ok(postCompleteCheck.details.stalled.length === 0, "run_watchdog_check: a completed (failed) ticket is no longer reported stalled");
	const postCompleteStatus = await planner.call("run_status", { run_id: runId });
	ok(postCompleteStatus.details.stalled_tickets.length === 0, "run_status: same, via the automatically-included stalled_tickets field");

	console.log("\n=== TEST 4 — the manual run_watchdog_check tool works even without waiting for the automatic sweep ===");
	// coder is never given a watchdog timer at all (planner-only) — confirms
	// the manual tool still works correctly from a non-planner instance,
	// exercising the "any role may call this" part of the tool description.
	const secondTicket = (await planner.call("ticket_create", { run_id: runId, title: "second stuck-on-purpose ticket" })).details.ticket;
	await coder.call("ticket_claim", { ticket_id: secondTicket.id });
	await waitUntil(async () => {
		const r = await coder.call("run_watchdog_check", { run_id: runId });
		return r.details.stalled.length === 1 && r.details.stalled[0].ticket_id === secondTicket.id;
	}, 3000, "run_watchdog_check called from the coder instance (no background timer of its own) still correctly reports the stall once past the threshold");
	// coder never had its own watchdogTimer, yet still saw no orchestrator-watchdog pi.sendMessage of its own.
	ok(coder.watchdogMessages().length === 0, "the watchdog escalation (pi.sendMessage/WhatsApp/SQLite event) is planner-only — a non-planner instance never fires it itself, even though it CAN read the same stalled state on demand");
	await planner.call("ticket_complete", { ticket_id: secondTicket.id, status: "failed" });
}

async function main() {
	console.log("Watchdog smoke test (Revisione 29) — REAL extensions/orchestrator.ts, REAL SQLite, REAL MQTT broker.\n");
	const project = "watchdog-test-" + Math.random().toString(36).slice(2, 8);
	const cwd = await bootstrapScratchRepo();
	console.log(`scratch repo: ${cwd}`);
	try {
		await runScenario(cwd, project);
		console.log(`\n${PASS} assertions passed.`);
		console.log("WATCHDOG SMOKE TEST PASSED");
	} catch (err) {
		console.error("\nWATCHDOG SMOKE TEST FAILED:", err);
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
