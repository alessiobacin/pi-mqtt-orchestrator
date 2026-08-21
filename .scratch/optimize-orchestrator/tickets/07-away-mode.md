# Ticket — Away-mode leggero

- **Spec**: `../../spec.md` (Implementation Decisions: Away-mode)
- **Riferimento decisione**: `../../issues/09-away-mode.md`

## Obiettivo

Modalità "away": il watcher bash (ticket 04) fa anche da router notifiche.
In `away`, le notifiche di routine (esiti attesi, heartbeat) sono assorbite;
solo le decisioni vere (stall, human_approval, conflitti merge) raggiungono
WhatsApp. Filtro in pura logica (bash/regole), nessun LLM extra.

## Criteri di accettazione

- Un flag/switch di modalità `away` (es. env var / config) attivabile
  dall'operatore.
- In `away`: routine soppresse, decisioni vere consegnate via notify_whatsapp.
- Fuori `away`: comportamento attuale invariato.
- Test: con away on, una routine è soppressa da WhatsApp; una decisione vera la
  raggiunge.

## Dipendenze

- Watcher bash (ticket 04); integrate with notifiche WhatsApp esistenti.
Status: implemented + tested OK
