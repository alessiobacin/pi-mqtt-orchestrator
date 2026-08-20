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
- **A watchdog** that detects stalled tickets and automatically escalates them
- **Phased execution plans** — the planner declares which roles work together and in what order, and the system enforces it
- **WhatsApp notifications** (via Evolution API) when a task completes or needs your input, so you don't have to watch the terminal
- **A global `po` CLI** (`po init`, `po start`) for scaffolding and launching new orchestrated projects
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
npm install
copy .env.example .env   # optional: WhatsApp notifications

# MQTT broker — either works:
docker compose -f mqtt/compose.yaml up -d   # with Docker Desktop
# or, without Docker Desktop, native Mosquitto for Windows:
#   install from https://mosquitto.org/download/ (or `winget install EclipseFoundation.Mosquitto`)
#   then, in a separate window: mosquitto -c mqtt\mosquitto.conf

po start --instance planner-01
```

`po init` detects your OS automatically and prints the right commands either way.

## Quickstart

Scaffold a new project and start the planner:

```bash
mkdir url-shortener && cd url-shortener
po init --name "URL Shortener"
npm install
cp .env.example .env   # optional: WhatsApp notifications, fill in your Evolution API details
docker compose -f mqtt/compose.yaml up -d   # local MQTT broker
po start --instance planner-01
```

Then, in the planner's chat, describe what you want built:

```
Build a URL shortener with a REST API and a SQLite backend.
```

The planner will scope the task, propose a team and an execution plan, and — once you confirm — launch the other agents and get to work. Coder implements inside an isolated worktree; reviewer checks the result; the planner merges it into your main branch once it's approved, and reports back.

Other roles (coder, reviewer, and any specialist) are launched the same way, directly with the `pi` CLI once you know their instance name:

```bash
pi -e extensions/orchestrator.ts --instance coder-01 --role coder
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
prompts/                     system prompt for each role (planner, coder, reviewer, specialists)
agents/roles.yaml            per-role defaults and the specialist roster
agents/agents.yaml            example instance configuration
bin/po.mjs                   the `po` CLI (init/start)
scripts/                     CLI internals, dev tooling, and CI checks
skills-vendor/mattpocock/    vendored planner-only skills (wayfinder, to-spec) — see VERSION.md
mqtt/                        local Mosquitto broker config for development
docs/                        architecture diagrams and detailed development notes
.env.example                 WhatsApp notification configuration template
```

## Contributing

Contributions are welcome — open an issue or a pull request. `docs/mvp-notes.md` has the detailed engineering history and design rationale behind each part of the system, if you want the full context before diving in.

## License

[MIT](LICENSE)
