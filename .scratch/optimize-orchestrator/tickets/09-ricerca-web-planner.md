# Ticket — Ricerca web nel planner (progetti simili + tool per ruolo)

- **Spec**: `../../spec.md` (Implementation Decisions: Ricerca web)
- **Riferimento decisione**: `../../issues/05-ricerca-web-agente.md`

## Obiettivo

Il planner (nessun ruolo dedicato) fa ricerca web approfondita sul task quando lo
merita: trova progetti simili da cui trarre spunto o da riusare, e i tool/MCP/
skill/playbook migliori per ciascun agente del team; li propone all'operatore
insieme alla conferma del team. Per task banali/non-dev la ricerca è ridotta o
saltata (decisione del planner). Se il prompt cresce troppo, estrarre la guida in
`prompts/research-guide.md`.

## Criteri di accettazione

- Guida di ricerca (nel prompt o su file) che il planner segue.
- Flusso: ricevi richiesta → ricerca progetti simili → leggi i migliori → nuova
  sessione di grilling per rifinire → se esiste già una cosa identica, suggerisci
  riuso → proponi team+tooling → conferma.
- Ricerca opzionale in base al tipo di task.
- Nota: la ricerca web richiede un tool di ricerca (websearch/browser) disponibile
  al planner; se assente, il planner lo segnala e procede con lo scoping senza.

## Dipendenze

- Su ticket 08 (flusso planning); produce input per preflight (ticket 10).
