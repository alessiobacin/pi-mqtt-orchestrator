// Real test of the shared-worktree coordination tools added once the
// planner can bring several specialists into the SAME worktree at once
// (Revisione 15/16): report_append (atomic append instead of read-modify-
// write, to stop two agents from clobbering each other's report section)
// and file_claim/file_release (an advisory lock so two agents don't edit
// the same file at once without at least being told about it). Mirrors the
// exact logic added to extensions/orchestrator.ts against a real scratch
// git repo/worktree (git is a real dependency here, same approach as
// smoke-test-worktree.mjs) — no MQTT/pi needed since these tools are pure
// fs + git.
//
// Usage: node scripts/smoke-test-coordination.mjs

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

async function worktreeFinalize(projectCwd, slug) {
	const { path: wtPath, branch } = worktreePaths(projectCwd, slug);
	// Same cleanup order as the real tool: locks removed BEFORE the safety-net commit.
	fs.rmSync(locksPath(wtPath), { force: true });
	const status = await execGit(["status", "--porcelain"], wtPath);
	if (status.stdout.trim().length > 0) {
		await execGit(["add", "-A"], wtPath);
		await execGit(["commit", "-q", "-m", `Task ${slug}`], wtPath);
	}
	await execGit(["merge", "--no-ff", branch, "-m", `Merge ${branch}`], projectCwd);
	try { await execGit(["worktree", "remove", wtPath], projectCwd); } catch { await execGit(["worktree", "remove", "--force", wtPath], projectCwd); }
}

function reportPath(worktreePath, slug) {
	return path.join(worktreePath, "reports", `${slug}.md`);
}

function locksPath(worktreePath) {
	return path.join(worktreePath, ".orchestrator-locks.json");
}

function readLocks(worktreePath) {
	try {
		const parsed = JSON.parse(fs.readFileSync(locksPath(worktreePath), "utf-8"));
		return Array.isArray(parsed) ? parsed : [];
	} catch { return []; }
}

function writeLocks(worktreePath, locks) {
	fs.writeFileSync(locksPath(worktreePath), JSON.stringify(locks, null, 2));
}

function lockExpired(lock, nowMs) {
	return nowMs - new Date(lock.claimed_at).getTime() > lock.ttl_minutes * 60_000;
}

function reportAppend(worktreePath, slug, section) {
	const file = reportPath(worktreePath, slug);
	if (!fs.existsSync(file)) throw new Error(`report_append: ${file} does not exist yet`);
	fs.appendFileSync(file, `\n${section.replace(/\s+$/, "")}\n`);
}

function fileClaim(worktreePath, file, holder, ttlMinutes, nowMs) {
	if (path.isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("unsafe file path");
	const locks = readLocks(worktreePath).filter((l) => !lockExpired(l, nowMs));
	const existing = locks.find((l) => l.file === file);
	if (existing && existing.holder !== holder) return { claimed: false, held_by: existing.holder, since: existing.claimed_at };
	const next = locks.filter((l) => l.file !== file);
	next.push({ file, holder, claimed_at: new Date(nowMs).toISOString(), ttl_minutes: ttlMinutes ?? 20 });
	writeLocks(worktreePath, next);
	return { claimed: true, already_yours: !!existing };
}

function fileRelease(worktreePath, file, holder) {
	const locks = readLocks(worktreePath);
	const held = locks.find((l) => l.file === file && l.holder === holder);
	writeLocks(worktreePath, locks.filter((l) => !(l.file === file && l.holder === holder)));
	return { released: !!held };
}

async function main() {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orch-coord-test-"));
	const main = path.join(scratch, "project");
	fs.mkdirSync(main);
	await execGit(["init", "-q", "-b", "main"], main);
	await execGit(["config", "user.email", "test@test.com"], main);
	await execGit(["config", "user.name", "Test"], main);
	fs.writeFileSync(path.join(main, "README.md"), "hello\n");
	await execGit(["add", "-A"], main);
	await execGit(["commit", "-q", "-m", "init"], main);

	const { worktree_path } = await worktreeCreate(main, "checkout-flow");
	fs.mkdirSync(path.join(worktree_path, "reports"), { recursive: true });
	fs.writeFileSync(reportPath(worktree_path, "checkout-flow"), "# Report: Checkout flow\n\n- Task: implement checkout\n- Stato: in corso\n");

	console.log("1. report_append: two 'concurrent' agents appending survive (no lost update)...");
	// Simulates the exact race report_append is meant to prevent: both agents
	// append via a real OS append call, not read-whole-file-then-write-whole-file.
	reportAppend(worktree_path, "checkout-flow", "## Round 1 — coder (`coder-01`)\n\n- Implementazione: checkout base");
	reportAppend(worktree_path, "checkout-flow", "## Round 1 — security-evaluator (`security-evaluator-01`)\n\n- Nessuna vulnerabilita' trovata");
	const reportContent = fs.readFileSync(reportPath(worktree_path, "checkout-flow"), "utf-8");
	assert.match(reportContent, /Round 1 — coder/);
	assert.match(reportContent, /Round 1 — security-evaluator/);
	assert.match(reportContent, /Task: implement checkout/, "original header must survive both appends");
	console.log("   OK — both sections present, nothing clobbered, original header intact");

	console.log("2. report_append on a report that doesn't exist yet fails loudly instead of silently creating a headerless file...");
	assert.throws(() => reportAppend(worktree_path, "nonexistent-slug", "## Round 1"), /does not exist yet/);
	console.log("   OK — clear error instead of silent misbehavior");

	console.log("3. file_claim: first agent claims a file, second agent is blocked...");
	const now = Date.now();
	const c1 = fileClaim(worktree_path, "src/checkout.ts", "coder-01", 20, now);
	assert.equal(c1.claimed, true);
	const c2 = fileClaim(worktree_path, "src/checkout.ts", "frontend-developer-01", 20, now + 1000);
	assert.equal(c2.claimed, false);
	assert.equal(c2.held_by, "coder-01");
	console.log("   OK — second agent sees claimed:false and who holds it, instead of silently colliding");

	console.log("4. same holder re-claiming is a no-op success (renews), not a conflict with itself...");
	const c3 = fileClaim(worktree_path, "src/checkout.ts", "coder-01", 20, now + 2000);
	assert.equal(c3.claimed, true);
	assert.equal(c3.already_yours, true);
	console.log("   OK — re-claiming your own file renews instead of erroring");

	console.log("5. file_release frees it up for the next agent...");
	const r1 = fileRelease(worktree_path, "src/checkout.ts", "coder-01");
	assert.equal(r1.released, true);
	const c4 = fileClaim(worktree_path, "src/checkout.ts", "frontend-developer-01", 20, now + 3000);
	assert.equal(c4.claimed, true, "should be claimable immediately after release");
	console.log("   OK — released, then claimable by someone else");

	console.log("6. release by someone who doesn't hold it is a harmless no-op...");
	const r2 = fileRelease(worktree_path, "src/checkout.ts", "someone-else-01");
	assert.equal(r2.released, false);
	const stillHeld = fileClaim(worktree_path, "src/checkout.ts", "coder-01", 20, now + 4000);
	assert.equal(stillHeld.claimed, false, "the real holder's claim must survive a no-op release attempt by a non-holder");
	console.log("   OK — no-op confirmed, real holder's claim untouched");

	console.log("7. an expired claim is treated as free automatically...");
	const veryOld = now - 25 * 60_000; // 25 minutes ago, ttl is 20
	fileClaim(worktree_path, "docs/README.md", "docs-sync-01", 20, veryOld);
	const afterExpiry = fileClaim(worktree_path, "docs/README.md", "architecture-diagrammer-01", 20, now);
	assert.equal(afterExpiry.claimed, true, "an expired lock should not block a new claim");
	console.log("   OK — stale lock from a crashed/forgetful agent doesn't block forever");

	console.log("8. worktree_finalize removes the lock registry before merging — never lands in main...");
	fileClaim(worktree_path, "src/checkout.ts", "coder-01", 20, now); // leave one active lock behind on purpose
	assert.ok(fs.existsSync(locksPath(worktree_path)), "sanity: lock file should exist before finalize");
	await worktreeFinalize(main, "checkout-flow");
	assert.ok(!fs.existsSync(path.join(main, ".orchestrator-locks.json")), "the ephemeral lock registry must never land in the main project");
	assert.ok(fs.existsSync(path.join(main, "reports", "checkout-flow.md")), "the actual report file SHOULD land in main");
	const mainStatus = await execGit(["status", "--porcelain"], main);
	assert.equal(mainStatus.stdout.trim(), "", "main checkout should be clean after finalize");
	console.log("   OK — lock registry cleaned up before merge, report file merged normally, main checkout clean");

	fs.rmSync(scratch, { recursive: true, force: true });
	console.log("\nCOORDINATION SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("COORDINATION SMOKE TEST FAILED:", err);
	process.exit(1);
});
