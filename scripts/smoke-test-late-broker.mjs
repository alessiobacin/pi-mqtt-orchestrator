// Verifies the fix for the exact bug reported: if the broker isn't up yet
// when the client starts, mqtt.connect() (not connectAsync + throw) must
// keep retrying in the background and fire "connect" once the broker
// becomes available — matching the resilient connection logic now in
// extensions/orchestrator.ts's session_start.
//
// Usage: node scripts/smoke-test-late-broker.mjs
// (starts NO broker itself for the first few seconds on purpose)

import mqtt from "mqtt";
import { spawn } from "node:child_process";

const client = mqtt.connect("mqtt://localhost:1884", {
	protocolVersion: 5,
	clientId: "late-broker-test",
	reconnectPeriod: 1000,
	connectTimeout: 5000,
});

let connected = false;
client.on("connect", () => {
	connected = true;
	console.log("OK — client connected after the broker came up late");
	client.end(true, () => process.exit(0));
});
client.on("error", () => { /* expected while broker is down */ });

console.log("1. client started with mqtt.connect() while NO broker is listening on :1884...");
setTimeout(() => {
	if (connected) return;
	console.log("2. still not connected after 3s (expected) — starting the broker now...");
	const mosq = spawn("mosquitto", ["-p", "1884"], { stdio: "ignore" });
	setTimeout(() => {
		if (!connected) {
			console.error("FAILED — client never connected after broker became available");
			mosq.kill();
			process.exit(1);
		}
	}, 8000);
}, 3000);
