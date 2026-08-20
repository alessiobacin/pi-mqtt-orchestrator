// Verifies the exact mechanical chain the role prompts rely on:
// planner (target_role: coder) -> coder (target_role: reviewer) ->
// reviewer (target_role: planner), all via the roles/<role>/tasks topic,
// not direct instance addressing. This was NOT covered by smoke-test.mjs
// (which only exercised 1:1 agents/<instance>/commands).
//
// Usage: node scripts/smoke-test-pipeline.mjs   (needs a broker on :1883)

import mqtt from "mqtt";
import assert from "node:assert/strict";

const BROKER = "mqtt://localhost:1883";
const project = "smoketest-pipeline";
const T = {
	cmd: (id) => `pi/${project}/agents/${id}/commands`,
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
		clientId: `pipeline-${instance}-${ulid()}`,
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
	console.log("1. connecting planner-01, coder-01, reviewer-01, each subscribed to its own roles/<role>/tasks...");
	const planner = await connectAgent("planner-01", "planner");
	const coder = await connectAgent("coder-01", "coder");
	const reviewer = await connectAgent("reviewer-01", "reviewer");

	const seen = { coder: null, reviewer: null, planner: null };

	// coder-01: on receiving a task addressed to role "coder", hands off to role "reviewer"
	coder.on("message", async (topic, payload) => {
		if (topic !== T.roleTasks("coder")) return;
		const env = JSON.parse(payload.toString());
		if (env.target_role !== "coder" || env.sender_instance === "coder-01") return;
		seen.coder = env;
		console.log("   coder-01 received task from", env.sender_instance, "->", env.prompt);
		await sendRoleCommand(coder, "coder-01", "coder", "reviewer", "implemented codice-fiscale check, please review");
	});

	// reviewer-01: on receiving a task addressed to role "reviewer", approves and informs role "planner"
	reviewer.on("message", async (topic, payload) => {
		if (topic !== T.roleTasks("reviewer")) return;
		const env = JSON.parse(payload.toString());
		if (env.target_role !== "reviewer" || env.sender_instance === "reviewer-01") return;
		seen.reviewer = env;
		console.log("   reviewer-01 received review request from", env.sender_instance, "->", env.prompt);
		await sendRoleCommand(reviewer, "reviewer-01", "reviewer", "planner", "work completed and verified: codice-fiscale check looks correct, tests pass");
	});

	// planner-01: on receiving the final report addressed to role "planner"
	const plannerDone = new Promise((resolve) => {
		planner.on("message", (topic, payload) => {
			if (topic !== T.roleTasks("planner")) return;
			const env = JSON.parse(payload.toString());
			if (env.target_role !== "planner" || env.sender_instance === "planner-01") return;
			seen.planner = env;
			resolve(env);
		});
	});

	console.log("2. planner-01 delegates the task to role 'coder'...");
	await sendRoleCommand(planner, "planner-01", "planner", "coder", "sviluppami una mini funzione che fa il controllo di un codice fiscale");

	const final = await Promise.race([plannerDone, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout: planner never got the final report")), 5000))]);

	assert.ok(seen.coder, "coder-01 should have received the task from planner-01");
	assert.equal(seen.coder.sender_instance, "planner-01");
	assert.ok(seen.reviewer, "reviewer-01 should have received the review request from coder-01");
	assert.equal(seen.reviewer.sender_instance, "coder-01");
	assert.ok(seen.planner, "planner-01 should have received the final report from reviewer-01");
	assert.equal(seen.planner.sender_instance, "reviewer-01");
	assert.match(final.prompt, /completed and verified/);

	console.log("   OK — full chain planner -> coder -> reviewer -> planner confirmed over roles/<role>/tasks topics");

	await Promise.all([planner.endAsync(), coder.endAsync(), reviewer.endAsync()]);
	console.log("\nPIPELINE SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("PIPELINE SMOKE TEST FAILED:", err);
	process.exit(1);
});
