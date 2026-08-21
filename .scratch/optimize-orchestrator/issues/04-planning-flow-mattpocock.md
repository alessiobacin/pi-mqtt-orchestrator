## Question

Come cablare nel planner il flusso completo Matt Pocock **scoping → spec →
ticket**:

- `wayfinder` per chart the map di task grandi/ambigui;
- `grilling` + `domain-modeling` per la sessione HITL di raffinamento dello scope;
- `to-spec` per la spec unica;
- `to-tickets` per scomporla in ticket implementativi.

Oggi il planner HA le skill (`roles.yaml`) e alcune istruzioni in
`prompts/planner.md`, ma l'ordine operativo esatto non è esplicito. Serve
definire il flusso che il planner deve seguire ("quando wayfinder vs quando
domande dirette" è già parzialmente dichiarato) e se/come passa i risultati di
wayfinder→spec→ticket ai tool `run_create`/`ticket_create` esistenti.

Type: grilling
Blocked by:
Status:
