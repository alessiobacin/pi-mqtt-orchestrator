// Real test of the automatic report audit trail added on explicit user
// request (Revisione 19): after watching a live herdr test where it wasn't
// clear whether the team was actually following the planner's phase plan
// (Revisione 18) or all just busy at once again, the user asked for every
// report_append AND every task-scoped agent_send to automatically record a
// timestamped snapshot of every known agent's status — so the report file
// alone (not the herdr panes, not logs/*.jsonl) is a complete audit trail.
// Mirrors the exact logic added to extensions/orchestrator.ts
// (agentStatusSnapshot(), the report_append footer, the agent_send slug
// param) against a real scratch git repo/worktree — no MQTT/pi needed,
// presence is simulated as a plain in-memory map exactly like the real
// `presence` Map extensions/orchestrator.ts keeps.
//
// Usage: node scripts/smoke-test-report-audit.mjs

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

function reportPath(worktreePath, slug) {
	return path.join(worktreePath, "reports", `${slug}.md`);
}

// Mirrors agentStatusSnapshot() exactly: self (from a fake `identity` +
// `inboundQueue`) plus every entry in a fake `presence` Map.
function agentStatusSnapshot(identity, inboundQueueSize, presence) {
	const self = {
		instance: identity.instance,
		role: identity.role,
		status: inboundQueueSize > 0 ? "busy" : "idle",
		current_load: inboundQueueSize,
		capacity: identity.capacity,
		self: true,
	};
	const others = [...presence.values()].map((c) => ({ ...c, self: false }));
	const all = [self, ...others].sort((a, b) => a.instance.localeCompare(b.instance));
	return all.map((a) => `${a.instance}(${a.role})=${a.status}${a.self ? "·io" : ""}[${a.current_load}/${a.capacity}]`).join(", ");
}

// Mirrors report_append's execute(): section + auto footer, ONE atomic append.
function reportAppend(worktreePath, slug, section, identity, inboundQueueSize, presence) {
	const file = reportPath(worktreePath, slug);
	if (!fs.existsSync(file)) throw new Error(`report_append: ${file} does not exist yet`);
	const eventLine = `\n> _[evento] report_append di \`${identity.instance}\` (\`${identity.role}\`) alle ${new Date().toISOString()} — stato team: ${agentStatusSnapshot(identity, inboundQueueSize, presence)}_\n`;
	const chunk = `\n${section.replace(/\s+$/, "")}\n${eventLine}`;
	fs.appendFileSync(file, chunk);
	return { report_path: file, appended_bytes: chunk.length };
}

// Mirrors agent_send's best-effort slug-scoped audit append.
function agentSendAudit(worktreePath, slug, identity, target, assignment_id, hops, newRound, inboundQueueSize, presence) {
	const file = reportPath(worktreePath, slug);
	if (!fs.existsSync(file)) return false; // silently skipped, exactly like the real tool
	const line =
		`\n> _[evento] agent_send: \`${identity.instance}\` (\`${identity.role}\`) → \`${target}\`` +
		` — assignment_id \`${assignment_id}\`, hops ${hops}${newRound ? ", new_round" : ""} — alle ${new Date().toISOString()}_\n` +
		`> _Stato team in quel momento: ${agentStatusSnapshot(identity, inboundQueueSize, presence)}_\n`;
	fs.appendFileSync(file, line);
	return true;
}

async function main() {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orch-audit-test-"));
	const main_ = path.join(scratch, "project");
	fs.mkdirSync(main_);
	await execGit(["init", "-q"], main_);
	await execGit(["config", "user.email", "test@example.com"], main_);
	await execGit(["config", "user.name", "Test"], main_);
	fs.writeFileSync(path.join(main_, "README.md"), "# scratch\n");
	await execGit(["add", "."], main_);
	await execGit(["commit", "-q", "-m", "init"], main_);

	console.log("1. worktree_create + report bootstrap...");
	const { worktree_path } = await worktreeCreate(main_, "codice-fiscale-api");
	fs.mkdirSync(path.join(worktree_path, "reports"), { recursive: true });
	const reportFile = reportPath(worktree_path, "codice-fiscale-api");
	fs.writeFileSync(reportFile, "# Report: Codice fiscale API\n\n- Task: validazione\n- Stato: in corso\n");
	console.log("   OK — report bootstrapped");

	const plannerIdentity = { instance: "planner-01", role: "planner", capacity: 1 };
	const coderIdentity = { instance: "coder-01", role: "coder", capacity: 1 };
	const presenceAsCoderSees = new Map([
		["planner-01", { instance: "planner-01", role: "planner", status: "idle", current_load: 0, capacity: 1 }],
		["reviewer-01", { instance: "reviewer-01", role: "reviewer", status: "idle", current_load: 0, capacity: 1 }],
	]);

	console.log("2. report_append automatically appends an event+status footer, atomically with the section...");
	const before = fs.readFileSync(reportFile, "utf-8");
	reportAppend(worktree_path, "codice-fiscale-api", "## Round 1 — coder\n\n- fatto qualcosa", coderIdentity, 1, presenceAsCoderSees);
	const after = fs.readFileSync(reportFile, "utf-8");
	assert.ok(after.startsWith(before), "the original content must be untouched, only appended to");
	assert.ok(after.includes("## Round 1 — coder"), "the section itself must be present");
	assert.ok(after.includes("[evento] report_append di `coder-01` (`coder`)"), "the auto event line must be present");
	assert.ok(after.includes("coder-01(coder)=busy·io"), "the reporting agent's OWN status must be in its own snapshot, marked ·io");
	assert.ok(after.includes("planner-01(planner)=idle") && after.includes("reviewer-01(reviewer)=idle"), "every other known agent must be in the snapshot too");
	console.log("   OK — section + event/status footer written as one atomic append, self included and marked");

	console.log("3. agent_send WITH slug appends its own event+status line to the report...");
	const beforeSend = fs.readFileSync(reportFile, "utf-8");
	const wrote = agentSendAudit(worktree_path, "codice-fiscale-api", coderIdentity, "reviewer-01", "01ABCXYZ", 1, false, 1, presenceAsCoderSees);
	assert.equal(wrote, true, "should have written since the report exists");
	const afterSend = fs.readFileSync(reportFile, "utf-8");
	assert.ok(afterSend.startsWith(beforeSend), "must only append, never touch prior content");
	assert.ok(afterSend.includes("agent_send: `coder-01` (`coder`) → `reviewer-01`"), "the send event line must record sender and target");
	assert.ok(afterSend.includes("assignment_id `01ABCXYZ`"), "the assignment_id must be recorded for cross-referencing with logs/*.jsonl");
	console.log("   OK — agent_send-with-slug leaves a matching audit trail in the report");

	console.log("4. agent_send WITHOUT a report yet (bad/missing slug) is silently skipped, never throws...");
	const wroteMissing = agentSendAudit(worktree_path, "nonexistent-task", coderIdentity, "reviewer-01", "01ZZZ", 0, false, 0, presenceAsCoderSees);
	assert.equal(wroteMissing, false, "must silently report false, not throw, when the report doesn't exist");
	console.log("   OK — missing report handled as a silent no-op, exactly like the real tool's best-effort design");

	console.log("5. the planner's own status reflects its inboundQueue size (busy while it has unfulfilled work)...");
	const idleSnapshot = agentStatusSnapshot(plannerIdentity, 0, new Map());
	const busySnapshot = agentStatusSnapshot(plannerIdentity, 2, new Map());
	assert.ok(idleSnapshot.includes("planner-01(planner)=idle"), "0 pending inbound -> idle");
	assert.ok(busySnapshot.includes("planner-01(planner)=busy"), ">0 pending inbound -> busy");
	console.log("   OK — self status derived correctly from inboundQueue size, matching the real publishPresence() logic");

	fs.rmSync(scratch, { recursive: true, force: true });
	console.log("\nREPORT AUDIT SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("REPORT AUDIT SMOKE TEST FAILED:", err);
	process.exit(1);
});
