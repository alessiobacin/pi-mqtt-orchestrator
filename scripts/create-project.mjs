#!/usr/bin/env node
// Scaffolda un nuovo progetto "vuoto" pronto per pi-mqtt-orchestrator, in una
// directory a scelta — copia agents/prompts/mqtt/.env.example da QUESTO
// pacchetto e scrive un package.json NUOVO, specifico del progetto (mai
// quello del pacchetto), inizializza un repo git (serve per l'isolamento in
// worktree, vedi docs/mvp-notes.md Revisioni 13/14).
//
// Revisione 33 — NON copia più extensions/: da quando l'estensione si
// installa globalmente (`pi extension install`, Revisione 31), `pi` la
// carica automaticamente in OGNI sessione, ovunque — copiarne anche un
// secondo esemplare nel progetto scaffoldato e caricarlo esplicitamente con
// `-e extensions/orchestrator.ts` (come faceva `po start` prima di questa
// revisione) causa un doppio caricamento: stessi tool/flag registrati due
// volte, `pi` si rifiuta con "Tool ... conflicts with ...". Scoperto da un
// test reale dell'operatore su una macchina Windows nuova — vedi Revisione
// 33 in docs/mvp-notes.md per il traceback completo e l'analisi. Un
// progetto scaffoldato ora contiene solo CONFIGURAZIONE
// (agents/roles.yaml, prompts/*.md, mqtt/, .env.example), mai il codice
// dell'estensione: `pi`/`configDir`/`promptsDir` la risolvono comunque
// relativa alla cwd del progetto, indipendentemente da dove il CODICE
// dell'estensione è stato caricato (verificato leggendo loadConfig()/
// loadRolePrompt() in extensions/orchestrator.ts: usano sempre
// `identity.cwd`, mai il percorso del modulo stesso).
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
import { runDoctor } from "./doctor.mjs";

function parseArgs(argv) {
	let name;
	let target;
	let force = false;
	let llmp = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--name") name = argv[++i];
		else if (a === "--target") target = argv[++i];
		else if (a === "--force") force = true;
		else if (a === "--llmp") llmp = true;
		else if (a === "--help" || a === "-h") {
			printUsage();
			process.exit(0);
		} else {
			console.error(`create-project: argomento non riconosciuto "${a}" (vedi --help).`);
			process.exit(1);
		}
	}
	return { name, target, force, llmp };
}

function printUsage() {
	console.log(
		[
			'Uso: po init --name "<Nome Progetto>" [--target <dir>] [--force] [--llmp]',
			'     (in locale, senza npm install -g: node scripts/create-project.mjs --name "<Nome Progetto>" [--target <dir>] [--force] [--llmp])',
			"",
			'  --name    Nome del progetto (obbligatorio) — finisce in package.json ("name", slug kebab-case)',
			"            e viene pre-scritto in .pi/extensions/multiAgentOrchestrator/config/project.json,",
			"            così il planner lo trova già impostato al primo orchestrator_init e non deve chiederlo.",
			"  --target  Directory da scaffoldare (default: la directory CORRENTE, in place). Se passato,",
			"            scaffolda invece in quella sottocartella/percorso (creandolo se non esiste).",
			"  --force   Permette di scrivere in una directory di destinazione già esistente e non vuota",
			"            (una directory che contiene solo \".git\" non conta come non vuota); con --llmp,",
			"            permette anche di sovrascrivere .pi/agent/models.json e settings.json già esistenti.",
			"  --llmp    Scrive anche .pi/agent/models.json e .pi/agent/settings.json, configurazione locale",
			'            di `pi` per un llmproxy su http://127.0.0.1:7045 (provider "llmproxy", tema dark) —',
			"            utile se usi un proxy LLM locale invece di un provider cloud diretto.",
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
export async function runCreateProject({ packageRoot, cwd, argv }) {
	const { name, target, force, llmp } = parseArgs(argv);
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

	// 1. Copia SOLO configurazione (agents/prompts/mqtt) dal pacchetto — MAI
	//    extensions/ (Revisione 33, vedi commento in testa al file: il codice
	//    dell'estensione vive nel pacchetto installato globalmente, `pi` lo
	//    carica da lì in automatico) e MAI il package.json del pacchetto
	//    stesso (motivo per cui questo script esiste: evitare che un
	//    progetto nuovo erediti l'identità/il nome del pacchetto invece del
	//    proprio, il problema reale osservato in moa-test-project — vedi
	//    docs/mvp-notes.md, Revisione 28).
	for (const dir of ["agents", "prompts", "mqtt"]) {
		const src = path.join(packageRoot, dir);
		if (fs.existsSync(src)) copyDir(src, path.join(targetDir, dir));
	}
	const envExample = path.join(packageRoot, ".env.example");
	if (fs.existsSync(envExample)) fs.copyFileSync(envExample, path.join(targetDir, ".env.example"));

	// 2. package.json NUOVO, minimo, specifico del progetto — solo
	//    identità/metadata (Revisione 33: nessuna dipendenza da installare
	//    per far girare l'estensione, dato che il codice e le sue
	//    dipendenze npm vivono nell'installazione globale del pacchetto, non
	//    qui — `npm install` non è più un passo necessario in un progetto
	//    scaffoldato di default).
	const projectPkg = {
		name: slug,
		version: "0.1.0",
		private: true,
		type: "module",
		description: `Progetto "${name}", orchestrato con pi-mqtt-orchestrator.`,
	};
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

	// 3bis. --llmp (Revisione 36, richiesto dall'operatore): scrive la
	//    configurazione LOCALE di `pi` per un llmproxy in
	//    <targetDir>/.pi/agent/{models,settings}.json — `pi` legge un `.pi/`
	//    project-local in aggiunta a quello globale in home (già osservato in
	//    Revisione 31: un `.pi/` dentro un checkout dell'operatore conteneva
	//    proprio impostazioni locali di `pi`, incluse le credenziali del suo
	//    proxy LLM), quindi questo è lo stesso meccanismo, non un'invenzione.
	//    Contenuto FISSO, fornito esplicitamente dall'operatore — non generato:
	//    provider "llmproxy" su http://127.0.0.1:7045 con una apiKey segnaposto
	//    ("proxy-local", non un vero segreto — un proxy locale in loopback non
	//    ne ha bisogno, il valore serve solo perché `pi` si aspetta il campo).
	//    Idempotente come il resto dello scaffold: non sovrascrive file già
	//    esistenti a meno di --force (evita di disfare una configurazione che
	//    l'operatore ha già personalizzato a mano).
	if (llmp) {
		const agentDir = path.join(targetDir, ".pi", "agent");
		fs.mkdirSync(agentDir, { recursive: true });

		const modelsPath = path.join(agentDir, "models.json");
		const settingsPath = path.join(agentDir, "settings.json");
		const modelsContent = {
			providers: {
				llmproxy: {
					api: "anthropic-messages",
					baseUrl: "http://127.0.0.1:7045",
					apiKey: "proxy-local",
					models: [{ id: "llmproxy", name: "llmProxy", contextWindow: 1000000 }],
				},
			},
		};
		const settingsContent = {
			theme: "dark",
			defaultProvider: "llmproxy",
			defaultModel: "llmproxy",
		};

		const skipped = [];
		if (force || !fs.existsSync(modelsPath)) {
			fs.writeFileSync(modelsPath, `${JSON.stringify(modelsContent, null, 2)}\n`);
		} else {
			skipped.push(modelsPath);
		}
		if (force || !fs.existsSync(settingsPath)) {
			fs.writeFileSync(settingsPath, `${JSON.stringify(settingsContent, null, 2)}\n`);
		} else {
			skipped.push(settingsPath);
		}

		console.log(`create-project: --llmp — configurazione pi/llmproxy scritta in ${agentDir}`);
		if (skipped.length > 0) {
			console.log(`create-project: (già presenti, non sovrascritti: ${skipped.join(", ")} — usa --force per sovrascriverli)`);
		}
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

	// Doctor automatico (Revisione 33, richiesto dall'operatore): controlla
	// che l'ambiente abbia tutto il necessario (git, `pi`, un modo per far
	// girare un broker MQTT) PRIMA di elencare i prossimi passi, con
	// istruzioni di installazione specifiche per il sistema operativo per
	// qualunque cosa manchi — vedi scripts/doctor.mjs.
	console.log("");
	await runDoctor({ cwd: targetDir });

	console.log("");
	console.log(`Fatto. Prossimi passi${inPlace ? "" : ` (cd ${targetDir})`}:`);
	console.log(`  ${copyEnvCmd}   # facoltativo, per la notifica WhatsApp di fine task`);
	console.log("  docker compose -f mqtt/compose.yaml up -d   # broker MQTT locale (Docker Desktop su Windows), oppure punta --broker a uno esistente");
	if (isWindows) {
		console.log("  # senza Docker Desktop: installa Mosquitto nativo (https://mosquitto.org/download/ o `winget install EclipseFoundation.Mosquitto`)");
		console.log("  #   poi: mosquitto -c mqtt\\mosquitto.conf   (in una finestra PowerShell separata)");
	}
	console.log("  po start --instance planner-01");
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
