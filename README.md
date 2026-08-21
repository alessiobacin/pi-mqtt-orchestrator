# pi-mqtt-orchestrator

[![CI](https://github.com/alessiobacin/pi-mqtt-orchestrator/actions/workflows/ci.yml/badge.svg)](https://github.com/alessiobacin/pi-mqtt-orchestrator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A multi-agent orchestration extension for [Pi](https://github.com/badlogic/pi-mono). It coordinates a **planner**, a **coder**, a **reviewer**, and an optional roster of specialist agents over MQTT 5, isolates every unit of work in its own git worktree, tracks execution through a persistent ticket/DAG layer, and can notify you over WhatsApp when something finishes or needs your attention.

## Overview

You describe a goal to the planner. It scopes the work, breaks it into tickets, and assigns them to a coder — each task runs inside its own isolated git worktree, so nothing touches your main branch until it's actually done. A reviewer checks the result, runs the project's own test suite, and either sends it back for fixes or approves it. Once approved, the planner merges the work into your main branch and reports back — automatically parallelizing across the roster of specialist roles (security review, documentation, CI/CD, accessibility, and more) when a task calls for it, and picking up again on its own if an agent gets stuck.

Everything communicates over a local MQTT broker, using role/instance identity and presence instead of a flat peer-to-peer chat — so any agent can reach any other by role or by name, and you can watch the whole team work from your terminal.

## Features

- **Role-based multi-agent coordination** over MQTT 5 — planner, coder, reviewer, and 23 optional specialist roles (TDD, mutation testing, security review, Kubernetes, CI/CD, accessibility, documentation sync, architecture diagrams, and more)
- **Git worktree isolation** — every task runs in its own worktree; your main branch is only ever touched by a clean, reviewed merge
- **A persistent ticket/DAG layer** (SQLite-backed) that tracks runs, specs, and tickets across restarts
- **A watchdog** that detects stalled tickets, runs that finished all their tickets but were never merged/notified, *and* tickets whose assigned instance has confirmably vanished (offline presence, not just slow) — the last case is auto-failed and escalated within a couple of minutes, not 15-30
- **`agent_terminate`** lets the planner force a clean shutdown of a wedged instance instead of waiting it out — with an opt-in fully automatic tier for hard-stuck-but-connected tickets
- **`agent_send` warns immediately, in the same turn, if nobody is actually there to receive it** — instead of silently reporting success when a role/instance was never launched
- **The planner is structurally barred from claiming ticket work itself** (`ticket_claim` refuses the planner role outright) — planning and delegating is the job, never quietly doing the work when an instance is missing
- **A mandatory closing checklist**: `worktree_finalize` refuses to merge until you declare the user actually confirmed the result, e2e tests ran (or don't apply), and the version was bumped (or doesn't apply) — and now pushes to the remote automatically after a successful merge
- **Phased execution plans** — the planner declares which roles work together and in what order, and the system enforces it
- **WhatsApp notifications** (via Evolution API) when a task completes or needs your input, so you don't have to watch the terminal
- **A global `po` CLI** (`po init`, `po start`, `po doctor`, `po update`, `po uninstall`, `po end`) for scaffolding, launching, verifying the environment, keeping new orchestrated projects up to date, and closing them out
- **Automatic per-project MQTT scoping** — two different projects never collide on a shared broker without you having to pass `--project` yourself
- **Cross-platform** — macOS, Linux, and Windows

## Installation

Install as a Pi extension:

```bash
pi extension install https://github.com/alessiobacin/pi-mqtt-orchestrator
```

This also installs the `po` CLI, which you'll use to scaffold and launch orchestrated projects. If you're installing directly from a clone instead:

```bash
npm install -g .
```

### Windows

Works the same way from PowerShell — no WSL required, just Node.js 18+ and Git for Windows:

```powershell
npm install -g .

mkdir url-shortener; cd url-shortener
po init --name "URL Shortener"
copy .env.example .env   # optional: WhatsApp notifications

# MQTT broker — either works:
docker compose -f mqtt/compose.yaml up -d   # with Docker Desktop
# or, without Docker Desktop, native Mosquitto for Windows:
#   install from https://mosquitto.org/download/ (or `winget install EclipseFoundation.Mosquitto`)
#   then, in a separate window: mosquitto -c mqtt\mosquitto.conf

po start --instance planner-01
```

`po init` detects your OS automatically and prints the right commands either way, and finishes by running `po doctor` for you — a quick check that git, `pi`, and an MQTT broker are all available, with OS-specific install hints for anything that's missing. Run it again any time with `po doctor`.

### Keeping `po` up to date

```bash
po update           # reinstall the global package from the latest GitHub main
po update --check   # just check whether an update is available, without installing
po uninstall        # remove the global installation (asks for confirmation; add --yes to skip it)
```

`po update` updates both places the extension can live: the global npm package (`npm install -g` against this repo's GitHub URL) and, if present, the separate clone `pi extension install` keeps under `~/.pi/agent/git/github.com/<owner>/<repo>` (a plain `git pull`). `po uninstall` removes both the same way, asking a separate confirmation for the second one.

**If you scaffolded a project with an older `po init`** (one that still copied `extensions/` into new projects), that project directory may have its own leftover `extensions/orchestrator.ts`. `po start` detects this and simply ignores it, relying on the globally-installed extension instead — it prints a note pointing this out, but the leftover folder no longer causes `pi` to fail with `Tool "..." conflicts with ...`/`Flag "..." conflicts with ...` (a real bug in that detection, fixed — it used to warn about the impending crash and then cause it anyway). The folder is inert at that point; delete it whenever convenient (`rm -rf extensions` / `Remove-Item -Recurse -Force extensions`) — nothing needs it once the extension is installed globally.

**If you scaffolded a project before this change**, its root-level `reports/`, `prompts/`, and `logs/` folders (development artifacts of working with this extension — task reports, role prompts, per-instance debug traces) were tracked by git like any other file, right alongside your actual application code. As of `po init --llmp`/plain `po init`, all three now live under the already-gitignored `.pi/extensions/multiAgentOrchestrator/` instead, so they never end up in a public push by default. Nothing migrates automatically for an existing project — if you want the same treatment there, `git rm -r --cached reports prompts logs` (whichever exist) and move their contents under `.pi/extensions/multiAgentOrchestrator/{reports,prompts,logs}` by hand; if any of them were already pushed to a public remote, removing them from tracking going forward does not erase that history — see `docs/development-notes.md`, Revisione 37, if you need to scrub it from a remote that's already public.

### Closing out a project

```bash
po end                       # list this project's "active" runs and, on confirmation, mark them "completed"
po end --list                # just list them, no changes
po end --run <run_id>        # close one specific run instead of every active one
po end --status cancelled    # mark as cancelled instead of completed (also accepts "failed")
po end --yes                 # skip the confirmation prompt
```

A run (the ticket/DAG layer's top-level container for one objective — see "Layer ticket/DAG persistente" in `docs/development-notes.md`, Revisione 26) normally closes itself once every one of its tickets is marked done. `po end` is for when that doesn't happen — a session ended before every ticket was formally completed, the goal changed, or you're simply satisfied with where things landed and want to declare it done. It never touches tickets, worktrees, or any file outside this project's own `orchestrator.db` — closing a run just changes its own status and records the change in its event history, visible later via `run_status` from inside a planner session.

### Optional: local llmproxy config

If you run `pi` against a local LLM proxy instead of a cloud provider directly, `po init --llmp` also writes `.pi/agent/models.json` and `.pi/agent/settings.json` in the scaffolded project, pre-configured for a proxy listening on `http://127.0.0.1:7045` (provider `llmproxy`, dark theme). It won't overwrite either file if it already exists — pass `--force` too if you want to reset them back to these defaults.

## Quickstart

Scaffold a new project and start the planner:

```bash
mkdir url-shortener && cd url-shortener
po init --name "URL Shortener"
cp .env.example .env   # optional: WhatsApp notifications, fill in your Evolution API details
docker compose -f mqtt/compose.yaml up -d   # local MQTT broker
po start --instance planner-01
```

Then, in the planner's chat, describe what you want built:

```
Build a URL shortener with a REST API and a SQLite backend.
```

The planner will scope the task, propose a team and an execution plan, and — once you confirm — launch the other agents and get to work. Coder implements inside an isolated worktree; reviewer checks the result; the planner merges it into your main branch once it's approved, and reports back.

Other roles (coder, reviewer, and any specialist) are launched the same way, directly with the `pi` CLI once you know their instance name — no `-e` flag needed, since the extension auto-loads once installed:

```bash
pi --instance coder-01 --role coder
```

## Configuration

WhatsApp notifications are optional and configured via `.env` (see `.env.example`):

| Variable | Description |
| --- | --- |
| `EVOLUTION_API_URL` | Base URL of your [Evolution API](https://github.com/EvolutionAPI/evolution-api) instance |
| `EVOLUTION_API_KEY` | API key for your Evolution API instance |
| `EVOLUTION_INSTANCE` | Your Evolution API instance name |
| `DESTINATION_PHONE_NUMBER` | Phone number to notify (with country code) |

Without a `.env`, the extension runs normally — notifications are simply skipped.

## Project layout

```
extensions/orchestrator.ts   the Pi extension itself — identity, MQTT, tools, prompts
prompts/                     system prompt for each role (planner, coder, reviewer, specialists) —
                              the source copy; `po init` copies it into every scaffolded project's
                              own .pi/extensions/multiAgentOrchestrator/prompts/, not its root
agents/roles.yaml            per-role defaults and the specialist roster
agents/agents.yaml            example instance configuration
bin/po.mjs                   the `po` CLI (init/start/doctor/update/uninstall)
scripts/                     CLI internals, dev tooling, and CI checks
skills-vendor/mattpocock/    vendored planner-only skills (wayfinder, to-spec) — see VERSION.md
mqtt/                        local Mosquitto broker config for development
docs/                        architecture diagrams and detailed development notes
.env.example                 WhatsApp notification configuration template
```

## Contributing

Contributions are welcome — open an issue or a pull request. `docs/development-notes.md` has the detailed engineering history and design rationale behind each part of the system, if you want the full context before diving in.

## License

[MIT](LICENSE)
