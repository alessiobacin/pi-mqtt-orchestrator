// Real test of the WhatsApp completion notification via Evolution API,
// added on explicit user request (Revisione 19): worktree_finalize sends a
// message when a task completes successfully, configured through a .env
// file (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME,
// DESTINATION_PHONE_NUMBER — see .env.example). Mirrors the exact
// loadEnvFile()/getEnvVar()/sendWhatsAppNotification() logic added to
// extensions/orchestrator.ts against a REAL local HTTP server standing in
// for Evolution API (node:http, no network access, no real WhatsApp
// message is ever sent by this test) — this verifies the actual HTTP
// request shape (method, path, headers, body), not just that "some fetch
// happens".
//
// Usage: node scripts/smoke-test-whatsapp-notify.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import assert from "node:assert/strict";

// Mirrors loadEnvFile()/getEnvVar() exactly.
function loadEnvFile(cwd) {
	const result = {};
	try {
		const raw = fs.readFileSync(path.join(cwd, ".env"), "utf-8");
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			let value = trimmed.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
			result[key] = value;
		}
	} catch { /* no .env — fine */ }
	return result;
}

function getEnvVar(cwd, key, envOverride) {
	return (envOverride && envOverride[key]) || loadEnvFile(cwd)[key] || undefined;
}

// Mirrors sendWhatsAppNotification() exactly, except process.env is passed
// in explicitly (envOverride) so this test doesn't need to mutate the real
// process.env of the test runner.
async function sendWhatsAppNotification(cwd, message, envOverride = {}) {
	const apiUrl = getEnvVar(cwd, "EVOLUTION_API_URL", envOverride);
	const apiKey = getEnvVar(cwd, "EVOLUTION_API_KEY", envOverride);
	const instanceName = getEnvVar(cwd, "EVOLUTION_INSTANCE_NAME", envOverride);
	const destination = getEnvVar(cwd, "DESTINATION_PHONE_NUMBER", envOverride);
	const missing = [
		!apiUrl && "EVOLUTION_API_URL",
		!apiKey && "EVOLUTION_API_KEY",
		!instanceName && "EVOLUTION_INSTANCE_NAME",
		!destination && "DESTINATION_PHONE_NUMBER",
	].filter(Boolean);
	if (missing.length > 0) return { ok: false, detail: `non configurato — variabili mancanti nel .env: ${missing.join(", ")}` };
	const url = `${apiUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(instanceName)}`;
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json", apikey: apiKey },
			body: JSON.stringify({ number: destination, text: message }),
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			return { ok: false, detail: `Evolution API ha risposto ${res.status}: ${body.slice(0, 200)}` };
		}
		return { ok: true, detail: "inviato" };
	} catch (err) {
		return { ok: false, detail: err instanceof Error ? err.message : String(err) };
	}
}

async function main() {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orch-whatsapp-test-"));

	console.log("1. missing .env / unset vars -> silently reports not-configured, never throws...");
	const noConfig = await sendWhatsAppNotification(scratch, "hello", {});
	assert.equal(noConfig.ok, false);
	assert.ok(noConfig.detail.includes("EVOLUTION_API_URL"), "should name the missing vars so the user can fix it");
	console.log("   OK —", noConfig.detail);

	console.log("2. .env file parsed correctly (quotes stripped, comments/blank lines ignored)...");
	fs.writeFileSync(path.join(scratch, ".env"), [
		"# commento da ignorare",
		"",
		'EVOLUTION_API_URL="http://127.0.0.1:0"', // placeholder, overridden per-test below with envOverride
		"EVOLUTION_API_KEY=segreto123",
		"EVOLUTION_INSTANCE_NAME=mio-whatsapp",
		"DESTINATION_PHONE_NUMBER=393331234567",
	].join("\n"));
	const parsed = loadEnvFile(scratch);
	assert.equal(parsed.EVOLUTION_API_URL, "http://127.0.0.1:0", "quotes must be stripped");
	assert.equal(parsed.EVOLUTION_API_KEY, "segreto123");
	assert.equal(Object.keys(parsed).length, 4, "comment and blank line must not become spurious keys");
	console.log("   OK — .env parsed into exactly the 4 expected keys");

	console.log("3. a real local HTTP server stands in for Evolution API — verifying the exact request shape...");
	let received = null;
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (c) => { body += c; });
		req.on("end", () => {
			received = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body || "{}") };
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "PENDING" }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;

	const ok = await sendWhatsAppNotification(scratch, "✅ Task completato", {
		EVOLUTION_API_URL: `http://127.0.0.1:${port}`,
		EVOLUTION_API_KEY: "segreto123",
		EVOLUTION_INSTANCE_NAME: "mio-whatsapp",
		DESTINATION_PHONE_NUMBER: "393331234567",
	});
	assert.equal(ok.ok, true, `expected success, got: ${ok.detail}`);
	assert.equal(received.method, "POST");
	assert.equal(received.url, "/message/sendText/mio-whatsapp", "instance name must be a URL path segment, not a query param or body field");
	assert.equal(received.headers.apikey, "segreto123", "API key must go in the apikey header, not Authorization");
	assert.deepEqual(received.body, { number: "393331234567", text: "✅ Task completato" }, "body must be the flat {number, text} shape");
	console.log("   OK — POST /message/sendText/<instance>, apikey header, {number, text} body — matches Evolution API v2");

	console.log("4. a non-2xx response from Evolution API is reported as a failure with the response body, not silently swallowed...");
	server.removeAllListeners("request");
	const server2 = http.createServer((req, res) => {
		res.writeHead(401, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ message: "invalid apikey" }));
	});
	await new Promise((resolve, reject) => { server.close(() => { server2.listen(0, "127.0.0.1", resolve); }); });
	const port2 = server2.address().port;
	const failed = await sendWhatsAppNotification(scratch, "test", {
		EVOLUTION_API_URL: `http://127.0.0.1:${port2}`,
		EVOLUTION_API_KEY: "wrong-key",
		EVOLUTION_INSTANCE_NAME: "mio-whatsapp",
		DESTINATION_PHONE_NUMBER: "393331234567",
	});
	assert.equal(failed.ok, false);
	assert.ok(failed.detail.includes("401"), "the actual HTTP status should be surfaced for debugging");
	assert.ok(failed.detail.includes("invalid apikey"), "the response body should be surfaced too, not just the status code");
	console.log("   OK —", failed.detail);

	server2.close();
	fs.rmSync(scratch, { recursive: true, force: true });
	console.log("\nWHATSAPP NOTIFY SMOKE TEST PASSED");
	process.exit(0);
}

main().catch((err) => {
	console.error("WHATSAPP NOTIFY SMOKE TEST FAILED:", err);
	process.exit(1);
});
