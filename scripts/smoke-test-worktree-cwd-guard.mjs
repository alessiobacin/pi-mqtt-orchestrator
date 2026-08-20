// REAL test of the "refuse to start from inside a worktree" guard
// (Revisione 30) — added after the SAME real incident as
// scripts/smoke-test-response-wakeup.mjs surfaced a second root cause for:
// an instance was launched with its cwd already set to
// ".../.worktrees/<slug>/" instead of the project root. Every path this
// extension computes (worktreePaths, moaWorkspaceDir → the SQLite
// orchestrator.db, reportPath, locksPath) joins onto identity.cwd assuming
// it's the project root — from inside a worktree instead, everything
// silently resolves one level too deep into a nested, empty, throwaway
// tree (a brand-new orchestrator.db with none of the real tickets/runs in
// it), which is exactly why that instance couldn't find the ticket/run its
// delegator referenced. This guard makes session_start refuse to proceed at
// all rather than silently computing wrong paths for an entire session.
//
// Same discipline as the other smoke-test-*.mjs files: dynamically imports
// the REAL extensions/orchestrator.ts. Deliberately does NOT need a real
// MQTT broker — the whole point is that the guard fires and returns BEFORE
// any MQTT connection is attempted, so this stays fast and broker-independent.
//
// Usage: node --experimental-strip-types scripts/smoke-test-worktree-cwd-guard.mjs

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");

let PASS = 0;
function ok(cond, msg) {
	if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
	PASS++;
	console.log(`   OK — ${msg}`);
}

function makeFakePi(flagValues) {
	const tools = new Map();
	const hooks = new Map();
	const commands = new Map();
	const appendedEntries = [];
	const pi = {
		registerFlag() {},
		getFlag(name) { return flagValues[name]; },
		registerTool(def) { tools.set(def.name, def); },
		on(event, handler) { hooks.set(event, handler); },
		registerCommand(name, def) { commands.set(name, def); },
		appendEntry(kind, data) { appendedEntries.push({ kind, data }); },
		sendMessage() {},
	};
	return { pi, tools, hooks, commands, appendedEntries };
}

function makeCtx(cwd) {
	const notifications = [];
	return {
		cwd,
		hasUI: false,
		ui: {
			notify(message, level) { notifications.push({ message, level }); },
			setWidget() {},
		},
		sessionManager: { getBranch() { return []; } },
		_notifications: notifications,
	};
}

async function main() {
	console.log("Worktree cwd guard smoke test (Revisione 30) — REAL extensions/orchestrator.ts.\n");
	const modUrl = pathToFileURL(path.join(PROJECT_ROOT, "extensions", "orchestrator.ts")).href;
	const mod = await import(modUrl);

	console.log("=== TEST 1 — session_start refuses when cwd is already inside a worktree ===");
	const badCwd = path.join(PROJECT_ROOT, ".worktrees", "url-shortener");
	const harnessBad = makeFakePi({ instance: "coder-01", role: "coder", project: "guard-test", broker: "mqtt://127.0.0.1:1", "config-dir": "agents", "prompts-dir": "prompts" });
	mod.default(harnessBad.pi);
	const ctxBad = makeCtx(badCwd);
	const sessionStartBad = harnessBad.hooks.get("session_start");
	await sessionStartBad({}, ctxBad);

	ok(ctxBad._notifications.some((n) => n.level === "error" && n.message.includes(".worktrees")), "an error notification naming .worktrees is shown");
	ok(ctxBad._notifications.some((n) => n.message.includes("root del progetto")), "the notification tells the operator to relaunch from the project root");
	ok(!harnessBad.appendedEntries.some((e) => e.data?.event === "connected"), "no MQTT 'connected' event is ever appended — the guard returns before any connection attempt");
	// A deeper nesting (a worktree inside a worktree, however that came to be) must be caught too.
	const nestedBadCwd = path.join(PROJECT_ROOT, "some", ".worktrees", "foo", "extra");
	const harnessNested = makeFakePi({ instance: "coder-02", role: "coder", project: "guard-test", broker: "mqtt://127.0.0.1:1", "config-dir": "agents", "prompts-dir": "prompts" });
	mod.default(harnessNested.pi);
	const ctxNested = makeCtx(nestedBadCwd);
	await harnessNested.hooks.get("session_start")({}, ctxNested);
	ok(ctxNested._notifications.some((n) => n.level === "error" && n.message.includes(".worktrees")), "the guard also catches .worktrees appearing mid-path, not just as the last segment");

	console.log("\n=== TEST 2 — a project root cwd (no .worktrees segment) is never blocked by this guard ===");
	// A sibling directory that merely CONTAINS the substring ".worktreesXYZ" as
	// part of a longer segment name must NOT be mistaken for an actual
	// .worktrees path component (the guard checks path SEGMENTS, not substrings).
	// This cwd doesn't need to be a real project checkout for THIS assertion —
	// session_start will go on to try loadConfig/a real MQTT connect past the
	// guard (that's the whole point: the guard doesn't stop it), so it's shut
	// down again immediately afterwards rather than left connecting/retrying
	// in the background for the rest of this process's life.
	const lookalikeCwd = path.join(PROJECT_ROOT, ".worktreesXYZ-not-really");
	const harnessLookalike = makeFakePi({ instance: "coder-03", role: "coder", project: "guard-test", broker: "mqtt://127.0.0.1:1", "config-dir": "agents", "prompts-dir": "prompts" });
	mod.default(harnessLookalike.pi);
	const ctxLookalike = makeCtx(lookalikeCwd);
	await harnessLookalike.hooks.get("session_start")({}, ctxLookalike);
	ok(!ctxLookalike._notifications.some((n) => n.level === "error" && n.message.includes(".worktrees")), "a directory name that merely CONTAINS \".worktrees\" as a substring (not an exact path segment) is not falsely flagged");
	const shutdownLookalike = harnessLookalike.hooks.get("session_shutdown");
	if (shutdownLookalike) await shutdownLookalike();

	console.log(`\n${PASS} assertions passed.`);
	console.log("WORKTREE CWD GUARD SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("\nWORKTREE CWD GUARD SMOKE TEST FAILED:", err);
	process.exitCode = 1;
});
