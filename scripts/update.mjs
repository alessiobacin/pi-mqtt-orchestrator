#!/usr/bin/env node
// `po update` — aggiorna l'installazione GLOBALE del pacchetto all'ultima
// versione pubblicata sul repo GitHub (branch di default), senza dover
// ricordare a mano la sintassi `npm install -g github:...`.
//
// PERCHÉ QUESTO SCRIPT ESISTE (Revisione 34): richiesto esplicitamente
// dall'operatore — un comando per aggiornare l'estensione già installata
// nel folder globale all'ultima versione della repo, invece di reinstallare
// a mano.
//
// Come funziona: `po` stesso esiste SOLO come pacchetto installato
// GLOBALMENTE via npm (`npm install -g <percorso o URL>`, oppure `npm link`
// in sviluppo — vedi bin/po.mjs, campo "bin" di package.json — nessun altro
// meccanismo di installazione di `po` è mai stato implementato in questo
// codebase). Aggiornare significa quindi reinstallare lo stesso pacchetto
// globale dalla stessa fonte, leggendo l'URL del repo direttamente dal
// campo "repository.url" del proprio package.json (mai un URL hardcoded,
// così un fork/mirror dell'operatore continua a funzionare senza modifiche
// a questo script).
//
// Uso:
//   po update            aggiorna alla versione più recente su GitHub
//   po update --check    controlla solo se è disponibile un aggiornamento, non installa
//
// Limite onesto, dichiarato esplicitamente (stessa disciplina della nota su
// `pi extension install` in docs/mvp-notes.md): non esiste in questo
// codebase alcuna evidenza che `pi extension install <url>` deleghi a un
// `npm install -g` dietro le quinte, né la controprova che non lo faccia —
// `pi` è tooling esterno, la sua implementazione interna non è ispezionabile
// da qui. Se l'installazione originale è stata fatta con `pi extension
// install` e quel comando gestisce un meccanismo indipendente da npm,
// questo comando aggiorna comunque VERAMENTE il pacchetto npm globale (da
// cui l'estensione auto-caricata da `pi` proviene in ogni caso verificato
// finora in questo progetto), ma non può garantire che sia la stessa identica
// copia che `pi` userà alla prossima sessione — verificalo con `po --version`
// dopo l'update, e se il numero non cambia, reinstalla con `pi extension
// install <url>`.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function commandExists(cmd) {
	const result = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
	return !result.error || result.error.code !== "ENOENT";
}

function readVersion(pkgJsonPath) {
	try {
		return JSON.parse(readFileSync(pkgJsonPath, "utf-8")).version;
	} catch {
		return null;
	}
}

// runUpdate({ packageRoot, argv }) — packageRoot è la directory del
// pacchetto installato globalmente da cui `po` sta girando in questo
// momento (usata sia per leggere la versione corrente sia per il campo
// "repository.url" da cui reinstallare).
export function runUpdate({ packageRoot, argv }) {
	const checkOnly = argv.includes("--check");

	const pkgJsonPath = path.join(packageRoot, "package.json");
	const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
	const currentVersion = pkg.version;

	const repoUrl = pkg.repository?.url;
	if (!repoUrl) {
		console.error(`po update: "${pkgJsonPath}" non ha un campo repository.url — non so da dove reinstallare.`);
		process.exit(1);
	}
	// npm accetta direttamente un URL HTTPS di GitHub che termina in ".git".
	const installSpec = repoUrl;

	if (!commandExists("npm")) {
		console.error("po update: npm non trovato sul PATH — necessario per reinstallare il pacchetto globale.");
		process.exit(1);
	}
	if (!commandExists("git")) {
		console.error("po update: git non trovato sul PATH — necessario a npm per scaricare il repo da GitHub.");
		process.exit(1);
	}

	console.log(`po update: versione installata attualmente: ${currentVersion}`);
	console.log(`po update: repo sorgente: ${installSpec}`);

	if (checkOnly) {
		// Confronto best-effort via `npm view` (legge il package.json remoto
		// senza reinstallare nulla) invece di clonare tutto solo per sapere
		// se serve un aggiornamento.
		const result = spawnSync("npm", ["view", installSpec, "version"], {
			encoding: "utf-8",
			shell: process.platform === "win32",
		});
		if (result.status !== 0 || !result.stdout) {
			console.error(`po update: impossibile controllare la versione remota (${result.stderr?.trim() || "errore sconosciuto"}).`);
			process.exit(1);
		}
		const remoteVersion = result.stdout.trim();
		console.log(`po update: ultima versione su GitHub: ${remoteVersion}`);
		if (remoteVersion === currentVersion) {
			console.log("po update: sei già aggiornato.");
		} else {
			console.log(`po update: disponibile un aggiornamento (${currentVersion} → ${remoteVersion}). Esegui \`po update\` (senza --check) per installarlo.`);
		}
		return;
	}

	console.log("po update: reinstallo il pacchetto globale da GitHub (npm install -g ...) — potrebbe richiedere qualche secondo...\n");
	try {
		execFileSync("npm", ["install", "-g", installSpec], { stdio: "inherit", shell: process.platform === "win32" });
	} catch (err) {
		console.error(`\npo update: "npm install -g ${installSpec}" fallito (${err instanceof Error ? err.message : String(err)}).`);
		console.error(
			"Su alcuni sistemi npm install -g richiede permessi elevati (sudo su macOS/Linux, un terminale da Amministratore su Windows) — riprova con quelli se l'errore riguarda i permessi.",
		);
		process.exit(1);
	}

	// Rilegge la versione dal pacchetto appena reinstallato per confermare
	// l'esito (npm non fallisce sempre in modo rumoroso su ogni ambiente).
	const newVersion = readVersion(pkgJsonPath);
	console.log("");
	if (newVersion && newVersion !== currentVersion) {
		console.log(`po update: aggiornato ${currentVersion} → ${newVersion}.`);
	} else if (newVersion === currentVersion) {
		console.log(`po update: reinstallato (versione invariata: ${currentVersion} — probabilmente eri già aggiornato, oppure la repo non ha ancora incrementato "version" in package.json).`);
	} else {
		console.log("po update: reinstallazione completata, ma non sono riuscito a rileggere la nuova versione — verifica con `po --version`.");
	}
	console.log("");
	console.log("Nota: se avevi installato originariamente con `pi extension install <url>` (non `npm install -g`), verifica con `po --version` che il numero sia davvero cambiato.");
	console.log("Se non è cambiato, questo comando potrebbe non aver toccato la copia che `pi` carica — reinstalla con `pi extension install <url>` (o l'equivalente comando di update della tua versione di `pi`).");
}

// Uso diretto: `node scripts/update.mjs ...` (dev, dal repo del pacchetto).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	runUpdate({ packageRoot: path.resolve(__dirname, ".."), argv: process.argv.slice(2) });
}
