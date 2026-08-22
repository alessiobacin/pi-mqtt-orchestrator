// Verifies the specialist-role prompt fallback added for the dynamic team
// roster (Revisione 15): a role with no prompts/<role>.md of its own, but a
// `label`/`brief` in agents/roles.yaml, should render prompts/specialist.md
// with {{ROLE}}/{{ROLE_LABEL}}/{{BRIEF}} filled in — while planner/coder/
// reviewer keep using their own bespoke prompt files untouched. Mirrors the
// real loadConfig()/loadRolePrompt() logic in extensions/orchestrator.ts
// against the REAL files in agents/ and prompts/ (not a mock), since those
// are plain fs reads + YAML parsing, no MQTT/pi dependency needed to test.
//
// Revisione 47 — loadRolePrompt() itself was rewritten to consult a
// primaryDir then an optional fallbackDir, file by file (see
// extensions/orchestrator.ts, "--custom-prompts"). Blocks 1-3 below still
// test the plain single-directory case (fallbackDir: null) — this repo's
// OWN top-level prompts/ folder, i.e. exactly the "global, no
// --custom-prompts" resolution every project now uses by default. The
// two-directory cascade itself (a local override present for SOME roles but
// not others, or missing entirely) is covered more rigorously against the
// REAL extension code in scripts/smoke-test-custom-prompts.mjs, since that
// needs a real session/MQTT round-trip to exercise properly; block 4 here
// just adds a fast, broker-free sanity check of the same cascade logic.
//
// Usage: node scripts/smoke-test-specialist-prompt.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import assert from "node:assert/strict";

const ROOT = path.join(import.meta.dirname, "..");
const GLOBAL_PROMPTS_DIR = path.join(ROOT, "prompts");

function loadYamlIfExists(file) {
	try {
		if (!fs.existsSync(file)) return null;
		return parseYaml(fs.readFileSync(file, "utf-8"));
	} catch {
		return null;
	}
}

function loadConfig(cwd, configDir) {
	const dir = path.isAbsolute(configDir) ? configDir : path.join(cwd, configDir);
	const rolesDoc = loadYamlIfExists(path.join(dir, "roles.yaml"));
	const agentsDoc = loadYamlIfExists(path.join(dir, "agents.yaml"));
	return { roles: rolesDoc?.roles || {}, agents: agentsDoc?.agents || {} };
}

function readRolePromptFile(dir, name) {
	if (!dir) return null;
	const file = path.join(dir, `${name}.md`);
	try {
		if (fs.existsSync(file)) return fs.readFileSync(file, "utf-8");
	} catch { /* fall through */ }
	return null;
}

// Mirrors the REAL extensions/orchestrator.ts loadRolePrompt() (Revisione
// 47): primaryDir is consulted first, file by file (<role>.md, then
// specialist.md if roleCfg has a brief) — fallbackDir (pass null to skip it
// entirely) is only consulted for whichever specific file primaryDir
// doesn't have. Unlike the real function (which just returns the prompt
// text), this mirror also reports which tier/kind of file was used, since
// blocks 1-3/2/2b/2c/2d/3/4 below assert on that for clarity.
function loadRolePrompt(primaryDir, fallbackDir, role, roleCfg) {
	const fromPrimary = readRolePromptFile(primaryDir, role);
	if (fromPrimary !== null) return { text: fromPrimary, source: "bespoke" };
	const fromFallback = readRolePromptFile(fallbackDir, role);
	if (fromFallback !== null) return { text: fromFallback, source: "bespoke" };
	if (roleCfg?.brief) {
		const specialistFromPrimary = readRolePromptFile(primaryDir, "specialist");
		if (specialistFromPrimary !== null) return { text: specialistFromPrimary, source: "specialist-template" };
		const specialistFromFallback = readRolePromptFile(fallbackDir, "specialist");
		if (specialistFromFallback !== null) return { text: specialistFromFallback, source: "specialist-template" };
		return { text: "Sei un agente specialista di ruolo {{ROLE}} ({{ROLE_LABEL}})... {{BRIEF}}", source: "specialist-builtin-fallback" };
	}
	return { text: `Sei l'agente ${role}, istanza {{INSTANCE}} nel progetto {{PROJECT}}.`, source: "generic-fallback" };
}

function render(text, identity, roleCfg) {
	return text
		.replaceAll("{{INSTANCE}}", identity.instance)
		.replaceAll("{{ROLE}}", identity.role)
		.replaceAll("{{ROLE_LABEL}}", roleCfg?.label || identity.role)
		.replaceAll("{{BRIEF}}", roleCfg?.brief || "")
		.replaceAll("{{PROJECT}}", identity.project)
		.replaceAll("{{TEAM}}", identity.team.join(", "));
}

function main() {
	const cfg = loadConfig(ROOT, "agents");

	console.log("1. planner/coder/reviewer still resolve to their own bespoke prompt files...");
	for (const role of ["planner", "coder", "reviewer"]) {
		const { text, source } = loadRolePrompt(GLOBAL_PROMPTS_DIR, null, role, cfg.roles[role]);
		assert.equal(source, "bespoke", `${role} should use its own prompts/${role}.md`);
		assert.ok(text.length > 200, `${role}.md should have real content`);
	}
	console.log("   OK — planner.md/coder.md/reviewer.md take priority, unaffected by the new roster");

	console.log("2. a brand-new specialist role (no prompts/<role>.md) falls back to specialist.md...");
	const role = "openapi-writer";
	assert.ok(cfg.roles[role], `roles.yaml should define ${role}`);
	assert.ok(cfg.roles[role].brief, `${role} should have a brief`);
	const { text, source } = loadRolePrompt(GLOBAL_PROMPTS_DIR, null, role, cfg.roles[role]);
	assert.equal(source, "specialist-template", "should load prompts/specialist.md");
	const rendered = render(text, { instance: "openapi-writer-01", role, project: "demo", team: ["core"] }, cfg.roles[role]);
	assert.ok(!rendered.includes("{{"), "no unfilled placeholders should remain after rendering");
	assert.match(rendered, /openapi-writer-01/);
	assert.match(rendered, /OpenAPI/);
	console.log("   OK — specialist.md rendered with role/label/brief correctly substituted, no leftover {{...}}");

	console.log("2b. security-evaluator now has its own bespoke prompt (Revisione 21) and takes priority over specialist.md...");
	const { text: secText, source: secSource } = loadRolePrompt(GLOBAL_PROMPTS_DIR, null, "security-evaluator", cfg.roles["security-evaluator"]);
	assert.equal(secSource, "bespoke", "security-evaluator should now use its own prompts/security-evaluator.md, not the generic template");
	assert.ok(secText.length > 1000, "security-evaluator.md should have real, substantial content");
	const secRendered = render(secText, { instance: "security-01", role: "security-evaluator", project: "demo", team: ["core"] }, cfg.roles["security-evaluator"]);
	assert.ok(!secRendered.includes("{{"), "no unfilled placeholders should remain after rendering");
	assert.match(secRendered, /security-01/);
	assert.match(secRendered, /oracol|attribute-inference/i);
	console.log("   OK — security-evaluator.md renders cleanly and is picked up ahead of specialist.md");

	console.log("2c. docs-sync now has its own bespoke prompt (Revisione 28 — README + QUICK-START.md mandate) and takes priority over specialist.md...");
	const { text: dsText, source: dsSource } = loadRolePrompt(GLOBAL_PROMPTS_DIR, null, "docs-sync", cfg.roles["docs-sync"]);
	assert.equal(dsSource, "bespoke", "docs-sync should now use its own prompts/docs-sync.md, not the generic template");
	assert.ok(dsText.length > 1000, "docs-sync.md should have real, substantial content");
	const dsRendered = render(dsText, { instance: "docs-sync-01", role: "docs-sync", project: "demo", team: ["core"] }, cfg.roles["docs-sync"]);
	assert.ok(!dsRendered.includes("{{"), "no unfilled placeholders should remain after rendering");
	assert.match(dsRendered, /docs-sync-01/);
	assert.match(dsRendered, /QUICK-START\.md/);
	console.log("   OK — docs-sync.md renders cleanly and is picked up ahead of specialist.md");

	console.log("2d. frontend-developer now has its own bespoke prompt (Revisione 45 — always routes through reviewer, never straight to planner) and takes priority over specialist.md...");
	const { text: fdText, source: fdSource } = loadRolePrompt(GLOBAL_PROMPTS_DIR, null, "frontend-developer", cfg.roles["frontend-developer"]);
	assert.equal(fdSource, "bespoke", "frontend-developer should now use its own prompts/frontend-developer.md, not the generic template");
	assert.ok(fdText.length > 1000, "frontend-developer.md should have real, substantial content");
	const fdRendered = render(fdText, { instance: "frontend-developer-01", role: "frontend-developer", project: "demo", team: ["core", "frontend"] }, cfg.roles["frontend-developer"]);
	assert.ok(!fdRendered.includes("{{"), "no unfilled placeholders should remain after rendering");
	assert.match(fdRendered, /frontend-developer-01/);
	assert.match(fdRendered, /target_role:\s*"reviewer"/, "frontend-developer.md must instruct sending work to reviewer, not straight to planner");
	assert.ok(!/target_role:\s*"planner"/.test(fdRendered), "frontend-developer.md must NOT instruct sending its own work directly to planner");
	console.log("   OK — frontend-developer.md renders cleanly, is picked up ahead of specialist.md, and always routes through reviewer");

	console.log("3. ALL roles in the roster render cleanly with no leftover placeholders...");
	const roster = Object.keys(cfg.roles).filter((r) => !["planner", "coder", "reviewer"].includes(r));
	assert.ok(roster.length >= 20, `expected a large specialist roster, got ${roster.length}`);
	for (const r of roster) {
		const roleCfg = cfg.roles[r];
		assert.ok(roleCfg.label, `${r} missing label`);
		assert.ok(roleCfg.brief, `${r} missing brief`);
		const { text: t } = loadRolePrompt(GLOBAL_PROMPTS_DIR, null, r, roleCfg);
		const out = render(t, { instance: `${r}-01`, role: r, project: "demo", team: ["core"] }, roleCfg);
		assert.ok(!out.includes("{{"), `${r}: leftover placeholder after render`);
	}
	console.log(`   OK — ${roster.length} specialist roles all render cleanly (${roster.join(", ")})`);

	console.log("4. fast fs-only cascade check (Revisione 47, --custom-prompts): primaryDir wins per-file, fallbackDir only fills in what's missing, no broker needed...");
	const scratchPrimary = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-cascade-"));
	try {
		const CUSTOM_CODER_MARKER = "CUSTOM-CODER-MARKER (scratch primaryDir only, coder.md)";
		fs.writeFileSync(path.join(scratchPrimary, "coder.md"), CUSTOM_CODER_MARKER);

		const coderResult = loadRolePrompt(scratchPrimary, GLOBAL_PROMPTS_DIR, "coder", cfg.roles.coder);
		assert.equal(coderResult.source, "bespoke", "coder.md exists in primaryDir — should win outright");
		assert.equal(coderResult.text, CUSTOM_CODER_MARKER, "primaryDir's coder.md content should be used verbatim, not merged with the global one");

		const reviewerResult = loadRolePrompt(scratchPrimary, GLOBAL_PROMPTS_DIR, "reviewer", cfg.roles.reviewer);
		const globalReviewerText = fs.readFileSync(path.join(GLOBAL_PROMPTS_DIR, "reviewer.md"), "utf-8");
		assert.equal(reviewerResult.source, "bespoke", "reviewer.md is missing from primaryDir — falls back to fallbackDir's own bespoke file");
		assert.equal(reviewerResult.text, globalReviewerText, "the fallback text should be the CURRENT global reviewer.md, not a stale copy — this is the whole point of the per-file cascade");

		const specialistResult = loadRolePrompt(scratchPrimary, GLOBAL_PROMPTS_DIR, "openapi-writer", cfg.roles["openapi-writer"]);
		assert.equal(specialistResult.source, "specialist-template", "openapi-writer isn't in primaryDir or fallbackDir as a bespoke file, but has a brief — falls through to fallbackDir's specialist.md");

		const noFallbackResult = loadRolePrompt(scratchPrimary, null, "reviewer", cfg.roles.reviewer);
		assert.equal(noFallbackResult.source, "generic-fallback", "with fallbackDir: null (e.g. the local prompts/ dir doesn't exist at all) and no bespoke/specialist file in primaryDir, it's the bare generic fallback — never a crash");
	} finally {
		fs.rmSync(scratchPrimary, { recursive: true, force: true });
	}
	console.log("   OK — primaryDir/fallbackDir per-file cascade behaves exactly like the real extension's loadRolePrompt()");

	console.log("\nSPECIALIST PROMPT SMOKE TEST PASSED");
	process.exit(0);
}

main();
