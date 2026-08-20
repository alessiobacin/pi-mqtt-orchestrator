// Verifies the fix for "Ctrl+C does nothing": if the mqtt client never
// manages to connect (broker unreachable, exactly the symptom reported),
// the shutdown sequence must still terminate within a bounded time instead
// of hanging forever on a queued QoS1 publish/end that will never resolve.
// Mirrors the withTimeout-guarded cleanShutdown() in extensions/orchestrator.ts.
//
// Usage: node scripts/smoke-test-shutdown-hang.mjs   (no broker needed — that's the point)

import mqtt from "mqtt";

function withTimeout(p, ms) {
	// NOT unref'd — see the matching comment in extensions/orchestrator.ts.
	// An earlier version of this test unref'd the watchdog timer, which made
	// the test itself unreliable: with nothing else keeping the event loop
	// alive, Node abandoned the pending await entirely instead of letting the
	// watchdog fire, so the script exited "cleanly" without ever validating
	// the timeout path.
	return Promise.race([
		p,
		new Promise((resolve) => { setTimeout(() => resolve(undefined), ms); }),
	]);
}

async function main() {
	console.log("1. connecting to a broker that will never respond (127.0.0.1:1 — nothing listens there)...");
	const client = mqtt.connect("mqtt://127.0.0.1:1", { reconnectPeriod: 1000, connectTimeout: 2000 });
	client.on("error", () => { /* expected, never connects */ });

	await new Promise((r) => setTimeout(r, 1500)); // let it sit "reconnecting" for a bit, like the real bug

	console.log("2. running the same bounded shutdown sequence orchestrator.ts uses...");
	const start = Date.now();

	await withTimeout(client.publishAsync("pi/test/agents/x/status", "{}", { qos: 1, retain: true }), 2000);
	await withTimeout(client.endAsync(), 1500);
	client.end(true);

	const elapsed = Date.now() - start;
	console.log(`   shutdown sequence took ${elapsed}ms`);

	if (elapsed > 5000) {
		console.error(`FAILED — shutdown took too long (${elapsed}ms), the hang is not fixed`);
		process.exit(1);
	}
	console.log("   OK — shutdown terminated within bounds even though the client never connected");
	console.log("\nSHUTDOWN-HANG SMOKE TEST PASSED");
	// No explicit process.exit(0) here on purpose: exiting immediately after
	// console.log can truncate unflushed stdout when it's piped (not a TTY).
	// Nothing is left pending (client force-closed above), so Node exits
	// naturally with code 0 once this function returns.
}

main().catch((err) => {
	console.error("SHUTDOWN-HANG SMOKE TEST FAILED:", err);
	process.exit(1);
});
