#!/usr/bin/env node
// `po` — CLI unificata di pi-mqtt-orchestrator (Revisione 31, vedi
// docs/mvp-notes.md). Sostituisce il vecchio binario a sé
// `pi-orchestrator-init` con due sottocomandi:
//
//   po init [opzioni]    scaffolda l'estensione nella directory CORRENTE
//                        (default — vedi `po init --help`), delega a
//                        scripts/create-project.mjs (runCreateProject()).
//   po start [opzioni]   lancia planner-01 componendo i flag --skill per le
//                        skill vendorizzate mattpocock, delega a
//                        scripts/launch-planner.mjs (runLaunchPlanner()).
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
			"",
			"  --version, -v    Stampa la versione del pacchetto installato",
			"  --help, -h       Mostra questo messaggio",
		].join("\n"),
	);
}

function main() {
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
		runCreateProject({ packageRoot, cwd, argv: rest });
		return;
	}
	if (sub === "start") {
		runLaunchPlanner({ packageRoot, cwd, argv: rest });
		return;
	}

	console.error(`po: comando sconosciuto "${sub}" (vedi \`po --help\`).`);
	process.exit(1);
}

main();
