#!/usr/bin/env node
// Scaffolda un nuovo progetto "vuoto" pronto per pi-mqtt-orchestrator, in una
// directory a scelta — copia extensions/agents/prompts/mqtt/.env.example da
// QUESTO pacchetto e scrive un package.json NUOVO, specifico del progetto
// (mai il package.json del pacchetto stesso), inizializza un repo git (serve
// per l'isolamento in worktree, vedi docs/mvp-notes.md Revisioni 13/14).
//
// PERCHÉ QUESTO SCRIPT ESISTE INVECE DI UN VERO SUBCOMMAND `pi orchestrator
// init` (richiesta dell'operatore, Revisione 28): non esiste, in questo
// codebase, nessuna evidenza che la CLI `pi` supporti sottocomandi shell
// registrati da un pacchetto/estensione — `pi.registerCommand()` registra
// solo uno slash-command DENTRO una sessione pi già avviata (vedi
// `/orchestrator` in extensions/orchestrator.ts), e `pi.registerFlag()`
// registra solo flag CLI sull'invocazione `pi -e ...`, non nuovi
// sottocomandi. Inventare `pi orchestrator init` come comando shell reale
// sarebbe una funzionalità non verificata — esattamente il tipo di cosa che
// questo progetto evita di documentare come se funzionasse (vedi la
// disciplina "verificato / non verificato" in docs/mvp-notes.md). Questo
// script è l'equivalente reale, verificato, dello stesso bisogno: un
// comando a riga di comando che prepara un progetto nuovo pronto all'uso.
//
// Revisione 31: la logica qui sotto è ora esportata come runCreateProject()
// e chiamata dal binario globale unificato `po init` (bin/po.mjs, campo
// "bin" di package.json) invece di essere un binario a sé
// (`pi-orchestrator-init`, rinominato — vedi docs/mvp-notes.md Revisione
// 31). Restano invariati sia l'uso diretto via `node scripts/create-project.mjs`
// sia tutta la logica di scaffolding.
//
// Uso:
//   node scripts/create-project.mjs --name "URL Shortener" [--target <dir>] [--force]
//   po init --name "URL Shortener" [--target <dir>] [--force]   (dopo `npm install -g` o `npm link`)
//
// --target di default (Revisione 31): la directory CORRENTE, in place — NON
// più una sottocartella nuova (scelta esplicita dell'operatore: "inizializza
// in place nella cartella corrente"). Passa --target <dir> per il vecchio
// comportamento (scaffold in una sottocartella dedicata).
// --force permette di scrivere in una directory --target già esistente e
// non vuota (di norma lo script si rifiuta, per non rischiare di
// sovrascrivere lavoro esistente) — una directory che contiene SOLO una
// `.git/` (es. dopo `mkdir progetto && cd progetto && git init`) non conta
// come "non vuota" ai fini di questo controllo, per non costringere
// all'uso di --force nel caso comune dello scaffolding in place.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
	let name;
	let target;
	let force = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--name") name = argv[++i];
		else if (a === "--target") target = argv[++i];
		else if (a === "--force") force = true;
		else if (a === "--help" || a === "-h") {
			printUsage();
			process.exit(0);
		} else {
			console.error(`create-project: argomento non riconosciuto "${a}" (vedi --help).`);
			process.exit(1);
		}
	}
	return { name, target, force };
}

function printUsage() {
	console.log(
		[
			'Uso: po init --name "<Nome Progetto>" [--target <dir>] [--force]',
			'     (in locale, senza npm install -g: node scripts/create-project.mjs --name "<Nome Progetto>" [--target <dir>] [--force])',
			"",
			'  --name    Nome del progetto (obbligatorio) — finisce in package.json ("name", slug kebab-case)',
			"            e viene pre-scritto in .pi/extensions/multiAgentOrchestrator/config/project.json,",
			"            così il planner lo trova già impostato al primo orchestrator_init e non deve chiederlo.",
			"  --target  Directory da scaffoldare (default: la directory CORRENTE, in place). Se passato,",
			"            scaffolda invece in quella sottocartella/percorso (creandolo se non esiste).",
			"  --force   Permette di scrivere in una directory di destinazione già esistente e non vuota",
			"            (una directory che contiene solo \".git\" non conta come non vuota).",
		].join("\n"),
	);
}

function slugify(s) {
	return (
		s
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "") // strip combining diacritics (é -> e, etc.)
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "progetto"
	);
}

function nowIso() {
	return new Date().toISOString();
}

function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const s = path.join(src, entry.name);
		const d = path.join(dest, entry.name);
		if (entry.isDirectory()) copyDir(s, d);
		else fs.copyFileSync(s, d);
	}
}

// runCreateProject({ packageRoot, cwd, argv }) — packageRoot è la directory
// del pacchetto pi-mqtt-orchestrator installato (da cui copiare
// extensions/agents/prompts/mqtt/.env.example/check-syntax.mjs); cwd è la
// directory dell'operatore (default per --target, Revisione 31: in place,
// non più una sottocartella — vedi commento in testa al file); argv sono gli
// argomenti (senza node/nome-script).
export function runCreateProject({ packageRoot, cwd, argv }) {
	const { name, target, force } = parseArgs(argv);
	if (!name) {
		console.error("create-project: --name è obbligatorio (vedi --help).");
		process.exit(1);
	}
	const slug = slugify(name);
	const inPlace = !target;
	const targetDir = path.resolve(target ? path.resolve(cwd, target) : cwd);

	if (fs.existsSync(targetDir)) {
		// Una directory che contiene solo ".git" (es. dopo `mkdir progetto &&
		// cd progetto && git init`, il flusso più comune prima di `po init` in
		// place) non conta come "non vuota" — altrimenti --force servirebbe
		// quasi sempre nel caso d'uso di default (Revisione 31).
		const existing = fs.readdirSync(targetDir).filter((e) => e !== ".git");
		if (existing.length > 0 && !force) {
			console.error(`create-project: "${targetDir}" esiste già e non è vuota — usa --force per scrivere comunque, o scegli un --target diverso.`);
			process.exit(1);
		}
	}
	fs.mkdirSync(targetDir, { recursive: true });

	console.log(`create-project: creo il progetto "${name}" in ${targetDir}${inPlace ? " (in place)" : ""}`);

	// 1. Copia extensions/agents/prompts/mqtt dal pacchetto — MAI il
	//    package.json del pacchetto stesso (motivo per cui questo script
	//    esiste: evitare che un progetto nuovo erediti l'identità/il nome
	//    del pacchetto invece del proprio, il problema reale osservato in
	//    moa-test-project — vedi docs/mvp-notes.md, Revisione 28).
	for (const dir of ["extensions", "agents", "prompts", "mqtt"]) {
		const src = path.join(packageRoot, dir);
		if (fs.existsSync(src)) copyDir(src, path.join(targetDir, dir));
	}
	const envExample = path.join(packageRoot, ".env.example");
	if (fs.existsSync(envExample)) fs.copyFileSync(envExample, path.join(targetDir, ".env.example"));
	// check-syntax.mjs è l'unico script del pacchetto copiato per default:
	// autosufficiente (nessuna dipendenza dalle skill vendorizzate di mattpocock né da
	// altri script), e utile per chiunque poi tocchi extensions/orchestrator.ts
	// nel progetto scaffoldato.
	const checkSyntaxSrc = path.join(packageRoot, "scripts", "check-syntax.mjs");
	const hasCheckSyntax = fs.existsSync(checkSyntaxSrc);
	if (hasCheckSyntax) {
		fs.mkdirSync(path.join(targetDir, "scripts"), { recursive: true });
		fs.copyFileSync(checkSyntaxSrc, path.join(targetDir, "scripts", "check-syntax.mjs"));
	}

	// 2. package.json NUOVO, specifico del progetto — legge dependencies/
	//    devDependencies dal pacchetto sorgente così restano sincronizzate
	//    senza doverle duplicare a mano in questo script, ma name/
	//    description/version sono del progetto, non del pacchetto.
	const sourcePkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"));
	const projectPkg = {
		name: slug,
		version: "0.1.0",
		private: true,
		type: "module",
		description: `Progetto "${name}", orchestrato con pi-mqtt-orchestrator.`,
		pi: { extensions: ["./extensions"] },
		scripts: {
			"check-syntax": "node --experimental-strip-types scripts/check-syntax.mjs extensions/orchestrator.ts",
		},
		dependencies: sourcePkg.dependencies || {},
		devDependencies: sourcePkg.devDependencies || {},
	};
	if (!hasCheckSyntax) delete projectPkg.scripts["check-syntax"];
	fs.writeFileSync(path.join(targetDir, "package.json"), `${JSON.stringify(projectPkg, null, 2)}\n`);

	// 3. Pre-scrivi config/project.json con il nome scelto — così il primo
	//    orchestrator_init lo trova già impostato e il planner non deve
	//    chiederlo all'utente (vedi prompts/planner.md, "Layer ticket/DAG
	//    persistente", Revisione 28). Schema minimo, coerente con
	//    MoaProjectConfig in extensions/orchestrator.ts, ma senza importare
	//    quel file (troppo pesante per uno script di scaffolding — si
	//    connetterebbe a MQTT): se lo schema di project.json cambia in una
	//    revisione futura, orchestrator_init lo aggiorna comunque da solo al
	//    primo utilizzo (creazione idempotente, mai distruttiva).
	const moaConfigDir = path.join(targetDir, ".pi", "extensions", "multiAgentOrchestrator", "config");
	fs.mkdirSync(moaConfigDir, { recursive: true });
	const projectJsonPath = path.join(moaConfigDir, "project.json");
	if (!fs.existsSync(projectJsonPath)) {
		fs.writeFileSync(
			projectJsonPath,
			`${JSON.stringify({ schema_version: 1, extension_version: "pre-init", project: name, created_at: nowIso(), updated_at: nowIso() }, null, 2)}\n`,
		);
	}

	// 4. .gitignore minimo (worktree/node_modules/logs), git init se non è
	//    già un repo — richiesto per l'isolamento in worktree (docs/mvp-notes.md,
	//    Revisioni 13/14).
	const gitignorePath = path.join(targetDir, ".gitignore");
	if (!fs.existsSync(gitignorePath)) {
		// .pi/ qui è la workspace runtime dell'estensione nel progetto scaffoldato
		// (SQLite orchestrator.db, config/project.json, specs/tickets — Revisioni
		// 26-28), non codice: locale per macchina/progetto, mai da condividere.
		fs.writeFileSync(gitignorePath, ["node_modules/", ".worktrees/", "logs/", ".env", ".pi/", "*.db", "*.db-journal", ""].join("\n"));
	}
	if (!fs.existsSync(path.join(targetDir, ".git"))) {
		try {
			execFileSync("git", ["init"], { cwd: targetDir, stdio: "ignore" });
			console.log("create-project: repo git inizializzato.");
		} catch (err) {
			console.warn(`create-project: \`git init\` non riuscito (${err instanceof Error ? err.message : String(err)}) — inizializzalo tu a mano, serve per l'isolamento in worktree.`);
		}
	}

	// Auto-discovery del sistema operativo (Revisione 32, richiesto
	// dall'operatore): il comando di copia e le opzioni broker suggerite
	// cambiano tra Windows e macOS/Linux — invece di scrivere un'unica riga
	// che funziona ovunque (impossibile: `cp` non esiste su cmd.exe, `copy`
	// non esiste su bash), lo script rileva `process.platform` e stampa il
	// comando giusto per CHI lo sta eseguendo, senza che l'operatore debba
	// tradurlo a mano — vedi anche README, sezione "Installazione su
	// Windows", per l'equivalente completo in PowerShell.
	const isWindows = process.platform === "win32";
	const copyEnvCmd = isWindows ? "copy .env.example .env" : "cp .env.example .env";

	console.log("");
	console.log(`Fatto. Prossimi passi${inPlace ? "" : ` (cd ${targetDir})`}:`);
	console.log("  npm install");
	console.log(`  ${copyEnvCmd}   # facoltativo, per la notifica WhatsApp di fine task`);
	console.log("  docker compose -f mqtt/compose.yaml up -d   # broker MQTT locale (Docker Desktop su Windows), oppure punta --broker a uno esistente");
	if (isWindows) {
		console.log("  # senza Docker Desktop: installa Mosquitto nativo (https://mosquitto.org/download/ o `winget install EclipseFoundation.Mosquitto`)");
		console.log("  #   poi: mosquitto -c mqtt\\mosquitto.conf   (in una finestra PowerShell separata)");
	}
	console.log("  po start --instance planner-01   # oppure: pi -e extensions/orchestrator.ts --instance planner-01 --role planner");
	console.log("");
	console.log("Nota: questo scaffold NON include la cartella delle skill vendorizzate di mattpocock (le skill Wayfinder/To-Spec");
	console.log("sono un extra pesante, non necessario per iniziare) — `po start` le include comunque dall'installazione globale");
	console.log("del pacchetto stesso (non dal progetto scaffoldato). Il planner userà gli 8 tool del layer ticket/DAG di default");
	console.log("fin dal primo task (vedi prompts/planner.md) — non serve nominarli nel prompt che gli dai.");
}

// Uso diretto: `node scripts/create-project.mjs ...` (dev, dal repo del pacchetto).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	runCreateProject({ packageRoot: path.resolve(__dirname, ".."), cwd: process.cwd(), argv: process.argv.slice(2) });
}
