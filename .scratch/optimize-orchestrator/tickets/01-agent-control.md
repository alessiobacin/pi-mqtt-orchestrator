# Ticket — Control/data plane: tool `agent_control`

- **Spec**: `../../spec.md` (Implementation Decisions: Control/data plane)
- **Riferimento decisione**: `../../issues/01-hardening-control-plane.md`

## Obiettivo

Introdurre in `extensions/orchestrator.ts` un tool `agent_control` distinto da
`agent_send`, che offra solo un set allowlisted di operazioni di controllo delle
istanze (`launch`, `interrupt`, `relaunch`), con postcondizione verificata per
ciascuna. La pianura dati (istruzioni di lavoro) resta su `agent_send`; la shell
arbitraria (herdr/tmux liberi) esce dal flusso principale del planner dove
applicabile, passando sotto questo gate.

## Criteri di accettazione

- `agent_control` accetta solo i verbi allowlisted; qualsiasi altro input è
  rifiutato con errore esplicito (mai testo/keys liberi).
- Ogni verbo è implementato con una postcondizione verificata (es. `launch` →
  l'istanza risulta online via `agent_list` in to tempo bound).
- Il prompt `planner.md` aggiornato per usare `agent_control` per le operazioni di
  controllo e `agent_send` per le istruzioni di lavoro.
- Esiste una definizione dell'allow-list dei comandi CLI in config (primo step
  verso la chiusura del rischio sezioni 25/40).
- Test: smoke test che verifica rifiuto di verbo non allowlisted e ok di uno
  allowlisted su stub.

## Dipendenze

- Nessuna (può partire in parallelo con gli altri ticket di hardening).
