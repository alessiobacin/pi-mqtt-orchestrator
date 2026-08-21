# Ticket — CLI `po`: comandi completi

- **Spec**: `../../spec.md` (Implementation Decisions: CLI po completa)
- **Riferimento decisione**: `../../issues/12-cli-po-comandi.md`

## Obiettivo

Aggiungere a `bin/po.mjs` i comandi: `status`, `gantt`/`web`, `logs`,
`provision`/`deps`, `fleet`, `mcp`, `skills`, `doctor --network` (accanto a
init/start/doctor/update/uninstall/`end` già esistenti). Ciascuno delega a uno
script in `scripts/`, output coerente e cross-platform, testabile da CLI.

## Criteri di accettazione

- Ogni comando esiste e ha `--help` in po.
- `po status`: stato run/ticket/fleet da terminale.
- `po gantt`/`po web`: avvia/apre la vista web (ticket 11).
- `po logs [instance]`: tail dei log di un'istanza.
- `po deps`/`provision`: esegue il capability-probe (ticket 10 / issue 13).
- `po fleet`: lista agenti live dal broker (agent_list).
- `po mcp`: mostra MCP/skills per agente/ruolo.
- `po skills`: mostra skill per agente/ruolo.
- `po doctor --network`: verifica raggiungibilità broker e integ.
- Test: output dei comandi su fixture/segnale reale.

## Dipendenze

- `gantt`/`web` → ticket 11; `deps`/`provision` → ticket 10; `fleet` → agent_list
  già presente; `logs` → directory logs esistente.
Status: implemented + tested OK
