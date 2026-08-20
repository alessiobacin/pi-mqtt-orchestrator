#!/usr/bin/env node
// Rilegge tutti i logs/<istanza>.jsonl (un file per istanza, scritto
// automaticamente da extensions/orchestrator.ts a ogni evento rilevante —
// vedi "Revisione 18" in docs/mvp-notes.md) e li fonde in un'unica timeline
// cronologica, per rivedere DOPO un test live se il flusso è partito
// nell'ordine giusto: chi si è svegliato quando, per colpa di chi, chi ha
// eseguito cosa. Non modifica né richiede nulla in esecuzione — è solo un
// merge+sort dei file scritti durante il test.
//
// Uso: node scripts/review-log.mjs [cartella-log]   (default: ./logs)

import * as fs from "node:fs";
import * as path from "node:path";

const dir = process.argv[2] || "logs";

if (!fs.existsSync(dir)) {
	console.error(`Nessuna cartella di log trovata in "${dir}" — o non è ancora girato nessun test con questa build, o vai lanciato da una directory diversa da quella del progetto (esegui questo script dalla stessa cartella in cui hai lanciato \`pi\`).`);
	process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
if (files.length === 0) {
	console.error(`"${dir}" esiste ma non contiene nessun file .jsonl.`);
	process.exit(1);
}

const events = [];
for (const f of files) {
	const raw = fs.readFileSync(path.join(dir, f), "utf-8");
	let lineNo = 0;
	for (const line of raw.split("\n")) {
		lineNo++;
		if (!line.trim()) continue;
		try {
			events.push(JSON.parse(line));
		} catch {
			console.error(`riga non valida in ${f}:${lineNo}, ignorata: ${line.slice(0, 120)}`);
		}
	}
}

// Ordinamento cronologico, stabile: a parità di `ts` resta l'ordine di
// lettura dei file (irrilevante per la diagnosi — sono eventi indipendenti,
// es. due session_start).
events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

// Correttivo mirato (Revisione 20): due eventi di istanze DIVERSE possono
// avere lo stesso `ts` ISO (risoluzione al millisecondo) — successo in un
// run di test reale, mettendo un `wake_in` PRIMA dell'`agent_send_out` che
// l'ha causato, esattamente la coppia che più conta diagnosticare
// correttamente con questo tool. Non basta un comparatore "intelligente"
// dentro `.sort()`: se restituisce 0 per la maggior parte delle coppie e un
// valore diverso da zero solo per questa coppia specifica, il comparatore
// non è un ordine totale valido e V8 (Timsort) può ignorare il vincolo
// (successo, verificato). Quindi: un secondo passaggio esplicito e mirato,
// SOLO quando il timestamp è davvero uguale (se `send.ts !== wake.ts` la
// differenza è reale, non un pareggio, e non va corretta).
let movedSomething = true;
let safety = 0;
while (movedSomething && safety++ < events.length) {
	movedSomething = false;
	const sendIndexByAssignment = new Map();
	events.forEach((e, i) => {
		if (e.type === "agent_send_out" && e.assignment_id != null) sendIndexByAssignment.set(e.assignment_id, i);
	});
	for (let wakeIdx = 0; wakeIdx < events.length; wakeIdx++) {
		const wake = events[wakeIdx];
		if (wake.type !== "wake_in" || wake.assignment_id == null) continue;
		const sendIdx = sendIndexByAssignment.get(wake.assignment_id);
		if (sendIdx == null || sendIdx <= wakeIdx) continue; // già nell'ordine giusto, o nessun invio corrispondente
		const send = events[sendIdx];
		if (send.ts !== wake.ts) continue; // ordine reale (clock diverso), non un pareggio da correggere
		events.splice(sendIdx, 1);
		events.splice(wakeIdx, 0, send);
		movedSomething = true;
		break; // gli indici sono cambiati, ricomincia la scansione
	}
}

console.log(`${events.length} eventi da ${files.length} istanza/e, in ordine cronologico:\n`);
for (const e of events) {
	const { ts, instance, role, type, ...rest } = e;
	const detail = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
	console.log(`${ts}  ${String(instance).padEnd(24)} ${String(role ?? "?").padEnd(14)} ${type}${detail}`);
}

// Segnale specifico per il bug "un agente parte da solo senza che nessuno
// gli abbia assegnato nulla": un turn_start/agent_end con
// had_pending_inbound/had_inbound false, per un'istanza che non ha MAI
// ricevuto un wake_in prima di quel momento.
const byInstance = new Map();
for (const e of events) {
	if (!byInstance.has(e.instance)) byInstance.set(e.instance, []);
	byInstance.get(e.instance).push(e);
}
const suspects = [];
for (const [instance, evs] of byInstance) {
	for (const e of evs) {
		const isUnsolicitedTurn =
			(e.type === "turn_start" && e.had_pending_inbound === false) ||
			(e.type === "agent_end" && e.had_inbound === false);
		if (!isUnsolicitedTurn) continue;
		const priorWake = evs.some((other) => other.type === "wake_in" && other.ts <= e.ts);
		if (!priorWake) {
			suspects.push(`${instance} @ ${e.ts} (${e.type})`);
			break;
		}
	}
}
if (suspects.length) {
	console.log(`\n⚠ Possibile partenza non richiesta (nessun wake_in ricevuto prima di agire): ${suspects.join(", ")}`);
} else {
	console.log(`\n✓ Nessuna partenza non richiesta rilevata: ogni turno registrato ha un wake_in precedente.`);
}
