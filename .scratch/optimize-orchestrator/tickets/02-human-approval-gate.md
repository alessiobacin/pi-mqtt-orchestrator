# Ticket — Gate `human_approval` durevole

- **Spec**: `../../spec.md` (Implementation Decisions: human_approval durevole)
- **Riferimento decisione**: `../../issues/01-hardening-control-plane.md`

## Obiettivo

Introdurre un gate di approvazione umana durevole nel layer ticket/DAG SQLite:
tabella `decision_holds` (id, ticket_id, question, status, opened_at,
resolved_at, resolved_by). Il planner può aprire un hold; si chiude SOLO con una
risposta esplicita registrata (mai "perché il planner se lo ricorda"); sopravvive
ai riavvii.

## Criteri di accettazione

- `decision_holds` nel DB del layer ticket/DAG (migrazione idempotente).
- Tool/API per aprire, elencare e risolvere un hold; lo stato è leggibile via
  run_status-like.
- Un hold aperto persiste dopo un riavvio (test: apri, ricrea storage, resta
  aperto; risolvi → risolto).
- Il planner usa il gate nel preflight credenziali (ticket 06/13) e nei punti dove
  serve conferma umana esplicita.
- Test: cycle open→persist→resolve, e assenza di auto-resolve.

## Dipendenze

- Nessuna per la parte di struttura; consumato da tickets 06/13 (preflight).

Status: implemented + tested OK
