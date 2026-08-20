// Real test of the deterministic phase gate (Revisione 21) — plan_set,
// plan_advance, plan_get, and the runtime check inside agent_send that
// refuses a send addressed to a role in a locked phase. Added after a real
// test (Revisione 20 analysis, claude/e2e-codice-fiscale-analysis.md)
// showed that a "clean" planner, given the CHANCE, scheduled a specialist
// (tdd-agent) in a phase BEFORE coder — a rule that only lived in prose
// (prompts/planner.md) had nothing stopping it from being violated. This
// revision makes the plan a small structured file the code actually reads
// and enforces, on top of (not instead of) the human-readable .plan.md.
//
// Mirrors the exact logic added to extensions/orchestrator.ts
// (planPath/readPlan/writePlan/renderPlanMarkdown/findPhaseForRole, the
// plan_set/plan_advance/plan_get tools, and agent_send's gate check)
// against a real scratch git repo/worktree — no MQTT/pi needed, the gate
// itself is pure fs + validation logic, and agent_send's actual publish
// step is simulated (this test cares about whether the send is REFUSED
// before publishing, not about MQTT delivery, which is already covered by
// smoke-test.mjs/smoke-test-pipeline.mjs).
//
// Usage: node scripts/smoke-test-plan-gate.mjs

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import assert from "node:assert/strict";

function execGit(args, cwd) {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd }, (err, stdout, stderr) => {
			if (err) reject(new Error(stderr?.toString().trim() || err.message));
			else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
		});
	});
}

function worktreePaths(projectCwd, slug) {
	return { path: path.join(projectCwd, ".worktrees", slug), branch: `task/${slug}` };
}

async function worktreeCreate(projectCwd, slug) {
	const { path: wtPath, branch } = worktreePaths(projectCwd, slug);
	if (fs.existsSync(wtPath)) return { worktree_path: wtPath, branch };
	let branchExists = true;
	try { await execGit(["rev-parse", "--verify", branch], projectCwd); } catch { branchExists = false; }
	if (branchExists) await execGit(["worktree", "add", wtPath, branch], projectCwd);
	else await execGit(["worktree", "add", "-b", branch, wtPath], projectCwd);
	return { worktree_path: wtPath, branch };
}

// ── Mirrors of extensions/orchestrator.ts (plan_set/plan_advance/plan_get/agent_send gate) ──

function planPath(worktreePath, slug) {
	return path.join(worktreePath, "reports", `${slug}.plan.json`);
}
function planMarkdownPath(worktreePath, slug) {
	return path.join(worktreePath, "reports", `${slug}.plan.md`);
}
function readPlan(worktreePath, slug) {
	try {
		const parsed = JSON.parse(fs.readFileSync(planPath(worktreePath, slug), "utf-8"));
		return parsed && Array.isArray(parsed.phases) ? parsed : null;
	} catch {
		return null;
	}
}
function renderPlanMarkdown(plan) {
	const icon = { complete: "[x]", unlocked: "[~]", locked: "[ ]" };
	const lines = [`# Piano di esecuzione: ${plan.slug}`, ""];
	for (const p of plan.phases) lines.push(`- ${icon[p.status]} Fase ${p.phase}: ${p.roles.join(", ")}`);
	return lines.join("\n") + "\n";
}
function writePlan(worktreePath, slug, plan) {
	fs.mkdirSync(path.dirname(planPath(worktreePath, slug)), { recursive: true });
	fs.writeFileSync(planPath(worktreePath, slug), JSON.stringify(plan, null, 2));
	fs.writeFileSync(planMarkdownPath(worktreePath, slug), renderPlanMarkdown(plan));
}
function findPhaseForRole(plan, role) {
	const normalized = role.trim().toLowerCase();
	return plan.phases.find((p) => p.roles.some((r) => r.trim().toLowerCase() === normalized));
}

// Mirrors the plan_set tool's execute() — including its role check and
// structural validation (phase 1 must include coder, no role in two phases,
// and the Revisione 21 follow-up TDD exception: phase 1 may be "tdd-agent"
// ALONE if — and only if — "coder" is then in phase 2 right after).
function planSet(worktreePath, callerRole, slug, phasesInput) {
	if (callerRole !== "planner") throw new Error(`plan_set: only the planner role may declare a task's execution plan (this instance is "${callerRole}").`);
	if (phasesInput.length === 0) throw new Error("plan_set: phases must have at least one entry.");
	for (const p of phasesInput) if (p.roles.length === 0) throw new Error("plan_set: every phase needs at least one role.");
	const phase1Roles = phasesInput[0].roles.map((r) => r.trim().toLowerCase());
	const isTddOnlyPhase1 = phase1Roles.length === 1 && phase1Roles[0] === "tdd-agent";
	if (!phase1Roles.includes("coder") && !isTddOnlyPhase1) {
		throw new Error(
			'plan_set: phase 1 must include "coder" — coder is always phase 1, no phase may precede it. The ONE exception: ' +
				'phase 1 may be "tdd-agent" ALONE (genuine TDD), with "coder" required in phase 2 right after.',
		);
	}
	if (isTddOnlyPhase1) {
		const phase2Roles = (phasesInput[1]?.roles ?? []).map((r) => r.trim().toLowerCase());
		if (!phase2Roles.includes("coder")) {
			throw new Error('plan_set: phase 1 is "tdd-agent" alone (the TDD exception) — "coder" must then be in phase 2, right after it.');
		}
	}
	// Revisione 24: the LAST phase must include "docs-sync" — mirrors the
	// same rule added to extensions/orchestrator.ts's plan_set.
	const lastPhaseRoles = phasesInput[phasesInput.length - 1].roles.map((r) => r.trim().toLowerCase());
	if (!lastPhaseRoles.includes("docs-sync")) {
		throw new Error('plan_set: the LAST phase must include "docs-sync" — every task plan now ends with a documentation pass.');
	}
	const seen = new Map();
	for (let i = 0; i < phasesInput.length; i++) {
		for (const role of phasesInput[i].roles) {
			const key = role.trim().toLowerCase();
			if (seen.has(key)) throw new Error(`plan_set: role "${role}" appears in both phase ${seen.get(key) + 1} and phase ${i + 1}.`);
			seen.set(key, i);
		}
	}
	const existing = readPlan(worktreePath, slug);
	const now = new Date().toISOString();
	const phases = phasesInput.map((p, i) => {
		const phaseNum = i + 1;
		const rolesKey = [...p.roles].map((r) => r.trim().toLowerCase()).sort().join(",");
		const prior = existing?.phases.find((op) => op.phase === phaseNum && [...op.roles].map((r) => r.trim().toLowerCase()).sort().join(",") === rolesKey);
		if (prior && prior.status === "complete") return { phase: phaseNum, roles: p.roles, note: p.note, status: "complete" };
		if (phaseNum === 1) return { phase: phaseNum, roles: p.roles, note: p.note, status: "unlocked" };
		return { phase: phaseNum, roles: p.roles, note: p.note, status: "locked" };
	});
	for (let i = 1; i < phases.length; i++) {
		if (phases[i].status === "locked" && phases[i - 1].status === "complete") phases[i].status = "unlocked";
	}
	const plan = { slug, phases, created_at: existing?.created_at || now, updated_at: now };
	writePlan(worktreePath, slug, plan);
	return plan;
}

// Mirrors the plan_advance tool's execute().
function planAdvance(worktreePath, callerRole, slug, completedPhase) {
	if (callerRole !== "planner") throw new Error(`plan_advance: only the planner role may advance a task's execution plan (this instance is "${callerRole}").`);
	const plan = readPlan(worktreePath, slug);
	if (!plan) throw new Error(`plan_advance: no plan found for "${slug}" — call plan_set first.`);
	const target = plan.phases.find((p) => p.phase === completedPhase);
	if (!target) throw new Error(`plan_advance: "${slug}" has no phase ${completedPhase}.`);
	if (target.status === "complete") return plan; // no-op
	if (target.status === "locked") throw new Error(`plan_advance: phase ${completedPhase} is still locked — can't mark it complete out of order.`);
	target.status = "complete";
	const next = plan.phases.find((p) => p.phase === completedPhase + 1);
	if (next && next.status === "locked") next.status = "unlocked";
	plan.updated_at = new Date().toISOString();
	writePlan(worktreePath, slug, plan);
	return plan;
}

// Mirrors agent_send's gate check exactly (the part that can throw and
// block the send) — presence is a plain instance->role map here.
function agentSendGateCheck(worktreePath, slug, targetRole, presenceByInstance, targetInstance) {
	const plan = readPlan(worktreePath, slug);
	if (!plan) return; // no structured plan for this task — completely ungated
	const role = targetRole ?? (targetInstance ? presenceByInstance[targetInstance] : undefined);
	if (!role) return;
	const phase = findPhaseForRole(plan, role);
	if (phase && phase.status === "locked") {
		const blocker = plan.phases.find((p) => p.phase < phase.phase && p.status !== "complete");
		throw new Error(
			`agent_send: refused — "${role}" belongs to phase ${phase.phase} of the plan for "${slug}", which is still locked` +
				(blocker ? ` (phase ${blocker.phase} isn't marked complete yet — call plan_advance on it first)` : "") +
				".",
		);
	}
}

async function main() {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orch-plan-gate-test-"));
	const main_ = path.join(scratch, "project");
	fs.mkdirSync(main_);
	await execGit(["init", "-q"], main_);
	await execGit(["config", "user.email", "test@example.com"], main_);
	await execGit(["config", "user.name", "Test"], main_);
	fs.writeFileSync(path.join(main_, "README.md"), "# scratch\n");
	await execGit(["add", "."], main_);
	await execGit(["commit", "-q", "-m", "init"], main_);

	const { worktree_path } = await worktreeCreate(main_, "codice-fiscale-api");
	fs.mkdirSync(path.join(worktree_path, "reports"), { recursive: true });

	console.log("1. plan_set REJECTS a plan whose phase 1 doesn't include coder (the exact bug from Revisione 20)...");
	assert.throws(
		() => planSet(worktree_path, "planner", "codice-fiscale-api", [{ roles: ["security-evaluator"], note: "not the TDD exception" }, { roles: ["coder"] }]),
		/phase 1 must include "coder"/,
		"a plan with a phase before coder must be rejected at declaration time, not just at send time (still true for any role OTHER than the TDD exception)",
	);
	console.log("   OK — rejected before it could ever be acted on");

	console.log("1b. ...UNLESS it's the Revisione 21 TDD exception: phase 1 = tdd-agent alone, phase 2 = coder (plus, from Revisione 24, a closing docs-sync phase)...");
	assert.doesNotThrow(
		() =>
			planSet(worktree_path, "planner", "codice-fiscale-tdd", [
				{ roles: ["tdd-agent"], note: "test-first" },
				{ roles: ["coder"] },
				{ roles: ["docs-sync"] },
			]),
		"genuine TDD (tests before implementation) is the one deliberate exception to coder-always-phase-1",
	);
	console.log("   OK — the TDD exception is accepted, and ONLY in this exact shape (checked below)");

	console.log("1c. ...but the TDD exception is narrow: tdd-agent can't share phase 1 with another role...");
	assert.throws(
		() => planSet(worktree_path, "planner", "codice-fiscale-tdd-2", [{ roles: ["tdd-agent", "architecture-diagrammer"] }, { roles: ["coder"] }]),
		/phase 1 must include "coder"/,
		"tdd-agent alone is the exception — tdd-agent PLUS another role must not reopen the original loophole",
	);
	console.log("   OK — the exception doesn't generalize to \"any role that claims independence\"");

	console.log("1d. ...and coder MUST be in phase 2 right after a TDD-only phase 1 — no coder anywhere is still rejected...");
	assert.throws(
		() => planSet(worktree_path, "planner", "codice-fiscale-tdd-3", [{ roles: ["tdd-agent"] }, { roles: ["reviewer"] }]),
		/coder.*must then be in phase 2/s,
		"a TDD-only phase 1 without coder in phase 2 would mean coder never appears in the plan at all",
	);
	console.log("   OK — coder can never be missing from the plan entirely, even via the TDD exception");

	console.log("1e. plan_set REJECTS a structurally valid plan whose LAST phase doesn't include docs-sync (Revisione 24)...");
	assert.throws(
		() => planSet(worktree_path, "planner", "codice-fiscale-docs", [
			{ roles: ["coder", "reviewer"] },
			{ roles: ["security-evaluator", "openapi-writer"] }, // no docs-sync anywhere
		]),
		/LAST phase must include "docs-sync"/,
		"every plan must end with a documentation pass now, not just optionally — same enforcement pattern as coder-always-phase-1",
	);
	console.log("   OK — rejected even though phase 1/role-uniqueness rules are otherwise satisfied");

	console.log("1f. ...but is accepted once docs-sync is added to the last phase (alone, or alongside other closing specialists)...");
	assert.doesNotThrow(() =>
		planSet(worktree_path, "planner", "codice-fiscale-docs", [
			{ roles: ["coder", "reviewer"] },
			{ roles: ["security-evaluator", "openapi-writer", "docs-sync"] },
		]),
	);
	console.log("   OK — docs-sync can share the last phase with other end-of-task specialists, doesn't need a phase of its own");

	console.log("2. plan_set REJECTS a role appearing in two phases, and REJECTS a non-planner caller...");
	assert.throws(() => planSet(worktree_path, "planner", "codice-fiscale-api", [
		{ roles: ["coder", "security-evaluator"] },
		{ roles: ["security-evaluator", "openapi-writer", "docs-sync"] },
	]), /appears in both phase/);
	assert.throws(() => planSet(worktree_path, "coder", "codice-fiscale-api", [{ roles: ["coder"] }]), /only the planner role/);
	console.log("   OK — both structural rules enforced");

	console.log("3. a valid plan_set: phase 1 unlocked automatically, later phases start locked...");
	let plan = planSet(worktree_path, "planner", "codice-fiscale-api", [
		{ roles: ["coder", "reviewer"], note: "implementazione + verifica" },
		{ roles: ["security-evaluator", "openapi-writer", "docs-sync"], note: "dopo approvazione" },
	]);
	assert.equal(plan.phases[0].status, "unlocked");
	assert.equal(plan.phases[1].status, "locked");
	assert.ok(fs.existsSync(planMarkdownPath(worktree_path, "codice-fiscale-api")), "human-readable .plan.md must be rendered too");
	console.log("   OK — phase 1 unlocked, phase 2 locked, .plan.md rendered alongside .plan.json");

	console.log("4. agent_send to a phase-1 role (coder, reviewer) is NEVER refused...");
	assert.doesNotThrow(() => agentSendGateCheck(worktree_path, "codice-fiscale-api", "coder", {}));
	assert.doesNotThrow(() => agentSendGateCheck(worktree_path, "codice-fiscale-api", "reviewer", {}));
	console.log("   OK — phase 1 always reachable");

	console.log("5. agent_send to a phase-2 role (security-evaluator) BEFORE phase 1 completes is REFUSED...");
	assert.throws(
		() => agentSendGateCheck(worktree_path, "codice-fiscale-api", "security-evaluator", {}),
		/refused.*phase 2.*still locked/s,
		"the exact violation this revision exists to prevent",
	);
	console.log("   OK — send blocked outright, not just logged/flagged after the fact");

	console.log("6. agent_send to a role NOT in the plan at all (e.g. \"planner\") is never gated...");
	assert.doesNotThrow(() => agentSendGateCheck(worktree_path, "codice-fiscale-api", "planner", {}));
	console.log("   OK — roles outside the declared plan are always reachable (specialist notifying planner, etc.)");

	console.log("7. plan_advance can't skip ahead (phase 2 while phase 1 still unlocked, not complete)...");
	assert.throws(() => planAdvance(worktree_path, "planner", "codice-fiscale-api", 2), /still locked/);
	assert.throws(() => planAdvance(worktree_path, "coder", "codice-fiscale-api", 1), /only the planner role/);
	console.log("   OK — both guards enforced");

	console.log("8. plan_advance(1) unlocks phase 2, and agent_send to security-evaluator now succeeds...");
	plan = planAdvance(worktree_path, "planner", "codice-fiscale-api", 1);
	assert.equal(plan.phases[0].status, "complete");
	assert.equal(plan.phases[1].status, "unlocked");
	assert.doesNotThrow(() => agentSendGateCheck(worktree_path, "codice-fiscale-api", "security-evaluator", {}));
	console.log("   OK — exactly the phase transition Revisione 18/20 described in prose, now enforced in code");

	console.log("9. plan_advance on an already-complete phase is a harmless no-op (not an error)...");
	const before = JSON.stringify(readPlan(worktree_path, "codice-fiscale-api"));
	planAdvance(worktree_path, "planner", "codice-fiscale-api", 1);
	const after = JSON.stringify(readPlan(worktree_path, "codice-fiscale-api"));
	assert.equal(before, after, "re-advancing an already-complete phase must not change anything");
	console.log("   OK — idempotent, safe to call twice by mistake");

	console.log("10. re-calling plan_set to EXTEND the plan preserves the completed phase's status...");
	plan = planSet(worktree_path, "planner", "codice-fiscale-api", [
		{ roles: ["coder", "reviewer"], note: "implementazione + verifica" }, // unchanged
		{ roles: ["security-evaluator", "openapi-writer"], note: "dopo approvazione" }, // unchanged, was unlocked
		{ roles: ["docs-sync"], note: "nuova fase 3 aggiunta a metà task" }, // brand new
	]);
	assert.equal(plan.phases[0].status, "complete", "phase 1 must stay complete after re-declaring the plan");
	assert.equal(plan.phases[1].status, "unlocked", "phase 2 must stay unlocked (it was already), not reset to locked");
	assert.equal(plan.phases[2].status, "locked", "the brand-new phase 3 starts locked");
	console.log("   OK — extending a plan mid-task doesn't lose progress on phases already underway");

	console.log("10b. TDD-exception plan: tdd-agent (phase 1) always reachable, coder (phase 2) gated until plan_advance(1)...");
	assert.doesNotThrow(() => agentSendGateCheck(worktree_path, "codice-fiscale-tdd", "tdd-agent", {}));
	assert.throws(
		() => agentSendGateCheck(worktree_path, "codice-fiscale-tdd", "coder", {}),
		/refused.*phase 2.*still locked/s,
		"coder itself is gated when it's the one in phase 2 of a TDD plan — the exception flips WHO is phase 1, not the gate mechanism",
	);
	planAdvance(worktree_path, "planner", "codice-fiscale-tdd", 1);
	assert.doesNotThrow(() => agentSendGateCheck(worktree_path, "codice-fiscale-tdd", "coder", {}), "coder reachable once tdd-agent's phase is marked complete");
	console.log("   OK — the gate mechanism itself doesn't special-case tdd-agent, it just follows whichever plan was declared");

	console.log("11. a task with NO structured plan (plan_set never called) is completely ungated...");
	const { worktree_path: wt2 } = await worktreeCreate(main_, "no-plan-task");
	assert.equal(readPlan(wt2, "no-plan-task"), null);
	assert.doesNotThrow(() => agentSendGateCheck(wt2, "no-plan-task", "security-evaluator", {}), "ad hoc tasks that never call plan_set must behave exactly as before this revision");
	console.log("   OK — backward compatible, ungated by default");

	fs.rmSync(scratch, { recursive: true, force: true });
	console.log("\nPLAN GATE SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("PLAN GATE SMOKE TEST FAILED:", err);
	process.exit(1);
});
