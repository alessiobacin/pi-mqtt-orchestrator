## Question

Un agente deve avere le credenziali (e le CLI/MCP/abilità) necessarie. Nel flusso
di planning, **prima di lanciare il team il planner prevede quali credenziali/
CLI/MCP saranno necessari**, verifica se esistono sul PC, e se mancano chiede
subito all'operatore con istruzioni esatte (es. "serve GitHub → installa gh così
… e fai gh auth login"). He hold via `human_approval` durevole finché non soddisfatto.

Come si integra con il controllo capability già esistente in orchestration
(roles.yaml, ticket_claim, capability resolution) e con po doctor? Decisione sul
meccanismo di "preflight capabilities" e la sua posizione nel flusso.

Type: grilling
Blocked by: 01 (human_approval durevole per il gate)
Status: resolved

## Answer

Decisione (operatore, 2026-08-21): confermato che il preflight credenziali/CLI/MCP
avviene nel flusso di planning PRIMA di lanciare il team, con gate tramite
`human_approval`. Il planner chiede all'operatore SE ASPETTARE per creare/fornire
le credenziali (poi scritte su `.env` + login necessari es. `gh auth login`) OPPURE
continuare e verificare man mano che servono. Aggiunto ticket 13: uno script
dinamico (`po deps`/capability-probe) che il planner usa per sapere se credenziali/
login/altro necessario sono presenti.

Nota: `.env` è nei convenzioni gitignore del progetto (mai committato) — le
credenziali preflight vanno scritte nel `.env` del progetto orchestrate (o dell'
estensione), non mai committate.
