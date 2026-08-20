// Verifies the specialist-role prompt fallback added for the dynamic team
// roster (Revisione 15): a role with no prompts/<role>.md of its own, but a
// `label`/`brief` in agents/roles.yaml, should render prompts/specialist.md
// with {{ROLE}}/{{ROLE_LABEL}}/{{BRIEF}} filled in — while planner/coder/
// reviewer keep using their own bespoke prompt files untouched. Mirrors the
// real loadConfig()/loadRolePrompt() logic in extensions/orchestrator.ts
// against the REAL files in agents/ and prompts/ (not a mock), since those
// are plain fs reads + YAML parsing, no MQTT/pi dependency needed to test.
//
// Usage: node scripts/smoke-test-specialist-prompt.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import assert from "node:assert/strict";

const ROOT = path.join(import.meta.dirname, "..");

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

function loadRolePrompt(cwd, promptsDir, role, roleCfg) {
	const dir = path.isAbsolute(promptsDir) ? promptsDir : path.join(cwd, promptsDir);
	const file = path.join(dir, `${role}.md`);
	try {
		if (fs.existsSync(file)) return { text: fs.readFileSync(file, "utf-8"), source: "bespoke" };
	} catch { /* fall through */ }
	if (roleCfg?.brief) {
		const specialistFile = path.join(dir, "specialist.md");
		try {
			if (fs.existsSync(specialistFile)) return { text: fs.readFileSync(specialistFile, "utf-8"), source: "specialist-template" };
		} catch { /* fall through to built-in default below */ }
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
		const { text, source } = loadRolePrompt(ROOT, "prompts", role, cfg.roles[role]);
		assert.equal(source, "bespoke", `${role} should use its own prompts/${role}.md`);
		assert.ok(text.length > 200, `${role}.md should have real content`);
	}
	console.log("   OK — planner.md/coder.md/reviewer.md take priority, unaffected by the new roster");

	console.log("2. a brand-new specialist role (no prompts/<role>.md) falls back to specialist.md...");
	const role = "openapi-writer";
	assert.ok(cfg.roles[role], `roles.yaml should define ${role}`);
	assert.ok(cfg.roles[role].brief, `${role} should have a brief`);
	const { text, source } = loadRolePrompt(ROOT, "prompts", role, cfg.roles[role]);
	assert.equal(source, "specialist-template", "should load prompts/specialist.md");
	const rendered = render(text, { instance: "openapi-writer-01", role, project: "demo", team: ["core"] }, cfg.roles[role]);
	assert.ok(!rendered.includes("{{"), "no unfilled placeholders should remain after rendering");
	assert.match(rendered, /openapi-writer-01/);
	assert.match(rendered, /OpenAPI/);
	console.log("   OK — specialist.md rendered with role/label/brief correctly substituted, no leftover {{...}}");

	console.log("2b. security-evaluator now has its own bespoke prompt (Revisione 21) and takes priority over specialist.md...");
	const { text: secText, source: secSource } = loadRolePrompt(ROOT, "prompts", "security-evaluator", cfg.roles["security-evaluator"]);
	assert.equal(secSource, "bespoke", "security-evaluator should now use its own prompts/security-evaluator.md, not the generic template");
	assert.ok(secText.length > 1000, "security-evaluator.md should have real, substantial content");
	const secRendered = render(secText, { instance: "security-01", role: "security-evaluator", project: "demo", team: ["core"] }, cfg.roles["security-evaluator"]);
	assert.ok(!secRendered.includes("{{"), "no unfilled placeholders should remain after rendering");
	assert.match(secRendered, /security-01/);
	assert.match(secRendered, /oracol|attribute-inference/i);
	console.log("   OK — security-evaluator.md renders cleanly and is picked up ahead of specialist.md");

	console.log("2c. docs-sync now has its own bespoke prompt (Revisione 28 — README + QUICK-START.md mandate) and takes priority over specialist.md...");
	const { text: dsText, source: dsSource } = loadRolePrompt(ROOT, "prompts", "docs-sync", cfg.roles["docs-sync"]);
	assert.equal(dsSource, "bespoke", "docs-sync should now use its own prompts/docs-sync.md, not the generic template");
	assert.ok(dsText.length > 1000, "docs-sync.md should have real, substantial content");
	const dsRendered = render(dsText, { instance: "docs-sync-01", role: "docs-sync", project: "demo", team: ["core"] }, cfg.roles["docs-sync"]);
	assert.ok(!dsRendered.includes("{{"), "no unfilled placeholders should remain after rendering");
	assert.match(dsRendered, /docs-sync-01/);
	assert.match(dsRendered, /QUICK-START\.md/);
	console.log("   OK — docs-sync.md renders cleanly and is picked up ahead of specialist.md");

	console.log("3. ALL roles in the roster render cleanly with no leftover placeholders...");
	const roster = Object.keys(cfg.roles).filter((r) => !["planner", "coder", "reviewer"].includes(r));
	assert.ok(roster.length >= 20, `expected a large specialist roster, got ${roster.length}`);
	for (const r of roster) {
		const roleCfg = cfg.roles[r];
		assert.ok(roleCfg.label, `${r} missing label`);
		assert.ok(roleCfg.brief, `${r} missing brief`);
		const { text: t } = loadRolePrompt(ROOT, "prompts", r, roleCfg);
		const out = render(t, { instance: `${r}-01`, role: r, project: "demo", team: ["core"] }, roleCfg);
		assert.ok(!out.includes("{{"), `${r}: leftover placeholder after render`);
	}
	console.log(`   OK — ${roster.length} specialist roles all render cleanly (${roster.join(", ")})`);

	console.log("\nSPECIALIST PROMPT SMOKE TEST PASSED");
	process.exit(0);
}

main();
