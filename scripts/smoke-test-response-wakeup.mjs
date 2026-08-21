// REAL test of the agent_send reply/timeout wake-up fix (Revisione 30) — the
// feature added after a real incident: coder-01 was delegated real work via
// agent_send (fire-and-forget, not agent_await), did the work, committed it,
// and its turn ended normally — the orchestrator's own agent_end hook
// auto-replied with the last assistant message, exactly as designed. But
// planner-01's turn had ALSO already ended by then (it was not blocked
// inside agent_await), and handleResponse() only resolved an in-memory
// Promise nobody was still awaiting — so the reply was silently absorbed and
// nothing ever told planner-01 that work was done. Unlike handleCommand
// (which always wakes the RECIPIENT of a task via pi.sendMessage), nothing
// woke the SENDER when its reply came back. This is a different failure mode
// than the Revisione 29 watchdog (which only detects a ticket stuck
// "running" past a wall-clock threshold) — here the ticket/DAG layer isn't
// even necessarily involved, and the reply legitimately arrived on time; it
// just had nowhere to go.
//
// Same discipline as scripts/smoke-test-watchdog.mjs: dynamically imports
// the REAL extensions/orchestrator.ts and drives it through a FakeInstance
// harness, against a REAL local mosquitto broker.
//
// What this DOES verify:
//  - a reply that lands while the sender's turn has already ended now wakes
//    that turn via pi.sendMessage (followUp + triggerTurn), carrying the
//    responder and the response content;
//  - a sender actively blocked inside agent_await for that exact
//    assignment_id does NOT also get a redundant wake-up message (the
//    entry.awaiting gate) — it gets the result as agent_await's own return
//    value instead, same as before this fix;
//  - an assignment that NEVER gets a reply within TIMEOUT_MS also wakes the
//    sender (a different customType, "orchestrator-timeout") instead of
//    silently vanishing, and attempts a WhatsApp notification for it (best
//    effort — no .env in the scratch repo, so it will report not-configured,
//    but the attempt itself, with the right reason, must be logged).
//
// What this does NOT verify: the real Evolution API HTTP call shape (already
// covered by scripts/smoke-test-whatsapp-notify.mjs) — only that
// sendWhatsAppNotification is actually invoked with reason
// "agent_send_timeout" on this path.
//
// Usage: node --experimental-strip-types scripts/smoke-test-response-wakeup.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const execFileP = promisify(execFile);
const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const BROKER_URL = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";

// Short enough to keep this test fast — the timeout branch under test needs
// to actually fire within the test's lifetime.
process.env.PI_ORCH_TIMEOUT_MS = "500";

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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-response-wakeup-"));
	await git(["init", "-q"], dir);
	await git(["config", "user.email", "response-wakeup-test@test.local"], dir);
	await git(["config", "user.name", "Response Wakeup Test"], dir);
	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	for (const f of ["agents.yaml", "roles.yaml"]) {
		fs.copyFileSync(path.join(PROJECT_ROOT, "agents", f), path.join(dir, "agents", f));
	}
	fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\nlogs/\n.pi/\n");
	await git(["add", "-A"], dir);
	await git(["commit", "-q", "-m", "initial scratch repo (response-wakeup test)"], dir);
	return dir;
}

// ━━ Fake pi / ctx harness — same shape as scripts/smoke-test-watchdog.mjs.
// sessionManager.getBranch() returns a single fake assistant message so
// agent_end's auto-reply has real (non-empty) text to publish. ━━━━━━━━━━━━━

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

function makeCtx(cwd, assistantText) {
	const widgets = new Map();
	return {
		cwd,
		hasUI: false,
		ui: {
			notify() {},
			setWidget(name, factory, opts) { widgets.set(name, { factory, opts }); },
		},
		sessionManager: {
			getBranch() {
				return assistantText == null ? [] : [{ type: "message", message: { role: "assistant", content: assistantText } }];
			},
		},
	};
}

let modPromiseCache = null;
const ALL_INSTANCES = [];

class FakeInstance {
	constructor(label, flagValues, cwd, assistantText) {
		this.label = label;
		this.flagValues = flagValues;
		this.cwd = cwd;
		this.harness = makeFakePi(flagValues);
		this.ctx = makeCtx(cwd, assistantText);
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

	async endTurn() {
		// Simulates the instance's pi turn ending normally — agent_end fires,
		// and (if there's an unfulfilled inbound) auto-replies with whatever
		// sessionManager.getBranch() says was the last assistant message.
		const hook = this.harness.hooks.get("agent_end");
		if (!hook) throw new Error(`${this.label}: agent_end hook not registered`);
		await hook({}, this.ctx);
	}

	responseWakeups() {
		return this.harness.sentMessages.filter((m) => m.msg?.customType === "orchestrator-response");
	}

	timeoutWakeups() {
		return this.harness.sentMessages.filter((m) => m.msg?.customType === "orchestrator-timeout");
	}

	inboundWakeups() {
		return this.harness.sentMessages.filter((m) => m.msg?.customType === "orchestrator-inbound");
	}

	logLines() {
		// Revisione 37 relocated per-instance debug logs from the project-root
		// `logs/<instance>.jsonl` to `.pi/extensions/multiAgentOrchestrator/logs/`
		// (the workspace's gitignored area), so resolve them there instead.
		const file = path.join(this.cwd, ".pi", "extensions", "multiAgentOrchestrator", "logs", `${this.flagValues.instance}.jsonl`);
		if (!fs.existsSync(file)) return [];
		return fs.readFileSync(file, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
	}

	async shutdown() {
		const hook = this.harness.hooks.get("session_shutdown");
		if (hook) await hook({}, this.ctx);
	}
}

async function makeInstance(label, instance, role, cwd, project, assistantText) {
	const fi = new FakeInstance(label, { instance, role, project, broker: BROKER_URL, "config-dir": "agents", "prompts-dir": "prompts" }, cwd, assistantText);
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

// ━━ Main ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function runScenario(cwd, project) {
	console.log("\n=== TEST 1 — a reply that lands after the sender's turn ended now wakes it ===");
	const planner = await makeInstance("planner", "planner-01", "planner", cwd, project, null);
	const coder = await makeInstance("coder", "coder-01", "coder", cwd, project, "lavoro fatto, tutto verde, committato 65a6fc8");

	const sendResult = await planner.call("agent_send", { target_instance: "coder-01", prompt: "implementa la feature X (round 2)" });
	const assignmentId = sendResult.details.assignment_id;
	ok(!!assignmentId, "agent_send returns an assignment_id");

	await waitUntil(() => coder.inboundWakeups().some((m) => m.msg.details.assignment_id === assignmentId), 3000, "coder-01 receives the inbound task wake-up (handleCommand's existing behavior, unaffected by this fix)");

	// Simulate coder-01's turn ending normally, having done the work — this is
	// exactly what a real pi turn does: agent_end auto-replies with the last
	// assistant message, no explicit agent_send-back required from the LLM.
	await coder.endTurn();

	await waitUntil(() => planner.responseWakeups().some((m) => m.msg.details.assignment_id === assignmentId), 3000, "planner-01 is woken with an orchestrator-response message even though its own turn had already ended (THE bug this fixes)");

	const wakeup = planner.responseWakeups().find((m) => m.msg.details.assignment_id === assignmentId);
	ok(wakeup.msg.display === true, "the response wake-up is display:true (visible), not silent");
	ok(wakeup.opts.deliverAs === "followUp" && wakeup.opts.triggerTurn === true, "delivered exactly like an incoming task: followUp + triggerTurn — the same mechanism handleCommand already uses");
	ok(wakeup.msg.details.responder_instance === "coder-01", "wake-up details name the actual responder");
	ok(wakeup.msg.content.includes("coder-01") && wakeup.msg.content.includes("lavoro fatto"), "wake-up content includes both who replied and what they said, not just an assignment_id");

	console.log("\n=== TEST 2 — a sender actively blocked in agent_await does NOT also get a redundant wake-up ===");
	const send2 = await planner.call("agent_send", { target_instance: "coder-01", prompt: "implementa la feature Y (round 3)" });
	const assignmentId2 = send2.details.assignment_id;

	await waitUntil(() => coder.inboundWakeups().some((m) => m.msg.details.assignment_id === assignmentId2), 3000, "coder-01 receives the second inbound task");

	// Kick off agent_await BEFORE the reply lands (it's the one racing
	// entry.promise), then let coder's turn end concurrently.
	const awaitPromise = planner.call("agent_await", { assignment_id: assignmentId2 });
	await new Promise((r) => setTimeout(r, 60)); // give agent_await's execute() a moment to actually start and set entry.awaiting
	await coder.endTurn();
	const awaitResult = await awaitPromise;

	ok(typeof awaitResult.details.response === "string" && awaitResult.details.response.includes("lavoro fatto"), "agent_await itself still returns the reply correctly (unaffected by this fix)");
	ok(!planner.responseWakeups().some((m) => m.msg.details.assignment_id === assignmentId2), "no redundant orchestrator-response wake-up fired for an assignment that was actively agent_await'd — it got the result directly instead");

	console.log("\n=== TEST 3 — an assignment that never gets ANY reply within TIMEOUT_MS also wakes the sender, not silence ===");
	// target_instance deliberately names an instance that will never connect
	// or reply — the MQTT publish succeeds, nobody is there to receive it.
	const send3 = await planner.call("agent_send", { target_instance: "ghost-01", prompt: "questo non riceverà mai risposta" });
	const assignmentId3 = send3.details.assignment_id;

	await waitUntil(() => planner.timeoutWakeups().some((m) => m.msg.details.assignment_id === assignmentId3), 3000, "planner-01 is woken with an orchestrator-timeout message once TIMEOUT_MS (500ms) elapses with no reply at all");

	const timeoutMsg = planner.timeoutWakeups().find((m) => m.msg.details.assignment_id === assignmentId3);
	ok(timeoutMsg.msg.display === true, "the timeout wake-up is display:true");
	ok(timeoutMsg.opts.deliverAs === "followUp" && timeoutMsg.opts.triggerTurn === true, "delivered the same way as every other wake-up in this file");
	ok(timeoutMsg.msg.details.target === "ghost-01", "timeout wake-up details name the target that never answered");
	ok(timeoutMsg.msg.content.includes("ghost-01"), "timeout wake-up content names the unresponsive target");

	await waitUntil(() => planner.logLines().some((l) => l.type === "whatsapp_notify" && l.reason === "agent_send_timeout" && l.assignment_id === assignmentId3), 2000, "a WhatsApp notification attempt for this timeout is logged (reason agent_send_timeout) — no .env here, so it reports not-configured, but the attempt itself must happen");
	const waLine = planner.logLines().find((l) => l.type === "whatsapp_notify" && l.assignment_id === assignmentId3);
	ok(waLine.ok === false, "as expected with no .env in this scratch repo, the WhatsApp send itself reports not-configured rather than throwing");

	console.log("\n=== TEST 4 — agent_await on an assignment that was fire-and-forget-abandoned still works standalone ===");
	// Sanity check unrelated to this fix: agent_get on an unknown/expired
	// assignment_id still degrades gracefully (pre-existing behavior).
	const unknown = await planner.call("agent_get", { assignment_id: "not-a-real-assignment-id" });
	ok(unknown.details.status === "unknown", "agent_get on an unknown assignment_id still reports status:unknown, unaffected by this fix");
}

async function main() {
	console.log("Agent-send response/timeout wake-up smoke test (Revisione 30) — REAL extensions/orchestrator.ts, REAL MQTT broker.\n");
	const project = "response-wakeup-test-" + Math.random().toString(36).slice(2, 8);
	const cwd = await bootstrapScratchRepo();
	console.log(`scratch repo: ${cwd}`);
	try {
		await runScenario(cwd, project);
		console.log(`\n${PASS} assertions passed.`);
		console.log("RESPONSE WAKEUP SMOKE TEST PASSED");
	} catch (err) {
		console.error("\nRESPONSE WAKEUP SMOKE TEST FAILED:", err);
		process.exitCode = 1;
	} finally {
		for (const inst of ALL_INSTANCES) {
			try { await inst.shutdown(); } catch { /* best-effort */ }
		}
		try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best-effort */ }
	}
}

main();
