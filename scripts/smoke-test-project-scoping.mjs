// REAL functional test of resolveDefaultProject() / the `--project` MQTT
// topic-scope default (Revisione 38, see docs/development-notes.md) — a
// real incident: the operator scaffolded a second project and, without
// ever passing `--project`, its planner immediately saw the FIRST
// project's agents on the same local broker, because `--project` used to
// default to the literal string "default" for every scaffolded project.
//
// This dynamically imports the REAL extensions/orchestrator.ts (same
// node --experimental-strip-types loader as check-syntax.mjs/e2e-full-flow.mjs)
// and drives it through a real session_start against a real local mosquitto
// broker — never a hand-copied mirror of the resolution logic — then reads
// back the ACTUAL retained MQTT status topic each instance published to,
// which encodes the resolved project value directly
// (`pi/<project>/agents/<instance>/status`). That is the one place the
// resolved value is externally observable without reaching into the
// module's closure-private `identity`/`T` state.
//
// Covers:
//   1. Cross-project isolation — two scratch projects, distinct package.json
//      names, neither passes --project: their resolved topic prefixes must
//      differ (the actual regression).
//   2. The fallback priority chain: config/project.json > package.json >
//      slugify(basename(cwd)) > "default", and that an explicit --project
//      always wins over all of them, unslugified.
//
// Usage: node --experimental-strip-types scripts/smoke-test-project-scoping.mjs

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import mqtt from "mqtt";

const PROJECT_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const BROKER_URL = process.env.PI_ORCH_BROKER_URL || "mqtt://127.0.0.1:1883";

let PASS = 0;
function ok(cond, msg) {
	if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
	PASS++;
	console.log(`   OK — ${msg}`);
}

// Mirrors extensions/orchestrator.ts's own slugify() (kept as an
// independent copy on purpose — see that file's comment on why it can't
// import scripts/create-project.mjs's version; this test needs its own
// expectation-computing copy for the same reason a mirror smoke test would).
function slugify(s) {
	return (
		s
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 60) || "progetto"
	);
}

// ━━ Minimal fake pi/ctx harness (trimmed from e2e-full-flow.mjs's — this
// test only ever needs session_start, never a tool call) ━━━━━━━━━━━━━━━━━

function makeFakePi(flagValues) {
	const hooks = new Map();
	const appendedEntries = [];
	const pi = {
		registerFlag() {},
		getFlag(name) {
			return flagValues[name];
		},
		registerTool() {},
		on(event, handler) {
			hooks.set(event, handler);
		},
		registerCommand() {},
		appendEntry(kind, data) {
			appendedEntries.push({ kind, data });
		},
		sendMessage() {},
	};
	return { pi, hooks, appendedEntries };
}

function makeCtx(cwd) {
	return {
		cwd,
		hasUI: false,
		ui: undefined,
		sessionManager: { getBranch() { return []; } },
	};
}

class FakeInstance {
	constructor(flagValues, cwd) {
		this.flagValues = flagValues;
		this.cwd = cwd;
		this.harness = makeFakePi(flagValues);
		this.ctx = makeCtx(cwd);
	}

	async start() {
		const modUrl = pathToFileURL(path.join(PROJECT_ROOT, "extensions", "orchestrator.ts")).href;
		// Fresh import() per instance so each gets its own closure-scoped
		// module state (extensions/orchestrator.ts default-exports a function
		// with no top-level mutable `let` — verified by e2e-full-flow.mjs's
		// own comment on this — but importing the SAME url is cached by
		// Node's module system, so re-invoking mod.default() per instance,
		// same as e2e-full-flow.mjs does, is what actually isolates them, not
		// a fresh import).
		if (!FakeInstance._modPromise) FakeInstance._modPromise = import(modUrl);
		const mod = await FakeInstance._modPromise;
		mod.default(this.harness.pi);
		const sessionStart = this.harness.hooks.get("session_start");
		if (!sessionStart) throw new Error("session_start hook not registered");
		await sessionStart({}, this.ctx);
		const deadline = Date.now() + 8000;
		while (Date.now() < deadline) {
			if (this.harness.appendedEntries.some((e) => e.data?.event === "connected")) return this;
			await new Promise((r) => setTimeout(r, 50));
		}
		throw new Error(`never saw MQTT "connected" event within 8s — is mosquitto running on ${BROKER_URL}?`);
	}

	async shutdown() {
		const hook = this.harness.hooks.get("session_shutdown");
		if (hook) await hook({}, this.ctx);
	}
}

function scratchDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

// Starts `instance` in `cwd` (no --project unless projectFlag given), then
// watches a fresh raw MQTT subscriber on `pi/#` for the FIRST retained
// status message whose topic matches `pi/<anything>/agents/<instance>/status`
// — returns the `<anything>` segment actually used, i.e. the real resolved
// project value, straight from the wire.
async function resolvedProjectFor(cwd, instance, projectFlag) {
	const observer = await mqtt.connectAsync(BROKER_URL, { protocolVersion: 5 });
	await observer.subscribeAsync("pi/+/agents/+/status");
	let resolved = null;
	const seen = new Promise((resolve) => {
		observer.on("message", (topic) => {
			const m = topic.match(/^pi\/(.+)\/agents\/([^/]+)\/status$/);
			if (m && m[2] === instance) {
				resolved = m[1];
				resolve();
			}
		});
	});

	const flagValues = {
		instance,
		role: "planner",
		broker: BROKER_URL,
	};
	if (projectFlag !== undefined) flagValues.project = projectFlag;

	const fi = new FakeInstance(flagValues, cwd);
	await fi.start();
	await Promise.race([seen, new Promise((_, rej) => setTimeout(() => rej(new Error(`never saw a status publish for "${instance}" within 8s`)), 8000))]);
	await fi.shutdown();
	await observer.endAsync();
	return resolved;
}

async function main() {
	console.log("\n=== TEST 1 — cross-project isolation (the real regression) ===");
	const dirAlpha = scratchDir("moa-scope-alpha");
	const dirBeta = scratchDir("moa-scope-beta");
	fs.writeFileSync(path.join(dirAlpha, "package.json"), JSON.stringify({ name: "alpha-widgets" }, null, 2));
	fs.writeFileSync(path.join(dirBeta, "package.json"), JSON.stringify({ name: "beta-widgets" }, null, 2));

	const projectAlpha = await resolvedProjectFor(dirAlpha, "planner-01", undefined);
	const projectBeta = await resolvedProjectFor(dirBeta, "planner-01", undefined);
	ok(projectAlpha === "alpha-widgets", `alpha project resolves to its own package.json name (got "${projectAlpha}")`);
	ok(projectBeta === "beta-widgets", `beta project resolves to its own package.json name (got "${projectBeta}")`);
	ok(projectAlpha !== projectBeta, "the two projects resolve to DIFFERENT MQTT topic scopes — no cross-talk");

	console.log("\n=== TEST 2 — fallback priority chain ===");

	// 2a. Nothing at all (no package.json, no config/project.json) -> falls
	// back to slugify(basename(cwd)).
	const dirBare = scratchDir("moa-scope-bare");
	const projectBare = await resolvedProjectFor(dirBare, "planner-01", undefined);
	ok(projectBare === slugify(path.basename(dirBare)), `no package.json/config -> slugify(basename(cwd)) (got "${projectBare}")`);

	// 2b. Only package.json -> its "name" wins.
	const dirPkgOnly = scratchDir("moa-scope-pkg");
	fs.writeFileSync(path.join(dirPkgOnly, "package.json"), JSON.stringify({ name: "pkg-only-slug" }, null, 2));
	const projectPkgOnly = await resolvedProjectFor(dirPkgOnly, "planner-01", undefined);
	ok(projectPkgOnly === "pkg-only-slug", `package.json name alone wins over the directory name (got "${projectPkgOnly}")`);

	// 2c. Both config/project.json AND package.json -> config/project.json
	// wins (the operator's own chosen name, possibly renamed since scaffold —
	// see moaEnsureWorkspace's projectNameOverride), slugified since it may
	// contain spaces.
	const dirBoth = scratchDir("moa-scope-both");
	fs.writeFileSync(path.join(dirBoth, "package.json"), JSON.stringify({ name: "other-slug-should-lose" }, null, 2));
	fs.mkdirSync(path.join(dirBoth, ".pi", "extensions", "multiAgentOrchestrator", "config"), { recursive: true });
	fs.writeFileSync(
		path.join(dirBoth, ".pi", "extensions", "multiAgentOrchestrator", "config", "project.json"),
		JSON.stringify({ schema_version: 1, extension_version: "test", project: "Human Chosen Name", created_at: "x", updated_at: "x" }, null, 2),
	);
	const projectBoth = await resolvedProjectFor(dirBoth, "planner-01", undefined);
	ok(projectBoth === slugify("Human Chosen Name"), `config/project.json wins over package.json, slugified (got "${projectBoth}")`);

	// 2d. Explicit --project always wins over everything, verbatim (no
	// slugify applied — matches the pre-Revisione-38 override behavior).
	const projectExplicit = await resolvedProjectFor(dirBoth, "planner-02", "Explicit-Override-Value");
	ok(projectExplicit === "Explicit-Override-Value", `explicit --project always wins, unslugified (got "${projectExplicit}")`);

	console.log(`\n${PASS} assertions passed.`);
}

main()
	.then(() => {
		console.log("PROJECT SCOPING SMOKE TEST PASSED");
		process.exit(0);
	})
	.catch((err) => {
		console.error("\nPROJECT SCOPING SMOKE TEST FAILED:", err);
		process.exit(1);
	});
