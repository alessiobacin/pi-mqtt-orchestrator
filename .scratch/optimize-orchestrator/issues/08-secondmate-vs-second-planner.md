## Question

Clarificazione di concetto: in firstmate "secondmate" è scala orizzontale
(sub-agenti persistenti su host separati via SSH, home isolate). In
multiAgentOrchestrator un "secondo planner" sarebbe semplicemente un'altra
istanza planner che orchestra una run diversa (`run_create` è già per-run).

Conclusione proposta (dalla discussione): NON sono lo stesso concetto. Il
"secondmate" = la forma *distribuita* (multi-host) del planner, da attivare solo
con una fleet vera (non con capacity=1/singolo operatore). Quindi NIENTE nuovo
concetto ora; solo sbloccare più run in parallelo (già possibile) e documentare.

Decisione: confermare questa lettura e non implementare secondmate ora (rimandato
a quando servirà multi-host)? O l'operatore intende qualcos'altro con "secondo
planner"?

Type: grilling
Blocked by:
Status:
