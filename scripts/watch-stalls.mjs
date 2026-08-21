#!/usr/bin/env node
// `po watch` — zero-token stall watcher (Ticket 04).
//
// A standalone detector that runs OUTSIDE any `pi` session (no LLM context at
// all — this process never calls an LLM). It periodically queries the local
// orchestrator.db for tickets stuck in "running" past a configured stall
// threshold and, when one is found:
//   - publishes a `ticket_stalled` event on the run's MQTT event topic
//     (pi/<project>/runs/<run>/events) so any live planner/widget sees it,
//   - appends a JSONL marker to the workspace logs area, and
//   - optionally sends a WhatsApp tripwire (same env contract as the extension).
//
// Why it exists: the in-process watchdog (Revisione 29) only runs while a
// planner instance is alive. `po watch` detaches detection+alerting from any
// live session — pure Node + sqlite + mqtt, zero tokens. It does NOT judge
// (lento vs bloccato) and does NOT act on the ticket: surfacing/pinging/
// failing stays the planner's decision (resumability contract). Idempotent:
// it only reads SQLite and appends markers.
//
// Complementary, not a replacement: keep the in-process watchdog for the
// planner's own wake; run `po watch` (in a bg pane / tmux / herdr) as a
// detached tripwire so stalls are still surfaced when no planner is open.
//
// Uso:
//   po watch [--project <slug>] [--stall-ms 900000] [--interval-ms 60000] [--once] [--away]
//   (in locale: node scripts/watch-stalls.mjs [stesse opzioni])
//
// Away-mode (Ticket 07): con `--away` il watcher assorbe il rumore di routine
// (una passata senza stall è silenziosa) e alza SOLO le decisioni vere (uno o
// più stall), incluse le notifiche WhatsApp. Nessun LLM extra — è il filtro di
// priorità in pura logica.
//
// Oppure `--away` può essere guidato da env: quando PI_ORCH_AWAY=1 la routine
// viene assorbita allo stesso modo, così il watcher può essere lanciato una
// volta e rimanere silenzioso mentre l'operatore è lontano.

import { existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import mqtt from "mqtt";

const moaRequire = createRequire(import.meta.url);

function parseArgs(argv) {
	const o = { project: null, stallMs: 900000, intervalMs: 60000, once: false, away: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--project") o.project = argv[++i];
		else if (a === "--stall-ms") o.stallMs = Number(argv[++i]);
		else if (a === "--interval-ms") o.intervalMs = Number(argv[++i]);
		else if (a === "--once") o.once = true;
		else if (a === "--away" || a === "-aw") o.away = true;
	}
	return o;
}

function resolveProject(cwd) {
	const cfgPath = path.join(cwd, ".pi", "extensions", "multiAgentOrchestrator", "config", "project.json");
	try {
		const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
		if (cfg.project) return cfg.project;
	} catch { /* fallthrough */ }
	try {
		const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf-8"));
		if (pkg.name && !String(pkg.name).startsWith("@otomatik/pi-mqtt-")) return pkg.name;
	} catch { /* fallthrough */ }
	return path.basename(cwd);
}

export async function runWatch({ cwd, argv }) {
	// `argv` is already the post-slice argument vector (script/import callers
	// pass process.argv.slice(2) or `--once --project ...`); parseArgs iterates
	// it directly, matching runEndProject's convention.
	const opts = parseArgs(argv);
	const project = opts.project || resolveProject(cwd);

	const dbPath = path.join(cwd, ".pi", "extensions", "multiAgentOrchestrator", "orchestratorStorage", "orchestrator.db");
	if (!existsSync(dbPath)) {
		console.log(`po watch: nessun orchestrator.db per questo progetto (${dbPath}) — niente da sorvegliare.`);
		process.exit(0);
	}

	let DatabaseSync;
	try {
		({ DatabaseSync } = moaRequire("node:sqlite"));
	} catch (err) {
		console.error(`po watch: node:sqlite non disponibile (${err instanceof Error ? err.message : String(err)}).`);
		process.exit(1);
	}

	const db = new DatabaseSync(dbPath, { readOnly: true });
	const brokerUrl = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";

	let client = null;
	try {
		client = mqtt.connect(brokerUrl);
		await new Promise((res, rej) => { client.once("connect", res); client.once("error", rej); });
	} catch (err) {
		client = null;
		console.warn(`po watch: broker ${brokerUrl} non raggiungibile (${err instanceof Error ? err.message : String(err)}) — solo report locale.`);
	}

	const now = Date.now();
	let stalled = [];
	try {
		const rows = db.prepare("SELECT * FROM tickets WHERE status = 'running' ORDER BY updated_at ASC").all();
		stalled = rows.filter((t) => now - new Date(t.updated_at).getTime() > opts.stallMs);
	} catch (err) {
		console.error(`po watch: query SQLite fallita (${err instanceof Error ? err.message : String(err)})`);
		process.exit(1);
	}

	const logDir = path.join(cwd, ".pi", "extensions", "multiAgentOrchestrator", "logs");

	// Semantic liveness proxy (Ticket 05): an assignee whose JSONL log carries a
	// recent tool_execution_start marker (logged by the extension at the START of
	// each tool call) is *actively tooling* — likely a long task, not a hung turn.
	// This is the per-harness semantic signal that lets an observer distinguish
	// "slow" from "blocked" (the Revisione 29 case) without any LLM turn.
	const semanticActive = new Set();
	try {
		if (existsSync(logDir)) {
			const stalenessWindow = Math.min(opts.stallMs, 600_000); // tool call within the last (stall or 10min) window counts as active
			const cutoff = now - stalenessWindow;
			for (const f of readdirSync(logDir)) {
				if (!f.endsWith(".jsonl")) continue;
				const inst = f.replace(/\.jsonl$/, "");
				try {
					const lines = readFileSync(path.join(logDir, f), "utf-8").split("\n").filter(Boolean);
					for (let i = lines.length - 1; i >= 0; i--) {
						const line = lines[i].trim();
						if (!line) continue;
						const o = JSON.parse(line);
						if (o && o.type === "tool_execution_start") {
							const t = new Date(o.ts).getTime();
							if (!Number.isNaN(t) && t > cutoff) semanticActive.add(inst);
							break;
						}
					}
				} catch { /* log format drift — ignore */ }
			}
		}
	} catch { /* best-effort */ }
	const marker = [];
	for (const t of stalled) {
		const elapsedMs = now - new Date(t.updated_at).getTime();
		const active = t.assigned_instance ? semanticActive.has(t.assigned_instance) : false;
		const event = { ts: new Date().toISOString(), type: "stall_watch", ticket_id: t.id, run_id: t.run_id, assigned_instance: t.assigned_instance, elapsed_ms: elapsedMs, semantic_active: active };
		if (client) {
			const topic = `pi/${project}/runs/${t.run_id}/events`;
			try {
				await client.publishAsync(topic, JSON.stringify({ type: "ticket_stalled", run_id: t.run_id, payload: { ticket_id: t.id, assigned_instance: t.assigned_instance, elapsed_ms: elapsedMs }, timestamp: new Date().toISOString() }), { qos: 0 });
			} catch { /* best-effort */ }
		}
		try {
			mkdirSync(logDir, { recursive: true });
			appendFileSync(path.join(logDir, "watch-stalls.jsonl"), JSON.stringify(event) + "\n");
		} catch { /* best-effort */ }
		console.log(`⚠️  ${t.id} "${t.title || "(no title)"}" — running da ${Math.round(elapsedMs / 60_000)} min (${t.assigned_instance ?? "?"})${active ? " [tool attivi di recente → probabile task lento, non bloccato]" : " [NESSUN tool recente → possibile turno bloccato]"}`);
		marker.push(event);
	}

	if (stalled.length === 0) {
		// Away-mode (Ticket 07): a clean 'no stall' pass is routine/heartbeat —
		// absorb it (silence) instead of paging the operator on every sweep.
		if (!awayEnabled(opts)) console.log(`po watch: nessun ticket running oltre ${Math.round(opts.stallMs / 60_000)} min (project "${project}").`);
	} else {
		// A real stall is a genuine decision — surface it in BOTH modes (away
		// still escalates real decisions; it only absorbs routine noise).
		console.log(`po watch: ${marker.length} stall rilevat${marker.length === 1 ? "o" : "i"} — pubblicati su MQTT e loggati. La decisione operativa è del planner, non del watcher.`);
	}

	if (marker.length && process.env.DESTINATION_PHONE_NUMBER && process.env.EVOLUTION_API_URL) {
		// Optional WhatsApp tripwire — best-effort, same env contract as the extension.
		try {
			const api = process.env.EVOLUTION_API_URL.replace(/\/$/, "");
			const url = `${api}/message/sendText/${process.env.EVOLUTION_INSTANCE || "default"}`;
			await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY || "" },
				body: JSON.stringify({ number: process.env.DESTINATION_PHONE_NUMBER, text: `⏱️ ${marker.length} ticket stagnanti (po watch): ${marker.map((m) => m.ticket_id).join(", ")}` }),
			});
		} catch { /* best-effort */ }
	}

	try { db.close(); } catch { /* ignore */ }
	if (client) {
		// Graceful close: force:false lets already-published (QoS0 in-flight)
		// messages flush before the connection drops — force:true here would
		// discard the ticket_stalled events we just published.
		try { await new Promise((r) => setTimeout(r, 120)); client.end(false); } catch { /* ignore */ }
	}

	if (opts.once || opts.intervalMs <= 0) return; // single pass — let the caller decide to exit
	// Real watcher loop: after this pass, wait intervalMs then run again.
	// Env-gated away mode is honored on every pass, so `--away` can be implied
	// by PI_ORCH_AWAY=1 even if the process was launched without the flag.
	setTimeout(() => {
		runWatch({ cwd, argv }).catch((e) => { console.error(e); process.exit(1); });
	}, opts.intervalMs);
}

function awayEnabled(opts) {
	return opts.away || String(process.env.PI_ORCH_AWAY || "") === "1";
}

// Direct invocation: `node scripts/watch-stalls.mjs --once` — only here do we
// take ownership of the process lifetime (process.exit), so an embedded caller
// importing runWatch can still run assertions after a --once pass.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const invokedOnce = async () => {
		await runWatch({ cwd: process.cwd(), argv: process.argv.slice(2) });
		process.exit(0); // explicit --once or defaults to single pass by this exit
	};
	invokedOnce().catch((err) => {
		console.error(`po watch: errore — ${err instanceof Error ? err.stack || err.message : String(err)}`);
		process.exit(1);
	});
}
