// REAL end-to-end test of extensions/orchestrator.ts — Revisione 25.
//
// Every previous "smoke test" in this project (smoke-test.mjs,
// smoke-test-worktree.mjs, smoke-test-plan-gate.mjs, ...) is a hand-copied
// MIRROR reimplementation of the extension's logic, never the real file —
// flagged as an open risk in every revision's "Verifica" section since
// Revisione 17. This script closes that gap: it dynamically imports the
// REAL extensions/orchestrator.ts (same node --experimental-strip-types
// ESM-loader path scripts/check-syntax.mjs already uses to prove the file
// parses) and drives it through full multi-instance task flows using:
//   - a REAL local mosquitto broker (mqtt://127.0.0.1:1883) — genuine
//     network pub/sub, not simulated;
//   - REAL git worktrees inside a scratch git repo;
//   - the REAL agents/roles.yaml, agents/agents.yaml, prompts/*.md files
//     from this project (copied verbatim into the scratch repo);
//   - a REAL local HTTP server standing in for Evolution API, to verify
//     WhatsApp notification dispatch end-to-end (same technique as
//     smoke-test-whatsapp-notify.mjs).
//
// Two npm packages the real pi runtime provides are stubbed just enough for
// the module to load and run under plain Node — see
// node_modules/@mariozechner/pi-tui/ (a tiny local stub: the extension only
// uses Text/visibleWidth/truncateToWidth in non-logic TUI rendering code,
// never in any execute()/hook body under test here).
// @mariozechner/pi-coding-agent needs no stub: its only usage in the
// extension is `import type {...}`, fully erased by --experimental-strip-types.
//
// What this DOES verify: every deterministic tool/hook body in the real
// file — worktree_create/finalize/abandon/list_open, plan_set/plan_advance/
// plan_get gating, agent_send's phase gate, file_claim/file_release,
// report_append, the real session_start MQTT wiring, before_agent_start's
// real prompt templating, agent_end's real response publication — executed
// for real, against real git/MQTT/filesystem state.
//
// What this does NOT verify: the LLM-driven decision-making a real `pi`
// agent turn would perform (what to write, when to call which tool) — this
// harness plays that role deterministically via FakeInstance, standing in
// for the LLM. No test against the actual `pi` CLI binary itself.
//
// Usage: node --experimental-strip-types scripts/e2e-full-flow.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const execFileP = promisify(execFile);
const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const BROKER_URL = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";

// This harness creates well over 10 real MQTT clients across all scenarios
// (5 in test 1 alone) — the mqtt package registers a process-level
// SIGINT/SIGTERM listener per client, which trips Node's default
// max-listeners heuristic. Harmless (not a real leak: every client is
// explicitly closed in FakeInstance.shutdown()/the final cleanup loop), but
// noisy — raised deliberately rather than silenced, so a GENUINE leak
// (e.g. a client that's never shut down) still warns past this ceiling.
process.setMaxListeners(64);

let PASS = 0;
function ok(cond, msg) {
	if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
	PASS++;
	console.log(`   OK — ${msg}`);
}

// worktree_create only creates the worktree/branch, not the report dir inside
// it (that's the planner's own job per prompts/planner.md) — mkdir first.
// Revisione 37: reports/ moved under .pi/extensions/multiAgentOrchestrator/
// (gitignored in real scaffolded projects) — kept in sync with reportsDir()
// in extensions/orchestrator.ts.
function writeReportHeader(wtPath, slug, content) {
	const dir = path.join(wtPath, ".pi", "extensions", "multiAgentOrchestrator", "reports");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, `${slug}.md`), content);
}

// Track every FakeInstance ever created so main() can force-shutdown all of
// them in `finally`, regardless of which test threw — each holds an open
// real MQTT socket + unref'd-but-real timers, and leaving any of them
// connected keeps the process alive past normal exit, which is what caused
// the harness to hang instead of failing fast on the first assertion error.
const ALL_INSTANCES = [];

// ━━ Scratch repo bootstrap ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function git(args, cwd) {
	return execFileP("git", args, { cwd });
}

async function makeScratchRepo(evolutionPort) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-e2e-"));
	await git(["init", "-q", "-b", "main"], dir);
	await git(["config", "user.email", "e2e@test.local"], dir);
	await git(["config", "user.name", "E2E Harness"], dir);

	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
	fs.mkdirSync(path.join(dir, ".pi", "extensions", "multiAgentOrchestrator", "reports"), { recursive: true });

	// Copy the REAL config/prompts, not fakes — so the harness exercises the
	// real docs-sync-brief text, the real planner.md instructions text (even
	// if the harness itself supplies the "decisions" instead of an LLM), etc.
	for (const f of ["agents.yaml", "roles.yaml"]) {
		fs.copyFileSync(path.join(PROJECT_ROOT, "agents", f), path.join(dir, "agents", f));
	}
	for (const f of fs.readdirSync(path.join(PROJECT_ROOT, "prompts"))) {
		fs.copyFileSync(path.join(PROJECT_ROOT, "prompts", f), path.join(dir, "prompts", f));
	}

	fs.writeFileSync(
		path.join(dir, "README.md"),
		"# scratch project (e2e harness)\n\nCreated by scripts/e2e-full-flow.mjs — not a real project.\n",
	);
	fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\nlogs/\n");
	fs.writeFileSync(
		path.join(dir, ".env"),
		[
			`EVOLUTION_API_URL=http://127.0.0.1:${evolutionPort}`,
			"EVOLUTION_API_KEY=e2e-test-key",
			"EVOLUTION_INSTANCE_NAME=e2e-whatsapp",
			"DESTINATION_PHONE_NUMBER=393331234567",
		].join("\n") + "\n",
	);
	await git(["add", "-A"], dir);
	await git(["commit", "-q", "-m", "initial scratch repo (e2e harness)"], dir);
	return dir;
}

function startEvolutionStub() {
	const received = [];
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (c) => { body += c; });
		req.on("end", () => {
			let parsed = {};
			try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
			received.push({ method: req.method, url: req.url, headers: req.headers, body: parsed });
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "PENDING" }));
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve({ server, received, port: server.address().port }));
	});
}

// ━━ Fake pi / ctx harness ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function makeFakePi(flagValues) {
	const tools = new Map();
	const hooks = new Map();
	const commands = new Map();
	// Pushed by pi.sendMessage, filtered to actual inbound task deliveries
	// (customType "orchestrator-inbound", from handleCommand). Revisione 30
	// added other customTypes ("orchestrator-response", "orchestrator-timeout")
	// on the SAME pi.sendMessage/inboundEvents-shaped call for a different
	// purpose (waking the sender of an agent_send, not delivering a task) —
	// without this filter those would also land here and shift every
	// index-based waitForInboundTask() lookup below.
	const inboundEvents = [];
	const appendedEntries = []; // pushed by pi.appendEntry
	const pi = {
		registerFlag() { /* no-op: flag values are supplied directly via getFlag below */ },
		getFlag(name) {
			return flagValues[name];
		},
		registerTool(def) {
			tools.set(def.name, def);
		},
		on(event, handler) {
			hooks.set(event, handler);
		},
		registerCommand(name, def) {
			commands.set(name, def);
		},
		appendEntry(kind, data) {
			appendedEntries.push({ kind, data });
		},
		sendMessage(msg, opts) {
			if (msg?.customType === "orchestrator-inbound") inboundEvents.push({ msg, opts });
		},
	};
	return { pi, tools, hooks, commands, inboundEvents, appendedEntries };
}

function makeCtx(cwd) {
	const notifications = [];
	const widgets = new Map();
	let branch = [];
	return {
		cwd,
		hasUI: true,
		ui: {
			notify(msg, level) { notifications.push({ msg, level }); },
			setWidget(name, factory, opts) { widgets.set(name, { factory, opts }); },
		},
		sessionManager: {
			getBranch() { return branch; },
		},
		// test-only helpers, not part of the real ExtensionContext shape
		_notifications: notifications,
		_setBranch(entries) { branch = entries; },
	};
}

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
		// Fresh import per instance is unnecessary — module state is closure-
		// scoped inside the default-exported function (verified by source
		// audit: no top-level mutable `let`), so re-invoking the SAME loaded
		// module gives each instance fully isolated state, exactly like
		// separate real `pi` processes would. Still import once per process
		// and cache it, since dynamic import() of the same URL is idempotent
		// in Node's module cache anyway.
		if (!FakeInstance._modPromise) FakeInstance._modPromise = import(modUrl);
		const mod = await FakeInstance._modPromise;
		mod.default(this.harness.pi);
		const sessionStart = this.harness.hooks.get("session_start");
		if (!sessionStart) throw new Error(`${this.label}: session_start hook not registered`);
		await sessionStart({}, this.ctx);
		// Poll appendedEntries for the "connected" event (published async
		// inside client.on("connect", ...)) instead of a fixed sleep.
		const deadline = Date.now() + 8000;
		while (Date.now() < deadline) {
			if (this.harness.appendedEntries.some((e) => e.data?.event === "connected")) return this;
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`${this.label}: never saw MQTT "connected" event within 8s — is mosquitto running on ${BROKER_URL}?`);
	}

	async beforeAgentStart() {
		const hook = this.harness.hooks.get("before_agent_start");
		if (!hook) return null;
		return hook({}, this.ctx);
	}

	tool(name) {
		const t = this.harness.tools.get(name);
		if (!t) throw new Error(`${this.label}: no tool registered named "${name}"`);
		return t;
	}

	async call(name, params = {}) {
		const t = this.tool(name);
		const result = await t.execute("call-" + Math.random().toString(36).slice(2), params);
		return result;
	}

	// Polls inboundEvents for the task delivered via the real handleCommand()
	// -> pi.sendMessage() path (real MQTT round-trip already happened by the
	// time this resolves) AT A SPECIFIC POSITION (atIndex), not just "the most
	// recent one so far" — when two sends targeting the SAME instance race
	// each other (e.g. two specialists both replying to the planner within
	// milliseconds of each other), "most recent" can silently return the same
	// later event twice for two different callers expecting two different
	// events. Pass the inboundCount captured right before triggering the send
	// this call is waiting on.
	async waitForInboundTask(timeoutMs = 8000, atIndex = 0) {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (this.harness.inboundEvents.length > atIndex) {
				return this.harness.inboundEvents[atIndex];
			}
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`${this.label}: no inbound task at index ${atIndex} within ${timeoutMs}ms`);
	}

	get inboundCount() {
		return this.harness.inboundEvents.length;
	}

	// Simulates finishing an LLM turn: fabricates an assistant message in
	// sessionManager.getBranch() and fires the real agent_end hook, which
	// reads it and publishes the response over real MQTT.
	async endTurn(responseText) {
		this.ctx._setBranch([{ type: "message", message: { role: "assistant", content: responseText } }]);
		const hook = this.harness.hooks.get("agent_end");
		if (!hook) throw new Error(`${this.label}: agent_end hook not registered`);
		await hook({}, this.ctx);
	}

	async shutdown() {
		const hook = this.harness.hooks.get("session_shutdown");
		if (hook) await hook({}, this.ctx);
	}
}

async function makeInstance(label, instance, role, cwd, project) {
	const fi = new FakeInstance(label, {
		instance,
		role,
		project,
		broker: BROKER_URL,
		"config-dir": "agents",
		"prompts-dir": "prompts",
	}, cwd);
	await fi.start();
	await fi.beforeAgentStart();
	ALL_INSTANCES.push(fi);
	return fi;
}

// ━━ Test scenarios ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function test1FullFlow(cwd, project, evo) {
	console.log("\n=== TEST 1 — full successful flow (parallel final phase: security-evaluator + docs-sync) ===");
	const slug = "e2e-full-flow";

	const planner = await makeInstance("planner-01", "planner-01", "planner", cwd, project);
	const coder = await makeInstance("coder-01", "coder-01", "coder", cwd, project);
	const reviewer = await makeInstance("reviewer-01", "reviewer-01", "reviewer", cwd, project);
	const security = await makeInstance("security-evaluator-01", "security-evaluator-01", "security-evaluator", cwd, project);
	const docsSync = await makeInstance("docs-sync-01", "docs-sync-01", "docs-sync", cwd, project);

	// 1. worktree_list_open must be empty before anything is created.
	const listBefore = await planner.call("worktree_list_open");
	ok(listBefore.details.open.length === 0, "worktree_list_open: empty before any worktree_create");

	// 2. worktree_create + report bootstrap.
	const created = await planner.call("worktree_create", { slug });
	ok(created.details.reused === false, "worktree_create: fresh worktree created");
	const wtPath = created.details.worktree_path;
	const reportRel = path.join(".pi", "extensions", "multiAgentOrchestrator", "reports", `${slug}.md`);
	writeReportHeader(wtPath, slug, `# Report: ${slug}\n\n- Task: aggiungi una funzione isPalindrome a src/util.ts\n- Stato: in corso\n`);

	// 3. plan_set with the TDD-exception NOT used here — plain coder+reviewer
	// phase 1, then a parallel final phase security-evaluator+docs-sync.
	const planSet = await planner.call("plan_set", {
		slug,
		phases: [
			{ roles: ["coder"], note: "implementazione" },
			{ roles: ["security-evaluator", "docs-sync"], note: "chiusura task" },
		],
	});
	ok(planSet.details.plan.phases.length === 2, "plan_set: 2-phase plan saved");
	ok(planSet.details.plan.phases[0].status === "unlocked", "plan_set: phase 1 starts unlocked");
	ok(planSet.details.plan.phases[1].status === "locked", "plan_set: phase 2 starts locked");

	// 4. Gate check BEFORE phase 1 completes: sending to docs-sync (phase 2)
	// must be refused by the real agent_send phase gate.
	let gateRefused = false;
	try {
		await planner.call("agent_send", { target_role: "docs-sync", prompt: "troppo presto", slug });
	} catch (err) {
		gateRefused = String(err.message).startsWith("agent_send: refused");
	}
	ok(gateRefused, "agent_send: real phase gate refuses a send to a locked-phase role");

	// 5. planner -> coder (phase 1, always reachable).
	const send1 = await planner.call("agent_send", { target_role: "coder", prompt: `Implementa isPalindrome. worktree_path=${wtPath} report=${reportRel}`, slug });
	ok(!!send1.details.assignment_id, "agent_send: planner -> coder accepted (phase 1 unlocked)");

	const coderInbound = await coder.waitForInboundTask();
	ok(coderInbound.msg.details.assignment_id === send1.details.assignment_id, "coder: received the real MQTT-delivered task (matching assignment_id)");

	// Coder does real work in the real worktree.
	fs.mkdirSync(path.join(wtPath, "src"), { recursive: true });
	fs.writeFileSync(path.join(wtPath, "src", "util.ts"), "export function isPalindrome(s: string): boolean {\n  return s === [...s].reverse().join('');\n}\n");
	await coder.call("report_append", { slug, section: "## Round 1 — coder (`coder-01`)\n\n- Implementato isPalindrome, test manuale: isPalindrome('anna') === true" });

	const send2 = await coder.call("agent_send", { target_role: "reviewer", prompt: `Rivedi isPalindrome. worktree_path=${wtPath} report=${reportRel}`, slug });
	await coder.endTurn("Fatto, ho implementato isPalindrome e girato la review al reviewer.");

	const reviewerInbound = await reviewer.waitForInboundTask();
	ok(reviewerInbound.msg.details.assignment_id === send2.details.assignment_id, "reviewer: received coder's real MQTT-delivered task");
	await reviewer.call("report_append", { slug, section: "## Round 1 — reviewer (`reviewer-01`)\n\n- Codice OK, test rieseguito, approvo." });
	const send3 = await reviewer.call("agent_send", { target_role: "planner", prompt: "Fase 1 completa, richiedo valutazione.", slug });
	await reviewer.endTurn("Approvato, ho girato la valutazione al planner.");

	// Exercise agent_await for real (Promise.race over the real pendingReplies
	// entry) rather than only ever polling agent_send's fire-and-forget
	// return value — send1 (planner->coder) already resolved when coder
	// called endTurn() above, so this proves agent_await picks up an
	// already-settled real MQTT response rather than timing out.
	const awaited = await planner.call("agent_await", { assignment_id: send1.details.assignment_id, timeout_ms: 5000 });
	ok(!awaited.details.error && typeof awaited.details.response === "string" && awaited.details.response.includes("isPalindrome"), "agent_await (real code): blocking wait resolves with coder's real response text");

	// planner picks up reviewer's response via agent_await on send1... but
	// send1 already resolved when coder called endTurn (its response was the
	// text passed to endTurn). What the planner is actually waiting ON here
	// is send3 (reviewer -> planner). Await it for real over MQTT.
	const plannerInbound = await planner.waitForInboundTask();
	ok(plannerInbound.msg.details.assignment_id === send3.details.assignment_id, "planner: received reviewer's real MQTT-delivered completion notice");

	// 6. planner advances phase 1, unlocking phase 2.
	const advanced = await planner.call("plan_advance", { slug, completed_phase: 1 });
	ok(advanced.details.plan.phases[1].status === "unlocked", "plan_advance: phase 2 unlocked after phase 1 marked complete");

	// 7. planner fans out to BOTH final-phase roles in parallel (this is the
	// scenario docs/development-notes.md/architecture.mmd describe as W12).
	const sendSec = await planner.call("agent_send", { target_role: "security-evaluator", prompt: `Verifica isPalindrome. worktree_path=${wtPath} report=${reportRel}`, slug, new_round: true });
	const sendDocs = await planner.call("agent_send", { target_role: "docs-sync", prompt: `Allinea la documentazione. worktree_path=${wtPath} report=${reportRel}`, slug, new_round: true });
	ok(!!sendSec.details.assignment_id && !!sendDocs.details.assignment_id, "agent_send: both final-phase roles reachable once phase 2 unlocked");

	const secInbound = await security.waitForInboundTask();
	ok(secInbound.msg.details.assignment_id === sendSec.details.assignment_id, "security-evaluator: received its real MQTT-delivered task");
	const docsInbound = await docsSync.waitForInboundTask();
	ok(docsInbound.msg.details.assignment_id === sendDocs.details.assignment_id, "docs-sync: received its real MQTT-delivered task");

	// file_claim/file_release contention check while both specialists are in
	// the SAME worktree (this is folded into test 1 for the successful path;
	// a dedicated contention test with two competing holders is test 8).
	const claim = await security.call("file_claim", { slug, file: "src/util.ts" });
	ok(claim.details.claimed === true, "file_claim: security-evaluator claims src/util.ts");
	await security.call("file_release", { slug, file: "src/util.ts" });

	await security.call("report_append", { slug, section: "## Round 1 — security-evaluator (`security-evaluator-01`)\n\n- Nessun problema di sicurezza rilevato." });
	const secDone = await security.call("agent_send", { target_role: "planner", prompt: "Verifica sicurezza completata, nessun problema.", slug });
	await security.endTurn("Verifica sicurezza completata.");

	await docsSync.call("report_append", { slug, section: "## Round 1 — docs-sync (`docs-sync-01`)\n\n- README aggiornato con isPalindrome." });
	const docsDone = await docsSync.call("agent_send", { target_role: "planner", prompt: "Documentazione allineata.", slug });
	await docsSync.endTurn("Documentazione allineata.");

	// planner receives both.
	const plannerInbound2 = await planner.waitForInboundTask(8000, 1);
	const plannerInbound3 = await planner.waitForInboundTask(8000, 2);
	const gotIds = [plannerInbound2.msg.details.assignment_id, plannerInbound3.msg.details.assignment_id].sort();
	const wantIds = [secDone.details.assignment_id, docsDone.details.assignment_id].sort();
	ok(JSON.stringify(gotIds) === JSON.stringify(wantIds), "planner: received BOTH final-phase completions via real MQTT (parallel fan-in)");

	const advanced2 = await planner.call("plan_advance", { slug, completed_phase: 2 });
	ok(advanced2.details.plan.phases[1].status === "complete", "plan_advance: phase 2 (last phase) marked complete");

	// 8. Final report + worktree_finalize — verifies real merge + real
	// WhatsApp dispatch to the stub Evolution API server.
	await planner.call("report_append", { slug, section: "## Report finale\n\nTutti i round completati, isPalindrome implementato, revisionato, verificato per sicurezza, documentato." });

	// Revisione 43: worktree_finalize now also refuses without an explicit
	// docs_synced declaration (or a skip reason) — same checklist pattern as
	// user_confirmed/e2e_tests_run/version_bumped from Revisione 42. Verify the
	// refusal BEFORE the real successful call below (validation runs before the
	// worktree is even touched, so this throws with no side effects).
	await assert.rejects(
		() => planner.call("worktree_finalize", { slug, user_confirmed: true, e2e_tests_run: true, version_bumped: true, push: false }),
		/docs_synced/,
		"worktree_finalize: refuses without docs_synced or docs_sync_skipped_reason (Revisione 43)",
	);
	// Use a slug with no real worktree here (not the task's own slug) so this
	// call fails on "no worktree found" instead of actually merging — proving
	// docs_sync_skipped_reason alone satisfies the checklist (no docs_synced
	// error) without performing a second, unwanted real merge of the task above.
	await assert.rejects(
		() => planner.call("worktree_finalize", { slug: "no-such-task-for-docs-sync-check", user_confirmed: true, e2e_tests_run: true, version_bumped: true, docs_sync_skipped_reason: "no docs apply to this pure-refactor step", push: false }),
		(err) => !/docs_synced/.test(err.message) && /no worktree found/.test(err.message),
		"worktree_finalize: docs_sync_skipped_reason alone (no docs_synced) satisfies the checklist — it fails later, on the worktree lookup, not on the docs-sync check",
	);

	const beforeCount = evo.received.length;
	const finalized = await planner.call("worktree_finalize", { slug, user_confirmed: true, e2e_tests_run: true, version_bumped: true, docs_synced: true, push: false });
	ok(finalized.details.merged === true, "worktree_finalize: real git merge succeeded");
	ok(!fs.existsSync(wtPath), "worktree_finalize: worktree directory actually removed from disk");
	const mainReport = path.join(cwd, reportRel);
	ok(fs.existsSync(mainReport), "worktree_finalize: report file present in MAIN checkout after merge");
	const mainReportText = fs.readFileSync(mainReport, "utf-8");
	ok(mainReportText.includes("isPalindrome"), "worktree_finalize: merged report contains real coder/reviewer content");
	ok(evo.received.length === beforeCount + 1, "worktree_finalize: exactly one real HTTP call made to the stub Evolution API server");
	const lastReq = evo.received[evo.received.length - 1];
	ok(lastReq.method === "POST" && lastReq.url === "/message/sendText/e2e-whatsapp", "worktree_finalize: WhatsApp POST hit the expected Evolution API path");
	ok(lastReq.headers.apikey === "e2e-test-key", "worktree_finalize: WhatsApp request carried the real apikey header from .env");
	ok(typeof lastReq.body.text === "string" && lastReq.body.text.includes(slug), "worktree_finalize: WhatsApp message text names the task slug");

	for (const inst of [planner, coder, reviewer, security, docsSync]) await inst.shutdown();
}

async function test2TddException(cwd, project) {
	console.log("\n=== TEST 2 — TDD-exception phase ordering (tdd-agent alone -> coder -> docs-sync) via the REAL plan_set validator ===");
	const slug = "e2e-tdd-exception";
	const planner = await makeInstance("planner-02", "planner-01", "planner", cwd, project);

	await planner.call("worktree_create", { slug });

	// Missing docs-sync in the last phase must be rejected by the REAL code.
	let rejectedNoDocs = false;
	try {
		await planner.call("plan_set", { slug, phases: [{ roles: ["tdd-agent"] }, { roles: ["coder"] }] });
	} catch (err) {
		rejectedNoDocs = err.message.includes("docs-sync");
	}
	ok(rejectedNoDocs, "plan_set (real code): rejects a plan missing docs-sync in the last phase");

	// tdd-agent alone in phase 1, without coder in phase 2, must also be rejected.
	let rejectedNoCoderPhase2 = false;
	try {
		await planner.call("plan_set", { slug, phases: [{ roles: ["tdd-agent"] }, { roles: ["docs-sync"] }] });
	} catch (err) {
		rejectedNoCoderPhase2 = err.message.includes('"coder" must then be in phase 2');
	}
	ok(rejectedNoCoderPhase2, "plan_set (real code): rejects tdd-agent-alone phase 1 without coder in phase 2");

	// Now a genuinely valid TDD-exception plan.
	const plan = await planner.call("plan_set", { slug, phases: [{ roles: ["tdd-agent"] }, { roles: ["coder"] }, { roles: ["docs-sync"] }] });
	ok(plan.details.plan.phases.length === 3, "plan_set (real code): valid TDD-exception plan (tdd-agent / coder / docs-sync) accepted");
	ok(plan.details.plan.phases[0].status === "unlocked" && plan.details.plan.phases[1].status === "locked", "plan_set (real code): only phase 1 (tdd-agent) starts unlocked");

	await planner.shutdown();
}

async function test3OverlapDetection(cwd, project) {
	console.log("\n=== TEST 3 — worktree_list_open genuinely detects an overlapping worktree from a PRIOR session ===");
	const slug = "e2e-overlap-feature";

	// "Prior session": a planner instance creates a worktree and a report,
	// then goes away (shuts down) without finalizing — exactly the real
	// incident this feature exists to prevent (docs/development-notes.md, Rev. 24).
	const priorPlanner = await makeInstance("planner-prior", "planner-01", "planner", cwd, project);
	const created = await priorPlanner.call("worktree_create", { slug });
	writeReportHeader(created.details.worktree_path, slug, `# Report: ${slug}\n\n- Task: validazione codice fiscale italiano\n- Stato: in corso\n`);
	// worktree_abandon (real code) correctly refuses to remove a worktree with
	// uncommitted changes — commit the report, same as a real coder/planner
	// would, so the later cleanup step exercises the intended path.
	await git(["add", "-A"], created.details.worktree_path);
	await git(["commit", "-q", "-m", "bootstrap report (e2e prior session)"], created.details.worktree_path);
	await priorPlanner.shutdown();

	// "New session": a completely fresh planner instance, with NO memory of
	// the above, must discover the open worktree via worktree_list_open —
	// the real fix for 3-worktrees-same-feature.
	const freshPlanner = await makeInstance("planner-fresh", "planner-01", "planner", cwd, project);
	const list = await freshPlanner.call("worktree_list_open");
	ok(list.details.open.length >= 1, "worktree_list_open (real code): a fresh session sees the prior session's open worktree");
	const found = list.details.open.find((w) => w.slug === slug);
	ok(!!found, "worktree_list_open: the specific overlapping slug is present");
	ok(found.task && found.task.includes("codice fiscale"), "worktree_list_open: real 'Task:' line parsed out of the report header");

	// Clean up via worktree_abandon (simulates the planner, after asking the
	// user, deciding this is genuinely stale and closing it) so it doesn't
	// leak into later tests.
	const abandoned = await freshPlanner.call("worktree_abandon", { slug, reason: "e2e test cleanup" });
	ok(!fs.existsSync(created.details.worktree_path), "worktree_abandon: worktree actually removed from disk");
	const listAfter = await freshPlanner.call("worktree_list_open");
	ok(!listAfter.details.open.some((w) => w.slug === slug), "worktree_list_open: no longer lists the abandoned worktree");

	await freshPlanner.shutdown();
}

async function test4DirtyMainAndConflict(cwd, project) {
	console.log("\n=== TEST 4 — worktree_finalize: dirty-main block, then a REAL merge conflict + worktree_abandon cleanup ===");
	const slug = "e2e-conflict-flow";
	const planner = await makeInstance("planner-04", "planner-01", "planner", cwd, project);

	const created = await planner.call("worktree_create", { slug });
	const wtPath = created.details.worktree_path;
	writeReportHeader(wtPath, slug, `# Report: ${slug}\n\n- Task: modifica README\n- Stato: in corso\n`);
	// Make a REAL conflicting change: edit README.md inside the worktree...
	fs.writeFileSync(path.join(wtPath, "README.md"), "# scratch project (e2e harness)\n\nModificato dal worktree.\n");
	await git(["add", "-A"], wtPath);
	await git(["commit", "-q", "-m", "worktree change to README"], wtPath);

	// ...AND dirty the main checkout itself with an uncommitted, unrelated
	// change — the real Revisione 24 pre-flight check must block on this
	// BEFORE even attempting the merge.
	fs.appendFileSync(path.join(cwd, "README.md"), "\nModifica non committata nella directory principale.\n");
	const blocked = await planner.call("worktree_finalize", { slug, user_confirmed: true, e2e_tests_run: true, version_bumped: true, docs_synced: true, push: false });
	ok(blocked.details.blocked_dirty_main === true, "worktree_finalize (real code): blocked by dirty main checkout BEFORE attempting any merge");
	ok(fs.existsSync(wtPath), "worktree_finalize: worktree left completely intact when blocked");

	// Clean up the simulated dirty state, then ALSO make main conflict for
	// real: edit the SAME line of README.md differently and commit on main.
	await git(["checkout", "--", "README.md"], cwd);
	fs.writeFileSync(path.join(cwd, "README.md"), "# scratch project (e2e harness)\n\nModificato SUL MAIN, in conflitto col worktree.\n");
	await git(["add", "-A"], cwd);
	await git(["commit", "-q", "-m", "main change to README (will conflict)"], cwd);

	const conflicted = await planner.call("worktree_finalize", { slug, user_confirmed: true, e2e_tests_run: true, version_bumped: true, docs_synced: true, push: false });
	ok(conflicted.details.conflict === true && conflicted.details.merged === false, "worktree_finalize (real code): reports a genuine merge conflict");
	ok(Array.isArray(conflicted.details.conflict_files) && conflicted.details.conflict_files.includes("README.md"), "worktree_finalize (real code): automatically lists README.md as the conflicting file");
	ok(fs.existsSync(wtPath), "worktree_finalize: worktree preserved after a conflict, for manual resolution");
	const mainStatusAfterAbort = await git(["status", "--porcelain"], cwd);
	ok(mainStatusAfterAbort.stdout.trim().length === 0, "worktree_finalize: main checkout left clean after merge --abort");

	// Simulate the manual resolution the real incident described: cherry-pick
	// straight into main, bypassing worktree_finalize entirely...
	await git(["checkout", `task/${slug}`, "--", path.join(".pi", "extensions", "multiAgentOrchestrator", "reports")], cwd); // bring the report over manually too
	await git(["add", "-A"], cwd);
	await git(["commit", "-q", "-m", "manual conflict resolution, bypassing worktree_finalize"], cwd);

	// ...then worktree_abandon must close the now-orphaned worktree cleanly.
	const abandoned = await planner.call("worktree_abandon", { slug, reason: "risolto manualmente durante il test e2e" });
	ok(!fs.existsSync(wtPath), "worktree_abandon: orphaned worktree removed after manual resolution");
	const branchList = await git(["branch", "--list", `task/${slug}`], cwd);
	ok(branchList.stdout.trim().length === 0, "worktree_abandon: branch force-deleted by default");

	await planner.shutdown();
}

async function test5FileClaimContention(cwd, project) {
	console.log("\n=== TEST 5 — file_claim/file_release real contention between two specialists sharing a worktree ===");
	const slug = "e2e-claim-contention";
	const planner = await makeInstance("planner-05", "planner-01", "planner", cwd, project);
	const specA = await makeInstance("security-evaluator-05a", "sec-05a", "security-evaluator", cwd, project);
	const specB = await makeInstance("security-evaluator-05b", "sec-05b", "security-evaluator", cwd, project);

	await planner.call("worktree_create", { slug });

	const claimA = await specA.call("file_claim", { slug, file: "src/shared.ts" });
	ok(claimA.details.claimed === true, "file_claim: first specialist claims the file");

	const claimB = await specB.call("file_claim", { slug, file: "src/shared.ts" });
	ok(claimB.details.claimed === false && claimB.details.held_by === "sec-05a", "file_claim (real code): second specialist is refused, told exactly who holds it");

	const releaseB = await specB.call("file_release", { slug, file: "src/shared.ts" });
	ok(releaseB.details.released === false, "file_release: no-op when you don't hold the lock (real code, not just claimed=false silently)");

	const releaseA = await specA.call("file_release", { slug, file: "src/shared.ts" });
	ok(releaseA.details.released === true, "file_release: holder releases successfully");

	const claimB2 = await specB.call("file_claim", { slug, file: "src/shared.ts" });
	ok(claimB2.details.claimed === true, "file_claim: file claimable again by the other specialist after release");

	for (const inst of [planner, specA, specB]) await inst.shutdown();
}

async function test6SpecialistBypassReviewer(cwd, project) {
	console.log("\n=== TEST 6 — specialist finds a problem, sends DIRECT to coder (bypass reviewer), fix routed back to the SAME specialist ===");
	const slug = "e2e-specialist-bypass";
	const planner = await makeInstance("planner-06", "planner-01", "planner", cwd, project);
	const coder = await makeInstance("coder-06", "coder-01", "coder", cwd, project);
	const security = await makeInstance("security-evaluator-06", "security-evaluator-01", "security-evaluator", cwd, project);

	const created = await planner.call("worktree_create", { slug });
	const wtPath = created.details.worktree_path;
	writeReportHeader(wtPath, slug, `# Report: ${slug}\n\n- Task: endpoint di login\n- Stato: in corso\n`);

	// No plan_set here on purpose (ungated slug) — this exercises the direct
	// specialist -> coder -> SAME specialist loop the Revisione 20 rule
	// describes (SP7/SP8/SP9/SP10/SP11 in the flow diagram), independent of
	// the phase-gate machinery tested elsewhere.
	const sendToSec = await planner.call("agent_send", { target_role: "security-evaluator", prompt: `Valuta la sicurezza dell'endpoint di login. worktree_path=${wtPath}`, slug });
	await security.waitForInboundTask();
	await security.call("report_append", { slug, section: "## Round 1 — security-evaluator (`security-evaluator-01`)\n\n- Trovata password loggata in chiaro nei log — richiede fix." });

	// Direct send to coder, bypassing reviewer.
	const sendToCoder = await security.call("agent_send", { target_role: "coder", prompt: "Rimuovi il log della password in chiaro nell'endpoint di login.", slug, new_round: true });
	await security.endTurn("Trovato un problema di sicurezza, ho girato il fix a coder direttamente.");

	const coderInbound = await coder.waitForInboundTask();
	ok(coderInbound.msg.details.assignment_id === sendToCoder.details.assignment_id, "agent_send: coder reachable directly by a specialist (bypassing reviewer) via real MQTT");
	await coder.call("report_append", { slug, section: "## Round 2 — coder (`coder-01`)\n\n- Rimosso il log della password." });

	// Per the Revisione 20 rule: response goes back to the SAME specialist,
	// NOT to reviewer.
	const sendBack = await coder.call("agent_send", { target_role: "security-evaluator", prompt: "Fix applicato: password non più loggata.", slug, new_round: true });
	await coder.endTurn("Fix applicato, ho girato la conferma a security-evaluator.");

	const secInbound2 = await security.waitForInboundTask(8000, 1);
	ok(secInbound2.msg.details.assignment_id === sendBack.details.assignment_id, "agent_send (real code): fix routed back to the SAME specialist that requested it, not to reviewer (Revisione 20 rule)");

	for (const inst of [planner, coder, security]) await inst.shutdown();
}

// ━━ Runner ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
	console.log("REAL e2e harness for extensions/orchestrator.ts — Revisione 25\n");
	console.log(`Broker: ${BROKER_URL}`);

	const evo = await startEvolutionStub();
	console.log(`Stub Evolution API listening on 127.0.0.1:${evo.port}`);
	const cwd = await makeScratchRepo(evo.port);
	console.log(`Scratch repo: ${cwd}`);
	const project = "e2e" + Math.random().toString(36).slice(2, 8);

	try {
		await test1FullFlow(cwd, project, evo);
		await test2TddException(cwd, project);
		await test3OverlapDetection(cwd, project);
		await test4DirtyMainAndConflict(cwd, project);
		await test5FileClaimContention(cwd, project);
		await test6SpecialistBypassReviewer(cwd, project);

		console.log(`\nE2E FULL FLOW TEST PASSED — ${PASS} assertions across 6 scenarios, all against the REAL extensions/orchestrator.ts.`);
		process.exitCode = 0;
	} catch (err) {
		console.error("\nE2E FULL FLOW TEST FAILED:", err);
		process.exitCode = 1;
	} finally {
		// Every FakeInstance holds a real, still-connected MQTT socket (plus its
		// own unref'd heartbeat/stale-sweep timers) — a test that throws mid-way
		// leaves some instances never explicitly shut down, and Node won't exit
		// on its own while those sockets are open. Force-close everything ever
		// created, then hard-exit, instead of leaving the harness to hang.
		for (const inst of ALL_INSTANCES) {
			try { await inst.shutdown(); } catch { /* best-effort */ }
		}
		evo.server.close();
		try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best-effort */ }
	}
	process.exit(process.exitCode ?? 0);
}

main();
