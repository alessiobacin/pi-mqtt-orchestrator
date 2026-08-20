// Real end-to-end test of the git worktree lifecycle behind worktree_create /
// worktree_finalize in extensions/orchestrator.ts — mirrors that logic
// exactly (execGit/worktreePaths/assertGitRepo/normalizePath/
// findExistingWorktree, then the create/finalize flows) against ACTUAL git
// repos in a scratch directory. Unlike the pi-tui-dependent fixes elsewhere
// in this project, git is a real dependency available in any dev/CI
// environment, so this one runs the real thing end to end: create, reuse
// (idempotency), the uncommitted-changes safety net, a clean merge +
// cleanup, and — importantly — a genuine merge CONFLICT to confirm the
// abort-and-preserve path never corrupts the main checkout or silently
// drops work.
//
// Usage: node scripts/smoke-test-worktree.mjs   (no broker needed — pure git)

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import assert from "node:assert/strict";

const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

function execGit(args, cwd) {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd }, (err, stdout, stderr) => {
			if (err) reject(new Error(stderr?.toString().trim() || err.message));
			else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
		});
	});
}

function worktreePaths(projectCwd, slug) {
	// Nested inside the project (.worktrees/<slug>), not a sibling directory —
	// see ensureWorktreesGitignored() for how it stays out of `git status` on
	// the main checkout.
	return { path: path.join(projectCwd, ".worktrees", slug), branch: `task/${slug}` };
}

async function assertGitRepo(cwd) {
	try {
		await execGit(["rev-parse", "--is-inside-work-tree"], cwd);
	} catch {
		throw new Error("git worktree isolation requires the project directory to be a git repository.");
	}
}

async function ensureWorktreesGitignored(projectCwd) {
	const gitignorePath = path.join(projectCwd, ".gitignore");
	let existing = "";
	try { existing = fs.readFileSync(gitignorePath, "utf-8"); } catch { /* none yet */ }
	const lines = existing.split("\n").map((l) => l.trim());
	const alreadyIgnored = lines.some((l) => l === ".worktrees" || l === ".worktrees/" || l === "/.worktrees" || l === "/.worktrees/" || l === "*" || l === ".*");
	if (alreadyIgnored) return;
	const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
	const addition = `${needsLeadingNewline ? "\n" : ""}# pi-mqtt-orchestrator: per-task git worktrees (see docs/mvp-notes.md)\n.worktrees/\n`;
	fs.writeFileSync(gitignorePath, existing + addition);
	try {
		await execGit(["add", ".gitignore"], projectCwd);
		await execGit(["commit", "-m", "chore: gitignore .worktrees/ (pi-mqtt-orchestrator task isolation)"], projectCwd);
	} catch { /* non-fatal */ }
}

function normalizePath(p) {
	try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

async function findExistingWorktree(projectCwd, wtPath) {
	const { stdout } = await execGit(["worktree", "list", "--porcelain"], projectCwd);
	const target = normalizePath(wtPath);
	for (const line of stdout.split("\n")) {
		if (!line.startsWith("worktree ")) continue;
		if (normalizePath(line.slice("worktree ".length).trim()) === target) return true;
	}
	return false;
}

async function worktreeCreate(projectCwd, slug) {
	if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}"`);
	await assertGitRepo(projectCwd);
	await ensureWorktreesGitignored(projectCwd);
	const { path: wtPath, branch } = worktreePaths(projectCwd, slug);
	if (await findExistingWorktree(projectCwd, wtPath)) return { worktree_path: wtPath, branch, reused: true };
	let branchExists = true;
	try { await execGit(["rev-parse", "--verify", branch], projectCwd); } catch { branchExists = false; }
	if (branchExists) await execGit(["worktree", "add", wtPath, branch], projectCwd);
	else await execGit(["worktree", "add", "-b", branch, wtPath], projectCwd);
	return { worktree_path: wtPath, branch, reused: false };
}

async function worktreeFinalize(projectCwd, slug, commitMessage) {
	if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}"`);
	await assertGitRepo(projectCwd);
	const { path: wtPath, branch } = worktreePaths(projectCwd, slug);
	if (!(await findExistingWorktree(projectCwd, wtPath))) throw new Error(`no worktree for slug "${slug}"`);

	// Revisione 24: refuse up front if the MAIN checkout itself has
	// uncommitted changes — mirrors the pre-flight check added to
	// worktree_finalize in extensions/orchestrator.ts, added after a real
	// incident where exactly this collision (a dirty main checkout + an
	// in-flight worktree merge) produced a messy conflict.
	const mainStatus = await execGit(["status", "--porcelain"], projectCwd);
	if (mainStatus.stdout.trim().length > 0) {
		return { merged: false, conflict: false, blocked_dirty_main: true, worktree_path: wtPath, branch };
	}

	const message = commitMessage || `Task ${slug}: completed and verified`;
	const status = await execGit(["status", "--porcelain"], wtPath);
	if (status.stdout.trim().length > 0) {
		await execGit(["add", "-A"], wtPath);
		await execGit(["commit", "-m", message], wtPath);
	}
	try {
		await execGit(["merge", "--no-ff", branch, "-m", `Merge ${branch}: ${message}`], projectCwd);
	} catch (err) {
		// Revisione 24: list conflicting files BEFORE aborting — mirrors
		// extensions/orchestrator.ts's use of `git diff --name-only
		// --diff-filter=U`, which only works while the merge is still
		// mid-conflict.
		let conflictFiles = [];
		try {
			const diffResult = await execGit(["diff", "--name-only", "--diff-filter=U"], projectCwd);
			conflictFiles = diffResult.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
		} catch { /* best-effort */ }
		try { await execGit(["merge", "--abort"], projectCwd); } catch { /* nothing to abort */ }
		return { merged: false, conflict: true, worktree_path: wtPath, branch, error: err.message, conflict_files: conflictFiles };
	}
	try {
		await execGit(["worktree", "remove", wtPath], projectCwd);
	} catch {
		await execGit(["worktree", "remove", "--force", wtPath], projectCwd);
	}
	return { merged: true, conflict: false, worktree_path: wtPath, branch };
}

// Mirrors the worktree_list_open tool's execute() exactly — see
// extensions/orchestrator.ts.
function reportPath(worktreePath, slug) {
	return path.join(worktreePath, "reports", `${slug}.md`);
}

async function worktreeListOpen(projectCwd) {
	await assertGitRepo(projectCwd);
	const { stdout } = await execGit(["worktree", "list", "--porcelain"], projectCwd);
	const mainReal = normalizePath(projectCwd);
	const wtRoot = normalizePath(path.join(projectCwd, ".worktrees"));
	const entries = [];
	let current = {};
	for (const line of stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (current.path) entries.push({ path: current.path, branch: current.branch || "" });
			current = { path: line.slice("worktree ".length).trim() };
		} else if (line.startsWith("branch ")) {
			current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
		}
	}
	if (current.path) entries.push({ path: current.path, branch: current.branch || "" });

	const open = [];
	for (const e of entries) {
		const real = normalizePath(e.path);
		if (real === mainReal) continue;
		if (real !== wtRoot && !real.startsWith(wtRoot + path.sep)) continue;
		const slug = path.basename(e.path);
		let task = null;
		try {
			const report = fs.readFileSync(reportPath(e.path, slug), "utf-8");
			const m = report.match(/^-\s*Task:\s*(.+)$/m);
			if (m) task = m[1].trim();
		} catch { /* no report yet */ }
		open.push({ slug, worktree_path: e.path, branch: e.branch, task });
	}
	return open;
}

// Mirrors the worktree_abandon tool's execute() exactly.
async function worktreeAbandon(projectCwd, slug, reason, deleteBranch = true) {
	if (!SLUG_RE.test(slug)) throw new Error(`invalid slug "${slug}"`);
	await assertGitRepo(projectCwd);
	const { path: wtPath, branch } = worktreePaths(projectCwd, slug);
	if (!(await findExistingWorktree(projectCwd, wtPath))) throw new Error(`no worktree for slug "${slug}"`);
	const status = await execGit(["status", "--porcelain"], wtPath);
	if (status.stdout.trim().length > 0) {
		throw new Error(`worktree_abandon: ${wtPath} still has uncommitted changes — refusing to remove it.`);
	}
	try {
		const src = reportPath(wtPath, slug);
		const dest = reportPath(projectCwd, slug);
		if (fs.existsSync(src) && !fs.existsSync(dest)) {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.copyFileSync(src, dest);
		}
	} catch { /* best-effort */ }
	try {
		await execGit(["worktree", "remove", wtPath], projectCwd);
	} catch {
		await execGit(["worktree", "remove", "--force", wtPath], projectCwd);
	}
	let branchDeleted = false;
	if (deleteBranch) {
		try {
			await execGit(["branch", "-D", branch], projectCwd);
			branchDeleted = true;
		} catch { /* best-effort */ }
	}
	return { worktree_path: wtPath, branch, branch_deleted: branchDeleted };
}

async function main() {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orch-wt-test-"));
	const main = path.join(scratch, "project");
	fs.mkdirSync(main);
	await execGit(["init", "-q", "-b", "main"], main);
	await execGit(["config", "user.email", "test@test.com"], main);
	await execGit(["config", "user.name", "Test"], main);
	fs.writeFileSync(path.join(main, "README.md"), "hello\n");
	await execGit(["add", "-A"], main);
	await execGit(["commit", "-q", "-m", "init"], main);

	console.log("1. worktree_create for a new slug...");
	const created = await worktreeCreate(main, "codice-fiscale");
	assert.equal(created.reused, false);
	assert.ok(fs.existsSync(created.worktree_path), "worktree directory should exist on disk");
	assert.equal(created.branch, "task/codice-fiscale");
	assert.equal(created.worktree_path, path.join(main, ".worktrees", "codice-fiscale"), "worktree should be nested inside the project, at .worktrees/<slug>");
	console.log(`   OK — created ${created.worktree_path} on ${created.branch}`);

	console.log("1b. .worktrees/ is gitignored (and the .gitignore change committed) in the main checkout...");
	const gitignore = fs.readFileSync(path.join(main, ".gitignore"), "utf-8");
	assert.match(gitignore, /^\.worktrees\/$/m, ".gitignore should contain a .worktrees/ entry");
	const mainStatusAfterCreate = await execGit(["status", "--porcelain"], main);
	assert.equal(mainStatusAfterCreate.stdout.trim(), "", "main checkout should show nothing dirty/untracked once .worktrees/ is gitignored and .gitignore itself is committed");
	console.log("   OK — .worktrees/ gitignored, .gitignore committed, main checkout clean");

	console.log("2. worktree_create AGAIN with the same slug (idempotency across rounds)...");
	const reused = await worktreeCreate(main, "codice-fiscale");
	assert.equal(reused.reused, true);
	assert.equal(reused.worktree_path, created.worktree_path);
	console.log("   OK — reused the existing worktree instead of erroring or duplicating");

	console.log("3. invalid slug is rejected...");
	await assert.rejects(() => worktreeCreate(main, "Not Valid Slug!"), /invalid slug/);
	console.log("   OK — bad slug rejected before touching git");

	console.log("4. coder/reviewer work in the worktree, leaving something uncommitted...");
	fs.writeFileSync(path.join(created.worktree_path, "codice-fiscale.ts"), "export function check() { return true; }\n");
	// deliberately NOT committing here — worktree_finalize's safety net should catch it
	const statusBefore = await execGit(["status", "--porcelain"], created.worktree_path);
	assert.ok(statusBefore.stdout.trim().length > 0, "sanity: should be dirty before finalize");

	console.log("5. worktree_finalize: commits the leftover change, merges to main, cleans up...");
	const finalized = await worktreeFinalize(main, "codice-fiscale", "codice-fiscale: implemented and verified");
	assert.equal(finalized.merged, true);
	assert.equal(finalized.conflict, false);
	assert.ok(!fs.existsSync(finalized.worktree_path), "worktree directory should be removed after a clean merge");
	assert.ok(fs.existsSync(path.join(main, "codice-fiscale.ts")), "the file should now exist in the MAIN project directory");
	const log = await execGit(["log", "--oneline", "-3"], main);
	assert.match(log.stdout, /Merge task\/codice-fiscale/);
	console.log("   OK — main project directory now has the merged file, worktree cleaned up, merge commit present");

	console.log("6. genuine merge conflict: aborts cleanly, preserves the worktree, never touches main...");
	// A second task that touches the SAME file both on main (directly) and in
	// its own worktree, with different content — guarantees a real conflict.
	const created2 = await worktreeCreate(main, "codice-fiscale-fix");
	fs.writeFileSync(path.join(created2.worktree_path, "codice-fiscale.ts"), "export function check() { return false; } // from worktree\n");
	await execGit(["add", "-A"], created2.worktree_path);
	await execGit(["commit", "-q", "-m", "conflicting change in worktree"], created2.worktree_path);

	fs.writeFileSync(path.join(main, "codice-fiscale.ts"), "export function check() { return 'DIRECT EDIT ON MAIN'; }\n");
	await execGit(["add", "-A"], main);
	await execGit(["commit", "-q", "-m", "conflicting direct edit on main"], main);

	const mainHeadBefore = (await execGit(["rev-parse", "HEAD"], main)).stdout.trim();
	const conflictResult = await worktreeFinalize(main, "codice-fiscale-fix");
	assert.equal(conflictResult.merged, false);
	assert.equal(conflictResult.conflict, true);
	assert.ok(fs.existsSync(created2.worktree_path), "worktree must be PRESERVED (not deleted) after a conflict, for manual resolution");

	const mainHeadAfter = (await execGit(["rev-parse", "HEAD"], main)).stdout.trim();
	assert.equal(mainHeadBefore, mainHeadAfter, "main branch HEAD must be unchanged after an aborted merge");
	const mainStatus = await execGit(["status", "--porcelain"], main);
	assert.equal(mainStatus.stdout.trim(), "", "main checkout must be clean (no leftover conflict markers) after the abort");
	assert.ok(conflictResult.conflict_files.includes("codice-fiscale.ts"), "the conflicting file must be listed automatically (Revisione 24), not left for the caller to figure out from raw git output");
	console.log("   OK — conflict detected, merge aborted, main untouched, worktree preserved for manual resolution, conflicting file listed");

	console.log("7. worktree_finalize REFUSES to even attempt a merge when the MAIN checkout has uncommitted changes (Revisione 24)...");
	const created3 = await worktreeCreate(main, "codice-fiscale-backend");
	fs.writeFileSync(path.join(created3.worktree_path, "backend.ts"), "export const ready = true;\n");
	await execGit(["add", "-A"], created3.worktree_path);
	await execGit(["commit", "-q", "-m", "backend work"], created3.worktree_path);
	// Simulate the real incident: a project update copied into main WITHOUT committing.
	fs.writeFileSync(path.join(main, "README.md"), "hello\nUNCOMMITTED EDIT ON MAIN\n");
	const dirtyResult = await worktreeFinalize(main, "codice-fiscale-backend");
	assert.equal(dirtyResult.merged, false);
	assert.equal(dirtyResult.blocked_dirty_main, true, "must be refused specifically for a dirty main checkout, distinct from a real merge conflict");
	assert.ok(fs.existsSync(created3.worktree_path), "worktree must be PRESERVED when finalize is blocked by a dirty main checkout");
	console.log("   OK — blocked before even attempting the merge, worktree untouched");
	// Clean up the simulated dirty state so the rest of the test isn't affected.
	await execGit(["checkout", "--", "README.md"], main);

	console.log("8. worktree_list_open lists every open worktree with its Task line, and NOT the main checkout itself...");
	fs.mkdirSync(path.join(created3.worktree_path, "reports"), { recursive: true });
	fs.writeFileSync(path.join(created3.worktree_path, "reports", "codice-fiscale-backend.md"), "# Report: Codice fiscale backend\n\n- Task: validate codice fiscale server-side\n- Stato: in corso\n");
	const openList = await worktreeListOpen(main);
	const openSlugs = openList.map((o) => o.slug);
	assert.ok(openSlugs.includes("codice-fiscale-backend"), "the still-open worktree must be listed");
	assert.ok(openSlugs.includes("codice-fiscale-fix"), "the conflicted-and-preserved worktree from step 6 must also still be listed");
	assert.ok(!openSlugs.includes(path.basename(main)), "the main checkout itself must never appear in the open-worktree list");
	const backendEntry = openList.find((o) => o.slug === "codice-fiscale-backend");
	assert.equal(backendEntry.task, "validate codice fiscale server-side", "the Task: line from the report header must be surfaced, so a new planner session can judge overlap without opening every report by hand");
	console.log(`   OK — ${openList.length} open worktree(s) found, Task line surfaced, main checkout excluded`);

	console.log("9. worktree_abandon: cleans up a worktree left orphaned by a MANUAL merge conflict resolution, without touching main's history...");
	const mainHeadBeforeAbandon = (await execGit(["rev-parse", "HEAD"], main)).stdout.trim();
	const abandoned = await worktreeAbandon(main, "codice-fiscale-fix", "resolved manually on main, worktree branch discarded");
	assert.ok(!fs.existsSync(abandoned.worktree_path), "worktree directory must be removed");
	assert.equal(abandoned.branch_deleted, true, "the now-redundant branch should be deleted by default");
	const mainHeadAfterAbandon = (await execGit(["rev-parse", "HEAD"], main)).stdout.trim();
	assert.equal(mainHeadBeforeAbandon, mainHeadAfterAbandon, "worktree_abandon must NEVER touch main's git history — that's worktree_finalize's job, this only cleans up");
	await assert.rejects(() => worktreeAbandon(main, "codice-fiscale-backend"), /uncommitted changes/, "must refuse to abandon a worktree that still has UNCOMMITTED changes, to avoid silently discarding work");
	console.log("   OK — orphaned worktree cleaned up, main history untouched, refuses when work would be lost");

	fs.rmSync(scratch, { recursive: true, force: true });
	console.log("\nWORKTREE SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("WORKTREE SMOKE TEST FAILED:", err);
	process.exit(1);
});
