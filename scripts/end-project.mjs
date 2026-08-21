#!/usr/bin/env node
// `po end` — chiude i run del layer ticket/DAG persistente (Revisione 26,
// `run_create`/`ticket_create`/... in extensions/orchestrator.ts) ancora
// segnati "active" per il progetto nella directory CORRENTE.
//
// PERCHÉ QUESTO SCRIPT ESISTE (Revisione 38, richiesto esplicitamente
// dall'operatore): un run normalmente si chiude DA SOLO — quando l'ultimo
// ticket viene marcato "done" via `ticket_complete`, il codice segna il run
// "completed" in automatico (vedi extensions/orchestrator.ts, il tool
// `ticket_complete`). Ma questo presuppone che ogni ticket arrivi fino in
// fondo attraverso quel percorso — una sessione planner chiusa a metà, un
// task abbandonato perché l'obiettivo è cambiato, o semplicemente l'utente
// che decide "va bene così, chiudiamo qui" senza completare formalmente
// ogni ticket, lasciano il run "active" per sempre, senza che l'utente
// abbia un modo per dirlo se non riaprendo una sessione `pi` e chiamando i
// tool a mano. `po end` è il bookend di `po init`/`po start`: un comando di
// shell puro, senza bisogno di una sessione `pi` aperta, per dichiarare
// esplicitamente concluso il lavoro di questo progetto.
//
// Cosa fa: apre orchestrator.db (node:sqlite, stesso schema di
// extensions/orchestrator.ts — vedi il commento lì sul perché è
// un'esperimentale nativa di Node, non una dipendenza npm), elenca i run
// "active", e — dopo conferma esplicita, salvo --yes — li segna nello
// status scelto (default "completed"), registrando anche un evento
// "run_closed_by_operator" nello storico (stesso posto in cui
// `ticket_complete` registra i suoi eventi — visibile dopo in
// `run_status`/`recent_events`, per chi riapre una sessione planner su
// questo progetto in futuro).
//
// Cosa NON tocca (dichiarato esplicitamente): i ticket del run restano
// esattamente come sono (pending/running/blocked/done/failed) — nessuno
// viene cancellato, forzato "done", o perso; nessun worktree git viene
// toccato/rimosso (resta compito di `worktree_finalize`/`worktree_abandon`,
// dentro una sessione planner); nessun file fuori da orchestrator.db viene
// modificato.
//
// Uso:
//   po end                       elenca i run "active" di questo progetto e chiede conferma prima di segnarli "completed"
//   po end --run <run_id>        chiude SOLO quel run (deve essere "active")
//   po end --status cancelled    segna come "cancelled" invece di "completed" (anche --status failed)
//   po end --list                elenca i run "active" e il loro stato ticket, senza modificare nulla
//   po end --yes | -y            salta la conferma (utile per script/CI)
//
//   (in locale, senza npm install -g: node scripts/end-project.mjs [stesse opzioni])

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const moaRequire = createRequire(import.meta.url);
const VALID_STATUSES = new Set(["completed", "cancelled", "failed"]);

function printHelp() {
	console.log(
		[
			"Uso: po end [opzioni]",
			"",
			'Chiude i run del layer ticket/DAG (Revisione 26) ancora "active" per il progetto nella directory corrente.',
			"Un run normalmente si chiude da solo quando l'ultimo ticket viene completato — questo comando è per i casi in",
			'cui non succede (sessione interrotta, obiettivo cambiato, o semplicemente "va bene così").',
			"",
			"Opzioni:",
			"  --run <run_id>        Chiude solo quel run (deve essere \"active\")",
			'  --status <valore>     "completed" (default), "cancelled", o "failed"',
			"  --list                Elenca i run \"active\" e i loro ticket, senza modificare nulla",
			"  --yes, -y             Salta la conferma",
			"  --help, -h            Mostra questo messaggio",
			"",
			"Non tocca ticket, worktree, o file fuori dal database ticket/DAG di questo progetto.",
		].join("\n"),
	);
}

function parseArgs(argv) {
	let runId;
	let status = "completed";
	let list = false;
	let yes = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--run") {
			runId = argv[++i];
		} else if (a === "--status") {
			status = argv[++i];
		} else if (a === "--list") {
			list = true;
		} else if (a === "--yes" || a === "-y") {
			yes = true;
		} else if (a === "--help" || a === "-h") {
			printHelp();
			process.exit(0);
		} else {
			console.error(`po end: opzione non riconosciuta "${a}" (vedi --help).`);
			process.exit(1);
		}
	}
	if (!VALID_STATUSES.has(status)) {
		console.error(`po end: --status deve essere uno tra ${[...VALID_STATUSES].join(", ")} (ricevuto "${status}").`);
		process.exit(1);
	}
	return { runId, status, list, yes };
}

async function confirm(promptText) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question(`${promptText} [y/N] `);
		return /^y(es)?$/i.test(answer.trim());
	} finally {
		rl.close();
	}
}

function nowIso() {
	return new Date().toISOString();
}

// runEndProject({ cwd, argv }) — cwd è la directory del progetto
// dell'operatore (stessa convenzione di runLaunchPlanner in
// scripts/launch-planner.mjs).
export async function runEndProject({ cwd, argv }) {
	const { runId, status, list, yes } = parseArgs(argv);

	// Stessi marker di "progetto inizializzato" usati da
	// scripts/launch-planner.mjs (Revisione 33) — niente più dipendenza da
	// extensions/orchestrator.ts locale, vedi quel file per il perché.
	const projectMarkers = [
		path.join(cwd, ".pi", "extensions", "multiAgentOrchestrator", "config", "project.json"),
		path.join(cwd, "agents", "roles.yaml"),
	];
	if (!projectMarkers.some((p) => existsSync(p))) {
		console.error(
			`po end: questa directory non sembra un progetto pi-mqtt-orchestrator inizializzato ` +
				`(nessun agents/roles.yaml, nessun .pi/extensions/multiAgentOrchestrator/config/project.json).\n` +
				`Esegui prima \`po init --name "<nome progetto>"\` da questa cartella.`,
		);
		process.exit(1);
	}

	const dbPath = path.join(cwd, ".pi", "extensions", "multiAgentOrchestrator", "orchestratorStorage", "orchestrator.db");
	if (!existsSync(dbPath)) {
		console.log("po end: nessun database ticket/DAG trovato per questo progetto (mai eseguito un task di sviluppo) — niente da chiudere.");
		return;
	}

	let DatabaseSync;
	try {
		({ DatabaseSync } = moaRequire("node:sqlite"));
	} catch (err) {
		console.error(
			`po end: node:sqlite non disponibile su questa versione di Node (${err instanceof Error ? err.message : String(err)}) — ` +
				"stesso limite dichiarato in extensions/orchestrator.ts: serve una build di Node con node:sqlite abilitato.",
		);
		process.exit(1);
	}

	const db = new DatabaseSync(dbPath);
	try {
		let runs;
		if (runId) {
			const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
			if (!row) {
				console.error(`po end: nessun run "${runId}" in questo progetto.`);
				process.exit(1);
			}
			if (row.status !== "active") {
				console.log(`po end: il run "${runId}" non è "active" (stato attuale: "${row.status}") — niente da fare, già concluso.`);
				return;
			}
			runs = [row];
		} else {
			runs = db.prepare("SELECT * FROM runs WHERE status = 'active' ORDER BY created_at ASC").all();
		}

		if (runs.length === 0) {
			console.log('po end: nessun run "active" per questo progetto — niente da chiudere.');
			return;
		}

		console.log(`Trovat${runs.length === 1 ? "o" : "i"} ${runs.length} run "active" in questo progetto:\n`);
		for (const run of runs) {
			const counts = db.prepare("SELECT status, COUNT(*) AS n FROM tickets WHERE run_id = ? GROUP BY status").all(run.id);
			const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
			const total = counts.reduce((sum, c) => sum + c.n, 0);
			const openWork = (byStatus.pending || 0) + (byStatus.running || 0) + (byStatus.blocked || 0);
			console.log(`- ${run.id}  "${run.objective.slice(0, 80)}"  (dominio: ${run.domain}, creato ${run.created_at})`);
			if (total === 0) {
				console.log("    nessun ticket creato in questo run.");
			} else {
				console.log(
					`    ticket: ${byStatus.done || 0} done, ${byStatus.failed || 0} failed, ${byStatus.running || 0} running, ` +
						`${byStatus.pending || 0} pending, ${byStatus.blocked || 0} blocked (${total} totali)`,
				);
				if (openWork > 0) {
					console.log(`    ATTENZIONE: ${openWork} ticket non ancora conclusi — chiudere il run NON li tocca, restano così nel database.`);
				}
			}
		}

		if (list) {
			return;
		}

		console.log(`\nQuesto NON modifica ticket/worktree/file — segna solo lo status del run "${status}" e registra l'evento nello storico.`);
		const proceed = yes || (await confirm(`Segnare ${runs.length === 1 ? "questo run" : "questi run"} come "${status}"?`));
		if (!proceed) {
			console.log("po end: annullato, nessuna modifica effettuata.");
			return;
		}

		const now = nowIso();
		const updateStmt = db.prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?");
		const eventStmt = db.prepare("INSERT INTO events (run_id, ticket_id, type, payload, created_at) VALUES (?, NULL, ?, ?, ?)");
		for (const run of runs) {
			updateStmt.run(status, now, run.id);
			eventStmt.run(run.id, "run_closed_by_operator", JSON.stringify({ previous_status: run.status, new_status: status, via: "po end" }), now);
			console.log(`po end: run "${run.id}" segnato "${status}".`);
		}
	} finally {
		db.close();
	}
}

// Uso diretto: `node scripts/end-project.mjs ...` (dev, o senza npm install -g).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	runEndProject({ cwd: process.cwd(), argv: process.argv.slice(2) }).catch((err) => {
		console.error(`po end: errore inatteso — ${err instanceof Error ? err.stack || err.message : String(err)}`);
		process.exit(1);
	});
}
