## Question

Script dinamico che controlla se le credenziali e/o i vari login e/o altro
necessario al task siano PRESENTI (es. `gh auth login` fatto, chiavi API in .env,
CLI/MCP installati), usabile dal planner per sapere al volo lo stato della
preflight (ticket 06). Confluisce nel comando `po deps` / `provision` del ticket 12.

Giudizio (planner): UTILE — lo script è il "capability-probe" che il planner
chiama per sapere in modo deterministico cosa c'è e cosa manca, invece di
indovinare dal prompt. Diventa parte integrante del preflight credenziali.

Domande da chiudere in spec: cosa controllare esattamente (presenza variabile
.env, exit code di `gh auth status`, `which <cli>`, MCP server raggiungibili), e
come il planner usa l'output (checklist tipizzata: `ok`/`missing` con istruzioni).

Type: task
Blocked by: 06
Status:
