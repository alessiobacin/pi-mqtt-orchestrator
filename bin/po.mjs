#!/usr/bin/env node
// `po` — CLI unificata di pi-mqtt-orchestrator (Revisione 31, vedi
// docs/development-notes.md). Sostituisce il vecchio binario a sé
// `pi-orchestrator-init` con questi sottocomandi:
//
//   po init [opzioni]    scaffolda l'estensione nella directory CORRENTE
//                        (default — vedi `po init --help`), delega a
//                        scripts/create-project.mjs (runCreateProject()).
//   po start [opzioni]   lancia planner-01 componendo i flag --skill per le
//                        skill vendorizzate mattpocock, delega a
//                        scripts/launch-planner.mjs (runLaunchPlanner()).
//   po doctor            verifica che l'ambiente abbia tutto il necessario
//                        (git, `pi`, un broker MQTT disponibile) e stampa
//                        istruzioni di installazione per il tuo sistema
//                        operativo per ciò che manca (Revisione 33) — delega
//                        a scripts/doctor.mjs (runDoctor()). Girato anche in
//                        automatico in coda a `po init`.
//   po update [--check]  aggiorna l'installazione globale all'ultima
//                        versione del repo GitHub (Revisione 34) — delega a
//                        scripts/update.mjs (runUpdate()).
//   po uninstall [--yes] rimuove l'installazione globale (Revisione 34) —
//                        delega a scripts/uninstall.mjs (runUninstall()).
//   po end [opzioni]     chiude i run "active" del layer ticket/DAG per il
//                        progetto nella directory corrente (Revisione 38) —
//                        delega a scripts/end-project.mjs (runEndProject()).
//   po copy-prompts      copia prompts/ dal pacchetto installato dentro
//                        <progetto>/.pi/extensions/multiAgentOrchestrator/prompts/,
//                        per chi vuole personalizzarli per QUESTO progetto
//                        (Revisione 47) — delega a scripts/copy-prompts.mjs
//                        (runCopyPrompts()). Da solo non cambia nulla: serve
//                        anche `po start ... --custom-prompts` per farli
//                        usare davvero (default: i prompt si leggono sempre
//                        dal pacchetto installato, mai da una copia locale
//                        — vedi extensions/orchestrator.ts).
//
// Installazione: `npm install -g <repo>` (o `npm link` in locale, per lo
// sviluppo di questo pacchetto stesso) espone `po` sul PATH — campo "bin" di
// package.json.
//
// Perché un binario dedicato invece di un vero sottocomando `pi po` o `pi
// orchestrator`: come già documentato in scripts/create-project.mjs, non
// esiste in questo codebase nessuna evidenza che la CLI `pi` supporti
// sottocomandi shell registrati da un'estensione — solo slash-command
// dentro una sessione già avviata. `po` è quindi un binario NPM separato,
// non un plugin di `pi`.

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCreateProject } from "../scripts/create-project.mjs";
import { runLaunchPlanner } from "../scripts/launch-planner.mjs";
import { runDoctor } from "../scripts/doctor.mjs";
import { runUpdate } from "../scripts/update.mjs";
import { runUninstall } from "../scripts/uninstall.mjs";
import { runEndProject } from "../scripts/end-project.mjs";
import { runCopyPrompts } from "../scripts/copy-prompts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const cwd = process.cwd();

function printTopUsage() {
	console.log(
		[
			"Uso: po <comando> [opzioni]",
			"",
			"Comandi:",
			'  init [opzioni]   Scaffolda pi-mqtt-orchestrator nella directory corrente (default) — `po init --help`',
			"  start [opzioni]  Lancia planner-01 con le skill vendorizzate mattpocock — `po start --help`",
			"  doctor           Verifica che l'ambiente abbia git/pi/un broker MQTT disponibili",
			"  update [--check] Aggiorna l'installazione globale all'ultima versione della repo GitHub",
			"  uninstall [--yes] Rimuove l'installazione globale",
			'  end [opzioni]    Chiude i run "active" del progetto nella directory corrente — `po end --help`',
			"  copy-prompts     Copia prompts/ dal pacchetto installato nel progetto corrente, per personalizzarli",
			"",
			"  --version, -v    Stampa la versione del pacchetto installato",
			"  --help, -h       Mostra questo messaggio",
		].join("\n"),
	);
}

async function main() {
	const [sub, ...rest] = process.argv.slice(2);

	if (!sub) {
		printTopUsage();
		process.exit(1);
	}
	if (sub === "--help" || sub === "-h") {
		printTopUsage();
		process.exit(0);
	}
	if (sub === "--version" || sub === "-v") {
		const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf-8"));
		console.log(pkg.version);
		process.exit(0);
	}
	if (sub === "init") {
		await runCreateProject({ packageRoot, cwd, argv: rest });
		return;
	}
	if (sub === "start") {
		runLaunchPlanner({ packageRoot, cwd, argv: rest });
		return;
	}
	if (sub === "doctor") {
		const { ok } = await runDoctor({ cwd });
		process.exit(ok ? 0 : 1);
	}
	if (sub === "update") {
		await runUpdate({ packageRoot, argv: rest });
		return;
	}
	if (sub === "uninstall") {
		await runUninstall({ packageRoot, argv: rest });
		return;
	}
	if (sub === "end") {
		await runEndProject({ cwd, argv: rest });
		return;
	}
	if (sub === "copy-prompts") {
		runCopyPrompts({ packageRoot, cwd });
		return;
	}

	console.error(`po: comando sconosciuto "${sub}" (vedi \`po --help\`).`);
	process.exit(1);
}

main().catch((err) => {
	console.error(`po: errore inatteso — ${err instanceof Error ? err.stack || err.message : String(err)}`);
	process.exit(1);
});
