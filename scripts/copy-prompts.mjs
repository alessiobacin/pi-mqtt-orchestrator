#!/usr/bin/env node
// `po copy-prompts` — Revisione 47.
//
// Da questa revisione, i prompt di ruolo si leggono SEMPRE dal pacchetto
// installato per default (resolveGlobalPromptsDir() in
// extensions/orchestrator.ts) — non esiste più una copia per-progetto creata
// automaticamente da `po init`, quindi non c'è più nulla che possa restare
// silenziosamente indietro dopo un `po update` (il bug reale dietro la
// Revisione 46, che questo comando sostituisce: `po sync-prompts` è stato
// rimosso, non serve più risincronizzare nulla per default).
//
// Questo comando esiste SOLO per chi vuole personalizzare i prompt di UN
// progetto specifico: copia prompts/ dal pacchetto installato (quello da cui
// `po` sta girando ORA) dentro
// <progetto>/.pi/extensions/multiAgentOrchestrator/prompts/, pronta da
// modificare a mano. Da sola non cambia nulla: un'istanza continua a leggere
// i prompt globali finché non la lanci con `po start --instance <nome>
// --role <ruolo> --custom-prompts` — è quel flag (letto da
// extensions/orchestrator.ts) a far guardare prima nella cartella locale
// appena creata, ricadendo comunque sui prompt globali per qualunque file
// tu NON abbia toccato lì dentro (fallback per-file, non tutto-o-niente:
// personalizzare un solo ruolo non fa congelare gli altri).
//
// Uso: po copy-prompts

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const s = path.join(src, entry.name);
		const d = path.join(dest, entry.name);
		if (entry.isDirectory()) copyDir(s, d);
		else fs.copyFileSync(s, d);
	}
}

function countFiles(dir) {
	let n = 0;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
		else n++;
	}
	return n;
}

// runCopyPrompts({ packageRoot, cwd }) — packageRoot è il pacchetto npm da
// cui `po` sta girando (la fonte, sempre l'ultima versione installata); cwd
// è la directory del progetto scaffoldato su cui operare (deve avere già
// .pi/extensions/multiAgentOrchestrator/, cioè essere stato creato con `po
// init`).
export function runCopyPrompts({ packageRoot, cwd }) {
	const promptsSrc = path.join(packageRoot, "prompts");
	if (!fs.existsSync(promptsSrc)) {
		console.error(`po copy-prompts: "${promptsSrc}" non esiste nel pacchetto installato — niente da cui copiare.`);
		process.exit(1);
	}

	const extensionDir = path.join(cwd, ".pi", "extensions", "multiAgentOrchestrator");
	if (!fs.existsSync(extensionDir)) {
		console.error(
			`po copy-prompts: "${extensionDir}" non esiste — questa directory non sembra un progetto scaffoldato con \`po init\`. ` +
				"Esegui questo comando DENTRO la directory del progetto da personalizzare.",
		);
		process.exit(1);
	}

	const promptsDest = path.join(extensionDir, "prompts");

	// Non sovrascrivere mai in silenzio una personalizzazione già fatta: se
	// esiste già una copia locale, spostala su un backup con timestamp prima
	// di scriverne una nuova (stesso principio già seguito altrove in questo
	// pacchetto — es. worktree_finalize non cancella mai un worktree in
	// conflitto, lo lascia intatto per revisione manuale).
	let backupDir = null;
	if (fs.existsSync(promptsDest)) {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		backupDir = `${promptsDest}.bak-${stamp}`;
		fs.renameSync(promptsDest, backupDir);
	}

	copyDir(promptsSrc, promptsDest);
	const n = countFiles(promptsDest);

	console.log(`po copy-prompts: copiati ${n} file da "${promptsSrc}" a "${promptsDest}".`);
	if (backupDir) {
		console.log(`po copy-prompts: la copia locale precedente è stata conservata in "${backupDir}" (niente è stato perso).`);
	}
	console.log(
		"po copy-prompts: questo da solo NON cambia ancora nulla — un'istanza continua a leggere i prompt del pacchetto " +
			"installato finché non la lanci con `po start --instance <nome> --role <ruolo> --custom-prompts`. Modifica ora " +
			`i file dentro "${promptsDest}", poi rilancia con quel flag perché vengano usati davvero (per i soli ruoli/file ` +
			"che personalizzi lì — qualunque altro file resta letto dal pacchetto installato, anche in futuro).",
	);
}

// Uso diretto: `node scripts/copy-prompts.mjs` (dev, dal repo del pacchetto —
// packageRoot e cwd coincidono, utile solo per verificare che lo script
// giri, non un uso reale).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	runCopyPrompts({ packageRoot: path.resolve(__dirname, ".."), cwd: process.cwd() });
}
