// Real test of the debug event log added to diagnose flow-ordering bugs
// (Revisione 18) — e.g. the real one reported by the user where the
// planner delegated to the whole confirmed team in one shot instead of
// following an execution plan, so reviewer (and almost everyone else)
// started immediately instead of waiting to be invoked. Mirrors the exact
// logEvent()/gitignore logic added to extensions/orchestrator.ts against a
// real scratch git repo (no MQTT/pi needed, this is pure fs + git), then
// runs the real scripts/review-log.mjs as a subprocess against the
// generated logs/ to check it correctly merges + flags the case.
//
// Usage: node scripts/smoke-test-debug-log.mjs

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function execGit(args, cwd) {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd }, (err, stdout, stderr) => {
			if (err) reject(new Error(stderr?.toString().trim() || err.message));
			else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
		});
	});
}

function run(cmd, args, cwd) {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { cwd }, (err, stdout, stderr) => {
			// review-log.mjs is allowed to exit 0 even when it prints a warning —
			// only reject on an actual spawn failure, not on its own exit code
			// (it doesn't use non-zero exit codes for "found a suspect").
			resolve({ stdout: stdout.toString(), stderr: stderr.toString(), err });
		});
	});
}

// Mirrors logEvent() in extensions/orchestrator.ts exactly: one JSONL file
// per instance, plain fs.appendFileSync (one writer per file, so no
// lost-update risk — unlike the shared report file).
function logEvent(projectCwd, instance, role, type, data = {}) {
	const dir = path.join(projectCwd, "logs");
	fs.mkdirSync(dir, { recursive: true });
	const line = `${JSON.stringify({ ts: new Date().toISOString(), instance, role, type, ...data })}\n`;
	fs.appendFileSync(path.join(dir, `${instance}.jsonl`), line);
}

// Mirrors ensureWorktreesGitignored()'s logs/ handling.
async function ensureScratchDirsGitignored(projectCwd) {
	const patterns = [
		{ dir: ".worktrees/", comment: "# pi-mqtt-orchestrator: per-task git worktrees" },
		{ dir: "logs/", comment: "# pi-mqtt-orchestrator: per-instance debug event logs, diagnostic only" },
	];
	const gitignorePath = path.join(projectCwd, ".gitignore");
	let existing = "";
	try { existing = fs.readFileSync(gitignorePath, "utf-8"); } catch { /* none yet */ }
	const lines = existing.split("\n").map((l) => l.trim());
	const isIgnored = (dir) => {
		const bare = dir.replace(/\/$/, "");
		return lines.some((l) => l === dir || l === `/${dir}` || l === bare || l === `/${bare}` || l === "*" || l === ".*");
	};
	let addition = "";
	for (const { dir, comment } of patterns) {
		if (isIgnored(dir)) continue;
		addition += `${comment}\n${dir}\n`;
	}
	if (!addition) return;
	const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
	fs.writeFileSync(gitignorePath, existing + (needsLeadingNewline ? "\n" : "") + addition);
	await execGit(["add", ".gitignore"], projectCwd);
	await execGit(["commit", "-m", "chore: gitignore .worktrees/ and logs/"], projectCwd);
}

async function main() {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orch-log-test-"));
	const main_ = path.join(scratch, "project");
	fs.mkdirSync(main_);
	await execGit(["init", "-q"], main_);
	await execGit(["config", "user.email", "test@example.com"], main_);
	await execGit(["config", "user.name", "Test"], main_);
	fs.writeFileSync(path.join(main_, "README.md"), "# scratch\n");
	await execGit(["add", "."], main_);
	await execGit(["commit", "-q", "-m", "init"], main_);

	console.log("1. logs/ gitignored + committed in the main checkout, same pass as .worktrees/...");
	await ensureScratchDirsGitignored(main_);
	const gitignore = fs.readFileSync(path.join(main_, ".gitignore"), "utf-8");
	assert.ok(gitignore.includes(".worktrees/"), ".gitignore should cover .worktrees/");
	assert.ok(gitignore.includes("logs/"), ".gitignore should cover logs/");
	const status1 = await execGit(["status", "--porcelain"], main_);
	assert.equal(status1.stdout.trim(), "", "main checkout should be clean right after the gitignore commit");
	console.log("   OK — .gitignore covers both, committed, main checkout clean");

	console.log("2. simulating a live-test run: planner delegates only to coder (correct), coder wakes and works...");
	logEvent(main_, "planner-01", "planner", "session_start", { project: "demo" });
	logEvent(main_, "coder-01", "coder", "session_start", { project: "demo" });
	logEvent(main_, "reviewer-01", "reviewer", "session_start", { project: "demo" });
	logEvent(main_, "planner-01", "planner", "agent_send_out", { assignment_id: "A1", target: "coder-01", hops: 0 });
	logEvent(main_, "coder-01", "coder", "wake_in", { assignment_id: "A1", sender_instance: "planner-01", sender_role: "planner" });
	logEvent(main_, "coder-01", "coder", "turn_start", { had_pending_inbound: true });
	logEvent(main_, "coder-01", "coder", "agent_end", { had_inbound: true, assignment_id: "A1" });
	logEvent(main_, "coder-01", "coder", "agent_send_out", { assignment_id: "A2", target: "reviewer-01", hops: 1 });
	logEvent(main_, "reviewer-01", "reviewer", "wake_in", { assignment_id: "A2", sender_instance: "coder-01", sender_role: "coder" });
	logEvent(main_, "reviewer-01", "reviewer", "turn_start", { had_pending_inbound: true });
	logEvent(main_, "reviewer-01", "reviewer", "agent_end", { had_inbound: true, assignment_id: "A2" });
	console.log("   OK — events written to logs/planner-01.jsonl, logs/coder-01.jsonl, logs/reviewer-01.jsonl");

	console.log("3. review-log.mjs merges all three files into one chronological timeline...");
	const clean = await run("node", [path.join(__dirname, "review-log.mjs"), path.join(main_, "logs")], scratch);
	assert.ok(!clean.err, `review-log.mjs should not crash on well-formed logs: ${clean.stderr}`);
	// Cerca le righe SPECIFICHE dell'invio e del risveglio (non solo il nome
	// istanza, che compare anche nelle righe di session_start — ties di
	// timestamp lì sono innocue, non hanno un ordine causale reale, quindi
	// non sono quello che questo test vuole verificare). Regressione reale
	// (Revisione 20): planner-01 e coder-01 possono avere lo stesso `ts` al
	// millisecondo se il test gira abbastanza in fretta — il caso che deve
	// restare comunque nell'ordine causale corretto è proprio invio→risveglio
	// per lo stesso assignment_id, non il testo generico dell'istanza.
	const lines = clean.stdout.split("\n");
	const idxPlannerSend = lines.findIndex((l) => l.includes("planner-01") && l.includes("agent_send_out") && l.includes("\"A1\""));
	const idxCoderWake = lines.findIndex((l) => l.includes("coder-01") && l.includes("wake_in") && l.includes("\"A1\""));
	assert.ok(idxPlannerSend !== -1 && idxCoderWake !== -1 && idxPlannerSend < idxCoderWake, "planner's send (assignment A1) should appear before coder's wake in the merged timeline, even if their timestamps tie to the millisecond");
	assert.ok(clean.stdout.includes("Nessuna partenza non richiesta"), "a fully-solicited run should NOT be flagged as suspicious");
	console.log("   OK — merged chronologically, no false positive on a correctly-sequenced run");

	console.log("4. simulating THE reported bug: reviewer starts on its own, with no prior wake_in...");
	logEvent(main_, "reviewer-01", "reviewer", "turn_start", { had_pending_inbound: false });
	logEvent(main_, "reviewer-01", "reviewer", "agent_end", { had_inbound: false });
	const buggy = await run("node", [path.join(__dirname, "review-log.mjs"), path.join(main_, "logs")], scratch);
	assert.ok(!buggy.err, `review-log.mjs should not crash: ${buggy.stderr}`);
	// reviewer-01 DOES have an earlier wake_in (from step 2) in its own file, so this
	// specific reviewer isn't a false suspect here — check the detector against an
	// instance with ZERO wake_in ever, which is the real "started on its own" shape.
	logEvent(main_, "docs-sync-01", "docs-sync", "session_start", { project: "demo" });
	logEvent(main_, "docs-sync-01", "docs-sync", "turn_start", { had_pending_inbound: false });
	logEvent(main_, "docs-sync-01", "docs-sync", "agent_end", { had_inbound: false });
	const flagged = await run("node", [path.join(__dirname, "review-log.mjs"), path.join(main_, "logs")], scratch);
	assert.ok(flagged.stdout.includes("Possibile partenza non richiesta"), "an instance that acted with zero prior wake_in must be flagged");
	assert.ok(flagged.stdout.includes("docs-sync-01"), "the flagged instance name must be named explicitly");
	console.log("   OK — an instance that acted without ever receiving a task is correctly flagged");

	console.log("5. malformed line in one file doesn't crash the merge, just gets skipped with a warning...");
	fs.appendFileSync(path.join(main_, "logs", "coder-01.jsonl"), "not valid json\n");
	const withGarbage = await run("node", [path.join(__dirname, "review-log.mjs"), path.join(main_, "logs")], scratch);
	assert.ok(!withGarbage.err, "a malformed line should not crash the script");
	assert.ok(withGarbage.stderr.includes("riga non valida") || withGarbage.stdout.includes("riga non valida"), "a malformed line should be reported, not silently dropped");
	console.log("   OK — malformed line skipped with a warning, rest of the merge unaffected");

	fs.rmSync(scratch, { recursive: true, force: true });
	console.log("\nDEBUG LOG SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("DEBUG LOG SMOKE TEST FAILED:", err);
	process.exit(1);
});
