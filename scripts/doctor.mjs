#!/usr/bin/env node
// `po doctor` — verifica che l'ambiente abbia tutto il necessario per far
// girare pi-mqtt-orchestrator, e per ciò che manca stampa un'istruzione di
// installazione specifica per il sistema operativo rilevato
// (`process.platform`) invece di un'unica lista generica.
//
// PERCHÉ QUESTO SCRIPT ESISTE (Revisione 33): richiesto dall'operatore dopo
// un test reale su una macchina Windows nuova — l'unico modo per scoprire
// che mancava un prerequisito era un errore criptico più a valle (spesso
// dentro `pi` stesso, non dentro questo pacchetto). Questo script sposta
// quella scoperta all'inizio, prima che qualunque cosa venga lanciata.
//
// Verifica: Node.js (già garantito se questo script gira, ma la versione è
// comunque riportata), git (richiesto per l'isolamento in worktree), `pi`
// (richiesto per lanciare qualunque istanza — questo pacchetto non gestisce
// la sua installazione, vedi nota onesta sotto), e un modo per far girare un
// broker MQTT: Docker con il daemon attivo (per `docker compose`), OPPURE
// Mosquitto nativo sul PATH, OPPURE un broker già raggiungibile su
// 127.0.0.1:1883 (qualcuno potrebbe già averne uno acceso altrove).
//
// Uso:
//   node scripts/doctor.mjs   (anche: po doctor — e automaticamente in coda a `po init`)
//
// Nota onesta: questo script NON verifica che `pi`, una volta trovato sul
// PATH, sia della versione giusta o configurato correttamente — controlla
// solo che il comando risolva. Non installa nulla da solo: stampa solo cosa
// manca e come installarlo, la decisione e l'esecuzione restano
// all'operatore (evita di richiedere permessi di sistema/sudo a sua
// insaputa).

import { spawnSync } from "node:child_process";
import * as net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

function commandExists(cmd, args = ["--version"]) {
	try {
		const result = spawnSync(cmd, args, { stdio: "ignore", shell: process.platform === "win32" });
		// ENOENT (or a thrown error) means the executable itself wasn't found.
		// A non-zero exit code still means the executable IS there (it just
		// didn't like these args) — that still counts as "found".
		return !result.error || result.error.code !== "ENOENT";
	} catch {
		return false;
	}
}

function dockerDaemonRunning() {
	if (!commandExists("docker")) return false;
	const result = spawnSync("docker", ["info"], { stdio: "ignore", shell: process.platform === "win32", timeout: 5000 });
	return result.status === 0;
}

function tcpReachable(host, port, timeoutMs = 400) {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port });
		const done = (ok) => {
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => done(true));
		socket.once("timeout", () => done(false));
		socket.once("error", () => done(false));
	});
}

function osInstallHint(tool) {
	const platform = process.platform;
	const hints = {
		git: {
			darwin: "brew install git   (oppure installa Xcode Command Line Tools: xcode-select --install)",
			win32: "winget install Git.Git   (oppure https://git-scm.com/download/win)",
			linux: "sudo apt-get install -y git   (Debian/Ubuntu — su altre distro usa il tuo package manager: dnf, pacman, ecc.)",
		},
		docker: {
			darwin: "brew install --cask docker   (oppure scarica Docker Desktop da https://www.docker.com/products/docker-desktop — poi APRILO, il daemon deve essere in esecuzione)",
			win32: "winget install Docker.DockerDesktop   (poi APRI Docker Desktop — il daemon deve essere in esecuzione)",
			linux: "segui https://docs.docker.com/engine/install/ per la tua distribuzione, poi: sudo systemctl start docker",
		},
		mosquitto: {
			darwin: "brew install mosquitto   (poi: mosquitto -c mqtt/mosquitto.conf)",
			win32: "winget install EclipseFoundation.Mosquitto   (poi, in una finestra separata: mosquitto -c mqtt\\mosquitto.conf)",
			linux: "sudo apt-get install -y mosquitto   (Debian/Ubuntu — poi: mosquitto -c mqtt/mosquitto.conf)",
		},
	};
	return hints[tool]?.[platform] ?? hints[tool]?.linux ?? "vedi la documentazione ufficiale del progetto.";
}

// runDoctor({ cwd }) — cwd è usato solo per decidere se menzionare
// `docker compose -f mqtt/compose.yaml up -d` (ha senso solo se quel file
// esiste, cioè dentro un progetto scaffoldato o dentro questo pacchetto
// stesso). Ritorna { ok: boolean } — ok è false se manca `pi` o se non c'è
// NESSUN modo disponibile per far girare un broker MQTT; git mancante è
// segnalato ma non fa fallire il check da solo (serve solo per i worktree,
// alcuni usi read-only/di prova non lo richiedono subito).
export async function runDoctor({ cwd = process.cwd() } = {}) {
	console.log("po doctor — verifica ambiente\n");

	const rows = [];
	let ok = true;

	rows.push(["Node.js", true, process.version]);

	const hasGit = commandExists("git");
	rows.push(["git", hasGit, hasGit ? "trovato" : `non trovato — ${osInstallHint("git")}`]);

	const hasPi = commandExists("pi", ["--version"]);
	rows.push([
		"pi",
		hasPi,
		hasPi
			? "trovato"
			: "non trovato sul PATH — questo pacchetto non gestisce l'installazione di `pi` stesso: installalo secondo la documentazione della tua distribuzione di pi.",
	]);
	if (!hasPi) ok = false;

	const dockerOk = dockerDaemonRunning();
	const hasMosquitto = commandExists("mosquitto", ["-h"]);
	const brokerUp = await tcpReachable("127.0.0.1", 1883);

	if (brokerUp) {
		rows.push(["Broker MQTT", true, "già raggiungibile su 127.0.0.1:1883"]);
	} else if (dockerOk) {
		rows.push(["Docker", true, "installato e in esecuzione — usa: docker compose -f mqtt/compose.yaml up -d"]);
	} else if (hasMosquitto) {
		rows.push(["Mosquitto (nativo)", true, "trovato sul PATH — usa: mosquitto -c mqtt/mosquitto.conf"]);
	} else {
		const dockerInstalled = commandExists("docker");
		rows.push([
			"Broker MQTT",
			false,
			dockerInstalled
				? `Docker è installato ma il daemon non sembra in esecuzione — aprilo, oppure installa Mosquitto nativo: ${osInstallHint("mosquitto")}`
				: `nessun broker disponibile — installa Docker Desktop (${osInstallHint("docker")}) oppure Mosquitto nativo (${osInstallHint("mosquitto")})`,
		]);
		ok = false;
	}

	for (const [name, good, detail] of rows) {
		console.log(`  ${good ? "✓" : "✗"} ${name.padEnd(19)} ${detail}`);
	}
	console.log("");
	console.log(ok ? "Ambiente pronto." : "Manca almeno un prerequisito — vedi sopra prima di continuare.");
	return { ok };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
	runDoctor({ cwd: process.cwd() }).then(({ ok }) => process.exit(ok ? 0 : 1));
}
