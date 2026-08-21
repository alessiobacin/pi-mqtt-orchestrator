# Ticket — Segnali semantici per-harness

- **Spec**: `../../spec.md` (Implementation Decisions: Segnali semantici)
- **Riferimento decisione**: `../../issues/03-segnali-semantici.md`

## Obiettivo

Distinguere "sta ancora ragionando" da "bloccato a metà turno" con segnali più
semantici della sola soglia di tempo. PRIMA: verificare se l'SDK di pi espone
eventi di ciclo di vita del turno (inizio/fine turno, tool-call in corso); se sì
agganciarli; se no, proxy = ultima tool-call di successo tracciata dagli eventi,
combinata con heartbeat "working". Soglia di tempo resta come fallback, non unica.

## Criteri di accettazione

- Esito documentato della verifica SDK pi (sezione specifica in mvp-notes o doc).
- Se pi espone tool-call → usato per marcare attività; else proxy ultima tool-call.
- Il watchdog (in-process o watcher bash) usa il segnale semantico per distinguere
  lento vs bloccato prima di risvegliare/escalare.
- Test per il caso Revisione 29 (turno troncato con solo evento loop vivo):
  riconosciuto come bloccato col nuovo segnale.

## Dipendenze

- Si integra con il watcher bash (ticket 04).
Status: implemented + tested OK
