// REAL functional test of scripts/launch-planner.mjs's Revisione 44
// generalization — launching ANY role (not just planner) through the same
// `-e` detection logic, with mattpocock skill flags attached ONLY for
// planner. Real incident this closes (see docs/development-notes.md,
// Revisione 44): the planner's own prompt (prompts/planner.md) hand-composed
// `pi -e extensions/orchestrator.ts --instance <nome> --role <ruolo>` to
// launch coder/reviewer/specialist instances via herdr/tmux — stale advice
// since Revisione 33 (a scaffolded project has no local extensions/orchestrator.ts
// any more), so the spawned `pi` process errored out immediately and the
// herdr pane/tmux session died on the spot. This script (and `po start`)
// previously refused any --role other than "planner" outright, pointing
// operators/the planner right back at that same stale command. Fixed: any
// role now goes through the identical, already-correct `-e`
// detection/composition logic used for planner.
//
// Spawns the REAL scripts/launch-planner.mjs as a child process (never a
// hand-copied mirror), same as `po start --instance <x> --role <y>
// --print-only` would.
//
// Usage: node scripts/smoke-test-launch-any-role.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const LAUNCH_SCRIPT = path.join(PACKAGE_ROOT, "scripts", "launch-planner.mjs");

let PASS = 0;
function ok(cond, msg) {
	if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
	PASS++;
	console.log(`   OK — ${msg}`);
}

function run(cwd, args) {
	const result = spawnSync("node", [LAUNCH_SCRIPT, ...args], { cwd, encoding: "utf8" });
	return `${result.stdout || ""}${result.stderr || ""}`;
}

function scratchDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function modernScaffold() {
	const dir = scratchDir("moa-any-role-scaffold");
	fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "any-role-test-project" }, null, 2));
	fs.writeFileSync(path.join(dir, "agents", "roles.yaml"), "roles: {}\n");
	return dir;
}

function main() {
	const dir = modernScaffold();

	console.log("\n=== TEST 1 — --role coder composes correctly, WITHOUT the mattpocock skill flags ===");
	const coderOut = run(dir, ["--instance", "coder-01", "--role", "coder", "--print-only"]);
	ok(/comando composto/.test(coderOut), "coder: command is printed (launch not refused, unlike pre-Revisione-44 behavior)");
	ok(coderOut.includes("--role coder"), "coder: composed command carries --role coder");
	ok(!coderOut.includes("--skill"), "coder: NO --skill flags attached (mattpocock skills stay planner-only)");
	ok(!coderOut.includes("-e extensions/orchestrator.ts"), "coder: no stale -e flag (modern scaffold, relies on global install)");

	console.log("\n=== TEST 2 — --role reviewer, same guarantee ===");
	const reviewerOut = run(dir, ["--instance", "reviewer-01", "--role", "reviewer", "--print-only"]);
	ok(reviewerOut.includes("--role reviewer"), "reviewer: composed command carries --role reviewer");
	ok(!reviewerOut.includes("--skill"), "reviewer: NO --skill flags attached");

	console.log("\n=== TEST 3 — --role omitted still defaults to planner WITH the skill flags (backward compatible) ===");
	const defaultOut = run(dir, ["--instance", "planner-01", "--print-only"]);
	ok(defaultOut.includes("--role planner"), "default (no --role passed): resolves to planner");
	ok(defaultOut.includes("--skill"), "default (no --role passed): mattpocock skill flags ARE attached, exactly as before Revisione 44");

	console.log("\n=== TEST 4 — a --session <id> (or any other unrecognized flag) passes through untouched ===");
	const sessionOut = run(dir, ["--instance", "coder-01", "--role", "coder", "--session", "01M0JKKF0YYBJZWZKCDPG3AM1D", "--print-only"]);
	ok(sessionOut.includes("--session 01M0JKKF0YYBJZWZKCDPG3AM1D"), "generic passthrough: --session <id> reaches the composed pi command verbatim (nothing in launch-planner.mjs intercepts it)");

	console.log("\n=== TEST 5 — --role as the last argument, with no value at all, is rejected clearly ===");
	const missingRoleResult = spawnSync("node", [LAUNCH_SCRIPT, "--instance", "x-01", "--role"], { cwd: dir, encoding: "utf8" });
	ok(missingRoleResult.status !== 0, "--role with no value at all: exits non-zero");
	ok(/richiede un valore/.test(`${missingRoleResult.stdout || ""}${missingRoleResult.stderr || ""}`), "--role with no value at all: clear error message, not a silent default");

	console.log(`\n${PASS} assertions passed.`);
}

try {
	main();
	console.log("LAUNCH-ANY-ROLE SMOKE TEST PASSED");
	process.exit(0);
} catch (err) {
	console.error("\nLAUNCH-ANY-ROLE SMOKE TEST FAILED:", err);
	process.exit(1);
}
