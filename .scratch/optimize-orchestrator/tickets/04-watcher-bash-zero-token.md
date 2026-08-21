# Ticket — Watcher bash zero-token

- **Spec**: `../../spec.md` (Implementation Decisions: Watcher bash zero-token)
- **Riferimento decisione**: `../../issues/02-watcher-bash-zero-token.md`

## Obiettivo

Script bash `scripts/watcher.sh` che rileva lo stall dei ticket senza consumare
token LLM: polla SQLite `tickets` (running oltre soglia) e/o legge retained MQTT
via `mosquitto_sub`; su vero stall pubblica un evento di watchdog e risveglia il
planner sul canale `[watchdog]` già esistente (Revisione 29). Singleton via lock.

## Criteri di accettazione

- Rileva un ticket `running` oltre soglia configurata e lo segnala.
- Il wake al planner avviene SOLO su vero superamento soglia, non a ogni sweep.
- Nessuna chiamata LLM: il watcher è puro bash + client MQTT/sqlite3.
- Singleton: due istanze non duplicano i wake (lock).
- Il `run_watchdog_check` esistente resta come verifica manuale/complementare.
- Test: simulare ticket running oltre soglia → wake emesso; sotto soglia → nessun
  wake.

## Dipendenze

- Consumato dall'away-mode (ticket 09) come router notifiche.
