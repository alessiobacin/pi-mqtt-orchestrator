# Wayfinder Map — Ottimizzazione multiAgentOrchestrator

Label: `wayfinder:map` (issue-tracker locale: `.scratch/optimize-orchestrator/`)

## Destination

Far arrivare multiAgentOrchestrator allo stato "ottimizzato" che l'operatore ha
descritto nella discussione/circolare firstmate, coprendo in modo coerente i 14
punti richiesti: hardening (control/data plane, allow-list CLI, `human_approval`
durevole, riconciliazione all'avvio reale e testata), supervisione a costo-zero
(watcher bash + segnali semantici), flusso Matt Pocock cablato nel planner
(scoping→spec→ticket), ricerca web nel planning, preflight di credenziali/
tooling con documento esaustivo, gantt live web, away-mode. La fine del percorso
è la **spec** (via `to-spec`) e i **ticket** (via to-tickets) di questa ottimizzazione.

## Notes

- **Dominio**: orchestrazione multi-agente su Pi + MQTT 5 + SQLite (layer
  ticket/DAG). Codice vivo in `extensions/orchestrator.ts` (~3900 righe),
  roster in `agents/roles.yaml`, logica di merge worktree in parallelo.
- **Skill da consultare**: wayfinder, to-spec, grilling, domain-modeling. Solo
  il planner ha accesso a queste; `research`/`prototype` non vendorizzate
  (limite noto — i ticket di quei tipi vengono segnalati, non risolti).
- **Standing preference (operatore)**: gestire il rischio. Non si fanno salti
  architetturali senza spec; "mai risolvere un conflitto da solo"; i punti 8/9
  (worktree-per-agente, secondmate) vanno valutati con prudenza e, se necessari,
  come progetti a sé.
- **Regola aziendale forte**: questo repo (`pi-mqtt-orchestrator`) è l'estensione
  stessa; i ticket del layer (run/ticket/DAG su SQLite) si riferiscono al lavoro
  che l'ORCHESTRATORE fa sui progetti, NON alla pianificazione dell'estensione
  stessa. Questa mappa e la spec sono artefatti del repo (`.scratch/`), non run
  dell'orchestratore.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

_(risolti: 05, 06, 07, 08, 12 — vedi i singoli ticket in issues/)_.

Riepilogo decisioni prese (2026-08-21, dal dialogo con l'operatore):
- **05** — Ricerca web nel planner (niente ruolo `researcher`), fallback su guida in
  file se il prompt cresce troppo; ricerca opzionale per task banali/non-dev.
- **06** — Preflight credenziali/CLI/MCP nel planning, gate `human_approval`; planner
  chiede wait-vs-async; → ticket 13 (script dinamico capability-probe / `po deps`).
- **07** — SINGOLO worktree condiviso per task + blocco file; niente
  worktree-per-agente + merge-agent in questa ottimizzazione; sparse-checkout = opz.
- **08** — secondmate ≠ concetto nuovo; secondo planner = istanza con run diversa;
  → ticket 14 (team planner per istanza documentato e testato).
- **12** — CLI po: entrano TUTTI i comandi proposti (status, gantt/web, logs,
  provision/deps, fleet, mcp, skills, doctor --network), accanto a end (già v.38).

TICKET NUOVI: 13 (script dinamico credenziali, blocked by 06), 14 (team planner
per istanza). Frontier residua: 01, 02, 03, 04, 09, 10, 11 (design/lavoro planner),
13, 14.

## Not yet specified

- **Ordine delle fasi**: qual è la sequenza giusta (hardening prima? watcher
  prima? planning-flow prima?) e cosa va in parallelo. Non è ancora un ticket:
  dipende dall'esito di quasi tutti i ticket di frontiera.
- **Requirements/riferimenti firstmate**: quanto in dettaglio trattare
  l'integrazione coi pattern firstmate (coda+lock+generazione, decision-hold,
  control/data plane) vs reinventare.
- **Portata esatta del documento esaustivo** (punto "documento di tutte le cose
  da fare") e dove vive (in `.scratch/`? nel repo? in config? ).

## Out of scope

- Riscrittura completa di firstmate; portabilità multi-harness verso altri
  harness all'infuori di Pi (fuori target: è un'estensione di Pi per design).
- Lancio/gestione di una seconda macchina o fleet multi-host operativa adesso
  (il ticket "secondmate" qui è solo decisionale/di chiarimento).

## Il percorso

1. Risolvere i ticket `wayfinder:grilling`/`wayfinder:research` della frontiera
   (un ticket alla volta, o più research in parallelo).
2. Quando la mappa è chiara → run `/skill:to-spec` (sintesi, nessuna intervista).
3. Poi to-tickets per scomporre la spec in ticket implementativi.
