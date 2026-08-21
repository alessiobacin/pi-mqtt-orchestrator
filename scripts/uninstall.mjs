#!/usr/bin/env node
// `po uninstall` — rimuove pi-mqtt-orchestrator dalle copie installate:
// il pacchetto npm GLOBALE, e (se presente) il clone git che `pi extension
// install` mantiene per conto suo — vedi la stessa nota, con il traceback
// reale che ha confermato quel secondo percorso, in scripts/update.mjs.
//
// PERCHÉ QUESTO SCRIPT ESISTE (Revisione 34): richiesto esplicitamente
// dall'operatore, insieme a `po update` — un modo pulito di rimuovere
// l'installazione globale senza dover ricordare a mano il nome del
// pacchetto npm né dove `pi extension install` tiene la sua copia.
//
// Uso:
//   po uninstall            chiede conferma per ciascuna copia trovata, poi la rimuove
//   po uninstall --yes|-y   salta le conferme (utile per script/CI)
//
// Cosa NON tocca (dichiarato esplicitamente, per evitare sorprese):
// - i progetti già scaffoldati con `po init` (agents/, prompts/, mqtt/,
//   .env, .pi/) — restano sul disco intatti, non sono di proprietà di
//   questa installazione, quindi non vengono rimossi;
// - qualunque broker MQTT/container Docker lasciato in esecuzione;
// - un'eventuale registrazione interna che `pi` tiene ALTROVE (un manifest
//   che elenca le estensioni installate, se esiste — non ispezionabile da
//   qui): questo script cancella la cartella del clone git, non un'eventuale
//   voce di registro separata. Se `pi` continua a lamentarsi dell'estensione
//   dopo questa rimozione, il comando di disinstallazione della tua versione
//   di `pi` (se esiste) resta la via più sicura per ripulire anche quello.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
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

// Stessa estrazione di scripts/update.mjs — duplicata deliberatamente
// invece di importata: sono due binari indipendenti (`po update`/`po
// uninstall` possono essere invocati anche standalone via `node
// scripts/uninstall.mjs`), non vale la pena di un modulo condiviso per 8
// righe di regex.
function parseGitUrl(url) {
	const https = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
	if (https) return { host: https[1], owner: https[2], repo: https[3] };
	const ssh = url.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
	if (ssh) return { host: ssh[1], owner: ssh[2], repo: ssh[3] };
	return null;
}

function piExtensionGitDir(repoUrl) {
	const parsed = parseGitUrl(repoUrl);
	if (!parsed) return null;
	return path.join(os.homedir(), ".pi", "agent", "git", parsed.host, parsed.owner, parsed.repo);
}

// runUninstall({ packageRoot, argv }) — packageRoot è la directory del
// pacchetto npm installato globalmente da cui `po` sta girando in questo
// momento, usata per leggere "name" (pacchetto da disinstallare via npm) e
// "repository.url" (per dedurre l'eventuale cartella di `pi extension
// install` — mai un percorso/nome hardcoded).
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

	const repoUrl = pkg.repository?.url;
	const gitDir = repoUrl ? piExtensionGitDir(repoUrl) : null;
	const hasGitClone = gitDir ? existsSync(gitDir) : false;

	console.log(`po uninstall: rimuoverà "${packageName}" dall'installazione globale npm (npm uninstall -g ${packageName}).`);
	if (hasGitClone) console.log(`po uninstall: trovata anche la copia di \`pi extension install\` in ${gitDir} — verrà chiesta una conferma separata per quella.`);
	console.log("Non tocca i progetti già scaffoldati con `po init` (restano intatti sul disco) né eventuali broker MQTT/container Docker in esecuzione.");

	if (!skipConfirm) {
		const proceed = await confirm("\nProcedere con la disinstallazione del pacchetto npm?");
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
	console.log("\npo uninstall: pacchetto npm rimosso — `po` non sarà più disponibile su questa macchina finché non lo reinstalli.");

	if (hasGitClone) {
		console.log(`\npo uninstall: trovata anche la copia che \`pi\` carica automaticamente in ${gitDir}.`);
		console.log("Rimuoverla impedisce a `pi` di caricare l'estensione nelle prossime sessioni, ma questo script non ha visibilità su un eventuale");
		console.log("registro/manifest separato che `pi` potrebbe tenere altrove — se `pi` si lamenta di un'estensione mancante dopo, il comando di");
		console.log("disinstallazione della tua versione di `pi` (se esiste) resta la via più sicura per ripulire anche quello.");
		let proceedGit = skipConfirm;
		if (!skipConfirm) {
			proceedGit = await confirm(`\nRimuovere anche "${gitDir}"?`);
		}
		if (proceedGit) {
			try {
				rmSync(gitDir, { recursive: true, force: true });
				console.log(`po uninstall: rimossa ${gitDir}.`);
			} catch (err) {
				console.error(`po uninstall: impossibile rimuovere ${gitDir} (${err instanceof Error ? err.message : String(err)}) — rimuovila a mano.`);
			}
		} else {
			console.log(`po uninstall: lasciata intatta ${gitDir}.`);
		}
	}
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
