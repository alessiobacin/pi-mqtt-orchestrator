# Ticket — Riconciliazione all'avvio reale e testata

- **Spec**: `../../spec.md` (Implementation Decisions: Riconciliazione all'avvio)
- **Riferimento decisione**: `../../issues/10-riconciliazione-avvio.md`

## Obiettivo

Rendere reale e testata la riconciliazione all'avvio prevista in sezione 27, sul
pattern firstmate: coda durevole di eventi + lock singleton + generazione/ack
(così un evento vecchio non viene mai riapplicato due volte), mappata su SQLite +
retained MQTT.

## Criteri di accettazione

- Coda durevole degli eventi non ancora gestiti; ack legato a una generazione.
- Lock singleton per sessione; niente doppia applicazione degli eventi (test
  dedicato).
- Riconciliazione all'avvio: il sistema ripristina lo stato dei run/ticket da
  SQLite senza duplicare lavoro.
- Coverage: test di riavvio su ogni componente critico (come fa firstmate).

## Dipendenze

- Sopra il layer ticket/DAG SQLite esistente.
