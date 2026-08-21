// REAL test of the capability-probe (Ticket 10) — scripts/po-deps.mjs and the
// `human_approval` integration contract: a preflight gate the planner can use
// (and already can back with decision_hold_create from ticket 02).
//
// Verifies:
//   - .env parsing: an expected var present in the project .env reports ok;
//     a missing one reports missing with an install hint;
//   - CLI detection: a real binary (git) reports present; an unknown reports
//     missing;
//   - auth detection is best-effort (exit-code based) and never throws;
//   - missing items are machine-readable in the returned object (ok/results/
//     missing), exactly the shape a planner hands to decision_hold_create.
//   - the integration loop is already covered: ticket 02's smoke test opens a
//     durable hold. Here we just assert the probe output is planner-actionable.
//
// Usage: node --experimental-strip-types scripts/smoke-test-po-deps.mjs

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
let PASS = 0;
function ok(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); PASS++; console.log(`   OK — ${msg}`); }

async function main() {
	console.log("Po-deps smoke test — scripts/po-deps.mjs (Ticket 10).\n");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moa-po-deps-"));
	fs.writeFileSync(path.join(dir, ".env"), "GITHUB_TOKEN=abc123\nEMPTY=\n");
	const { runPoDeps } = await import(pathToFileURL(path.join(PROJECT_ROOT, "scripts", "po-deps.mjs")).href);

	console.log("=== PART 1 — env vars present vs missing ===");
	let r = await runPoDeps({ cwd: dir, argv: ["--env", "GITHUB_TOKEN,EMPTY,NOT_HERE"] });
	const e1 = r.results.find((x) => x.name === "GITHUB_TOKEN");
	const e2 = r.results.find((x) => x.name === "EMPTY");
	const e3 = r.results.find((x) => x.name === "NOT_HERE");
	ok(e1.present === true && e1.list === "ok", "present non-empty .env var reports ok");
	ok(e2.present === false && e2.list === "missing", "an EMPTY-vs-present var counts as missing (must be non-empty)");
	ok(e3.present === false && e3.list === "missing" && typeof e3.hint === "string", "missing var is missing with an install hint");

	console.log("\n=== PART 2 — CLI detection (real binary present, unknown missing) ===");
	r = await runPoDeps({ cwd: dir, argv: ["--cli", "git,made_up_cmd_xyz"] });
	const c1 = r.results.find((x) => x.name === "git");
	const c2 = r.results.find((x) => x.name === "made_up_cmd_xyz");
	ok(c1.present === true, "git (real binary) is present");
	ok(c2.present === false && c2.list === "missing", "a made-up binary is missing");

	console.log("\n=== PART 3 — auth best-effort never throws ===");
	r = await runPoDeps({ cwd: dir, argv: ["--auth", "git"] });
	const a1 = r.results.find((x) => x.name === "git");
	ok(a1 !== undefined && ["ok", "missing"].includes(a1.list), "auth check returns a typed result without throwing");

	console.log("\n=== PART 4 — machine-readable summary (planner-actionable) ===");
	r = await runPoDeps({ cwd: dir, argv: ["--env", "NOT_HERE", "--cli", "made_up_cmd_xyz"] });
	ok(typeof r.ok === "boolean" && r.ok === false, "summary ok=false when something is missing");
	ok(Array.isArray(r.missing) && r.missing.length === 2, "the missing array lists exactly the gaps — ready to feed decision_hold_create context");
	ok(Array.isArray(r.results) && r.results.every((x) => ["env", "cli", "auth"].includes(x.kind)), "each result is typed (env|cli|auth) for the preflight checklist");

	console.log(`\n${PASS} assertions passed.`);
	console.log("PO-DEPS SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => { console.error(`\nPO-DEPS SMOKE TEST FAILED: ${err.message}\n${err.stack || ""}`); process.exit(1); });
