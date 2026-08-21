## Question

Modalità "away" leggera: un livello che assorbe le notifiche di routine (esiti
attesi, heartbeat) e alza SOLO le decisioni vere (stall, richieste di approvazione
umana, conflitti merge) evitando di affidare ogni escalation a WhatsApp.

Disegno proposto: il watcher bash zero-token (ticket 02) fa anche da router
notifiche; in modalità `away`, filtra routine e alza solo ciò che richiede
davvero l'umano. Nessun LLM extra.

Decisione: confermare che l'away-mode venga costruito sul watcher (ticket 02)
piuttosto che come modulo separato; definire le regole di priorità.

Type: grilling
Blocked by: 02
Status:
