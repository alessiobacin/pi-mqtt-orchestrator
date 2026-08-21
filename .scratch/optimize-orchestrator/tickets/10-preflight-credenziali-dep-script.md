# Ticket — Preflight credenziali + script dinamico capability-probe (`po deps`)

- **Spec**: `../../spec.md` (Implementation Decisions: Preflight credenziali + script)
- **Riferimento decisione**: `../../issues/06`, `../../issues/13`

## Obiettivo

Prima di lanciare il team, il planner prevede quali credenziali/CLI/MCP servono,
verifica cosa c'è con uno script dinamico (`po deps`/capability-probe), e chiede
all'operatore — con istruzioni esatte — se ASPETTARE che fornisca le credenziali
(scritte su `.env` + login es. `gh auth login`) o se continuare in parallelo
(verifica man mano quando servono), via gate `human_approval` (ticket 02). Produce
anche il documento esaustivo delle cose da fare, elencate una a una.

## Criteri di accettazione

- Script `po deps`/`provision` controlla: variabili `.env` attese, `gh auth
  status`, `which <cli>`, MCP server raggiungibili, ecc.; output checklist
  tipizzato `ok`/`missing` con istruzioni per ciascuna voce.
- Il planner lo invoca nel planning, apre un `decision_hold`, e chiede wait-vs-async.
- Nel caso wait: prosegue solo dopo che l'operatore ha registrato la risoluzione.
- Nel caso async: procede e verifica man mano che le credenziali servono.
- Credenziali scritte nel `.env` del progetto (gitignored), mai committate.
- Documento esaustivo (checklist ownership/stato/azioni) generato e persistito.

## Dipendenze

- Gate human_approval (ticket 02); CLI po (ticket 13 di po); ricerca web (ticket
  09) per i tool migliori.
Status: implemented + tested OK
