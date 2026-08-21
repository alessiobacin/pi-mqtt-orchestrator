## Question

Assicurarsi che altre istanze di planner nello stesso progetto possano avere un
team diverso dal team del planner-01 — requisito esplicito dell'operatore.

Stato attuale: già supportato dal codice — `resolveCapabilities` risolve `teams`
per istanza con precedenza INSTANCE > ROLE (voce in `agents.yaml`), e i topic
`pi/<project>/teams/<team>/events` sono per-progetto, quindi planner-02 con una
propria voce `teams` diversa ottiene un canale e una membership diversi. Il planner
è comunque l'unico a fare plan_set/plan_advance per i propri run.

Scopo del ticket: (1) documentare il comportamento; (2) aggiungere un test che
verifichi che due istanze planner nello stesso progetto (es. planner-01 core,
planner-02 core2) risolvano team diversi e non si "vedano" in topic dove non
condividono il team; (3) assicurarsi che `launch-planner.mjs`/`po start` non
forzino un team unico per tutti i planner (lasciare che l'istanza derivi il suo).

Type: task
Blocked by:
Status:
