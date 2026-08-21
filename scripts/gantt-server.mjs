#!/usr/bin/env node
// `po gantt` / `po web` — live Gantt view of orchestration state (Ticket 11).
//
// A tiny self-contained web server (Node http + a minimal WebSocket upgrade
// handshake — no npm dependencies, no websocket lib) that serves a single-page
// Gantt timeline of this project's runs/tickets/phases from the on-disk
// orchestrator.db, and streams MQTT orchestration events live so the view
// updates as agents publish "something happened".
//
// - GET /            → HTML+JS page that renders the timeline
// - GET /data        → JSON snapshot of runs/tickets/holds from SQLite
// - GET /healthz     → { ok: true }
// - WebSocket /ws    → pushes a fresh snapshot on every MQTT run-event
//
// read-only: never modifies DB/tickets/worktrees. `po gantt --open` opens the
// browser.
//
// Uso:
//   po gantt [--port 8174] [--open] [--project <slug>]
//   (in locale: node scripts/gantt-server.mjs [stesse opzioni])

import { readFileSync, existsSync } from "node:fs";
import * as net from "node:net";
import * as http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import mqtt from "mqtt";

const moaRequire = createRequire(import.meta.url);

function workspaceDir(cwd) { return path.join(cwd, ".pi", "extensions", "multiAgentOrchestrator"); }
function resolveProject(cwd) {
	try { const cfg = JSON.parse(readFileSync(path.join(workspaceDir(cwd), "config", "project.json"), "utf-8")); if (cfg.project) return cfg.project; } catch { /* */ }
	try { const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf-8")); if (pkg.name && !String(pkg.name).startsWith("@otomatik/pi-mqtt-")) return pkg.name; } catch { /* */ }
	return path.basename(cwd);
}

// ── Snapshot: runs + tickets + open holds from orchestrator.db ───────────
function buildSnapshot(cwd) {
	const dbPath = path.join(workspaceDir(cwd), "orchestratorStorage", "orchestrator.db");
	if (!existsSync(dbPath)) return { project: resolveProject(cwd), runs: [], ok: false };
	let DatabaseSync;
	try { ({ DatabaseSync } = moaRequire("node:sqlite")); } catch { return { project: resolveProject(cwd), runs: [], ok: false, error: "node:sqlite unavailable" }; }
	const db = new DatabaseSync(dbPath, { readOnly: true });
	const project = resolveProject(cwd);
	const runs = db.prepare("SELECT * FROM runs WHERE project = ? ORDER BY created_at ASC").all(project);
	const enriched = runs.map((r) => {
		const tickets = db.prepare("SELECT * FROM tickets WHERE run_id = ? ORDER BY created_at ASC").all(r.id);
		const holds = db.prepare("SELECT * FROM decision_holds WHERE run_id = ? AND status='open'").all(r.id);
		return { ...r, tickets, open_holds: holds };
	});
	db.close();
	return { project, runs: enriched, ok: true };
}

function handleUpgrade(req, socket, head, wss) {
	const url = req.url.split("?")[0];
	if (url !== "/ws") { socket.destroy(); return; }
	const key = req.headers["sec-websocket-key"];
	if (!key) { socket.destroy(); return; }
	const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
	socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
	wss.add(socket);
	// frames are text (opcode 0x81). We only ever SEND; incoming is ignored for
	// this simple view (client may send pings; parse-opcode below is sender-only).
}
function wsSend(socket, obj) {
	try {
		const payload = Buffer.from(JSON.stringify(obj));
		const header = Buffer.alloc(payload.length > 125 ? 4 : 2);
		if (payload.length > 125) { header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
		else { header[0] = 0x81; header[1] = payload.length; }
		socket.write(Buffer.concat([header, payload]));
	} catch { /* ignore */ }
}
function wsBroadcast(wss, obj) { for (const s of wss) { if (!s.destroyed) wsSend(s, obj); } }

// ── Minimal SPA that renders the timeline ─────────────────────────────────
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Orchestrator Gantt</title>
<style>
:root{--edge:#333;--txt:#e6e6e6;--bg:#1a1a1a;--card:#2a2a2a}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 ui-monospace,Menlo,monospace;background:var(--bg);color:var(--txt)}
h1{font-size:18px;margin:12px 16px}.bar{height:22px;border-radius:3px;color:#000;padding:2px 6px;overflow:hidden;white-space:nowrap}
.wrap{margin:0 16px 24px}.run{border:1px solid var(--edge);border-left:4px solid #4a9eff;padding:8px;margin:12px 0;background:var(--card)}
.run h3{margin:0 0 6px;font-size:14px}.t{display:flex;gap:6px;align-items:center;margin:3px 0}
.status-done{background:#3a9a5a}.status-running{background:#f0c040}.status-pending{background:#6a6a8a}.status-blocked{background:#c05050}.status-failed{background:#c05050}.status-cancelled{background:#555}
legend{margin:0 16px}.legend span{display:inline-block;width:12px;height:12px;border-radius:2px;vertical-align:middle;margin:0 6px 0 14px}
.rank{color:#999;width:24px;text-align:right;display:inline-block}
</style></head><body>
<h1 id="title">Orchestrator — Gantt</h1>
<legend><span class="status-done"></span>done<span class="status-running"></span>running<span class="status-pending"></span>pending<span class="status-blocked"></span>blocked<span class="status-failed"></span>failed</legend>
<div class="wrap" id="root"></div>
<script>
const colors={done:"status-done",running:"status-running",pending:"status-pending",blocked:"status-blocked",failed:"status-failed",cancelled:"status-cancelled"};
function esc(s){return String(s??"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}
function render(snap){
  document.getElementById("title").textContent="Orchestrator — "+ (snap.project||"") +" (live)";
  const root=document.getElementById("root");
  if(!snap.ok){ root.innerHTML="<p>no orchestrator.db found for this project</p>"; return; }
  if(!snap.runs.length){ root.innerHTML="<p>no runs yet</p>"; return; }
  root.innerHTML=snap.runs.map(function(r){
    const tickets=(r.tickets||[]);
    const holds=(r.open_holds||[]);
    return '<div class="run"><h3>'+esc(r.id)+' <span style="color:#999">'+esc(r.status)+'</span> — '+esc(r.objective||"")+'</h3>'+
      (holds.length?'<div style="color:#f0c040">⚠️ '+esc(holds.length)+' open hold(s): '+esc(holds.map(function(h){return h.question;}).join(" | "))+'</div>':'')+
      tickets.map(function(t){return '<div class="t"><span class="rank">#'+(ticketOrder.get(t.id)??t.id.slice(-4))+'</span><span class="bar '+colors[t.status]+'">'+esc(t.title)+'</span><span style="color:#999">'+esc(t.status)+(t.assigned_instance?' · '+esc(t.assigned_instance):'')+'</span></div>';}).join("")+
    '</div>';
  }).join("");
}
const ticketOrder=new Map();var ticketN=0;
async function load(){const r=await fetch("/data");const snap=await r.json();(snap.runs||[]).forEach(function(ru){(ru.tickets||[]).forEach(function(t){if(!ticketOrder.has(t.id))ticketOrder.set(t.id,++ticketN);});});render(snap);}
try{const ws=new WebSocket((location.protocol==="https:"?"wss":"ws")+"://"+location.host+"/ws");ws.onmessage=function(e){try{const s=JSON.parse(e.data);(s.runs||[]).forEach(function(ru){(ru.tickets||[]).forEach(function(t){if(!ticketOrder.has(t.id))ticketOrder.set(t.id,++ticketN);});});render(s);}catch(_){}};}catch(_){}
load();setInterval(load,5000);
</script></body></html>`;

export async function runGantt({ cwd, argv, packageRoot }) {
	const portArg = argv.includes("--port") ? Number(argv[argv.indexOf("--port") + 1]) : 8174;
	const project = argv.includes("--project") ? argv[argv.indexOf("--project") + 1] : resolveProject(cwd);
	const useCwd = argv.includes("--cwd") ? argv[argv.indexOf("--cwd") + 1] : cwd;
	const open = argv.includes("--open");
	const dbg = argv.includes("--once"); // one snapshot + exit (for tests / health probes)

	const wss = new Set();
	const mqttClients = new Set();
	const server = http.createServer((req, res) => {
		const url = (req.url || "/").split("?")[0];
		if (url === "/" || url === "/index.html") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(PAGE); return; }
		if (url === "/data") { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(buildSnapshot(useCwd))); return; }
		if (url === "/healthz") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, project })); return; }
		res.writeHead(404); res.end("not found");
	});
	server.on("upgrade", (req, socket, head) => handleUpgrade(req, socket, head, wss));
	// Cleanup stray sockets on close
	server.on("close", () => { for (const s of wss) { try { s.destroy(); } catch {} } });

	// Subscribe to MQTT run-events for this project and broadcast snapshots on any.
	const broker = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";
	const client = mqtt.connect(broker, { clean: true, reconnectPeriod: 3000 });
	mqttClients.add(client);
	client.on("connect", () => { try { client.subscribe(`pi/${project}/runs/+/events`, { qos: 0 }); } catch {} });
	client.on("message", () => { wsBroadcast(wss, buildSnapshot(useCwd)); });
	client.on("error", () => { /* broker optional; HTTP still serves /data */ });

	const host = "127.0.0.1";
	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(portArg, host, () => {
			const base = `http://${host}:${portArg}`;
			console.log(`po gantt — orchestrator view: ${base}/   (project: ${project})`);
			if (open) {
				try {
					const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
					const { execFile } = moaRequire("node:child_process");
					execFile(cmd, [base], () => {});
				} catch { /* best-effort */ }
			}
			// Resolve immediately with handles; the listening server keeps the
			// process alive for a CLI invocation (po gantt), and an embedded
			// caller (test / probe) can close when it's done. --once makes the
			// CLI variant exit right after one health probe instead of staying up.
			if (dbg) {
				http.get(`${base}/healthz`, () => { server.close(); try { client.end(true); } catch {} });
			}
			resolve({ server, client, base, project });
		});
	});
}

// Direct invocation
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	runGantt({ cwd: process.cwd(), argv: process.argv.slice(2) }).catch((e) => { console.error(e); process.exit(1); });
}
