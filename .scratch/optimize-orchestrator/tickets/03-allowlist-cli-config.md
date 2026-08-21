# Ticket — Allow-list comandi CLI (config)

- **Spec**: `../../spec.md` (Implementation Decisions: Control/data plane)
- **Riferimento decisione**: `../../issues/01-hardening-control-plane.md`

## Obiettivo

Definire e applicare una allow-list dei comandi CLI che le istanze/il planner
possono eseguire (sezioni 25/40 come rischio aperto). Applicata a livello di
wrapper/script, non lasciata alla disciplina del prompt.

## Criteri di accettazione

- Una config (es. `config/allowed-cli.json` o campo in config del progetto) elenca
  i pattern di comando sicuri e le CLI consentite per ruolo.
- Il wrapper di esecuzione dei comandi verifica il pattern prima di eseguire;
  un comando fuori allow-list viene rifiutato con errore.
- Documentato come chiudere/bilanciare questo rischio; compatibile con capacità già
  dichiarate in `roles.yaml` (cli per ruolo).
- Test: allowed vs denied su fixture.

## Dipendenze

- Si appoggia a `agent_control` (ticket 01) per il routing dei comandi dove
  applicabile.

Status: implemented + tested OK
