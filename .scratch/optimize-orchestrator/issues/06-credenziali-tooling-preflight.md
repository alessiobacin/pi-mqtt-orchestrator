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
Status:
