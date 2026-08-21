# Ticket — Flusso planning Matt Pocock (prompt planner + fallback)

- **Spec**: `../../spec.md` (Implementation Decisions: Flusso planning)
- **Riferimento decisione**: `../../issues/04-planning-flow-mattpocock.md`

## Obiettivo

Il prompt del planner esplicita l'ordine operativo: per task grandi/ambigui
wayfinder→grilling→domain-modeling→to-spec→to-tickets; per task piccoli domande
dirette. Se le skill vendorizzate mancano (caso v.38), scatta il metodo di
scoping integrato già aggiunto alla v.38 — il planner resta "con le mani
occupate", mai a vuoto. to-tickets non è una skill vendored: è il passo in cui
produce i file ticket (es. in `.scratch/<task>/tickets/`).

## Criteri di accettazione

- Il prompt descrive chiaramente il flusso e il criterio "wayfinder vs domande
  dirette" (già in parte presente).
- Verificato il fallback di scoping quando le skill mancano (test che simula
  session senza skill).
- Il collegamento tra l'esito di to-spec/to-tickets e il layer ticket/DAG
  (run_create/spec_create/ticket_create) è chiaro.
- Documentata la relazione to-tickets ≠ skill vendored.

## Dipendenze

- Nessuna strutturale; foundation per ricerca web (ticket 09).
Status: implemented + tested OK
