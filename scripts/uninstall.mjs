#!/usr/bin/env node
// `po uninstall` — rimuove il pacchetto pi-mqtt-orchestrator dall'installazione
// GLOBALE npm (quella da cui `po` stesso e l'estensione auto-caricata da `pi`
// provengono — vedi la stessa nota in scripts/update.mjs).
//
// PERCHÉ QUESTO SCRIPT ESISTE (Revisione 34): richiesto esplicitamente
// dall'operatore, insieme a `po update` — un modo pulito di rimuovere
// l'installazione globale senza dover ricordare a mano il nome esatto del
// pacchetto npm.
//
// Uso:
//   po uninstall            chiede conferma, poi esegue `npm uninstall -g <nome pacchetto>`
//   po uninstall --yes|-y   salta la conferma (utile per script/CI)
//
// Cosa NON tocca (dichiarato esplicitamente, per evitare sorprese):
// - i progetti già scaffoldati con `po init` (agents/, prompts/, mqtt/,
//   .env, .pi/) — restano sul disco intatti, non sono di proprietà di
//   questa installazione globale, quindi non vengono rimossi;
// - qualunque broker MQTT/container Docker lasciato in esecuzione;
// - la registrazione interna di `pi`, se l'estensione era stata installata
//   con `pi extension install <url>` invece che con `npm install -g` —
//   stessa incertezza dichiarata in scripts/update.mjs: non c'è visibilità
//   da questo codebase sul meccanismo interno di `pi`. Se `pi` continua a
//   caricare l'estensione dopo questo comando, va rimossa anche da lì (il
//   comando di disinstallazione equivalente della tua versione di `pi`, se
//   esiste — non verificato in questa sessione).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

function commandExists(cmd) {
	const result = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
	return !result.error || result.error.code !== "ENOENT";
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

// runUninstall({ packageRoot, argv }) — packageRoot è la directory del
// pacchetto installato globalmente da cui `po` sta girando in questo
// momento, usata solo per leggere il campo "name" da package.json (mai un
// nome hardcoded, così un fork/rename dell'operatore continua a funzionare
// senza modifiche a questo script).
export async function runUninstall({ packageRoot, argv }) {
	const skipConfirm = argv.includes("--yes") || argv.includes("-y");

	const pkgJsonPath = path.join(packageRoot, "package.json");
	const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
	const packageName = pkg.name;
	if (!packageName) {
		console.error(`po uninstall: "${pkgJsonPath}" non ha un campo "name" — non so quale pacchetto disinstallare.`);
		process.exit(1);
	}

	if (!commandExists("npm")) {
		console.error("po uninstall: npm non trovato sul PATH — necessario per rimuovere il pacchetto globale.");
		process.exit(1);
	}

	console.log(`po uninstall: rimuoverà "${packageName}" dall'installazione globale npm (npm uninstall -g ${packageName}).`);
	console.log("Non tocca i progetti già scaffoldati con `po init` (restano intatti sul disco) né eventuali broker MQTT/container Docker in esecuzione.");
	console.log("Se l'avevi installato con `pi extension install <url>`, verifica dopo se `pi` la carica ancora — vedi la nota in testa a questo script.");

	if (!skipConfirm) {
		const proceed = await confirm("\nProcedere con la disinstallazione?");
		if (!proceed) {
			console.log("po uninstall: annullato, nessuna modifica effettuata.");
			return;
		}
	}

	console.log(`\npo uninstall: eseguo npm uninstall -g ${packageName} ...\n`);
	try {
		execFileSync("npm", ["uninstall", "-g", packageName], { stdio: "inherit", shell: process.platform === "win32" });
	} catch (err) {
		console.error(`\npo uninstall: "npm uninstall -g ${packageName}" fallito (${err instanceof Error ? err.message : String(err)}).`);
		console.error(
			"Su alcuni sistemi npm uninstall -g richiede permessi elevati (sudo su macOS/Linux, un terminale da Amministratore su Windows) — riprova con quelli se l'errore riguarda i permessi.",
		);
		process.exit(1);
	}

	console.log("\npo uninstall: fatto — `po` non sarà più disponibile su questa macchina finché non lo reinstalli.");
}

// Uso diretto: `node scripts/uninstall.mjs ...` (dev, dal repo del pacchetto).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	runUninstall({ packageRoot: path.resolve(__dirname, ".."), argv: process.argv.slice(2) }).catch((err) => {
		console.error(`po uninstall: errore inatteso — ${err instanceof Error ? err.stack || err.message : String(err)}`);
		process.exit(1);
	});
}
