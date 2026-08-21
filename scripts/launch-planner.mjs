#!/usr/bin/env node
// Lancia una istanza `pi` con --role planner, includendo automaticamente i
// flag --skill per le skill vendorizzate di mattpocock/skills
// (skills-vendor/mattpocock/, vedi VERSION.md lì dentro) — wayfinder,
// to-spec, grilling, domain-modeling, setup-matt-pocock-skills.
//
// PERCHÉ QUESTO SCRIPT ESISTE (Revisione 22, vedi docs/development-notes.md):
// extensions/orchestrator.ts non compone MAI il comando che lancia un nuovo
// processo `pi` — l'unico uso di execFile() nell'estensione è per le
// chiamate di self-report/rename verso herdr e per `git` (vedi
// herdrReportAgent()/herdrRenamePane()/gitExec... più sotto nel file). Le
// istanze del team vengono lanciate dal planner stesso via shell, seguendo
// il testo di prompts/planner.md (herdr o paseo) — mai per un altro
// planner, visto che l'architettura attuale non ne spawna mai un secondo.
// planner-01 stesso viene avviato a mano dall'utente (vedi README
// Quickstart). Questo script è quindi il vero "punto" in cui gli argomenti
// del processo pi per il ruolo planner vengono composti — non un ramo
// dentro orchestrator.ts, che non esiste.
//
// Uso:
//   node scripts/launch-planner.mjs --instance planner-01 [--name "Planner"] [altri flag pi...]
//   node scripts/launch-planner.mjs --instance planner-01 --print-only   # stampa il comando composto, non lo esegue (verifica manuale)
//   po start --instance planner-01   # dopo `npm install -g`/`npm link` (Revisione 31, vedi bin/po.mjs)
//
// Forza sempre --role planner: se l'utente passa esplicitamente un --role
// diverso, lo script si rifiuta (questo script è SOLO per planner — per
// altri ruoli va usato `pi -e extensions/orchestrator.ts` direttamente,
// senza i flag --skill di mattpocock, che non devono raggiungere altri
// ruoli).
//
// Revisione 31 — packageRoot vs cwd (importante per l'installazione globale):
// prima di questa revisione lo script usava SEMPRE la propria directory
// (repoRoot, cioè la cartella del pacchetto) sia per risolvere le skill
// vendorizzate sia come cwd del processo `pi` che spawna — corretto solo
// quando lo script viene eseguito dalla root del pacchetto stesso (l'unico
// caso d'uso, prima d'ora). Con `po start` installato globalmente, invece,
// il pacchetto vive in tutt'altra directory rispetto al PROGETTO
// dell'operatore (dove sta extensions/orchestrator.ts scaffoldato da `po
// init`): le skill vendorizzate vanno ancora cercate nel pacchetto
// (packageRoot — non vengono copiate nei progetti scaffoldati, vedi
// create-project.mjs), ma `pi` va spawnato con cwd = directory
// dell'operatore (cwd), altrimenti caricherebbe l'orchestrator.ts sbagliato
// (quello del pacchetto, non quello del progetto).

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Le 5 skill vendorizzate destinate al ruolo planner (Revisione 22) — vedi
// skills-vendor/mattpocock/VERSION.md per la motivazione di ciascuna
// (wayfinder/to-spec richieste dall'utente; grilling/domain-modeling
// dipendenze dirette e incondizionate di wayfinder; setup-matt-pocock-skills
// perché entrambe la richiedono per configurare il tracker del repo).
const MATT_POCOCK_SKILLS = ["wayfinder", "to-spec", "grilling", "domain-modeling", "setup-matt-pocock-skills"];

function resolveSkillPaths(packageRoot) {
	const base = path.join(packageRoot, "skills-vendor", "mattpocock");
	const missing = [];
	const paths = MATT_POCOCK_SKILLS.map((name) => {
		const p = path.join(base, name);
		if (!existsSync(path.join(p, "SKILL.md"))) missing.push(p);
		return p;
	});
	if (missing.length > 0) {
		console.error("launch-planner: skill vendorizzate mancanti o incomplete (manca SKILL.md):");
		for (const m of missing) console.error(`  - ${m}`);
		console.error("Verifica skills-vendor/mattpocock/ (vedi VERSION.md lì dentro).");
		process.exit(1);
	}
	return paths;
}

function parseArgs(argv) {
	const passthrough = [];
	let printOnly = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--print-only") {
			printOnly = true;
			continue;
		}
		if (a === "--role") {
			const value = argv[i + 1];
			if (value !== "planner") {
				console.error(
					`launch-planner: questo script forza sempre --role planner (le skill mattpocock sono solo per planner) — ` +
						`hai passato --role ${value ?? "<mancante>"}. Per altri ruoli usa direttamente ` +
						`"pi -e extensions/orchestrator.ts --role <ruolo>", senza questo script.`,
				);
				process.exit(1);
			}
			i++; // consuma anche il valore, verrà comunque riaggiunto sotto in modo esplicito
			continue;
		}
		passthrough.push(a);
	}
	return { passthrough, printOnly };
}

// runLaunchPlanner({ packageRoot, cwd, argv }) — packageRoot risolve le
// skill vendorizzate (vivono SOLO nel pacchetto, mai copiate in un progetto
// scaffoldato — vedi create-project.mjs); cwd è la directory del progetto
// dell'operatore, usata sia come cwd del processo `pi` spawnato sia per
// verificare che sia davvero un progetto inizializzato.
//
// Revisione 33 — niente più `-e extensions/orchestrator.ts` di default:
// da quando l'estensione si installa globalmente (`pi extension install`),
// `pi` la carica in automatico in OGNI sessione, ovunque (verificato da un
// test reale dell'operatore su Windows: `pi --instance planner-01`, senza
// alcun `-e`, si connette correttamente). Un progetto scaffoldato da `po
// init` non contiene più una copia locale di extensions/orchestrator.ts
// (vedi create-project.mjs) — comporre comunque il comando con
// `-e extensions/orchestrator.ts` in quel caso caricava lo stesso codice
// due volte (quello globale auto-caricato + quello esplicito locale), e
// `pi` rifiutava ogni tool/flag duplicato ("Tool ... conflicts with ...",
// "Flag ... conflicts with ...") — esattamente il traceback riportato
// dall'operatore. Fix: passa `-e extensions/orchestrator.ts` SOLO se quel
// file esiste davvero in cwd (dev mode dentro questo stesso repo, o un
// progetto legacy pre-Revisione-33 con ancora una copia locale); altrimenti
// confida nell'auto-load globale e non passa `-e` affatto. La verifica "è
// un progetto inizializzato" non può quindi più dipendere dall'esistenza di
// extensions/orchestrator.ts (Revisione 31) — usa invece i marker che
// `po init` scrive sempre: agents/roles.yaml oppure
// .pi/extensions/multiAgentOrchestrator/config/project.json.
export function runLaunchPlanner({ packageRoot, cwd, argv }) {
	const { passthrough, printOnly } = parseArgs(argv);

	const orchestratorPath = path.join(cwd, "extensions", "orchestrator.ts");
	const hasLocalExtension = existsSync(orchestratorPath);
	const projectMarkers = [
		path.join(cwd, ".pi", "extensions", "multiAgentOrchestrator", "config", "project.json"),
		path.join(cwd, "agents", "roles.yaml"),
	];
	const looksInitialized = hasLocalExtension || projectMarkers.some((p) => existsSync(p));
	if (!looksInitialized) {
		console.error(
			`launch-planner: questa directory non sembra un progetto pi-mqtt-orchestrator inizializzato ` +
				`(nessun agents/roles.yaml, nessun .pi/extensions/multiAgentOrchestrator/config/project.json, ` +
				`nessun extensions/orchestrator.ts locale).\n` +
				`Esegui prima \`po init --name "<nome progetto>"\` (o \`node scripts/create-project.mjs ...\` in locale), poi rilancia da lì.`,
		);
		process.exit(1);
	}

	// Revisione 34 — caso reale osservato dall'operatore: un progetto
	// scaffoldato da una versione di `po init` PRECEDENTE alla Revisione 33
	// ha ancora una copia locale di extensions/orchestrator.ts sul disco
	// (creata prima che create-project.mjs smettesse di copiarla). Quella
	// copia stale continua a triggerare `hasLocalExtension` qui sopra.
	// Euristica per distinguere questo caso dal legittimo "dentro il repo del
	// pacchetto stesso, in sviluppo": il package.json del pacchetto ha
	// sempre name === "pi-mqtt-orchestrator"; un progetto scaffoldato da `po
	// init` ha sempre uno slug diverso (viene da --name, vedi
	// create-project.mjs).
	let cwdPkgName;
	try {
		cwdPkgName = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf-8")).name;
	} catch {
		cwdPkgName = undefined;
	}
	const looksLikePackageRepo = cwdPkgName === "pi-mqtt-orchestrator";

	// Revisione 38 — bug reale trovato in produzione (docs/development-notes.md,
	// Revisione 38): fino a qui questo script si limitava ad AVVISARE del
	// rischio di conflitto ("Tool ... conflicts with ...") ma continuava
	// comunque a comporre `-e extensions/orchestrator.ts` anche nel caso
	// stale — l'avviso descriveva correttamente il crash imminente invece di
	// evitarlo. Un operatore che ha visto esattamente quell'avviso ha
	// comunque avuto il crash subito dopo, sia con `po start` che con `pi -e
	// extensions/orchestrator.ts --role planner` a mano. Fix: quando la
	// copia locale NON è dentro il repo del pacchetto stesso, ignorala del
	// tutto — non passare mai `-e` per lei, confida SEMPRE sull'auto-load
	// globale in quel caso (esattamente come per un progetto senza copia
	// locale affatto). L'unico caso in cui `-e` viene ancora composto è lo
	// sviluppo del pacchetto stesso (packageRoot === cwd, verificato via
	// package.json name).
	if (hasLocalExtension && !looksLikePackageRepo) {
		console.warn(
			`launch-planner: trovato "${orchestratorPath}" residuo, ma IGNORATO (non aggiunto a -e) — è quasi certamente\n` +
				`un residuo di uno scaffold creato da una versione di \`po init\` precedente alla Revisione 33 (che non copia\n` +
				`più extensions/ — vedi docs/development-notes.md). L'estensione installata globalmente (pi extension install /\n` +
				`npm install -g) viene usata al suo posto, come per qualunque altro progetto scaffoldato di recente — questa\n` +
				`cartella residua è ormai inerte e sicura da cancellare quando vuoi:\n` +
				`  ${process.platform === "win32" ? "Remove-Item -Recurse -Force" : "rm -rf"} "${path.join(cwd, "extensions")}"\n`,
		);
	}

	const skillFlags = resolveSkillPaths(packageRoot).flatMap((p) => ["--skill", p]);
	// -e esplicito SOLO in sviluppo del pacchetto stesso (looksLikePackageRepo)
	// — mai per una copia locale residua in un progetto scaffoldato, anche se
	// esiste sul disco (vedi Revisione 38 sopra): l'estensione installata
	// globalmente basta sempre da sola in quel caso.
	const extensionFlags = hasLocalExtension && looksLikePackageRepo ? ["-e", "extensions/orchestrator.ts"] : [];
	const piArgs = [...extensionFlags, ...passthrough, "--role", "planner", ...skillFlags];

	const printable = ["pi", ...piArgs].map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");
	console.log(`launch-planner: comando composto (cwd ${cwd}):\n  ${printable}\n`);

	if (printOnly) {
		process.exit(0);
	}

	// stdio: "inherit" — planner è una sessione interattiva, deve ereditare
	// il terminale corrente esattamente come un `pi ...` lanciato a mano.
	// cwd: la directory del PROGETTO (non del pacchetto) — vedi commento
	// Revisione 31 in testa al file.
	//
	// shell su Windows (Revisione 32): un `pi` installato via npm su Windows è
	// quasi certamente uno shim `pi.cmd`/`pi.ps1`, non un eseguibile nativo —
	// `child_process.spawn()` NON risolve l'estensione da solo (a differenza
	// della shell dell'utente) e fallirebbe con ENOENT anche se `pi` funziona
	// perfettamente da un prompt aperto a mano. Passare per la shell di
	// sistema (cmd.exe) risolve lo shim correttamente. Limite noto e onesto:
	// Node cita rare stranezze di quoting con `shell: true` su Windows quando
	// un argomento contiene spazi (es. un percorso come "C:\Users\Mario
	// Rossi\..."); non verificato in questa sessione (nessun ambiente
	// Windows disponibile per testarlo) — se capita, la libreria `cross-spawn`
	// è il fix noto (gestisce il quoting di cmd.exe correttamente), non
	// ancora aggiunta come dipendenza per non appesantire il pacchetto senza
	// una verifica reale del problema.
	const child = spawn("pi", piArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
	child.on("error", (err) => {
		console.error(`launch-planner: impossibile lanciare "pi" (${err.message}) — è nel PATH?`);
		process.exit(1);
	});
	child.on("exit", (code, signal) => {
		process.exit(signal ? 1 : (code ?? 0));
	});
}

// Uso diretto: `node scripts/launch-planner.mjs ...` (dev, dal repo del
// pacchetto — packageRoot e cwd coincidono in questo caso, comportamento
// invariato rispetto a prima della Revisione 31 per questo flusso).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const packageRoot = path.resolve(__dirname, "..");
	runLaunchPlanner({ packageRoot, cwd: process.cwd(), argv: process.argv.slice(2) });
}
