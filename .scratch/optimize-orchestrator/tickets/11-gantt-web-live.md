# Ticket — Gantt live web

- **Spec**: `../../spec.md` (Implementation Decisions: Gantt live web)
- **Riferimento decisione**: `../../issues/11-gantt-live-web.md`

## Obiettivo

Piccola web app (Node http server + `ws`) che serve run/tickets/fasi da SQLite e
strima gli eventi MQTT via websocket, con una timeline "chi fa cosa, in quale fase,
stato", auto-refresh. Accessibile con `po gantt`/`po web`. Nessuna dependency
pesante.

## Criteri di accettazione

- Serve una pagina gantt LIVE tornando su dati reali SQLite + eventi MQTT.
- Timeline con ownership per ruolo/istanza e stato per fase/ticket.
- Aggiornamento in tempo reale via websocket quando arrivano eventi.
- Aperta da `po gantt` (apre browser/URL) e `po web` (serve l'URL).
- Test: serve i dati attesi da una fixture SQLite; riceve un evento MQTT e la vista
  si aggiorna.

## Dipendenze

- Usa il layer ticket/DAG SQLite e gli eventi MQTT esistenti.
Status: implemented + tested OK
