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

Decisione richiesta all'operatore: adottare sparse-checkout DENTRO il singolo
worktree adesso, e rimandare/trattare worktree-per-agente come progetto a sé (con
spec dedicata)? O vuole realmente il secondo subito?

Type: grilling
Blocked by:
Status:
