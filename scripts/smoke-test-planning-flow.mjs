// Lightweight test of the planning-flow additions (Tickets 08 + 09):
// verifies the artefacts that make the Matt Pocock flow + optional research
// step concrete in the repo:
//   - prompts/research-guide.md exists and documents when research applies,
//     the flow, and the honest fallback when no web tool is available;
//   - prompts/planner.md references research-guide.md (research step wired in);
//   - prompts/planner.md documents the to-spec -> to-tickets -> ticket-layer
//     closure ('to-tickets' is not a vendored skill, it is the ticket files);
//   - check-skill-isolation still passes (the vendored mattpocock skills are
//     ONLY for planner — our additions must not leak them elsewhere).
//
// This is a content/repo-structure check (no broker, no DB needed) — the
// runtime behaviour of the flow itself is exercised by the existing
// planner-driven e2e suite.
//
// Usage: node --experimental-strip-types scripts/smoke-test-planning-flow.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
let PASS = 0;
function ok(cond, msg) { if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); PASS++; console.log(`   OK — ${msg}`); }

async function main() {
	console.log("Planning-flow smoke test — Tickets 08/09 (artefacts + isolation).\n");

	const guide = path.join(PROJECT_ROOT, "prompts", "research-guide.md");
	ok(fs.existsSync(guide), "prompts/research-guide.md exists");
	const g = fs.readFileSync(guide, "utf-8");
	ok(/Quando usarla \(e quando no\)/.test(g) && /Flusso consigliato/.test(g), "research guide documents when + the flow");
	ok(/websearch\/browser/.test(g) || /NON bloccarti/.test(g), "research guide documents the honest fallback when no web tool exists");
	ok(/inventa/.test(g), "research guide forbids inventing unverified tools/projects");

	const planner = path.join(PROJECT_ROOT, "prompts", "planner.md");
	const p = fs.readFileSync(planner, "utf-8");
	ok(/research-guide\.md/.test(p), "planner.md references the research guide (Ticket 09 wired)");
	ok(/to-tickets/.test(p) && /NON è una skill vendored/.test(p), "planner.md documents the to-spec->to-tickets closure (Ticket 08): to-tickets = ticket files, not a vendored skill");
	ok(/ticket_create/.test(p), "planner.md links the to-tickets output to the persistent ticket layer");

	console.log("\n=== skill isolation must still hold (mattpocock skills ONLY for planner) ===");
	const { stdout } = await execFileP("node", ["scripts/check-skill-isolation.mjs"], { cwd: PROJECT_ROOT });
	ok(/OK/.test(stdout) && /OK: scripts\/check-skill-isolation/.test(stdout), "check-skill-isolation passes after the prompt/guide additions");

	console.log(`\n${PASS} assertions passed.`);
	console.log("PLANNING-FLOW SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => { console.error(`\nPLANNING-FLOW SMOKE TEST FAILED: ${err.message}\n${err.stack || ""}`); process.exit(1); });
