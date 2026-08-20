# AGENTS.md

Pi carica questo file automaticamente all'avvio di ogni istanza (planner,
coder, reviewer, specialisti) in questo repo — vedi `docs/mvp-notes.md` per
il contesto completo del progetto e `README.md` per il funzionamento
generale.

## Agent skills

Scritto da `/skill:setup-matt-pocock-skills` (Revisione 22 — vedi
`docs/mvp-notes.md`), eseguita in una sessione planner per configurare le
skill vendorizzate `wayfinder`/`to-spec` (vedi `skills-vendor/mattpocock/`).

### Issue tracker

Local markdown files under `.scratch/<feature-slug>/` — nessuna dipendenza
da GitHub/GitLab Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` alla radice del repo, creati
lazily quando servono davvero (nessuno dei due esiste ancora oggi). See
`docs/agents/domain.md`.
