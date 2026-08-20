#!/usr/bin/env node
// Verifica sintattica dell'estensione usando il VERO loader ESM di Node
// (via dynamic import), lo stesso percorso di parsing che usa `pi` quando
// carica l'estensione — non un bundler o un `--check` che non è affidabile
// per questo file. Vedi "Revisione 17" in docs/mvp-notes.md per il perché
// esiste questo script: sia `esbuild --bundle` sia `node --check
// --experimental-strip-types` si sono rivelati inaffidabili per questa
// classe di bug (una virgola finale dentro un `return ( ... );` con più
// stringhe concatenate — sintassi invalida che entrambi hanno lasciato
// passare senza errori, ma che ha fatto crashare `pi` per davvero).
//
// Uso: node --experimental-strip-types scripts/check-syntax.mjs [file.ts]
// (il flag --experimental-strip-types va passato al processo `node` che
// esegue QUESTO script, non è qualcosa che lo script possa attivare da solo,
// perché serve al parser dell'`import()` dinamico qui sotto.)
//
// Come distingue un vero errore di sintassi da un fallimento "atteso":
// - SyntaxError -> il file NON è sintatticamente valido, fallisce con
//   messaggio ed exit code 1.
// - ERR_MODULE_NOT_FOUND / ERR_UNSUPPORTED_DIR_IMPORT -> il parsing è
//   arrivato oltre la sintassi, fino alla risoluzione dei moduli, e si è
//   fermato solo perché pacchetti come @mariozechner/pi-tui /
//   @mariozechner/pi-coding-agent esistono solo dentro il runtime di `pi`
//   e non sono installabili qui: la sintassi è comunque valida, quindi
//   PASS.
// - qualsiasi altro errore (es. "pi is not defined" se qualcuno eseguisse
//   codice top-level che usa l'oggetto `pi` fuori da un hook) -> significa
//   comunque che il parsing è riuscito, quindi PASS, ma il messaggio viene
//   stampato per trasparenza.

import { pathToFileURL } from "node:url";

const target = process.argv[2] ?? "extensions/orchestrator.ts";
const url = pathToFileURL(target).href;

try {
	await import(url);
	console.log(`OK: ${target} sintatticamente valido (importato ed eseguito senza eccezioni al top level).`);
} catch (err) {
	if (err instanceof SyntaxError) {
		console.error(`ERRORE DI SINTASSI in ${target}:`);
		console.error(err.message);
		process.exitCode = 1;
	} else if (err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "ERR_UNSUPPORTED_DIR_IMPORT") {
		const pkg = String(err.message || "").match(/'([^']+)'/)?.[1] ?? "un pacchetto esterno";
		console.log(`OK (sintassi valida): ${target} — parsing riuscito, si ferma solo alla risoluzione di "${pkg}" (pacchetto disponibile solo dentro il runtime di pi, atteso qui).`);
	} else {
		console.log(`OK (sintassi valida): ${target} — parsing riuscito, fallito dopo per un motivo non sintattico:`);
		console.log(String(err?.stack || err));
	}
}
