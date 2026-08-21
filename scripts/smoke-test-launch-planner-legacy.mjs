// REAL functional test of scripts/launch-planner.mjs's "stale legacy scaffold"
// handling (Revisione 38, see docs/development-notes.md) — a real incident:
// an operator's project scaffolded before Revisione 33 still had its own
// leftover extensions/orchestrator.ts on disk. launch-planner.mjs detected
// it, printed a warning explaining the impending "Tool ... conflicts with
// ..." crash — and then composed the command WITH `-e extensions/orchestrator.ts`
// anyway, causing exactly the crash it had just warned about, both via
// `po start` and via a manual `pi -e extensions/orchestrator.ts --role planner`.
// The warning described the problem instead of avoiding it.
//
// This spawns the REAL scripts/launch-planner.mjs as a child process (same
// as an operator running `po start --print-only` / `node
// scripts/launch-planner.mjs ... --print-only` would), never a hand-copied
// mirror, and checks the actual composed command plus the actual warning
// text across three real scenarios: a stale legacy scaffold, genuine
// package-repo dev mode, and a normal modern scaffold with no local copy.
//
// Usage: node scripts/smoke-test-launch-planner-legacy.mjs

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

// The composed command goes to stdout (console.log); the stale-scaffold
// warning goes to stderr (console.warn) — capture and concatenate both, so
// assertions can check either regardless of which stream produced it.
function runPrintOnly(cwd) {
	const result = spawnSync("node", [LAUNCH_SCRIPT, "--instance", "planner-01", "--print-only"], {
		cwd,
		encoding: "utf8",
	});
	return `${result.stdout || ""}${result.stderr || ""}`;
}

function scratchDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function main() {
	const realOrchestratorSrc = fs.readFileSync(path.join(PACKAGE_ROOT, "extensions", "orchestrator.ts"), "utf8");

	console.log("\n=== Scenario A — stale legacy scaffold (pre-Revisione-33 leftover extensions/) ===");
	const legacyDir = scratchDir("moa-legacy-scaffold");
	fs.mkdirSync(path.join(legacyDir, "extensions"), { recursive: true });
	fs.mkdirSync(path.join(legacyDir, "agents"), { recursive: true });
	fs.writeFileSync(path.join(legacyDir, "extensions", "orchestrator.ts"), realOrchestratorSrc);
	fs.writeFileSync(path.join(legacyDir, "package.json"), JSON.stringify({ name: "moa-test-project" }, null, 2));
	fs.writeFileSync(path.join(legacyDir, "agents", "roles.yaml"), "roles: {}\n");
	const legacyOut = runPrintOnly(legacyDir);
	ok(!legacyOut.includes("-e extensions/orchestrator.ts"), "stale legacy scaffold: composed command does NOT include -e (the actual fix)");
	ok(/comando composto/.test(legacyOut), "stale legacy scaffold: command is still printed (launch is not blocked)");
	ok(/IGNORATO/.test(legacyOut), "stale legacy scaffold: warns that the stale copy was found but ignored");
	ok(/sicura da cancellare/.test(legacyOut), "stale legacy scaffold: tells the operator the leftover folder is now safe to delete");

	console.log("\n=== Scenario B — genuine package-repo dev mode (name === pi-mqtt-orchestrator) ===");
	const devDir = scratchDir("moa-dev-repo");
	fs.mkdirSync(path.join(devDir, "extensions"), { recursive: true });
	fs.mkdirSync(path.join(devDir, "agents"), { recursive: true });
	fs.writeFileSync(path.join(devDir, "extensions", "orchestrator.ts"), realOrchestratorSrc);
	fs.writeFileSync(path.join(devDir, "package.json"), JSON.stringify({ name: "pi-mqtt-orchestrator" }, null, 2));
	fs.writeFileSync(path.join(devDir, "agents", "roles.yaml"), "roles: {}\n");
	const devOut = runPrintOnly(devDir);
	ok(devOut.includes("-e extensions/orchestrator.ts"), "package-repo dev mode: composed command DOES include -e (still needed there)");
	ok(!/IGNORATO/.test(devOut), "package-repo dev mode: no stale-scaffold warning (this really is dev mode, not a leftover)");

	console.log("\n=== Scenario C — normal modern scaffold, no local extensions/ at all ===");
	const modernDir = scratchDir("moa-modern-scaffold");
	fs.mkdirSync(path.join(modernDir, "agents"), { recursive: true });
	fs.writeFileSync(path.join(modernDir, "package.json"), JSON.stringify({ name: "modern-project" }, null, 2));
	fs.writeFileSync(path.join(modernDir, "agents", "roles.yaml"), "roles: {}\n");
	const modernOut = runPrintOnly(modernDir);
	ok(!modernOut.includes("-e extensions/orchestrator.ts"), "modern scaffold: no -e (relies on the global install, as designed since Revisione 33)");
	ok(!/IGNORATO/.test(modernOut), "modern scaffold: no warning (nothing stale to report)");

	console.log(`\n${PASS} assertions passed.`);
}

try {
	main();
	console.log("LAUNCH-PLANNER LEGACY-SCAFFOLD SMOKE TEST PASSED");
	process.exit(0);
} catch (err) {
	console.error("\nLAUNCH-PLANNER LEGACY-SCAFFOLD SMOKE TEST FAILED:", err);
	process.exit(1);
}
