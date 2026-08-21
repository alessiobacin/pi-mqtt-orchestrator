## Question

Il punto più delicato. L'operatore propone di usare **sparse-checkout** per
evitare duplicazione/spazio e passare a **un worktree per agente**, con un agente
delegato al merge di tutti i worktree nella repo principale.

Il pregresso (Revisione 24) dice: la feature "codice fiscale" finì su 3 worktree
separati con merge caotico; la filosofia attuale è ONE worktree-per-task condiviso
+ `file_claim`/`file_release` per il parallelismo, e `worktree_finalize` /
`worktree_abandon` con guardie anti-tangle (blocco su main sporco, `.worktrees`
nella cwd).

Dunque:
- **Sparse-checkout nel singolo worktree di task**: sì, additive, riduce il
  checkout, zero impatto sul merge — da adottare.
- **Worktree-per-agente + merge-agent**: è un cambio architetturale profondo che
  introduce N worktree/branch da integrare e un nodo di merge nuovo (rischio
  conflitti su tree/file spostati). Da fare solo se il parallelismo reale richiede
  davvero collisioni zero.

Decisione (operatore, 2026-08-21): si mantiene il sistema attuale — SINGOLO
worktree condiviso per task + blocco file (`file_claim`/`file_release`) per il
parallelismo. È PIÙ efficiente: un solo worktree per task = meno spazio di un
worktree-per-agente. Worktree-per-agente + merge-agent NON si fanno in questa
ottimizzazione: restano concetto documentato per il futuro. sparse-checkout è
ottimizzazione additiva del singolo worktree (riduce checkout senza impatto merge):
opzionale, bassa priorità, non bloccante.

Type: grilling
Blocked by:
Status: resolved

## Answer

Scelta dell'operatore: restare sul singolo worktree condiviso per task con blocco
file. sparse-checkout = ottimizzazione opzionale additiva (bassa priorità). Nessun
cambio architetturale sul modello di worktree in questa ottimizzazione.
