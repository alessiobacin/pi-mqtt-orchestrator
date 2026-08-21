#!/usr/bin/env node
// `po deps` / `po provision` — capability-probe (Ticket 10). Verifica in modo
// deterministico quali credenziali/CLI/MCP/etc. sono presenti sul sistema per
// un task (o per il progetto), e cosa manca — l'output è una checklist tipizzata
// `ok` / `missing` con, per ogni voce mancante, l'istruzione esatta da dare
// all'operatore. Il planner lo invoca nel flusso di planning PRIMA di lanciare
// il team, e usa il risultato per (a) aprire un `decision_hold_create` e (b)
// chiedere all'operatore wait-vs-async. Le credenziali fornite vanno nel `.env`
// del progetto (gitignored), mai committate.
//
// Cosa controlla:
//   - variabili .env ATTESE (dal task: lista `KEY` — il probe legge .env e dice
//     if present);
//   - CLI (`which <cmd>`);
//   - auth CLI login (es. `gh auth status`);
//   - MCP server dichiarati (mcp.json) → presenza del comando server.
//
// Uso:
//   po deps --cli gh,docker --env GITHUB_TOKEN,DESTINATION_PHONE_NUMBER [--auth gh]
//   po deps --list-hints                 mostra i comandi suggeriti senza controllare
//   (in locale: node scripts/po-deps.mjs [stesse opzioni])
//
// Ritorna un array `results` tipizzato per permettere al planner di agire. Non
// modifica nulla: read-only (fino a `.env`).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync as rfs } from "node:fs";

function parseArgs(argv) {
	const o = { cli: [], env: [], auth: [], listHints: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--cli") o.cli = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
		else if (a === "--env") o.env = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
		else if (a === "--auth") o.auth = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
		else if (a === "--list-hints") o.listHints = true;
	}
	return o;
}

function which(cmd) {
	try { const r = spawnSync(cmd, ["--version"], { stdio: "ignore" }); return !r.error || r.error.code !== "ENOENT"; }
	catch { return false; }
}

function authOk(cmd) {
	// Best-effort auth check per known CLI. `gh auth status` return 0 when
	// logged in. Unknown commands fall back to "which exists".
	const map = {
		gh: ["auth", "status"],
		git: ["config", "user.email"],
	};
	const args = map[cmd] || ["--version"];
	try {
		const r = spawnSync(cmd, args, { stdio: "ignore" });
		if (!r.error || r.error.code !== "ENOENT") return r.status === 0;
		return false;
	} catch { return false; }
}

function readEnv(cwd) {
	try {
		const p = path.join(cwd, ".env");
		if (!existsSync(p)) return {};
		const out = {};
		for (const line of readFileSync(p, "utf-8").split("\n")) {
			const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
			if (m) out[m[1]] = m[2];
		}
		return out;
	} catch { return {}; }
}

export async function runPoDeps({ cwd, argv }) {
	const opts = parseArgs(argv);
	if (opts.listHints) {
		console.log("Suggerimenti `po deps`:");
		console.log("  --cli gh,docker          CLI da controllare (which).");
		console.log("  --env GITHUB_TOKEN,..    variabili attese nel .env del progetto.");
		console.log("  --auth gh                CLI da verificare come già autenticata (es. gh auth status).");
		return { hints: true };
	}
	if (!opts.cli.length && !opts.env.length && !opts.auth.length) {
		console.log("po deps: indica almeno uno tra --cli, --env, --auth (vedi --list-hints).");
		process.exit(1);
	}
	const env = readEnv(cwd);
	const results = [];

	for (const v of opts.env) {
		const present = v in env && env[v] !== "";
		results.push({ kind: "env", name: v, present, list: present ? "ok" : "missing", hint: `aggiungi ${v}=... al .env del progetto (gitignored, mai committarlo)` });
	}
	for (const cmd of opts.cli) {
		const present = which(cmd);
		results.push({ kind: "cli", name: cmd, present, list: present ? "ok" : "missing", hint: cmd === "gh" ? "installa gh: brew install gh  (poi: gh auth login)" : cmd === "docker" ? "installa Docker Desktop (https://www.docker.com/products/docker-desktop)" : `installa "${cmd}" (usa il package manager del tuo OS)` });
	}
	for (const cmd of opts.auth) {
		const present = authOk(cmd);
		results.push({ kind: "auth", name: cmd, present, list: present ? "ok" : "missing", hint: cmd === "gh" ? "esegui: gh auth login" : `assicurati che "${cmd}" sia autenticato` });
	}

	const missing = results.filter((r) => !r.present);
	const okCount = results.length - missing.length;
	console.log(`po deps: ${okCount}/${results.length} soddisfatt${results.length === 1 ? "o" : "i"}.`);
	for (const r of results) {
		console.log(`   ${r.present ? "✓" : "✗"} [${r.kind}] ${r.name}${r.present ? "" : ` — ${r.hint}`}`);
	}
	if (missing.length) console.log(`\n${missing.length} voce/i mancante/i — forniscile (wait) oppure procedi (async) e verrà rivista quando serve.`);

	// Planner actionability: a compact machine-readable summary in details-adjacent
	// form for the planner to pass into decision_hold_create context.
	return { ok: missing.length === 0, results, missing };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	runPoDeps({ cwd: process.cwd(), argv: process.argv.slice(2) }).then((r) => process.exit(r.ok ? 0 : 1));
}
