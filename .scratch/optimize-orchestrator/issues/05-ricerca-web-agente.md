## Question

Aggiungere un'agente dedicata (o estendere planner) che fa **ricerca web
approfondita sul task** prima dello scoping: trovare progetti simili online per
spunto/riuso, e individuare le **CLI/MCP/skill/playbook migliori per ogni agente**
del team candidato. Il flusso che l'operatore descrive:

1. planner riceve richiesta (es. "app che valida codice fiscale");
2. ricerca web di progetti simili; legge i migliori;
3. nuova sessione di domande HITL (grilling) per raffinare lo scope; se esiste
   già una cosa identica, suggerire di riusarla;
4. decide team → chiede conferma team ALL'UTENTE;
5. conferma anche le CLI/MCP/skill migliori per ogni agente;
6. produce documento esaustivo di tutte le cose da fare, elencate una a una.

Decisioni: ruolo `researcher` nuovo vs estensione del planner; quando è utile
(task semplici/non-dev potrebbero saltarla); come il documento esaustivo diventa
il punto di partenza di plan_set/ticket.

Type: grilling
Blocked by:
Status:
