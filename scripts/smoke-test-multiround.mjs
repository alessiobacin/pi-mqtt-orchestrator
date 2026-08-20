// Verifies the extended multi-round flow the role prompts now implement:
// planner -> coder -> reviewer REJECTS -> coder fixes -> reviewer approves
// -> planner is NOT satisfied yet -> planner starts a whole new round ->
// coder -> reviewer approves -> planner is satisfied (final report).
//
// This is a wire-protocol simulation (bare MQTT clients acting out what the
// LLM in each role is instructed to do), same style as
// smoke-test-pipeline.mjs — it does NOT exercise the actual hop-limit logic
// inside orchestrator.ts's agent_send tool (that requires the real pi
// ExtensionAPI host, not available outside a real `pi` process; see
// scripts/../docs/mvp-notes.md for the standalone reproduction that checks
// the hop math directly). What this DOES verify: that repeated back-and-forth
// on the same roles/<role>/tasks topics works correctly across more than one
// hop in each direction, and that a planner receiving a non-final
// "please evaluate" message can distinguish it from the eventual final one
// and correctly trigger a second full round.
//
// Usage: node scripts/smoke-test-multiround.mjs   (needs a broker on :1883)

import mqtt from "mqtt";
import assert from "node:assert/strict";

const BROKER = "mqtt://localhost:1883";
const project = "smoketest-multiround";
const T = {
	resp: (id) => `pi/${project}/agents/${id}/responses`,
	status: (id) => `pi/${project}/agents/${id}/status`,
	roleTasks: (role) => `pi/${project}/roles/${role}/tasks`,
};

function ulid() {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function connectAgent(instance, role) {
	const client = await mqtt.connectAsync(BROKER, {
		protocolVersion: 5,
		clientId: `multiround-${instance}-${ulid()}`,
		clean: true,
		will: { topic: T.status(instance), payload: JSON.stringify({ instance, role, status: "offline" }), qos: 1, retain: true },
	});
	await client.subscribeAsync(T.roleTasks(role), { qos: 1 });
	return client;
}

function sendRoleCommand(client, senderInstance, senderRole, targetRole, prompt) {
	const assignment_id = ulid();
	const env = {
		type: "command", assignment_id, sender_instance: senderInstance, sender_role: senderRole,
		target_role: targetRole, project, prompt, reply_to: T.resp(senderInstance), hops: 0, timestamp: new Date().toISOString(),
	};
	return client.publishAsync(T.roleTasks(targetRole), JSON.stringify(env), { qos: 1 }).then(() => assignment_id);
}

async function main() {
	console.log("1. connecting planner-01, coder-01, reviewer-01...");
	const planner = await connectAgent("planner-01", "planner");
	const coder = await connectAgent("coder-01", "coder");
	const reviewer = await connectAgent("reviewer-01", "reviewer");

	let coderRound = 0; // how many times coder has been asked to (re)implement
	let reviewerSeen = 0;
	const plannerMessages = [];

	// coder-01: round 1 implements and asks for review; round 2 (after a
	// "new round" from planner) implements again and asks for review too.
	coder.on("message", async (topic, payload) => {
		if (topic !== T.roleTasks("coder")) return;
		const env = JSON.parse(payload.toString());
		if (env.sender_instance === "coder-01") return;
		coderRound += 1;
		console.log(`   coder-01 round ${coderRound}: task from ${env.sender_instance} -> ${env.prompt}`);
		await sendRoleCommand(coder, "coder-01", "coder", "reviewer", `round ${coderRound} implementation ready for review`);
	});

	// reviewer-01: rejects coder's FIRST attempt (round 1) once, approves
	// every subsequent attempt (round 1 retry, and round 2).
	let rejectedOnce = false;
	reviewer.on("message", async (topic, payload) => {
		if (topic !== T.roleTasks("reviewer")) return;
		const env = JSON.parse(payload.toString());
		if (env.sender_instance === "reviewer-01") return;
		reviewerSeen += 1;
		if (!rejectedOnce) {
			rejectedOnce = true;
			console.log("   reviewer-01: rejecting round 1 attempt, sending back to coder...");
			await sendRoleCommand(reviewer, "reviewer-01", "reviewer", "coder", "found an issue, please fix X");
			return;
		}
		console.log(`   reviewer-01: approving (review #${reviewerSeen}), notifying planner for final evaluation...`);
		await sendRoleCommand(reviewer, "reviewer-01", "reviewer", "planner", "work completed and verified, please do a final evaluation");
	});

	// planner-01: first time it hears from reviewer, it is NOT satisfied and
	// starts a whole new round; second time, it is satisfied (final).
	const plannerFinal = new Promise((resolve) => {
		planner.on("message", async (topic, payload) => {
			if (topic !== T.roleTasks("planner")) return;
			const env = JSON.parse(payload.toString());
			if (env.sender_instance === "planner-01") return;
			plannerMessages.push(env);
			if (plannerMessages.length === 1) {
				console.log("   planner-01: not satisfied yet, starting a NEW round (new_round semantics)...");
				await sendRoleCommand(planner, "planner-01", "planner", "coder", "please also cover edge case Y in a second round");
				return;
			}
			console.log("   planner-01: satisfied, this is the final report.");
			resolve(env);
		});
	});

	console.log("2. planner-01 delegates the task to role 'coder' (round 1)...");
	await sendRoleCommand(planner, "planner-01", "planner", "coder", "sviluppami una mini funzione che fa il controllo di un codice fiscale");

	const final = await Promise.race([
		plannerFinal,
		new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: planner never reached the final report")), 8000)),
	]);

	assert.equal(coderRound, 3, "coder should have been asked to implement 3 times (initial, fix after rejection, and the planner-initiated round 2)");
	assert.equal(reviewerSeen, 3, "reviewer should have seen 3 review requests (initial, post-fix, round 2)");
	assert.equal(plannerMessages.length, 2, "planner should have heard from reviewer twice (not-satisfied, then final)");
	assert.match(final.prompt, /completed and verified/);

	console.log("   OK — rejection, fix, re-approval, planner-initiated new round, and eventual final report all confirmed");

	await Promise.all([planner.endAsync(), coder.endAsync(), reviewer.endAsync()]);
	console.log("\nMULTI-ROUND SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("MULTI-ROUND SMOKE TEST FAILED:", err);
	process.exit(1);
});
