#!/usr/bin/env node
// Crea (idempotente) uno stub LOCALE minimo di @mariozechner/pi-tui dentro
// node_modules/, così extensions/orchestrator.ts può essere importato ed
// ESEGUITO per davvero da questo repo (scripts/smoke-test-watchdog.mjs,
// smoke-test-response-wakeup.mjs, smoke-test-worktree-cwd-guard.mjs,
// smoke-test-ticket-engine.mjs, e2e-full-flow.mjs) fuori dal runtime reale
// di `pi`, dove il pacchetto vero è invece disponibile — vedi Revisione 25
// in docs/mvp-notes.md per la spiegazione completa.
//
// PERCHÉ QUESTO SCRIPT ESISTE (Revisione 31): lo stub vive dentro
// node_modules/ (gitignored, MAI committato — sarebbe scorretto spacciare
// un pacchetto reale non nostro), quindi va ricreato dopo ogni `npm install`
// pulito (clone nuovo, CI, o — l'errore reale che ha portato a scrivere
// questo script — un `npm install` che rimuove uno stub creato a mano in
// precedenza perché non tracciato da package.json/package-lock.json).
// `@mariozechner/pi-coding-agent`, il secondo pacchetto runtime-only che
// extensions/orchestrator.ts referenzia, NON serve stubbarlo: è usato SOLO
// in un `import type {...}`, cancellato del tutto da
// `--experimental-strip-types` (zero uso a runtime, verificato leggendo ogni
// occorrenza nel file).
//
// Uso:
//   node scripts/setup-dev-stubs.mjs   (anche: npm run setup-dev-stubs)
// (va rilanciato ogni volta che node_modules viene ricreato da zero — non fa
// male rilanciarlo più volte, sovrascrive sempre lo stesso contenuto noto)
//
// ATTENZIONE — SOLO per lo sviluppo/test di QUESTO pacchetto: non lanciare
// mai questo script dentro un progetto scaffoldato da `po init` che userai
// per davvero con `pi`/`po start`. La risoluzione dei moduli Node preferisce
// SEMPRE il node_modules più vicino al file che fa l'import: se questo stub
// finisse nel node_modules di un progetto reale, "vincerebbe" sul pacchetto
// vero fornito dal runtime di `pi`, rompendo silenziosamente il rendering
// TUI reale (Text/visibleWidth/truncateToWidth naive, non la libreria vera).
// È sicuro SOLO qui, nel repo del pacchetto, perché qui extensions/orchestrator.ts
// non viene mai eseguito da un `pi` reale — solo dai test harness di questo repo.

import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const stubDir = path.join(packageRoot, "node_modules", "@mariozechner", "pi-tui");

const stubComment =
	'NOT a real published package — a minimal local stub so extensions/orchestrator.ts\'s ' +
	'import { Text, visibleWidth, truncateToWidth } from "@mariozechner/pi-tui" resolves under plain Node ' +
	"(outside the real pi runtime, where the real package is provided). Recreated by scripts/setup-dev-stubs.mjs " +
	"after every clean npm install — see docs/mvp-notes.md, Revisione 25 and Revisione 31, and " +
	"scripts/e2e-full-flow.mjs's header comment for why this exists and why it's safe: the code paths that use " +
	"Text/visibleWidth/truncateToWidth (renderPool/renderCall/renderResult, TUI rendering only) are never invoked " +
	"by any test harness in this repo, so a naive stub is sufficient — it only needs to make the import resolve, " +
	"not behave identically to the real widget-rendering package.";

const packageJson = `${JSON.stringify(
	{
		name: "@mariozechner/pi-tui",
		version: "0.0.0-local-stub",
		private: true,
		type: "module",
		main: "./index.mjs",
		_comment: stubComment,
	},
	null,
	2,
)}\n`;

const indexMjs = `// Local stub for @mariozechner/pi-tui — see package.json's "_comment" for why
// this exists. Naive on purpose: none of this is ever exercised at runtime
// by this repo's test harnesses (only referenced inside TUI render callbacks
// that are never invoked outside the real \`pi\` runtime).

export class Text {
	constructor(content, x = 0, y = 0) {
		this.content = content;
		this.x = x;
		this.y = y;
	}
}

// Naive width helpers — strip ANSI escape codes, then use string length.
// The real package presumably accounts for wide/combining characters too;
// not needed here since nothing in this repo's tests renders these strings.
const ANSI_PATTERN = /\\x1b\\[[0-9;]*m/g;

export function visibleWidth(s) {
	return String(s).replace(ANSI_PATTERN, "").length;
}

export function truncateToWidth(s, width) {
	const str = String(s);
	if (visibleWidth(str) <= width) return str;
	// Naive truncation on the raw string (not ANSI-aware) — acceptable here
	// since this path is never exercised by any test harness (see comment above).
	return str.slice(0, Math.max(0, width));
}
`;

fs.mkdirSync(stubDir, { recursive: true });
fs.writeFileSync(path.join(stubDir, "package.json"), packageJson);
fs.writeFileSync(path.join(stubDir, "index.mjs"), indexMjs);
console.log(`setup-dev-stubs: stub locale di @mariozechner/pi-tui scritto in ${stubDir}`);
