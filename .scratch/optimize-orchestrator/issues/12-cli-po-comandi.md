## Question

La CLI `po` ha senso? E quali comandi aggiungere?

Risposta in discussione: sì, è il punto d'ingresso umano comodo già cross-platform.
Comandi proposti oltre agli esistenti (init/start/doctor/update/uninstall):
`status`, `gantt`/`web`, `logs`, `provision`/`deps`, `fleet`, `mcp`, `skills`,
`doctor --network`.

Decisione: quali di questi entrano in questo ciclo di ottimizzazione e quali
restano opzionali/futuri.

Type: grilling
Blocked by:
Status: resolved

## Answer

Decisione (operatore, 2026-08-21): VOGLIO TUTTO. Entrano nel ciclo di
ottimizzazione: `status`, `gantt`/`web`, `logs`, `provision`/`deps`,
`fleet`, `mcp`, `skills`, `doctor --network`. Si affiancano agli esistenti
(init/start/doctor/update/uninstall) e a `po end` (già aggiunto nella v.38).
Nessun comando proposto viene scartato in questo ciclo.
