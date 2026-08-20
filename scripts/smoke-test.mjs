// Standalone smoke test of the MQTT transport/paradigm logic used by
// extensions/orchestrator.ts (presence retain+LWT, command/response with a
// fencing token, QoS1 duplicate handling) — run against a real local broker,
// independent of the Pi CLI (which isn't installable in this sandbox).
//
// Usage: node scripts/smoke-test.mjs

import mqtt from "mqtt";
import assert from "node:assert/strict";

const BROKER = "mqtt://localhost:1883";
const project = "smoketest";
const T = {
	cmd: (id) => `pi/${project}/agents/${id}/commands`,
	resp: (id) => `pi/${project}/agents/${id}/responses`,
	status: (id) => `pi/${project}/agents/${id}/status`,
	statusWild: () => `pi/${project}/agents/+/status`,
};

function ulid() {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function connectAgent(instance, role) {
	const client = await mqtt.connectAsync(BROKER, {
		protocolVersion: 5,
		clientId: `smoke-${instance}-${ulid()}`,
		clean: true,
		will: { topic: T.status(instance), payload: JSON.stringify({ instance, role, status: "offline" }), qos: 1, retain: true },
	});
	await client.publishAsync(T.status(instance), JSON.stringify({ instance, role, status: "idle" }), { qos: 1, retain: true });
	return client;
}

async function main() {
	console.log("1. connecting planner-01 and coder-01...");
	const planner = await connectAgent("planner-01", "planner");
	const coder = await connectAgent("coder-01", "coder");

	console.log("2. planner subscribes to presence wildcard, should see coder-01 retained status...");
	const seenPresence = new Set();
	planner.on("message", (topic, payload) => {
		const m = topic.match(/\/agents\/([^/]+)\/status$/);
		if (m) {
			const card = JSON.parse(payload.toString());
			seenPresence.add(`${m[1]}:${card.status}`);
		}
	});
	await planner.subscribeAsync(T.statusWild(), { qos: 0 });
	await new Promise((r) => setTimeout(r, 300));
	assert.ok([...seenPresence].some((s) => s.startsWith("coder-01:")), "planner should see coder-01 presence");
	console.log("   OK — presence seen:", [...seenPresence]);

	console.log("3. command/response round trip with fencing token (assignment_id)...");
	await coder.subscribeAsync(T.cmd("coder-01"), { qos: 1 });
	const received = [];
	const seenAssignments = new Set();
	coder.on("message", async (topic, payload) => {
		if (topic !== T.cmd("coder-01")) return;
		const env = JSON.parse(payload.toString());
		if (seenAssignments.has(env.assignment_id)) {
			received.push({ duplicate: true, assignment_id: env.assignment_id });
			return; // dedupe, as orchestrator.ts's rememberAssignment() does
		}
		seenAssignments.add(env.assignment_id);
		received.push({ duplicate: false, assignment_id: env.assignment_id });
		// simulate coder replying
		await coder.publishAsync(env.reply_to, JSON.stringify({
			type: "response", assignment_id: env.assignment_id, responder_instance: "coder-01", response: "done", error: null,
		}), { qos: 1 });
	});

	await planner.subscribeAsync(T.resp("planner-01"), { qos: 1 });
	const assignment_id = ulid();
	let resolveReply;
	const replyPromise = new Promise((res) => { resolveReply = res; });
	planner.on("message", (topic, payload) => {
		if (topic !== T.resp("planner-01")) return;
		const env = JSON.parse(payload.toString());
		if (env.assignment_id === assignment_id) resolveReply(env);
	});

	await planner.publishAsync(T.cmd("coder-01"), JSON.stringify({
		type: "command", assignment_id, sender_instance: "planner-01", sender_role: "planner",
		target_instance: "coder-01", project, prompt: "implement backend", reply_to: T.resp("planner-01"), hops: 0, timestamp: new Date().toISOString(),
	}), { qos: 1 });

	const reply = await Promise.race([replyPromise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout waiting for reply")), 5000))]);
	assert.equal(reply.response, "done");
	assert.equal(reply.assignment_id, assignment_id);
	console.log("   OK — got response:", reply);

	console.log("4. simulating a duplicate QoS1 delivery of the same command (broker redelivery)...");
	await coder.publishAsync(T.cmd("coder-01"), JSON.stringify({
		type: "command", assignment_id, sender_instance: "planner-01", sender_role: "planner",
		target_instance: "coder-01", project, prompt: "implement backend", reply_to: T.resp("planner-01"), hops: 0, timestamp: new Date().toISOString(),
	}), { qos: 1 });
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(received.filter((r) => r.assignment_id === assignment_id && r.duplicate).length, 1, "duplicate should be deduped, not reprocessed");
	console.log("   OK — duplicate delivery deduped, not double-executed");

	console.log("5. clean disconnect publishes offline status (retained)...");
	const offlineSeen = new Promise((resolve) => {
		planner.on("message", (topic, payload) => {
			if (topic === T.status("coder-01")) {
				const card = JSON.parse(payload.toString());
				if (card.status === "offline") resolve(card);
			}
		});
	});
	await coder.publishAsync(T.status("coder-01"), JSON.stringify({ instance: "coder-01", role: "coder", status: "offline" }), { qos: 1, retain: true });
	await coder.endAsync();
	const offlineCard = await Promise.race([offlineSeen, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout waiting for offline status")), 5000))]);
	assert.equal(offlineCard.status, "offline");
	console.log("   OK — offline status observed:", offlineCard);

	await planner.endAsync();
	console.log("\nALL SMOKE TESTS PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("SMOKE TEST FAILED:", err);
	process.exit(1);
});
