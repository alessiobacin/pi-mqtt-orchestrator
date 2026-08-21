## Question

Aggiungere un **gantt** delle operazioni da fare e di chi le fa, con visualizzazione
via web LIVE di quello che sta accadendo. Serve una piccola web app che serve
run/tickets/dipendenze da SQLite + strima gli eventi MQTT via websocket, timeline
con stato auto-refresh. Comandi po correlati: `po gantt`/`po web`.

Decisione: stack (Node http server + ws, nessuna dependency pesante), che serve
il dato e come si aggancia agli eventi esistenti. Prevedibile.

Type: task
Blocked by:
Status:
