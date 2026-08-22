// REAL functional test of `po copy-prompts` (scripts/copy-prompts.mjs,
// Revisione 47) — spawns the real CLI script as a child process (same as an
// operator running `node bin/po.mjs copy-prompts` / `po copy-prompts`
// would), never a hand-copied mirror.
//
// Revisione 47 replaced the earlier `po sync-prompts` (Revisione 46): by
// default, role prompts are now ALWAYS read from the installed package
// (never a per-project copy — see extensions/orchestrator.ts,
// resolveGlobalPromptsDir()), so there is nothing to resync any more after a
// `po update`. `po copy-prompts` exists only for someone who wants to
// customize prompts for ONE specific project — it just materializes a local
// copy to edit; --custom-prompts (tested separately in
// scripts/smoke-test-custom-prompts.mjs, against the real extension) is
// what actually makes an instance read it.
//
// Usage: node scripts/smoke-test-copy-prompts.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const PO_BIN = path.join(PACKAGE_ROOT, "bin", "po.mjs");

let PASS = 0;
function ok(cond, msg) {
	if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
	PASS++;
	console.log(`   OK — ${msg}`);
}

function scratchDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function runCopyPrompts(cwd) {
	const result = spawnSync("node", [PO_BIN, "copy-prompts"], { cwd, encoding: "utf8" });
	return { status: result.status, out: `${result.stdout || ""}${result.stderr || ""}` };
}

function main() {
	console.log("\n=== Scenario A — refuses outside a scaffolded project (no .pi/extensions/multiAgentOrchestrator) ===");
	const notScaffolded = scratchDir("not-a-project");
	const resA = runCopyPrompts(notScaffolded);
	ok(resA.status !== 0, "exits non-zero when the cwd was never scaffolded with `po init`");
	ok(/multiAgentOrchestrator|non esiste|non sembra un progetto/.test(resA.out), "clear error message, not a silent no-op");

	console.log("\n=== Scenario B — copies the package's CURRENT prompts/ into a freshly-scaffolded project (which has none by default, Revisione 47) ===");
	const project = scratchDir("scaffolded-project-no-prompts");
	fs.mkdirSync(path.join(project, ".pi", "extensions", "multiAgentOrchestrator"), { recursive: true });
	const promptsDest = path.join(project, ".pi", "extensions", "multiAgentOrchestrator", "prompts");
	ok(!fs.existsSync(promptsDest), "sanity check: a freshly-scaffolded project has NO prompts/ dir yet (matches `po init`'s new behavior)");

	const resB = runCopyPrompts(project);
	ok(resB.status === 0, "po copy-prompts exits 0 on a real scaffolded project");
	ok(/copiati/.test(resB.out), "prints a confirmation mentioning how many files were copied");
	ok(!/copia locale precedente/.test(resB.out), "does NOT mention a backup — there was nothing to back up the first time");

	const realPlannerMd = fs.readFileSync(path.join(PACKAGE_ROOT, "prompts", "planner.md"), "utf8");
	const copiedPlannerMd = fs.readFileSync(path.join(promptsDest, "planner.md"), "utf8");
	ok(copiedPlannerMd === realPlannerMd, "the copied planner.md matches the package's current planner.md exactly");
	ok(fs.existsSync(path.join(promptsDest, "frontend-developer.md")), "frontend-developer.md (Revisione 45) is copied too — the whole current prompts/ folder, not a stale subset");

	console.log("\n=== Scenario C — running it again backs up the previous local copy instead of silently clobbering a customization ===");
	fs.writeFileSync(path.join(promptsDest, "planner.md"), "CUSTOMIZED-BY-OPERATOR-MARKER");
	const resC = runCopyPrompts(project);
	ok(resC.status === 0, "po copy-prompts exits 0 the second time too");
	ok(/copia locale precedente/.test(resC.out), "this time it DOES mention preserving the previous local copy (there was something to back up)");

	const parent = path.dirname(promptsDest);
	const backups = fs.readdirSync(parent).filter((e) => e.startsWith("prompts.bak-"));
	ok(backups.length === 1, "exactly one timestamped backup directory was created");
	const backedUpPlanner = fs.readFileSync(path.join(parent, backups[0], "planner.md"), "utf8");
	ok(backedUpPlanner === "CUSTOMIZED-BY-OPERATOR-MARKER", "the operator's customization is fully recoverable from the backup — nothing was lost");
	const freshPlannerAgain = fs.readFileSync(path.join(promptsDest, "planner.md"), "utf8");
	ok(freshPlannerAgain === realPlannerMd, "the local copy is now the fresh package content again, not the old customization");

	console.log(`\n${PASS} assertions passed.`);
	console.log("COPY-PROMPTS SMOKE TEST PASSED");
}

main();
