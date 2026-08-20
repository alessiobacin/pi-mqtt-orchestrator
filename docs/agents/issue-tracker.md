# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

Scelto esplicitamente per evitare qualunque dipendenza da GitHub Issues (o
GitLab) — nessun CLI `gh`/`glab` richiesto, nessun remote necessario. Vedi
`skills-vendor/mattpocock/VERSION.md` per il contesto completo di questa
scelta (Revisione 22 in `docs/mvp-notes.md`).

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state: non applicabile in questo repo — la skill `triage` di mattpocock/skills non è vendorizzata qui (solo `wayfinder`/`to-spec`/`grilling`/`domain-modeling`/`setup-matt-pocock-skills`, vedi `skills-vendor/mattpocock/VERSION.md`), quindi non esiste un vocabolario di label di triage da applicare
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/skill:wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

**Limite noto**: i tipi di ticket `research` e `prototype` non sono
risolvibili in questo repo — le skill corrispondenti non sono vendorizzate
(scelta deliberata, vedi `skills-vendor/mattpocock/VERSION.md`). Se una
mappa di wayfinder genera un ticket di uno di questi due tipi, il planner
lo segnala all'utente invece di tentare di risolverlo (vedi
`prompts/planner.md`).
