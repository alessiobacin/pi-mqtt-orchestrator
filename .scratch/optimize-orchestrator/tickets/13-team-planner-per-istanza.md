# Ticket — Team planner-per-istanza (doc + test)

- **Spec**: `../../spec.md` (Implementation Decisions: Team planner-per-istanza)
- **Riferimento decisione**: `../../issues/14-team-planner-per-istanza.md`

## Obiettivo

Assicurare (e provare) che istanze planner diverse nello stesso progetto possano
avere team diversi. Già supportato: `resolveCapabilities` risolve `teams` per
istanza (INSTANCE>ROLE, voce `agents.yaml`), i topic team sono per-progetto.
Scopo: documentare il comportamento, aggiungere un test con due istanze planner
con team diversi che non si "vedono" in topic di team diversi, e assicurarsi che
`launch-planner.mjs`/`po start` non forzino un team unico.

## Criteri di accettazione

- Documentato (mvp-notes/architecture) che team è per-istanza e per-progetto.
- Test: due istanze planner nello stesso progetto con team diversi risolvono team
  distinti e non si notificano eventi su canali team non condivisi.
- `po start`/`launch-planner.mjs` non sovrascrivono il team dell'istanza: l'istanza
  deriva il proprio da config, e un eventuale flag team è opzionale/override.

## Dipendenze

- Nessuna strutturale.
