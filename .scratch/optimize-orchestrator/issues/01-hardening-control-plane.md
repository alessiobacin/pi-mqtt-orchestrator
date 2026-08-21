## Question

Come applicare la priorità alta introdotta dalla comparazione firstmate:

1. **Separare control plane e data plane in `agent_send`**. Oggi planner lancia
   istanze eseguendo shell (`herdr pane split`, `tmux new-session`). Option:
   introduzione di un tool `agent_control` esplicito (launch/interrupt/relaunch)
   con allow-list, distinto da `agent_send`.
2. **Allow-list dei comandi CLI** (rischio aperto sezione 25/40).
3. **`human_approval` durevole** (decision-hold style) minimale via SQLite
   (`decision_holds`), in forma minima ora, Scheduler Engine dopo.

Quale perimetro di hardening va in questa ottimizzazione, e in che ordine rispetto
agli altri lavori? Serve conferma dello scope prima di specificare.

Type: grilling
Blocked by:
Status:
