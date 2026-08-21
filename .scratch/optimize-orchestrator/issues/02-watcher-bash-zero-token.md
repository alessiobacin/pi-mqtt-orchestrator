## Question

Sostituire/affiancare il watchdog LLM-planner (Revisione 29) con un **watcher
bash zero-token** che rileva lo stall (polling SQLite / MQTT) senza consumare
token e sveglia la planner solo quando serve una decisione.

- Detector bash (mosquitto_sub + polling SQLite `tickets` running/updated_at).
- Actuator: wake del planner solo su vero stall con messaggio già pronto.
- Singleton lock per evitare doppi watcher.

Domanda progettuale: il watcher serve solo per "stalled ticket" o anche per
assorbire/w-escalare notifiche di routine (away-mode, punto 11 della lista
operatore)? Che relazione ha col `run_watchdog_check` esistente?

Type: research (SDK pi / pattern) + design
Blocked by:
Status:
