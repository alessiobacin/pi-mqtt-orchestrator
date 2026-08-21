# Spec — Ottimizzazione multiAgentOrchestrator

Riferimento: mappa wayfinder in `../map.md`, decision tickets in `../issues/`.
Tutti i file di questo df (`spec.md`, `tickets/`, `issues/`) sono artefatti del
repo `pi-mqtt-orchestrator` (l'estensione stessa), NON run dell'orchestratore.

## Problem Statement

Dal punto di vista dell'operatore: multiAgentOrchestrator funziona ma ha punti
deboli emersi anche dal confronto con firstmate — supervisione costosa (watchdog
che sveglia un turno LLM), errori di scoping dovuti a skill mancanti o procedure
non esplicite, assenza di un flusso di planning che faccia ricerca web e verifichi
credenziali/CLI prima di lanciare il team, nessuna vista live dello stato dei
lavori, e comandi `po` incompleti. L'operatore vuole un insieme coerente di
miglioramenti senza cambi architetturali rischiosi sul modello di worktree.

## Solution

Un insieme di ottimizzazioni in 5 sotto-aree che si integrano con l'esistente
(estension `extensions/orchestrator.ts`, CLI `bin/po.mjs`, `prompts/planner.md`,
roster `agents/roles.yaml`, layer ticket/DAG SQLite, broker MQTT 5):

1. **Hardening autorità/controllo**: separare control plane e data plane (tool
   `agent_control` con allow-list vs `agent_send`), definire l'allow-list dei
   comandi CLI, e introdurre un gate di approvazione umana DUREVOLE
   (`human_approval`) minimale via SQLite.
2. **Supervisione a costo zero**: watcher bash zero-token che rileva lo stall
   (polling SQLite/MQTT) e sveglia il planner solo su vero stall; segnali
   semantici per distinguere "ragiona" da "bloccato" (verifica SDK pi, fallback
   su ultima tool-call); riconciliazione all'avvio reale e testata (coda+lock+
   generazione); away-mode costruito sul watcher.
3. **Flusso di planning Matt Pocock + ricerca + credenziali**: il planner usa in
   ordine wayfinder→grilling→to-spec→to-tickets (con fallback integrato se le
   skill mancano); fa ricerca web di progetti simili e dei tool migliori per ogni
   agente del team (DENTRO il planner, non ruolo nuovo); preflight di
   credenziali/CLI/MCP con script dinamico (`po deps`) e gate `human_approval`;
   produce un documento esaustivo delle cose da fare elencate una a una.
4. **Osservabilità**: gantt live web (dati da SQLite + eventi MQTT via websocket).
5. **CLI `po` completa**: `status`, `gantt`/`web`, `logs`, `provision`/`deps`,
   `fleet`, `mcp`, `skills`, `doctor --network` (accanto a init/start/doctor/
   update/uninstall/end). Più doc+test per il team planner-per-istanza.

Il modello di worktree NON cambia: resta il singolo worktree condiviso per task +
blocco file. Worktree-per-agente/merge-agent e secondmate: rimandati, non in
scope.

## User Stories

1. Come operatore, voglio che il planner separi i comandi di controllo dalle
   istruzioni di lavoro, così da non poter lanciare/fermare istanze tramite
   testo libero o shell arbitraria.
2. Come operatore, voglio un gate di approvazione umana durevole che sopravviva
   a un riavvio, così da poter approvare/differire decisioni sensibili in modo
   verificabile e non solo "perché il planner se lo ricorda".
3. Come operatore, voglio che lo stall dei ticket venga rilevato senza consumare
   token LLM, svegliando il planner solo quando serve davvero una decisione.
4. Come operatore, voglio distinguere "l'agente sta ancora ragionando" da "è
   bloccato a metà turno", usando segnali il più possibile semantici invece di
   una sola soglia di tempo.
5. Come operatore, voglio che al riavvio il sistema riconcili lo stato (eventi/
   ticket) in modo idempotente, senza riapplicare eventi vecchi, con test che lo
   dimostrino.
6. Come operatore, voglio una modalità "away" che assorba le notifiche di
   routine e raggiunga WhatsApp solo per le decisioni vere, senza un LLM extra.
7. Come operatore, voglio che il planner segua un flusso di scoping esplicito
   (wayfinder→grilling→to-spec→to-tickets) e, se le skill vendored mancano, abbia
   comunque un metodo di scoping integrato invece di restare a mani vuote.
8. Come operatore, voglio che il planner, su task che lo meritano, cerchi online
   progetti simili e i tool/MCP/skill migliori per ciascun agente del team, e me
   li proponga insieme alla conferma del team.
9. Come operatore, voglio che prima di lanciare il team il planner preveda quali
   credenziali/CLI/MCP servono, verifichi cosa c'è con uno script, e mi chieda —
   con istruzioni esatte — se devo fornirle subito (aspettando) o in parallelo
   (verifica man mano), bloccando finché non è ok.
10. Come operatore, voglio un documento esaustivo (checklist una-per-una) di
    tutte le attività da fare, la loro ownership, e le dipendenze, generato dal
    flusso di planning.
11. Come operatore, voglio una vista gantt web LIVE di cosa sta succedendo (chi fa
    cosa, in quale fase, stato), aggiornata in tempo reale dagli eventi MQTT.
12. Come operatore, voglio la CLI `po` completa per operare lo stato, i log, la
    gantt, la verifica delle dipendenze/credenziali, la fleet, MCP e skills senza
    aprire una sessione dialogica.
13. Come operatore con più planner, voglio che ogni istanza planner nello stesso
    progetto possa avere il proprio team, senza che po start/launch forzi un team
    unico.
14. Come operatore, voglio che questi miglioramenti siano accompagnati da test
    (smoke/unit/e2e dove appropriato) e dalla risoluzione dei rischi aperti
    documentati (allow-list, credenziali, riconciliazione).

## Implementation Decisions

- **Control/data plane**: nuovo tool `agent_control` in `extensions/orchestrator.ts`
  distinto da `agent_send`, con un set allowlisted di operazioni
  (`launch`, `interrupt`, `relaunch`). La superficie di comando è limitata a verbi
  noti con postcondizione verificata, mai testo/keys liberi. La shell arbitraria
  (herdr/tmux) esce dal flusso principale del planner e passa sotto questo gate
  dove applicabile; l'allow-list CLI dei comandi ammessi è definita in config.
- **`human_approval` durevole**: tabella SQLite `decision_holds` (id, ticket_id,
  question, status, opened_at, resolved_at, resolved_by) nel layer ticket/DAG.
  Un nodo `type: human_approval` diventa gestibile: il planner può aprire un hold,
  l'operatore lo risolve esplicitamente l'operatore registro; sopravvive ai
  riavvii. Forma minima ora, Scheduler Engine completo rimandato.
- **Watcher bash zero-token**: script bash `scripts/watcher.sh` che (a) polla
  SQLite `tickets` per i `running` oltre soglia e/o legge retained MQTT via
  `mosquitto_sub`, (b) su vero stall pubblica un evento di watchdog e un wake al
  planner (canale già esistente del `[watchdog]`), (c) è singleton via lock. Si
  affianca/sostituisce il watchdog in-process (Revisione 29) per il rilevamento; il
  djudizio "lento vs bloccato" resta al planner col ping tool esistente.
- **Segnali semantici**: verifica preliminare se l'SDK di pi espone eventi di ciclo
  di vita del turno. Se sì, agganciarli; se no, usare l'ultima tool-call di
  successo (tracciata dagli eventi) come proxy, combinata col heartbeat "working".
  La soglia di tempo resta come fallback, non unica.
- **Riconciliazione all'avvio**: coda durevole di eventi non ackati + lock singleton
  + generazione/ack (un evento una volta sola), sul pattern firstmate, mappata su
  SQLite+retained MQTT. Copertura di test obbligatoria prima di considerarla chiusa.
- **Away-mode**: costruito sul watcher (router notifiche). In `away`, routine
  assorbite; solo decisioni vere (stall, human_approval, conflitti merge) vanno su
  WhatsApp. Filtro in pura logica (bash/regole), nessun LLM extra.
- **Flusso planning planner**: il prompt del planner esplicita l'ordine
  wayfinder→grilling→domain-modeling→to-spec→to-tickets per task grandi/ambigui,
  domande dirette per task piccoli. Se le skill vendorizzate mancano (caso v.38),
  scattare il metodo di scoping integrato; non restare a mani vuote. to-tickets NON
  è una skill vendored: è il passo in cui il planner produce i file ticket.
- **Ricerca web nel planner**: nessun ruolo dedicato. Il planner, su task che lo
  meritano, consulta una guida di ricerca (estrattibile su file:
  `prompts/research-guide.md` se il prompt cresce troppo), esamina progetti simili
  e i tool migliori per ogni ruolo, propone team+tooling e chiede conferma. Per
  task banali/non-dev la ricerca è ridotta o saltata (decisione del planner).
- **Preflight credenziali + script dinamico**: script `scripts/po deps` /
  capability-probe (fuso in `po deps`), che controlla: variabili `.env` attese,
  `gh auth status`, `which <cli>`, MCP server raggiungibili, ecc., e produce una
  checklist tipizzata `ok`/`missing` con istruzioni. Il planner lo invoca nel
  planning, apre un `decision_hold` e chiede all'operatore wait-vs-async. Le
  credenziali vanno nel `.env` del progetto (gitignored), mai committate.
- **Documento esaustivo**: generato dal flusso di planning, elenca ogni attività,
  la ownership, le dipendenze, lo stato verificato, le azioni uomo richieste.
  Vive come artefatto del task (in `.scratch/` del task o nel report), non come
  runaway.
- **Gantt live web**: piccola web app (Node http server + `ws`) che serve run/tickets
  /fasi da SQLite e strima gli eventi MQTT via websocket; timeline con chi/che fase;
  auto-refresh; accessibile con `po gantt`/`po web`. Nessuna dependency pesante.
- **CLI `po` completa**: aggiungere `status`, `gantt`/`web`, `logs`, `provision`/
  `deps`, `fleet`, `mcp`, `skills`, `doctor --network` a `bin/po.mjs`, ciascuno
  delegato a uno script in `scripts/` (come end-project): output coerente,
  cross-platform, testabile da CLI.
- **Team planner-per-istanza**: documentare che `resolveCapabilities` risolve il
  team per istanza (INSTANCE>ROLE, v `agents.yaml`) e che i topic team sono per
  progetto; aggiungere un test con due istanze planner con team diversi;
  assicurarsi che `launch-planner.mjs`/`po start` non forzino un team unico.

## Testing Decisions

- Un buon test verifica **comportamento esterno**, non dettagli interni: per il watcher
  bash, che generi il wake giusto quando un ticket supera la soglia; per
  l'human_approval, che un hold aperto persista dopo un riavvio e si risolva solo
  da una risposta esplicita registrata; per la riconciliazione, che un evento non
  venga mai applicato due volte (grazie a generazione/ack); per lo script deps, che
  l'output `ok`/`missing` sia corretto su fixture note.
- Moduli testati: `extensions/orchestrator.ts` (agent_control, human_approval,
  riconciliazione, scoping fallback), `scripts/watcher.sh`, `scripts/*.mjs` dei
  comandi `po` (status/logs/deps/fleet/mcp/skills/gantt/doctor --network), test
  del flusso di planning (fallback se skill mancanti), test team-per-istanza.
- Prior art nel codebase: i test esistenti in `scripts/smoke-test-*.mjs` e il test
  e2e full-flow; pattern di test del broker reale usato per il fix `--project` (v.38).
- Secondo la prassi del progetto, i test devono usare un broker MQTT vero dove
  serve e fixture locali SQLite, senza mock delle primitive di rete se il comportamento
  dipende da esse.

## Out of Scope

- Worktree-per-agente + merge-agent (progetto futuro separato, decisione 07).
- secondmate / fleet multi-host operativa (decisione 08) — solo doc+test"concept".
- Portabilità dell'estensione verso harness diversi da Pi (design attuale: estensione).
- Scheduler Engine completo delle decisioni (resta il gate human_approval minimale).
- Governo/ACL/mTLS del broker MQTT in produzione (già rischi aperti noti, post-V1,
  non in questo ciclo per priority) — l'allow-list dei comandi sì, la sicurezza di
  trasporto del broker resta fuori.

## Further Notes

- L'allow-list dei comandi CLI è priorità: la comparazione e il doc interno segnalano
  sezioni 25/40 come rischio aperto; riduce la superficie prima di espandere il roster.
- La separazione control/data plane e l'human_approval durevole sono prerequisiti
  multimodali per preflight (ticket 06/13) e away-mode (ticket 09).
- La verifica SDK pi per i segnali semantici va fatta subito (prima di investire
  nell'euristica a soglia); se pi espone eventi tool-call, usarli.
- Tutto è additive all'esistente: niente breaking change sul modo in cui i task
  sono orchestrati (worktree, plan_set, ticket/DAG, MQTT).