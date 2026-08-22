# Development notes

Questo pacchetto è il livello di **trasporto + identità + presenza + pub/sub +
comportamento di ruolo** descritto in `docs/architecture.md`, §22-24 e §37 —
l'equivalente diretto di `coms.ts`/`coms-net.ts` del repo
`disler/pi-vs-claude-code`, ma su MQTT 5 e con il paradigma role/instance al
posto della chat P2P piatta.

## Revisione 44 — `po start`/`launch-planner.mjs` generalizzato a QUALUNQUE ruolo: chiude il vero bug dietro "il planner non riesce a rilanciare gli agenti su herdr"

**Trigger reale**: l'operatore ha incollato il transcript di ragionamento di un
planner reale (progetto "voice-agent") che tentava di rilanciare dei worker
dopo un blocco — 4 turni, decine di migliaia di token, spesi a
ridiagnosticare da zero un problema che questo repo aveva già risolto per il
ruolo planner nella Revisione 33. Il planner ha lanciato `pi -e
extensions/orchestrator.ts --instance <nome> --role <ruolo>` via `herdr agent
start`, il processo `pi` è fallito immediatamente (quel file non esiste più
in un progetto scaffoldato dopo la Revisione 33), il pannello/tab herdr è
morto sul colpo, e il planner ha dovuto scoprire da solo — `which pi`, `pi
--help`, `find` sull'intero filesystem, lettura di `~/.pi/agent/settings.json`
— che l'estensione è caricata automaticamente e che `-e` non va mai passato.

**Causa reale, non un'ipotesi**: `scripts/launch-planner.mjs` (quindi `po
start`) risolve correttamente da anni se serve `-e extensions/orchestrator.ts`
o no (Revisione 33/34/38) — ma SOLO per il ruolo planner. Per qualunque altro
ruolo, lo script si rifiutava esplicitamente di procedere e rimandava
l'operatore/il planner a comporre il comando A MANO con `pi -e
extensions/orchestrator.ts --role <ruolo>` — un consiglio diventato stale
esattamente dalla Revisione 33 in poi, MAI corretto in questo punto specifico.
Il planner, seguendo `prompts/planner.md` (sezione "Selezione dinamica del
team", mai passando da `po start`/`launch-planner.mjs` per gli altri ruoli),
componeva quello stesso comando stale a mano, per ogni istanza coder/
reviewer/specialista lanciata via herdr o tmux — riproducendo l'esatto
traceback "Tool ... conflicts with ..." (o, peggio, un fallimento silenzioso
del processo `pi` all'avvio) ogni singola volta.

**Due domande dirette dell'operatore, risposta**: "quando planner lancia un
nuovo agente, deve usarlo con `pi ...` o `po start ...`?" — d'ora in poi
SEMPRE `po start --instance <nome> --role <ruolo>`, per qualunque ruolo, mai
più `pi -e extensions/orchestrator.ts` composto a mano: è l'unico punto del
codice che applica la logica di rilevamento `-e` già corretta, e adesso la
applica a ogni ruolo, non solo planner.

**Fix** (`scripts/launch-planner.mjs`): `parseArgs()` non forza più
`--role planner` — accetta qualunque ruolo, default `"planner"` se omesso
(compatibilità piena con l'uso storico di `po start --instance planner-01`
senza `--role`). I 5 flag `--skill` mattpocock restano attaccati **solo**
quando il ruolo risolto è `"planner"` — mai per un altro ruolo, stessa
garanzia di prima, verificata dallo stesso `scripts/check-skill-isolation.mjs`
(il cui controllo 5 è stato riscritto per verificare l'accettazione invece
del rifiuto). La logica di rilevamento `-e extensions/orchestrator.ts`
(hasLocalExtension && looksLikePackageRepo, Revisione 33/38) è invariata e
ora si applica identica a qualunque ruolo. `scripts/create-project.mjs`
(messaggio stampato da `po init`) e `prompts/planner.md` (sezione di lancio
team, herdr E tmux) aggiornati per usare sempre `po start --instance <nome>
--role <ruolo>` invece del vecchio `pi -e extensions/orchestrator.ts ...`.

**Seconda richiesta dell'operatore — rilancio per session id** (`po start
--instance planner-01 --session <id>`): `launch-planner.mjs` inoltra già
qualunque flag non riconosciuto direttamente a `pi` (nulla nel parser lo
intercetta) — verificato con un test dedicato che `--session <id>` (o
qualunque altro flag) attraversa `po start` inalterato fino al comando `pi`
composto. **Limite onesto, dichiarato esplicitamente sia nel codice sia in
`prompts/planner.md`**: se `pi` riconosca davvero un flag `--session`/
`--resume`/`--continue` per riprendere una sessione precedente per id NON è
mai stato verificato contro un binario `pi` reale in questo progetto — il
passthrough generico funziona già oggi (è meccanico, non specifico a
`--session`), ma se quel flag faccia davvero qualcosa di utile in `pi`
dipende dalla CLI di `pi` stessa, fuori dal controllo di questo pacchetto.
`prompts/planner.md` istruisce ora il planner a controllare `pi --help`
PRIMA di usarlo, esattamente come già fa per `herdr pane split`/i
sotto-comandi tab di herdr — mai inventare la sintassi, mai bloccarsi se non
la trova: rilanciare una sessione nuova va sempre bene come fallback.

**Terza osservazione dell'operatore — "voglio un nuovo tab di herdr non
tmux"**: la preferenza herdr-su-tmux (e tab-su-split) era già la regola
scritta in `prompts/planner.md` prima di questa revisione — resa più
esplicita qui ("SEMPRE herdr quando è disponibile, mai tmux se herdr c'è").
Il tmux menzionato nel transcript del planner era quasi certamente
terminologia informale per descrivere i pannelli herdr stessi (probabilmente
implementati sopra tmux), non un fallback effettivamente scelto al posto di
herdr — non c'è evidenza nel transcript che il planner abbia usato comandi
tmux diretti invece di `herdr agent start`. La causa reale del fallimento
era il comando `pi` composto, non lo strumento di terminal multiplexing
scelto.

**Verificato**: nuovo `scripts/smoke-test-launch-any-role.mjs` (11
asserzioni) — spawna il vero `scripts/launch-planner.mjs` come child process
(mai un mirror): `--role coder`/`--role reviewer` compongono correttamente
SENZA alcun flag `--skill`; `--role` omesso resta compatibile all'indietro
(planner + skill, invariato); un flag ignoto come `--session <id>` attraversa
inalterato; `--role` senza alcun valore viene rifiutato con un errore
chiaro. `scripts/check-skill-isolation.mjs` controllo 5 riscritto per
verificare l'accettazione di un ruolo diverso da planner (non più il
rifiuto). Suite completa (21 smoke test + `e2e-full-flow.mjs` +
`check-syntax`/`check-skill-isolation`) verde, più smoke test manuale della
CLI `po` (`npm install -g .`, `po init --force`, `po start --instance
coder-01 --role coder --print-only`, `po start --instance planner-01
--print-only`).

**Versione**: bump a `1.2.3`, da `1.2.2` (Revisione 43).

## Revisione 43 — la procedura di chiusura obbligatoria (Revisione 42) guadagna un quarto passaggio: docs-sync

**Richiesta esplicita dell'operatore**, subito dopo aver ricevuto e testato la
Revisione 42: oltre a test e2e, bump versione, commit, push, ci deve **sempre**
essere anche un agente che sincronizza tutti i documenti del progetto alle
ultime modifiche, come parte della stessa procedura di chiusura obbligatoria —
non un passo facoltativo lasciato alla memoria del planner.

**Perché questo non era già coperto**: il ruolo `docs-sync` esiste dalla
Revisione 28 (sezione 43 di `claude/architecture.md`) ed è già normalmente
incluso nel team quando il planner lo ritiene pertinente — ma "quando lo
ritiene pertinente" è esattamente il tipo di giudizio discrezionale che la
Revisione 42 ha appena dimostrato non essere abbastanza affidabile da solo
(lo stesso motivo per cui `user_confirmed`/`e2e_tests_run`/`version_bumped`
sono ora dichiarazioni obbligatorie, non convenzioni di prompt). Senza un
gate strutturale, nulla impedisce che un task chiuda con codice funzionante
ma README/QUICK-START/diagramma d'architettura silenziosamente disallineati.

**Fix, stesso pattern esatto delle tre dichiarazioni della Revisione 42**
(`extensions/orchestrator.ts`, tool `worktree_finalize`): nuova coppia di
parametri `docs_synced: Type.Optional(Boolean)` / `docs_sync_skipped_reason:
Type.Optional(String)` — uno dei due obbligatorio, validato PRIMA di
qualunque operazione git, esattamente come `e2e_tests_run`/`version_bumped`.
Mancante o incompleto, la chiamata viene rifiutata con un errore che nomina
esplicitamente cosa manca. L'evento `worktree_finalize_checklist` registra
ora anche questi due campi, per la stessa ragione di audit delle altre tre
dichiarazioni: un falso dichiarato lascia comunque una traccia nell'event
log, invece che il passaggio non essere mai stato considerato.

`prompts/planner.md` (sezione "Procedura di chiusura obbligatoria",
rinominata per riferirsi a entrambe le Revisioni 42-43): il quarto punto
istruisce esplicitamente a includere `docs-sync` nel team di ogni task che
tocca comportamento/API/setup visibili all'esterno (non solo per task
esplicitamente "di documentazione"), e a usare `docs_sync_skipped_reason`
per un task puramente interno senza alcun doc che lo nomini — invece di
ometterlo silenziosamente.

**Verificato**: `scripts/e2e-full-flow.mjs` — i tre call site esistenti di
`worktree_finalize` (flusso completo, blocco per merge conflict, blocco per
main sporca) aggiornati con `docs_synced: true` (il TEST 1 ha già
un'istanza `docsSync` reale nel team che riporta un round prima della
finalizzazione — la dichiarazione non è quindi solo nominale, riflette un
lavoro di sincronizzazione realmente avvenuto nello scenario di test). Due
nuove asserzioni aggiunte prima del primo finalize riuscito: (a) omettere
sia `docs_synced` che `docs_sync_skipped_reason` fa rifiutare la chiamata
con un errore che nomina `docs_synced`; (b) `docs_sync_skipped_reason` da
solo (senza `docs_synced`) supera la validazione del checklist — verificato
usando uno slug inesistente apposta, cosicché la chiamata fallisca dopo,
sulla ricerca del worktree, non sul controllo docs-sync, evitando così un
secondo merge reale indesiderato dello stesso task. Suite completa
riverificata verde: tutti i 20 smoke test + `e2e-full-flow.mjs` (50
asserzioni via il contatore `ok()`, più le due nuove verifiche di rifiuto)
+ `check-syntax`/`check-skill-isolation`, più uno smoke test manuale
completo della CLI `po` (`npm install -g .`, `po init --force`, `po start
--print-only`, `po end --list`).

**Versione**: bump a `1.2.2` (`package.json`), da `1.2.1` (Revisione 42).

**Limite onesto, stesso di `e2e_tests_run`/`version_bumped`**: `docs_synced`
è un'autodichiarazione, non verificata indipendentemente da questo codice —
l'estensione non confronta essa stessa i documenti del progetto ospitato col
suo codice, si fida che chi dichiara `true` lo abbia fatto per davvero (o
abbia delegato a `docs-sync` per farlo). Un planner che ignora questa
istruzione può comunque dichiarare `docs_synced: true` senza aver mai
davvero controllato nulla — il gate rende il passaggio esplicito e
tracciato, non impossibile da falsificare.

## Revisione 42 — istanze morte rilevate subito (non più dopo 15-30 min), planner strutturalmente escluso da `ticket_claim`, kill/relaunch, chiusura task obbligatoria (conferma utente + e2e + version bump + commit + push)

**Richiesta esplicita dell'operatore, tre punti in un solo messaggio**, dopo aver
osservato di persona (progetto "code-mem", lo stesso della Revisione 41) che un
planner ripreso da un riavvio, trovando un coder assente, **ha semplicemente
fatto lui il lavoro di coding** invece di rilanciarne uno:

1. Un "servizio deterministico" che tenga sotto controllo istanze previste vs
   effettivamente aperte, rilevi istanze bloccate/sparite, e le termini/permetta
   di ricrearle — **senza dover aspettare 30 minuti**.
2. **Il planner DEVE fare solo il planner** — mai coding, mai review, mai il
   lavoro di un altro ruolo, in nessuna circostanza (istanza assente inclusa).
3. A fine task, il planner deve **chiedere conferma del completamento
   all'utente**, poi eseguire in automatico test e2e, bump versione, commit,
   push.

### Punto 1 — rilevamento istantaneo + kill/relaunch

I due controlli watchdog esistenti (Revisione 29: ticket `running` senza
`ticket_complete` da 15+ minuti; Revisione 40: run `completed` senza finalize
da 10+ minuti) condividono lo stesso limite: sono euristiche sul tempo
trascorso, perché l'unico segnale che avevano era "nessun evento arriva più".
Ma per il caso specifico di un'istanza CHE NON C'È PIÙ (pane herdr chiuso,
processo `pi` morto — non "lento", proprio assente), esiste un segnale
migliore e già disponibile: la presenza MQTT (retained, alimentata da LWT +
`staleSweepTimer` lato client, che la pota dopo `STALE_AFTER_MS` ~45s di
silenzio). Non è un'euristica, è un fatto: se l'istanza assegnataria di un
ticket `running` non ha una presence card viva, è confermabilmente
disconnessa, punto.

Nuova funzione pura `moaFindOrphanedTickets(storage, project, presenceSnapshot)`
(stesso stile testabile di `moaFindStalledTickets`/`moaFindUnfinalizedRuns`,
nessuna soglia di tempo richiesta) integrata nello sweep automatico del
planner (`watchdogSweep`, ogni `WATCHDOG_INTERVAL_MS`, default 2 min): un
ticket "orfano" viene **automaticamente marcato `failed`** (con
`result_summary` che spiega perché), pubblicato su `run_events`, e il planner
viene svegliato con un messaggio `[watchdog]` che questa volta non è un
suggerimento ma un'istruzione obbligatoria: rilancia SUBITO quell'istanza,
poi ripianifica — **mai fare tu il lavoro del ticket**. Nella pratica questo
si rileva entro 1-2 minuti dalla disconnessione reale, non 15-30. WhatsApp
notificato come per gli altri controlli.

Per il caso diverso (istanza ANCORA connessa ma bloccata da tempo — il
vecchio caso Revisione 29), nuovo tool **`agent_terminate({ target_instance,
reason })`** (planner-only): pubblica un controllo `type: "terminate"` sullo
STESSO topic comandi già usato da `agent_send`/`handleCommand` — l'istanza
target, ricevendolo, esegue lo stesso `cleanShutdown()` di un
`session_shutdown` pulito e poi esce (`process.exit`). Non rilancia nulla da
solo: dopo, va verificato con `agent_list` e rilanciata manualmente (stesso
meccanismo herdr/tmux della selezione iniziale del team — nessun modo
verificato per questa estensione di generare un nuovo pane/processo dall'interno,
stesso limite onesto già documentato per herdr/paseo). Esiste anche una
terminazione automatica opt-in (`PI_ORCH_WATCHDOG_AUTO_TERMINATE=true`,
default **disattivato**): un ticket ancora "running" oltre
`PI_ORCH_WATCHDOG_AUTO_TERMINATE_MS` (default 20 min, ben sotto i 30 min del
timeout di `agent_send`) con presenza ANCORA viva riceve una terminazione
automatica, codice puro, nessun giudizio LLM richiesto. Deliberatamente NON
attivo di default: a differenza del caso orfano sopra (un'istanza già
sparita, niente da perdere), terminare un processo ANCORA in esecuzione
rischia di uccidere un task genuinamente lento ma che sta progredendo — un
trade-off che l'operatore deve scegliere consapevolmente, non qualcosa che
questo pacchetto decide da solo alle sue spalle.

### Punto 2 — planner strutturalmente escluso da `ticket_claim`

`prompts/planner.md` documentava già (Revisione 26) che è sempre e solo
un'istanza worker a dover chiamare `ticket_claim` ("deve essere lei a
chiamarlo, non tu") — ma era solo una convenzione di prompt, mai imposta dal
codice. Ora `ticket_claim` **rifiuta esplicitamente il ruolo planner**, con
un errore che spiega perché e cosa fare invece (rilanciare l'istanza del
ruolo giusto). Questo chiude strutturalmente il caso specifico
dell'incidente: il planner non ha modo di "prendere in carico" da solo il
lavoro di un ticket.

**Cosa NON è cambiato, e perché** — un tentativo iniziale in questa stessa
revisione aveva anche ristretto l'override del planner su `ticket_complete`
(bloccando `status: "done"` su un ticket di un'altra istanza, lasciando solo
`"failed"`). Rileggendo `prompts/planner.md` con più attenzione prima di
consegnare, questo si è rivelato un errore di analisi: il documento descrive
esplicitamente **il planner come il chiamante normale e previsto di
`ticket_complete`**, non un override d'emergenza — "`ticket_complete` invece
lo chiami TU, il planner — mai il worker[...] quel contributo si considera
concluso solo quando TU lo giudichi tale". È così by design fin dalla
Revisione 26: un ticket rappresenta il contributo di un ruolo a una fase, e
quel contributo è "fatto" solo quando il planner lo giudica tale (lo stesso
momento in cui chiama `plan_advance`) — bloccare questo avrebbe rotto il
flusso normale previsto, non solo l'incidente. Il revert è stato fatto PRIMA
di consegnare, non dopo un bug report — la lezione: l'incidente reale era il
planner che scriveva codice di persona via Bash/Edit, MAI passando da
`ticket_claim` per cominciare — bloccare `ticket_claim` da solo chiude
esattamente quel buco, senza bisogno di toccare `ticket_complete`.

**Limite onesto, non risolto da questa revisione**: non esiste, in questa
estensione Pi, alcun modo verificato per impedire a un'istanza planner di
usare i tool nativi di Pi (Bash/Edit/Write) per scrivere codice direttamente
— quei tool non sono registrati da questa estensione, e non è emersa nessuna
API dell'`ExtensionAPI` per limitarli per ruolo (stessa onestà già applicata
altrove in questo file per herdr/paseo: mai inventare una superficie API mai
verificata). La difesa resta quindi a più livelli: regola esplicita e molto
rafforzata in `prompts/planner.md` (sezione dedicata, in cima al file),
`ticket_claim` bloccato per planner, e la nuova rilevazione/istruzione
obbligatoria di rilancio sopra — non un blocco tecnico assoluto e garantito
al 100% contro un planner che ignora tutto questo.

### Punto 3 — chiusura task obbligatoria: conferma utente, e2e, version bump, push

`worktree_finalize` ora **rifiuta la chiamata** se non vengono dichiarati
esplicitamente tre nuovi parametri: `user_confirmed: true` (nessuna
eccezione — il planner deve aver chiesto esplicitamente conferma
all'utente prima di finalizzare, non assumerla dal fatto che tutti i ticket
sono `done`), ed **`e2e_tests_run: true` oppure `e2e_tests_skipped_reason`**
e **`version_bumped: true` oppure `version_bump_skipped_reason`** (per i task
che genuinamente non si applicano, es. un task di sola documentazione). Sono
autodichiarazioni — questo tool non esegue né verifica indipendentemente i
test o il version bump di un progetto arbitrario (stack/tooling troppo
variabili tra progetti diversi per automatizzarlo in modo sicuro qui dentro)
— ma un `false`/una bugia resta ora tracciata nell'event log
(`worktree_finalize_checklist`), invece che il passaggio non essere mai
stato nemmeno considerato.

Separatamente, `worktree_finalize` ora **esegue anche `git push` al remote**
dopo un merge riuscito (default `push: true`, disattivabile con `push:
false`) — prima faceva solo il merge locale, "commit, push" a fine task
richiedeva che il planner se ne ricordasse a parte. Best-effort e mai in
grado di invalidare il merge già avvenuto: nessun remote configurato, push
rifiutato, ecc. vengono riportati nel testo di risposta, non lanciati come
eccezione.

**Verifica**: nuovo file `scripts/smoke-test-instance-liveness.mjs` (14
asserzioni) copre tutti e tre i punti con la REALE `extensions/orchestrator.ts`
contro un broker Mosquitto reale: rilevamento orfano + auto-fail + messaggio
di rilancio obbligatorio; `ticket_claim` rifiutato per planner;
`ticket_complete` confermato INVARIATO (regression guard esplicita, non solo
assenza di errori); `agent_terminate` che forza un vero `cleanShutdown()`
osservabile via presence MQTT reale; `agent_list` ancora stabile con più
peer offline nello stesso scenario. Rieseguita l'intera suite preesistente
(20+ smoke test, `check-syntax`, `check-skill-isolation`) — verde, incluso
un aggiornamento a `scripts/smoke-test-end-project.mjs` (il suo script di
seed usava il planner stesso per `ticket_claim`, ora strutturalmente
vietato — corretto usando una seconda istanza fake di ruolo `coder`, esattamente
come farebbe il flusso reale). Test manuale della CLI `po` (`npm install -g
.`, `po init --force`, `po start --print-only`, `po end --list`) — verde.
Versione bump a 1.2.1.

## Revisione 41 — `agent_send` avvisa subito se non c'è nessuno ad ascoltare, bug reale in `agent_list` dopo un offline, conferma: nomi istanza riusabili tra progetti diversi

**Due domande reali dell'operatore sullo stesso progetto `code-mem`** (uno screenshot
di herdr: pannello del planner che mostra "delegato al coder" con un
`assignment_id`, ma nessun coder mai lanciato per quel progetto):

1. Se lo stesso nome istanza/tab (es. `planner-01`) usato in due progetti/workspace
   diversi sia un problema.
2. Perché il planner di `code-mem` ha dichiarato "ho delegato al coder"
   (`agent_send` verso `target_role: "coder"`, `assignment_id` restituito) senza
   che nessun coder fosse mai stato lanciato per quel progetto.

**Domanda 1 — già risolta, verificata contro il codice e il test esistenti, nessun
fix necessario.** `resolveDefaultProject()` (Revisione 38) deriva lo scope MQTT
(`pi/<project>/...`) dall'identità del PROGETTO (cartella), non dal nome
istanza — due progetti diversi ottengono prefissi di topic diversi anche
riusando lo stesso `--instance planner-01` in entrambi. `scripts/smoke-test-project-scoping.mjs`
(TEST 1) usa già esplicitamente `"planner-01"` come nome istanza in DUE
directory scratch diverse (package.json `alpha-widgets`/`beta-widgets`) e
verifica che i prefissi risolti siano diversi — esattamente lo scenario
dell'operatore, già coperto. Anche a livello di filesystem non c'è
collisione: il workspace `.pi/extensions/multiAgentOrchestrator/` (incluso
`orchestrator.db`) vive dentro la cartella di CIASCUN progetto, quindi due
progetti diversi non condividono mai lo stesso storage anche con identico
nome istanza. Il raggruppamento per "space"/progetto visibile nel pannello
agenti di herdr (screenshot dell'operatore: "voice-agent · planner-01" vs
"code-mem · planner-01" come righe separate) conferma che anche herdr non
tratta il nome istanza come chiave globale unica. Nessuna modifica al
codice: risposta data, verificata, non un fix.

**Domanda 2 — bug reale, corretto in questa revisione.** `agent_send`
pubblica il comando sul topic MQTT del ruolo/istanza target indipendentemente
dal fatto che qualcuno sia davvero sottoscritto — un publish non fallisce
mai solo perché nessuno ascolta — quindi la tool call "riusciva" comunque,
con un `assignment_id` reale, anche quando nessuna istanza di quel ruolo era
mai stata lanciata per il progetto. L'unica rete di sicurezza esistente era
il timeout di 30 minuti di Revisione 30 (`agent_send` risveglia il mittente
se nessuno risponde entro `PI_ORCH_TIMEOUT_MS`) — un ritardo reale prima che
il planner (o l'operatore, leggendo la sua chat) si accorgesse che la delega
non sarebbe mai stata ricevuta da nessuno.

**Fix** (`extensions/orchestrator.ts`, tool `agent_send`): prima di
pubblicare, controlla la mappa di presenza (la stessa letta da `agent_list`,
popolata da messaggi MQTT retained reali) per almeno un'istanza NON
`"offline"` che corrisponda a `target_instance`/`target_role`. Se non ne
trova, l'invio parte comunque (l'istanza potrebbe stare per connettersi, o
la presenza potrebbe essere di un istante stale — questo resta un avviso,
mai un blocco), ma il risultato del tool include `details.no_live_target:
true` e il testo restituito include subito un `⚠️` esplicito che nomina il
ruolo/istanza mancante — visibile nello STESSO turno della delega, non 30
minuti dopo. `prompts/planner.md` aggiornato con una sezione dedicata: se
vedi quell'avviso, non dichiarare la delega riuscita prima di aver
verificato con `agent_list` o lanciato tu stesso l'istanza mancante.

**Bug reale trovato ATTRAVERSO il test di questo fix, indipendente da esso**:
`agent_list` andava in crash (`TypeError: Cannot read properties of
undefined (reading 'join')`) non appena una qualsiasi istanza nota risultava
mai andata offline — il payload di presenza "offline" (pubblicato sia dal
Last Will and Testament sia dallo shutdown pulito) dichiara deliberatamente
solo `instance`/`role`/`project`/`status`/`last_heartbeat`, mai
`team`/`capacity`/`current_load` (un'istanza sparita non ha più nulla da
riportare su quei campi) — ma `agent_list` assumeva che ogni `PresenceCard`
avesse sempre la forma completa. Un bug preesistente, non introdotto da
questa revisione, che sarebbe scattato in qualunque progetto reale dopo il
primo agente disconnesso. Corretto con un default (`team ?? []`, `capacity
?? 0`, `current_load ?? 0`) invece di assumere la forma piena.

**Verificato**: nuovo `scripts/smoke-test-agent-send-presence-warning.mjs`,
stessa disciplina e2e reale delle revisioni precedenti (broker Mosquitto
reale, `extensions/orchestrator.ts` reale importato) — 9 asserzioni: nessuna
istanza online per un `target_role` genera l'avviso e comunque un
`assignment_id` reale; lanciare l'istanza mancante lo fa sparire; stessa
cosa per `target_instance` con un nome esatto mai lanciato; un'istanza che
va offline (shutdown pulito, payload "offline" reale) fa ricomparire
l'avviso — quest'ultimo caso è anche quello che ha fatto emergere il bug di
`agent_list` sopra. Suite completa (tutti gli smoke test esistenti +
`e2e-full-flow.mjs` + `check-syntax`/`check-skill-isolation`) riverificata
verde, più uno smoke test manuale completo della CLI `po` (`npm install -g
.`, `po init`, `po start --print-only`, `po end --list`). Versione bump
`1.1.0` → `1.2.0`.

**Limite onesto**: il controllo di presenza è un avviso, non un blocco — un
falso negativo resta possibile se la presenza è momentaneamente stale
(l'istanza si è appena connessa ma il retained message non è ancora
arrivato) o un falso positivo se l'istanza sta per connettersi un attimo
dopo l'invio; in entrambi i casi il timeout di 30 minuti di Revisione 30
resta la rete di sicurezza di ultima istanza. Non risolve né riguarda il
motivo per cui un planner a volte salta il passaggio di lancio effettivo
delle istanze mancanti (sezione 40/`prompts/planner.md`) — quello resta un
problema di aderenza del prompt lato LLM, non qualcosa che il codice possa
garantire da solo; questo fix rende solo l'errore immediatamente visibile
invece che silenzioso.

Dettagli completi (changelog riga per riga) in questo stesso file, sopra.

## Revisione 40 — bug reale: run completato ma mai finalizzato/notificato (watchdog cieco a questo caso), presence idle/busy scollegata dal lavoro reale sui ticket

**Incidente reale, riportato dall'operatore in produzione su `voice-agent`**:
tre osservazioni nella stessa sessione herdr — (1) `docs-sync-02` compariva
come "idle" nella barra di stato MQTT (in basso, widget `orchestrator-pool`)
mentre il proprio pannello lo mostrava chiaramente al lavoro da minuti (edit,
bash, report_append); (2) `docs-sync-02` ha effettivamente completato il suo
task (`ticket_complete`, ticket_id `01M0JKMPRK9HKB1VJSWFYK97AW` → `done`), ma
`planner-01` non ha mai reagito — nessun merge, nessuna notifica, il pannello
del planner semplicemente fermo; (3) nessun WhatsApp è arrivato per questo
blocco. L'operatore ha collegato il blocco a un riavvio del container Docker
`llmproxy-production` fatto "nel frattempo".

**Diagnosi, verificata leggendo i log/report/DB reali del progetto** (non solo
il codice): il log jsonl di `planner-01` (`.pi/extensions/multiAgentOrchestrator/
logs/planner-01.jsonl`) si ferma alle 17:12:46, **oltre un minuto prima** che
`docs-sync-02` completasse il proprio ticket (17:13:52) — il planner ha smesso
di processare qualunque cosa (nemmeno un evento di ricezione del completamento)
proprio nella finestra del riavvio di llmproxy segnalato dall'operatore.
Interrogando direttamente `orchestrator.db`: il run (`01M0JKKF0YYBJZWZKCDPG3AM1D`)
risultava correttamente `status: "completed"` (il branch `allDone` di
`ticket_complete` lo marca automaticamente quando l'ultimo ticket passa a
`done` — funziona, verificato), tutti e 4 i ticket erano `done`, ma **nessun
evento `worktree_finalize` né `whatsapp_notify` risultava mai registrato** —
il merge del worktree e la notifica finale sono decisioni del planner stesso
(chiamare `worktree_finalize`), non qualcosa che il layer ticket/DAG fa da
solo. Il watchdog esistente (Revisione 29, `moaFindStalledTickets`) guarda
**solo** ticket ancora in stato `"running"` — nel momento in cui l'ultimo
ticket passa a `"done"` (e il run a `"completed"`), quel controllo non ha più
nulla da segnalare, per costruzione: è cieco esattamente al caso "il layer
ticket/DAG dice che è tutto finito, ma nessuno l'ha davvero chiuso verso
l'operatore".

**Due fix distinti, entrambi in `extensions/orchestrator.ts`**:

1. **Watchdog: nuovo controllo `moaFindUnfinalizedRuns()`** — parallelo e
   indipendente da `moaFindStalledTickets()`, gira nello stesso
   `watchdogSweep()` (stesso timer, planner-only, stessa filosofia "euristica,
   non certezza — informa, non agisce automaticamente"): un run con
   `status === "completed"` da più di `WATCHDOG_FINALIZE_GRACE_MS` (default 10
   min, `PI_ORCH_WATCHDOG_FINALIZE_GRACE_MS`) senza altre novità viene
   segnalato **una sola volta** (dedupe via `watchdogRunAlerted`, stesso
   pattern di `watchdogAlertLevel`) sia via WhatsApp sia risvegliando il
   turno del planner (`pi.sendMessage(..., {deliverAs: "followUp", triggerTurn:
   true})` — lo stesso meccanismo che già risveglia un planner che riceve un
   `agent_send`). Questo è il vero "awake" richiesto dall'operatore: se il
   turno del planner si era semplicemente fermato (non il processo intero
   morto) perché la chiamata LLM in corso è fallita silenziosamente dopo il
   riavvio del container, questo lo rimette in moto senza aspettare un evento
   che potrebbe non arrivare mai da solo. Se il processo è davvero morto, il
   WhatsApp arriva comunque (è una `fetch` indipendente dal turno del
   planner). Esposto anche in `run_watchdog_check` (chiamabile a mano da
   qualunque ruolo) e in `run_status`.

2. **Presence MQTT (`idle`/`busy`) ora riflette anche il lavoro sui ticket, non
   solo `agent_send`** — lo stato pubblicato su `pi/<project>/agents/<id>/status`
   dipendeva SOLO da `inboundQueue.size` (quanti `agent_send` diretti non ancora
   risposti), un segnale di completamento completamente diverso da
   `ticket_claim`/`ticket_complete` (il layer ticket/DAG). Un'istanza poteva
   quindi essere profondamente al lavoro su un ticket per minuti — molti tool
   call, edit, bash — e risultare "idle" nel widget se non aveva (o aveva già
   esaurito) un `agent_send` pendente, esattamente il mismatch osservato su
   `docs-sync-02`. Fix: nuovo insieme `activeTicketIds` (per-istanza, in
   memoria), popolato da `ticket_claim` e svuotato da `ticket_complete`;
   `computeSelfStatus()` ora è `busy` se `inboundQueue.size > 0` OPPURE
   `activeTicketIds.size > 0`, ripubblicato immediatamente su claim/complete
   (non solo al prossimo heartbeat). **Limite onesto**: `activeTicketIds` è
   stato locale al processo — se il planner completa un ticket per conto di
   un'altra istanza (permesso esplicitamente dal tool, es. dopo uno stall), lo
   svuotamento avviene nel set del PLANNER, non in quello dell'istanza
   originale, che resterà "busy" finché non si riconnette da sola. Risolverlo
   del tutto richiederebbe uno stato di ownership centralizzato (MQTT/SQLite)
   invece che in memoria locale — fuori scope per questo incidente, che era un
   flusso claim→complete sulla stessa istanza dall'inizio alla fine.

**Verificato**: `scripts/smoke-test-watchdog.mjs` esteso con un TEST 5 (5 nuove
assertion sul solo watchdog run-non-finalizzato: nessun falso allarme prima
della grace period, un solo alert non ripetuto, contenuto del messaggio,
esposizione in `run_status`/`run_watchdog_check`) più 2 assertion aggiuntive
sulla presence reale via un client MQTT indipendente (sottoscritto al topic
`status` reale, non stato interno) — un'istanza dedicata (`coder-02`), non
quella lasciata deliberatamente "bloccata" dal TEST 1/3 (che infatti resta
`busy` per sempre in quello scenario, correttamente: un worker davvero morto
non dovrebbe mostrarsi idle). Intera suite di test pre-esistente (20 file,
inclusi tutti gli e2e reali e il CLI `po`) rieseguita, tutta verde — nessuna
regressione. Version bump a 1.1.0 (`package.json`).

**Cosa NON risolve**: il motivo di fondo per cui il turno del planner si è
fermato (probabilmente una richiesta HTTP al container `llmproxy-production`
riavviato che è fallita/rimasta appesa senza essere gestita) è nel runtime di
`pi`/nel provider LLM, non in questo pacchetto — non verificabile né
correggibile da qui. Questo fix garantisce solo che l'operatore venga
comunque avvisato entro un tempo limitato e che, se il turno era solo fermo
(non il processo morto), riparta da solo.

## Revisione 39 — bug reale: la protezione anti-doppio-caricamento (Revisione 34/35) avvisava del crash imminente invece di evitarlo

**Incidente reale, riportato subito dopo la consegna della Revisione 38**:
l'operatore ha lanciato il planner in `moa-test-project` — sia con `po start
--instance planner-01` sia con `pi -e extensions/orchestrator.ts --instance
planner-01 --role planner` a mano — e ha ricevuto lo stesso identico
traceback della Revisione 33 (`Tool "agent_list" conflicts with
.../moa-test-project/extensions/orchestrator.ts`, ripetuto per ogni tool e
flag, poi `Hint: Start without extensions using "pi -ne"`).

**Causa reale — un bug genuino in `scripts/launch-planner.mjs`, non un
problema della cartella dell'operatore.** La Revisione 34/35 aveva
aggiunto un rilevamento per questo esatto scenario (una copia locale stale
di `extensions/orchestrator.ts` in un progetto scaffoldato prima della
Revisione 33) — ma quel rilevamento si limitava a stampare un AVVISO
("questa copia locale verrà caricata ANCHE lei con -e, duplicando ogni
tool/flag") e poi, subito dopo, componeva comunque il comando CON `-e
extensions/orchestrator.ts` — la variabile `looksLikePackageRepo`, calcolata
apposta per distinguere questo caso, veniva usata SOLO per decidere se
stampare l'avviso, mai per decidere se includere `-e`. Il codice descriveva
correttamente il crash imminente invece di evitarlo — verificato leggendo
`extensionFlags = hasLocalExtension ? ["-e", "extensions/orchestrator.ts"] :
[]`, che ignorava del tutto `looksLikePackageRepo`.

**Fix**: `extensionFlags` ora richiede ENTRAMBE le condizioni —
`hasLocalExtension && looksLikePackageRepo` — non più solo la prima. Una
copia locale stale in un progetto scaffoldato (non il repo del pacchetto
stesso) non viene più mai passata a `-e`: il comando composto si affida
sempre all'estensione installata globalmente in quel caso, esattamente come
per un progetto scaffoldato di recente senza copia locale affatto.
L'avviso resta (informativo, non più un preannuncio di crash) ma con testo
aggiornato: la cartella residua è dichiarata esplicitamente "IGNORATA" e
"sicura da cancellare quando vuoi", non più un problema da risolvere prima
di procedere.

**Verificato**: nuovo `scripts/smoke-test-launch-planner-legacy.mjs` (8
asserzioni) — lancia per davvero `scripts/launch-planner.mjs` come child
process (mai un mirror) in tre scenari reali: scaffold legacy con una copia
stale reale di `extensions/orchestrator.ts` (package.json con uno slug
diverso da quello del pacchetto — replica esatta della cartella
dell'operatore) → conferma che il comando composto NON include più `-e` e
che l'avviso dichiara la cartella ignorata/sicura da cancellare; repo del
pacchetto stesso in sviluppo (`package.json` con `name ===
"pi-mqtt-orchestrator"`) → conferma che `-e` continua a essere incluso
correttamente, nessun avviso spurio; scaffold moderno senza copia locale →
invariato. Suite esistente (13 smoke test + 3 file `--experimental-strip-types`
aggiuntivi della Revisione 38 + `e2e-full-flow.mjs` + `check-skill-isolation`)
riverificata verde.

**Limite onesto**: questo fix copre solo l'invocazione tramite `po
start`/`scripts/launch-planner.mjs`. Se l'operatore lancia `pi -e
extensions/orchestrator.ts --role planner` A MANO (bypassando lo script) in
una cartella con una copia locale stale e l'estensione ANCHE installata
globalmente, il conflitto si verifica ancora — non c'è modo per questo
progetto di intercettare un'invocazione diretta di `pi`. L'unica soluzione
in quel caso resta cancellare la cartella `extensions/` residua (ora
esplicitamente segnalata come sicura da cancellare, invece che come un
problema da capire).

Dettagli completi (changelog riga per riga) in questo stesso paragrafo —
nessun file ulteriore da consultare, il fix tocca solo
`scripts/launch-planner.mjs` e il nuovo test.

## Revisione 38 — MQTT scoping automatico per progetto, skill del planner robuste al metodo di lancio, `po end`

Tre segnalazioni reali dall'operatore, dopo aver usato herdr per lanciare un
secondo progetto: (1) il planner del nuovo progetto vedeva gli agenti del
progetto precedente; (2) chiesto un task, il planner ha detto che le skill
Wayfinder/To-Spec non erano cablate e che avrebbe proceduto in autonomia
senza — invece di fermarsi come `prompts/planner.md` già gli imponeva di
fare; (3) richiesta esplicita di un comando `po end` per chiudere il
progetto della cartella corrente.

**1. Cross-talk MQTT tra progetti diversi — causa radice reale, non solo
teorica.** `--project` (il flag che scopa l'intero albero di topic MQTT,
`pi/<project>/...`) defaultava alla stringa letterale `"default"` per
QUALUNQUE progetto scaffoldato, ogni singola volta che non veniva passato
esplicitamente — cosa che nessun percorso documentato faceva mai (né `po
start`/`scripts/launch-planner.mjs`, né gli esempi herdr in questo stesso
file, né la guida `pi -e extensions/orchestrator.ts --instance ... --role
...` usata per coder/reviewer). Due progetti qualsiasi sullo stesso broker
locale — lo scenario che il Quickstart stesso rende naturale, un broker per
macchina non uno per progetto — finivano quindi sempre sullo stesso albero
di topic, vedendosi a vicenda. Non un edge case: il comportamento di
default, colpito alla prima occasione reale in cui l'operatore ha avuto due
progetti in corso.

**Fix**: `--project`, quando omesso, ora deriva dall'identità del progetto
stesso invece che da una costante condivisa — vedi `resolveDefaultProject()`
in `extensions/orchestrator.ts`, con questo ordine di priorità:
`.pi/extensions/multiAgentOrchestrator/config/project.json` (il nome scelto
dall'operatore, se il workspace è già stato inizializzato) → `package.json`
(`name`, sempre presente e specifico del progetto da `po init` in poi) →
`slugify(basename(cwd))` → `"default"` solo come ultimissima rete di
sicurezza. `--project` esplicito continua a vincere sempre su tutto, non
slugificato — cambia solo cosa succede quando NON viene passato, prima
silenziosamente insicuro. Zero configurazione richiesta: chi segue la guida
esistente (`po start`, o gli esempi herdr) smette di collidere senza dover
imparare un flag nuovo.

**Verificato**: `scripts/smoke-test-project-scoping.mjs` (nuovo) — importa
per davvero `extensions/orchestrator.ts` (stesso loader di
`check-syntax.mjs`), avvia due planner reali in due directory scratch con
`package.json` diversi, nessun `--project` passato, e legge il topic di
presenza RETAINED reale pubblicato da ciascuno su un broker mosquitto reale
per confermare che i due prefissi risultano diversi — la regressione
esatta, non una sua imitazione. Copre anche l'intera catena di fallback
(niente → `basename(cwd)`; solo `package.json`; `config/project.json` che
vince su `package.json`; `--project` esplicito che vince su tutto). Tutta
la suite esistente (smoke test + `e2e-full-flow.mjs`) ri-eseguita e
verificata invariata — nessuno dei test esistenti dipendeva dal vecchio
default, passano tutti già un valore esplicito.

**2. Le skill del planner (Wayfinder/To-Spec) diventano inutili se lanciato
a mano, invece di fermarsi come previsto.** `prompts/planner.md` già
istruiva il planner a fermarsi e segnalarlo all'utente se `/skill:wayfinder`
non risultava riconosciuta — ma l'incidente reale mostra che un LLM non
segue sempre fedelmente quell'istruzione, e nel frattempo la sezione "Come
provarlo end-to-end con 3 agenti reali (herdr)" di questo stesso file
mostrava il planner lanciato con `pi -e extensions/orchestrator.ts --role
planner` a mano — esattamente il percorso che salta la composizione dei
flag `--skill` (quella la fa solo `scripts/launch-planner.mjs`/`po start`),
in diretta contraddizione con l'istruzione "mai `pi` a mano per planner"
che lo stesso prompt dichiara.

**Fix**, in due parti:
- `prompts/planner.md` guadagna un **metodo di scoping integrato**,
  equivalente condensato (parole proprie, non il testo dei `SKILL.md`
  vendorizzati) di wayfinder+to-spec — charting a round, ogni ambiguità
  irrisolta come ticket `task`/`grilling`, collasso in una spec unica,
  traccia locale in `.pi/extensions/multiAgentOrchestrator/reports/<slug>.plan.md`
  — usato in automatico (con una riga esplicita all'utente) quando le skill
  vendorizzate non risultano cablate, invece di procedere senza alcun
  metodo. Le skill vendorizzate restano comunque la via preferita quando
  disponibili (più ricche: includono anche grilling/domain-modeling).
- Gli esempi herdr in questo file e il messaggio finale di `po init`
  (`scripts/create-project.mjs`) ora lanciano il planner SEMPRE con
  `scripts/launch-planner.mjs`/`po start`, mai `pi -e ... --role planner`
  a mano — coerente con quello che il prompt stesso dichiara.

**Nota su "to-Tickets"**: l'operatore ha nominato anche una terza skill,
"to-Tickets", tra quelle attese. `skills-vendor/mattpocock/VERSION.md`
documenta però che `to-tickets` è stata esclusa esplicitamente su richiesta
dell'operatore stesso in una revisione precedente ("Esplicitamente fuori
scope"). Non l'ho vendorizzata né aggiunta al metodo integrato senza
conferma — probabile che si riferisse alla mappa di ticket che wayfinder
stesso produce, non a una skill distinta, ma è stato segnalato
esplicitamente all'operatore invece di decidere in autonomia su una scelta
di scope già presa in precedenza.

**3. `po end`** (nuovo, `scripts/end-project.mjs`) — un comando di shell
puro, senza bisogno di una sessione `pi` aperta, che elenca i run del layer
ticket/DAG ancora `"active"` per il progetto nella directory corrente e,
dopo conferma esplicita (salvo `--yes`), li segna nello status scelto
(default `"completed"`, anche `"cancelled"`/`"failed"`), registrando un
evento `run_closed_by_operator` nello storico. Colma un gap reale: un run si
chiude da solo SOLO quando ogni suo ticket arriva a `"done"` via
`ticket_complete` — una sessione interrotta a metà, o un obiettivo cambiato,
lasciano il run `"active"` per sempre senza che l'utente abbia un modo di
dirlo se non riaprendo `pi` a mano. Non tocca ticket, worktree, o file fuori
da `orchestrator.db` — dichiarato esplicitamente sia nel codice che in
README. `--list` per una lettura senza modifiche, `--run <id>` per chiudere
un run specifico invece di tutti quelli attivi.

**Verificato**: `scripts/smoke-test-end-project.mjs` (nuovo, 15 asserzioni)
— seeding reale via le stesse tool call MQTT reali (`run_create`/
`spec_create`/`ticket_create`/`ticket_claim`/`ticket_complete`) su un
broker mosquitto reale, poi il vero eseguibile `scripts/end-project.mjs`
lanciato come child process (esattamente come farebbe un operatore da
shell) — copre: directory non inizializzata (rifiuta), progetto
inizializzato ma senza `orchestrator.db` ancora (nessun errore, niente da
chiudere), validazione di `--status`, `--list` senza modifiche, conferma
rifiutata senza modifiche, `--run` che chiude solo quel run e registra
l'evento, un run già chiuso richiamato con `--run` è un no-op non un
errore, `--yes` senza `--run` chiude tutti i run attivi rimasti, run
successiva senza run attivi. Anche verificato manualmente tramite
un'installazione globale reale (`npm install -g .` + `po end`).

**Anche corretto in questo passaggio, trovato per caso mentre verificavo lo
scaffold**: lo step "po CLI smoke test" di `.github/workflows/ci.yml`
asseriva `test -f extensions/orchestrator.ts` su un progetto appena
scaffoldato — un'asserzione rimasta stale dalla Revisione 33, quando
`create-project.mjs` ha smesso di copiare `extensions/` nei progetti
scaffoldati. Sarebbe fallita alla prima vera esecuzione di CI. Sostituita
con asserzioni su quello che uno scaffold post-Revisione-33 garantisce
davvero (`agents/roles.yaml`, `.pi/extensions/multiAgentOrchestrator/config/project.json`,
`.pi/extensions/multiAgentOrchestrator/prompts/planner.md`, e l'assenza di
`extensions/orchestrator.ts`), verificato con uno scaffold reale in una
directory scratch prima di scriverla in CI.

**Limite onesto**: nessuna migrazione automatica per un run "active" creato
prima di questa revisione con un `--project` esplicito diverso da quello
che `resolveDefaultProject()` calcolerebbe ora — resta comunque
raggiungibile passando lo stesso `--project` esplicito di prima, non è mai
stato tolto come opzione. Il metodo di scoping integrato nel prompt del
planner è deliberatamente più semplice delle skill vendorizzate vere e
proprie (nessuna invocazione reale di `grilling`/`domain-modeling` come
skill separate) — un compromesso dichiarato per garantire presenza anche
senza `po start`, non un sostituto a parità di ricchezza.

## Revisione 37 — `reports/`, `prompts/`, `logs/` spostati sotto `.pi/extensions/multiAgentOrchestrator/`; rimosso il concetto di "MVP" da tutto il progetto

**Richiesta 1 dell'operatore**: `reports/` e `prompts/` (e, di conseguenza,
anche `logs/`) appartengono concettualmente a multiAgentOrchestrator, non
alla root del progetto — "una questione di ordine mentale". Discussione
seguita a un controllo effettivo del codice e di `.gitignore`: la prima
risposta data qui era stata di soprassedere, dato che `.pi/` è interamente
gitignored e reports/prompts sono contenuto pensato per essere rivisto/
versionato a mano (report umani, prompt di ruolo). L'operatore ha però
chiarito il punto reale, più specifico del semplice "ordine mentale":

- **`reports/`** è reportistica di sviluppo DI QUESTO PROGETTO — non deve
  finire in un repository pubblico se il progetto scaffoldato viene poi
  pubblicato su GitHub (rivelerebbe il processo interno di orchestrazione
  AI), ma deve comunque restare sulla macchina dove il progetto è stato
  sviluppato, non sparire.
- **`prompts/`** si personalizza nell'ESTENSIONE, una volta per tutte — non
  per singolo progetto scaffoldato ("li modifico nell'estensione, non li
  modifico nei progetti"). Un fork per-progetto tracciato da git avrebbe
  solo invitato a divergere copia per copia senza motivo, ed è comunque
  soggetto alla stessa preoccupazione di riservatezza di `reports/` se
  qualcuno lo personalizza a mano dentro un progetto poi reso pubblico.
- **`logs/`** (il trace di debug per-istanza, Revisione 18) era già
  gitignored a livello di root — spostarlo sotto `.pi/` è stato il
  cambiamento a rischio più basso dei tre: nessun impatto sul tracciamento
  git, solo "quale cartella già ignorata" lo ospita.

**Implementazione**:

- `extensions/orchestrator.ts` — `moaSubdirs()` ora include `reports`,
  `prompts`, `logs` insieme alle sotto-cartelle già esistenti (`config`,
  `specs`, ecc.), quindi `moaEnsureWorkspace()` le crea tutte allo stesso
  modo. Nuovo helper `reportsDir(base)` = `moaSubdirs(moaWorkspaceDir(base)).reports`,
  usato da `reportPath()`, `planPath()`, `planMarkdownPath()` al posto di
  `path.join(base, "reports", ...)` diretto — `base` può essere sia un
  worktree attivo sia `identity.cwd` dopo il merge, esattamente come prima,
  solo un livello più annidato. `logsDir(cwd)` ora ritorna
  `moaSubdirs(moaWorkspaceDir(cwd)).logs` invece di `path.join(cwd, "logs")`.
  Il default di `--prompts-dir` (nel flag letto da `before_agent_start`) è
  passato da `"prompts"` a `.pi/extensions/multiAgentOrchestrator/prompts` —
  un `--prompts-dir` esplicito continua a vincere sempre, invariato.
  `ensureWorktreesGitignored()` non aggiunge più una voce `logs/` a sé
  stante (ridondante: `.pi/` la copre già in ogni progetto scaffoldato dalla
  Revisione 31) — resta solo `.worktrees/`.
- `scripts/create-project.mjs` — `prompts/` non viene più copiato nella root
  del progetto scaffoldato, ma dentro
  `.pi/extensions/multiAgentOrchestrator/prompts/` (stessa cartella che
  `moaEnsureWorkspace()` userà a runtime). `agents/`/`mqtt/` restano invariati
  alla root. La riga `logs/` è stata tolta dal `.gitignore` scritto per i
  nuovi progetti — non più necessaria, coperta da `.pi/`.
- `scripts/review-log.mjs` — la cartella di default passa da `./logs` a
  `./.pi/extensions/multiAgentOrchestrator/logs`; un argomento esplicito
  resta comunque supportato per rivedere un progetto scaffoldato prima di
  questa revisione, che ancora scrive in `logs/` a livello di root.
- Le sei prompt di ruolo (`prompts/*.md`, la copia SORGENTE in questo
  repository — non toccata la sua posizione, resta alla root, è quella che
  viene copiata dentro `.pi/.../prompts` nei progetti scaffoldati) sono state
  aggiornate ovunque citassero il percorso letterale `reports/<slug>...` o
  `<worktree_path>/reports/...`, che ora è
  `.pi/extensions/multiAgentOrchestrator/reports/<slug>...`. Sono le
  istruzioni che gli agenti LLM leggono per sapere dove scrivere/cercare il
  report — se non aggiornate, planner/coder/reviewer/specialisti avrebbero
  continuato a creare `reports/<slug>.md` nel posto sbagliato (la root),
  rompendo silenziosamente `report_append`/`worktree_list_open`/`worktree_finalize`,
  che ora cercano tutti nel nuovo percorso.

**Richiesta 2 dell'operatore**: eliminare ogni riferimento al concetto di
"MVP" dal progetto — va gestito e comunicato come un progetto vero e
proprio, non come un minimum viable product. Un controllo di tutte le
occorrenze (`grep -rni mvp`) ha mostrato che quasi ogni menzione era in
realtà solo il nome del file `docs/mvp-notes.md` citato in un commento — la
vera "narrazione MVP" si limitava a una manciata di frasi sparse in
`extensions/orchestrator.ts` e in questo stesso documento. Rinominato questo
file da `docs/mvp-notes.md` a `docs/development-notes.md` (titolo interno
aggiornato da "MVP scope notes" a "Development notes"), aggiornati tutti i
riferimenti in ogni file del repository che lo citava (`extensions/orchestrator.ts`,
script, prompt, README, AGENTS.md, CI, ecc.), e riformulate le poche frasi
che usavano davvero "MVP" come concetto (limite di scope dichiarato, non
solo citazione del filename) con un linguaggio neutro ("a questo stadio",
"questo progetto", ecc.) invece che sparire o essere sostituite con un
placeholder generico.

**Verificato**: l'intera suite di smoke test esistente (`smoke-test-worktree.mjs`,
`smoke-test-coordination.mjs`, `smoke-test-plan-gate.mjs`,
`smoke-test-report-audit.mjs`, `smoke-test-debug-log.mjs`,
`smoke-test-ticket-engine.mjs`, `smoke-test-multiround.mjs`,
`smoke-test-response-wakeup.mjs`, `smoke-test-watchdog.mjs`,
`smoke-test-worktree-cwd-guard.mjs`, `smoke-test-pipeline.mjs`,
`smoke-test-late-broker.mjs`, `smoke-test-shutdown-hang.mjs`,
`smoke-test-whatsapp-notify.mjs`, `smoke-test.mjs`,
`smoke-test-specialist-prompt.mjs`, ed `e2e-full-flow.mjs` — quest'ultimo
contro il file REALE, non un mirror) più `check-syntax`/`check-skill-isolation`,
rieseguita per intero contro un broker Mosquitto reale dopo le modifiche —
tutta verde. Diversi test avevano un proprio mirror hardcoded di
`reportPath()`/`planPath()`/`logsDir()` (per testare la logica senza
importare il file reale) — aggiornati uno per uno per restare in sync con il
codice reale, altrimenti avrebbero silenziosamente testato un percorso
ormai sbagliato. Scaffold reale (`node scripts/create-project.mjs --name ... --llmp`)
verificato a mano: nessuna cartella `reports/`/`prompts/`/`logs/` alla root,
tutto dentro `.pi/extensions/multiAgentOrchestrator/`, `git status`/
`git check-ignore` confermano che nulla lì dentro risulta tracciabile.

**Limite onesto**: questa revisione non fa nulla per un progetto GIÀ
scaffoldato prima di oggi — `reports/`/`prompts/`/`logs/` restano alla root,
tracciati da git se già committati, e non vengono spostati automaticamente
da nessun comando. Migrazione manuale documentata in README ("Keeping `po`
up to date"). Se un progetto del genere è già stato pushato pubblicamente
con `reports/`/`prompts/` dentro, rimuoverli dal tracking da questo punto in
poi (`git rm -r --cached`) non cancella la history già pubblica — richiede
una riscrittura della history (`git filter-repo`/BFG) se serve davvero
toglierli anche da lì, un'operazione che questo progetto non automatizza e
che l'operatore dovrebbe valutare con cautela (riscrive gli hash dei commit,
richiede un force-push coordinato con chiunque altro abbia clonato il repo).

## Revisione 36 — `po init --llmp` (config locale llmproxy), conferma del pane-naming automatico via herdr

**Richiesta 1 dell'operatore**: un'opzione di `po init` per scrivere anche la
configurazione locale di `pi` per un llmproxy, così un progetto scaffoldato è
pronto a usarlo senza doverla scrivere a mano ogni volta.

**Implementazione** (`scripts/create-project.mjs`): nuovo flag `--llmp`. Se
passato, scrive `.pi/agent/models.json` e `.pi/agent/settings.json` dentro
`targetDir` — contenuto FISSO fornito esplicitamente dall'operatore (provider
`llmproxy`, `baseUrl http://127.0.0.1:7045`, `apiKey "proxy-local"` — un
segnaposto, non un vero segreto, dato che un proxy in loopback non ne ha
bisogno davvero; tema `dark`, `defaultProvider`/`defaultModel` entrambi
`llmproxy`). Il percorso `.pi/agent/` è già coperto da `.gitignore`
(`.pi/`, aggiunto in Revisione 31) — coerente con quanto osservato in quella
stessa revisione: un `.pi/` dentro un checkout dell'operatore conteneva
proprio impostazioni locali di `pi`, incluse credenziali di un proxy LLM.
Idempotente come il resto dello scaffold: non sovrascrive `models.json`/
`settings.json` già esistenti a meno di passare anche `--force` (lo stesso
flag già usato per permettere di scaffoldare in una directory non vuota —
riusato invece di introdurne uno dedicato, dato che il significato
"sovrascrivi quello che c'è già" è lo stesso).

**Richiesta 2 dell'operatore**: che la tab herdr del planner, appena lanciata
con `po start --instance planner-01`, si chiami come l'istanza
(`planner-01`).

**Nessun codice nuovo necessario — già implementato**: `extensions/orchestrator.ts`
già calcola `displayName = flags.name || flags.instance` (quindi
`planner-01` di default, a meno che l'operatore passi esplicitamente
`--name` per un'etichetta diversa) e, in `session_start`, chiama
incondizionatamente `herdrRenamePane(displayName)` (oltre a
`herdrReportAgent()`/`setTerminalTitle()` come fallback ridondanti — vedi il
commento a quel punto del file). `po start`/`launch-planner.mjs` non
aggiunge mai un `--name` proprio, quindi questo comportamento di default si
applica automaticamente a ogni `po start --instance <nome>`. **Condizione
necessaria, non ovvia**: `herdrRenamePane()` è un no-op se
`process.env.HERDR_ENV !== "1"` — cioè funziona solo se il terminale da cui
si lancia `po start` è DAVVERO un pane gestito da herdr (herdr inietta quella
variabile lui stesso). Se l'operatore apre un terminale/finestra PowerShell
normale (non creata da herdr) e ci lancia `po start` dentro, non c'è nessun
pane herdr da rinominare — comportamento corretto, non un bug, dato che in
quel caso l'istanza semplicemente non sta girando "dentro" herdr.

**Verificato**: `po init --llmp` in una directory scratch scrive
`models.json`/`settings.json` con il contenuto esatto richiesto; senza
`--llmp` la cartella `.pi/agent/` non viene creata affatto (nessun falso
positivo); un secondo `po init --llmp --force` su un file modificato a mano
lo riporta correttamente al contenuto standard, confermando sia il comporta-
mento idempotente di default sia l'override esplicito con `--force`.
`check-syntax`/`check-skill-isolation` rieseguiti, entrambi verdi. La
richiesta 2 non richiede un test nuovo: è lettura di codice già esistente
(righe di `session_start` in `extensions/orchestrator.ts`, invariate in
questa revisione), stesso limite onesto già dichiarato lì (mai verificato
contro un binario herdr reale in questa sessione).

## Revisione 35 — residuo di `extensions/` locale su progetti pre-Revisione-33, e scoperta reale del percorso di `pi extension install`

**Trigger**: l'operatore ha riportato lo STESSO traceback della Revisione 33
("Tool ... conflicts with ...", "Flag ... conflicts with ...") su una
macchina Windows, DOPO aver disinstallato e reinstallato la versione più
recente del pacchetto. Il comando composto da `po start` includeva ancora
`-e extensions/orchestrator.ts`, e il traceback mostrava per la prima volta
con evidenza diretta DUE percorsi distinti in conflitto:

```
C:\Users\<utente>\.pi\agent\git\github.com\alessiobacin\pi-mqtt-orchestrator\extensions\orchestrator.ts
C:\Users\<utente>\Desktop\Development\test\extensions\orchestrator.ts
```

**Causa reale, non un regresso del fix della Revisione 33**: il fix della
Revisione 33 era corretto per gli scaffold NUOVI (`po init` non copia più
`extensions/`), ma la directory di progetto `test` dell'operatore era stata
scaffoldata PRIMA di quella revisione, da una versione di `po init` che
copiava ancora `extensions/orchestrator.ts` al suo interno. Quel file
residuo sul disco continua a far scattare `hasLocalExtension` in
`launch-planner.mjs` esattamente come previsto per il caso "dev mode" — solo
che qui non è dev mode, è un progetto scaffoldato con un file avanzato da
prima. Risultato: `po start` compone ancora `-e extensions/orchestrator.ts`,
che duplica ogni tool/flag contro la copia caricata in automatico da `pi`
dal SECONDO percorso mostrato sopra.

**Scoperta concreta, non più solo "non verificato"**: quel secondo percorso,
`~/.pi/agent/git/<host>/<owner>/<repo>/`, è la cartella dove `pi extension
install <url>` mantiene DAVVERO la propria copia — un clone git separato dal
pacchetto npm globale, mai documentato pubblicamente da `pi` ma ora
confermato da un traceback reale (non più solo un'ipotesi, come nella nota
onesta della Revisione 34). Questo spiega perché `po update`/`po uninstall`
(Revisione 34), che agivano solo sul pacchetto npm globale, non toccavano
affatto la copia che `pi` carica davvero per chi ha installato con `pi
extension install`.

**Fix**:

- `scripts/launch-planner.mjs`: quando `hasLocalExtension` è vero, controlla
  se il `package.json` della directory corrente ha `name ===
  "pi-mqtt-orchestrator"` (vero solo dentro il repo del pacchetto stesso, in
  sviluppo). Se non lo è, stampa un avviso esplicito (non bloccante — non si
  può escludere un caso legittimo non previsto) che spiega la causa e dà il
  comando pronto da copiare per risolvere (`rm -rf "<dir>/extensions"` su
  macOS/Linux, `Remove-Item -Recurse -Force "<dir>\extensions"` su Windows).
- `scripts/update.mjs`: ora aggiorna ENTRAMBE le copie quando presenti — il
  pacchetto npm globale (come nella Revisione 34) E, se esiste,
  `~/.pi/agent/git/<host>/<owner>/<repo>` (dedotto da `repository.url`, mai
  hardcoded) via `git pull --ff-only`, con conferma prima/dopo tramite
  `git rev-parse --short HEAD`. `--check` interroga anche quella cartella
  con `git fetch` + confronto locale/remoto, senza scaricare nulla.
- `scripts/uninstall.mjs`: ora rileva e (con una conferma interattiva
  separata, saltabile con `--yes`) rimuove anche quella stessa cartella,
  con l'avvertenza onesta che potrebbe esistere un registro/manifest
  separato che `pi` tiene altrove, non ispezionabile da questo codebase.

**Verificato**: nuovo scenario di test funzionale reale — una directory
scratch con un `extensions/orchestrator.ts` residuo (che simula esattamente
il caso dell'operatore) fa scattare il nuovo avviso con il comando `rm -rf`
corretto; il repo del pacchetto stesso (`name === "pi-mqtt-orchestrator"`)
resta silenzioso, nessun falso positivo. `po update --check` verificato di
nuovo contro il repo pubblico reale (non un mock): legge correttamente la
versione remota via `npm view` sull'URL GitHub reale. `check-syntax` e
`check-skill-isolation` rieseguiti, entrambi verdi.

**Limite onesto**: il percorso `~/.pi/agent/git/<host>/<owner>/<repo>` è
dedotto dalla struttura osservata in un SINGOLO traceback reale (Windows,
`pi` v0.84.2) — non è documentato pubblicamente da `pi`, potrebbe cambiare
in una versione futura senza preavviso, e non è stato verificato su
macOS/Linux (nessun ambiente con `pi` reale disponibile in questa sessione,
stesso limite di tutte le revisioni precedenti). Il `git pull --ff-only`
in `po update` si rifiuta deliberatamente di procedere se quel clone ha
modifiche locali o storia divergente, invece di forzare — in quel caso resta
più sicuro reinstallare da capo con `pi extension install <url>`.

## Revisione 34 — `po update` e `po uninstall`

**Richiesta dell'operatore**: un comando per aggiornare l'estensione installata
nel folder globale all'ultima versione della repo GitHub, e un comando per
disinstallarla in modo pulito.

**Scoperta di design, prima di scrivere codice**: `po` esiste SOLO come
pacchetto installato GLOBALMENTE via npm (`npm install -g <percorso o URL>`,
o `npm link` in sviluppo — mai un secondo meccanismo di installazione). Il
modo verificabile e onesto di "aggiornare"/"disinstallare" è quindi agire su
QUEL pacchetto npm globale — leggendo `repository.url` e `name` direttamente
dal `package.json` del pacchetto in esecuzione (mai hardcoded), così un
fork/mirror dell'operatore continua a funzionare senza modifiche a questi
script. **Limite dichiarato esplicitamente in entrambi gli script**: non
c'è visibilità da questo codebase sul meccanismo interno di `pi extension
install` — se delega a `npm install -g` dietro le quinte o gestisce un
registro indipendente non è verificabile qui (stessa incertezza già
annotata per `pi extension install` che apre una sessione agente, vedi
sopra in questo stesso documento). Entrambi i comandi istruiscono
esplicitamente l'operatore a verificare `po --version` dopo l'esecuzione e,
se il numero non cambia, a reinstallare/disinstallare anche tramite `pi`
stesso.

**`scripts/update.mjs`** (`runUpdate({packageRoot, argv})`, esposto come
`po update`):
- `po update` esegue `npm install -g <repository.url>` (letto dal
  `package.json` del pacchetto in esecuzione) — npm accetta direttamente un
  URL HTTPS di GitHub terminante in `.git`, quindi reinstalla sempre
  dall'ultimo stato del branch di default, senza bisogno di conoscere il
  numero di versione in anticipo.
- `po update --check` usa `npm view <url> version` per leggere la versione
  remota SENZA reinstallare nulla, e la confronta con quella installata
  localmente — utile per sapere se serve aggiornare prima di farlo
  davvero.
- Verifica preventiva di `npm`/`git` sul PATH (npm ha bisogno di git per
  scaricare da un URL GitHub), messaggio esplicito su permessi elevati
  (sudo/Amministratore) se l'installazione fallisce per quello.
- Dopo l'installazione, rilegge la versione dal `package.json` appena
  scritto per confermare l'esito (npm non fallisce sempre in modo rumoroso
  su ogni ambiente) e stampa un confronto prima/dopo.

**`scripts/uninstall.mjs`** (`runUninstall({packageRoot, argv})`, esposto
come `po uninstall`):
- Chiede conferma interattiva (`node:readline/promises`) prima di eseguire
  `npm uninstall -g <name>` — evita la disinstallazione accidentale.
  `--yes`/`-y` salta la conferma (per script/CI).
- Dichiara esplicitamente cosa NON tocca: i progetti già scaffoldati da
  `po init` (restano intatti — non sono di proprietà dell'installazione
  globale), eventuali broker MQTT/container Docker in esecuzione, e la
  registrazione interna di `pi` se l'installazione originale era via `pi
  extension install`.

**`bin/po.mjs`**: aggiunti i due nuovi sottocomandi (`update`, `uninstall`),
entrambi delegano a `await run...()` come gli altri sottocomandi async.

**Verificato con test funzionali reali contro il repo pubblico vero**
(`https://github.com/alessiobacin/pi-mqtt-orchestrator.git`, non un mock):
- `po update --check` legge correttamente la versione remota via `npm view`
  contro l'URL git reale e la confronta con quella locale.
- `po update` (reinstallazione reale, non simulata) esegue con successo
  `npm install -g` dall'URL del repo pubblicato, sovrascrivendo
  correttamente l'installazione precedente (osservato riprendendo il
  controllo dell'ambiente di sviluppo via `npm link` dopo il test, dato che
  `po update` aveva legittimamente sostituito quel link con la versione
  reale pubblicata su GitHub — comportamento corretto, non un bug).
- `po uninstall --yes` rimuove davvero il pacchetto globale (`po` non è più
  sul PATH subito dopo); l'invocazione interattiva senza `--yes`,
  rispondendo "n", annulla correttamente senza toccare nulla.
- Suite esistente (`check-syntax`, `check-skill-isolation`, `po start
  --print-only` con e senza `-e` locale) rieseguita dopo il re-link e
  confermata verde, nessuna regressione.

**Limite onesto**: nessuno dei due comandi è stato testato contro
un'installazione fatta con `pi extension install` (nessun ambiente con `pi`
reale disponibile in questa sessione, stesso limite di tutte le revisioni
precedenti) — solo contro un'installazione via `npm install -g`/`npm link`,
l'unico percorso verificabile da questo codebase.

## Revisione 33 — bug reale di doppio caricamento su Windows (tool/flag conflicts), `po doctor`, scaffold semplificato senza `extensions/`

**Trigger**: un test reale dell'operatore su una macchina Windows nuova,
dopo aver installato l'estensione globalmente con `pi extension install` e
scaffoldato un progetto con `po init`. `po start --instance planner-01` ha
composto (come atteso, prima di questa revisione):

```
pi -e extensions/orchestrator.ts --instance planner-01 --role planner --skill C:\Users\...\wayfinder --skill ...\to-spec --skill ...\grilling --skill ...\domain-modeling --skill ...\setup-matt-pocock-skills
```

fallendo con circa 30 righe del tipo:

```
Error: Failed to load extension ...
Tool <nome> conflicts with C:\Users\alessiobacin.DESKTOP-RLE36PF\Desktop\Development\test\extensions\orchestrator.ts
Flag --instance conflicts with ...
Hint: Start without extensions using 'pi -ne'.
```

L'operatore ha poi lanciato, per verificare, il comando bare `pi --instance
planner-01` (nessun `-e`, nessun `--role`, nessun `--skill`) — funzionato
perfettamente:

```
pi v0.84.2 ... [Extensions] orchestrator.ts ...
orchestrator connesso · planner-01 (planner) · broker mqtt://localhost:1883
```

**Root cause, confermata da questo test**: una volta installata come vera
estensione Pi (`pi extension install <url>`), `pi` carica il codice
dell'estensione IN AUTOMATICO in ogni sessione, da qualunque directory —
non serve mai più passare `-e extensions/orchestrator.ts` a mano. Ma
`create-project.mjs` (fino alla Revisione 32) copiava comunque una seconda
copia del codice dentro ogni progetto scaffoldato, e `launch-planner.mjs`
la caricava esplicitamente con `-e`. Risultato: lo stesso tool/flag veniva
registrato due volte (una dall'auto-load globale, una dal caricamento
esplicito locale) e `pi` rifiutava ogni singolo tool/flag come duplicato.
Confermato leggendo `loadConfig()`/`loadRolePrompt()` in
`extensions/orchestrator.ts`: risolvono sempre `configDir`/`promptsDir`
relativi a `identity.cwd`/`process.cwd()`, MAI al percorso del modulo
stesso — quindi un progetto scaffoldato non ha mai avuto bisogno di una sua
copia del CODICE, solo della sua CONFIGURAZIONE (agents/roles.yaml,
prompts/*.md, mqtt/, .env).

**Fix**:

- `scripts/create-project.mjs` non copia più `extensions/` (né
  `check-syntax.mjs`) in un progetto scaffoldato. Il `package.json`
  generato è ora minimale (solo identità/metadata: `name`, `version`,
  `private`, `type`, `description`) — niente più `pi.extensions`, niente
  script `check-syntax`, niente `dependencies`/`devDependencies`: il codice
  dell'estensione e le sue dipendenze npm (`mqtt`, `yaml`, ecc.) vivono solo
  nel pacchetto installato globalmente. `npm install` non è più un passo
  necessario dopo `po init`.
- `scripts/launch-planner.mjs` (`runLaunchPlanner()`) non richiede più
  l'esistenza di `<cwd>/extensions/orchestrator.ts` per partire: se quel
  file esiste (dev mode dentro questo stesso repo, o un progetto legacy
  pre-Revisione-33 con ancora una copia locale) compone il comando CON `-e
  extensions/orchestrator.ts`, come prima; altrimenti lo compone SENZA `-e`,
  confidando sull'auto-load globale. La verifica "è un progetto
  inizializzato" (prima basata sull'esistenza di quel file) ora controlla
  invece `agents/roles.yaml` oppure
  `.pi/extensions/multiAgentOrchestrator/config/project.json` (marker che
  `po init` scrive sempre), con l'esistenza locale di
  `extensions/orchestrator.ts` come terzo criterio valido.
- **`po doctor`** (nuovo sottocomando, `scripts/doctor.mjs`,
  `runDoctor({cwd})`): richiesto esplicitamente dall'operatore insieme al
  fix sopra — verifica che l'ambiente abbia git, `pi` (senza pretendere di
  installarlo: questo pacchetto non ne gestisce l'installazione, solo
  segnala che manca), e un modo di far girare un broker MQTT (broker già
  raggiungibile su 127.0.0.1:1883, oppure Docker con il daemon attivo,
  oppure Mosquitto nativo sul PATH) — con istruzioni di installazione
  specifiche per `process.platform` (darwin/win32/linux, via
  brew/winget/apt) per qualunque cosa manchi. Gira automaticamente in coda a
  `po init`, ed è invocabile a sé con `po doctor`.
- `bin/po.mjs`: aggiunto il terzo sottocomando `doctor`; `main()` è ora
  `async` (necessario perché `runCreateProject()` e `runDoctor()` sono
  entrambe `async`).
- Verificato con test funzionali reali in questa sessione: `po init` in una
  directory scratch non scaffolda più `extensions/`, il `package.json`
  generato è minimale, `po doctor` gira in automatico alla fine; `po start
  --print-only` nella stessa directory compone il comando SENZA `-e`;
  `po start --print-only` dentro questo stesso repo del pacchetto (dove
  `extensions/orchestrator.ts` esiste davvero) compone il comando CON `-e`,
  come prima. `npm run check-syntax` e `npm run check-skill-isolation`
  passano entrambi senza modifiche.
- `README.md` aggiornato di conseguenza: rimosso il passo `npm install` dal
  Quickstart e dalla sezione Windows (non più necessario), menzionato `po
  doctor`, e l'esempio di lancio di un ruolo diverso da planner non passa
  più `-e extensions/orchestrator.ts` a mano.

## Revisione 32 — installazione/uso su Windows (auto-discovery del sistema operativo)

**Richiesta dell'operatore**: aggiungere supporto Windows, con
auto-discovery del sistema operativo invece di istruzioni separate da
seguire a mano.

- **Bug reale trovato e corretto** in `scripts/launch-planner.mjs`
  (`runLaunchPlanner()`, usato sia da `node scripts/launch-planner.mjs` che
  da `po start`): lo spawn del processo `pi` (`spawn("pi", piArgs, { cwd,
  stdio: "inherit" })`) avrebbe fallito su Windows con `ENOENT` anche con
  `pi` perfettamente funzionante da un prompt aperto a mano — un `pi`
  installato via npm su Windows è quasi certamente uno shim `pi.cmd`/
  `pi.ps1`, non un eseguibile nativo, e `child_process.spawn()` non risolve
  l'estensione da solo (a differenza della shell interattiva dell'utente).
  Corretto passando `shell: process.platform === "win32"` — delega la
  risoluzione a `cmd.exe`, che trova correttamente lo shim. **Limite onesto
  esplicitamente lasciato in un commento nel file**: Node stesso documenta
  rare stranezze di quoting con `shell: true` su Windows quando un argomento
  contiene spazi (es. un percorso utente come `C:\Users\Mario
  Rossi\...\skills-vendor\...`) — non verificato in questa sessione (nessun
  ambiente Windows disponibile per testarlo davvero); se si presenta per
  davvero, il fix noto è la libreria `cross-spawn`, non ancora aggiunta come
  dipendenza senza una verifica reale del problema.

- **Auto-discovery del sistema operativo** (il modo scelto per soddisfare la
  richiesta, invece di semplicemente scrivere istruzioni Windows separate da
  seguire a mano): `scripts/create-project.mjs` (`runCreateProject()`, dietro
  sia l'uso diretto che `po init`) ora legge `process.platform` e stampa da
  solo, nei "Prossimi passi" finali, il comando di copia giusto (`copy
  .env.example .env` su Windows, `cp .env.example .env` altrove) e — solo su
  Windows — una nota sull'alternativa a Docker Desktop (Mosquitto nativo via
  `mosquitto.org/download` o `winget`). L'operatore non deve più tradurre a
  mano le istruzioni Linux/macOS.

- **README**: nuova sezione "Installazione su Windows" (sotto
  "Installazione — due scenari diversi") con l'equivalente PowerShell
  completo del flusso `po init`/`po start`.

- **Verificato per davvero** (con `process.platform` forzato a `"win32"` via
  `Object.defineProperty`, dato che nessun ambiente Windows reale è
  disponibile in nessuno dei due sandbox usati in questa sessione):
  `runCreateProject()` stampa correttamente `copy` invece di `cp` e la nota
  sul broker nativo quando `process.platform === "win32"`. **Non
  verificato**: l'esecuzione reale su una macchina Windows vera (spawn dello
  shim `pi.cmd`, `docker compose`/Mosquitto nativo, l'intero flusso fino
  all'avvio di `planner-01`) — nessun ambiente Windows era disponibile in
  questa sessione per testarlo.

## Revisione 31 — CLI globale `po` (init/start), pubblicazione su GitHub pubblico, CI

**Richiesta dell'operatore**: pubblicare questo repo su GitHub come repo
pubblico personale (`github.com/alessiobacin/pi-mqtt-orchestrator`),
installabile come una normale estensione Pi (`pi extension install
<url>`), con un comando globale — deciso insieme all'operatore come `po`
(**p**i-**o**rchestrator, non `poi`: più corto, e non si confonde col fatto
che serve anche a lanciare planner, non solo a inizializzare) — invece del
vecchio binario a sé `pi-orchestrator-init`.

**Cosa cambia**:

- **`bin/po.mjs`** (nuovo) — CLI unificata con due sottocomandi, esposta dal
  campo `"bin"` di `package.json` (`"po": "./bin/po.mjs"`, sostituisce
  `"pi-orchestrator-init"`):
  - `po init [--name ... --target ... --force]` — dietro le quinte chiama
    `runCreateProject()` (`scripts/create-project.mjs`, refactored per
    essere sia eseguibile direttamente che importabile). **Cambio di
    comportamento esplicitamente richiesto dall'operatore**: il default di
    `--target` non è più una sottocartella nuova (`./<slug-del-nome>`), ma
    la **directory corrente, in place** — una directory che contiene solo
    `.git/` (il caso comune di `mkdir progetto && cd progetto && git init`
    prima di `po init`) non conta come "non vuota" ai fini del controllo
    che normalmente richiede `--force`.
  - `po start [--instance ... --print-only ...]` — dietro le quinte chiama
    `runLaunchPlanner()` (`scripts/launch-planner.mjs`, stesso refactor).
    **Bug reale trovato e corretto durante questo refactor**: la versione
    precedente usava SEMPRE la propria directory (quella del pacchetto) sia
    per risolvere le skill vendorizzate mattpocock sia come `cwd` del
    processo `pi` spawnato — corretto solo quando lo script gira dalla root
    del pacchetto stesso (l'unico caso d'uso esistito finora). Con `po
    start` installato globalmente, il pacchetto vive in tutt'altra
    directory rispetto al progetto dell'operatore: le skill vanno ancora
    cercate nel pacchetto installato (non vengono copiate nei progetti
    scaffoldati, mai lo sono state), ma `pi` va spawnato con `cwd` =
    directory del progetto, altrimenti caricherebbe l'`orchestrator.ts` del
    pacchetto invece di quello del progetto. `runLaunchPlanner()` ora
    riceve esplicitamente `{ packageRoot, cwd, argv }` e li tiene separati;
    verifica anche che `<cwd>/extensions/orchestrator.ts` esista prima di
    spawnare `pi`, con un errore chiaro invece di lasciar fallire `pi`
    stesso in modo criptico.
  - Uso diretto senza installazione globale resta invariato: `node
    scripts/create-project.mjs ...` / `node scripts/launch-planner.mjs ...`
    (lo stesso file, richiamato con `packageRoot === cwd` in quel caso).

- **Verificato per davvero** (non solo letto): `npm link` in questo repo,
  poi da una directory scratch separata `po init --name "..."` (scaffold
  in place corretto, `package.json`/`.gitignore`/`.pi/.../project.json`
  tutti corretti) e `po start --instance planner-01 --print-only` (compone
  il comando `pi` giusto, con `cwd` sulla directory scratch e i 5 `--skill`
  risolti dal pacchetto linkato altrove) — vedi anche il nuovo step CI "po
  CLI smoke test" sotto.

- **`.gitignore` irrobustito** prima della prima pubblicazione pubblica:
  `node_modules` → `node_modules/` (mancava lo slash), aggiunti `.env`
  (nessun secret deve mai finire in questo repo — vedi sotto), `*.db` /
  `*.db-journal` (SQLite del layer ticket/DAG, locale per macchina) e `.pi/`
  (contiene, si è scoperto controllando prima di pubblicare, impostazioni
  locali dell'operatore per `pi` stesso — un percorso assoluto della sua
  macchina in `mcp.json`, endpoint/chiave del suo proxy LLM locale in
  `models.json` — niente di tutto ciò appartiene a un repo pubblico). Lo
  stesso identico irrobustimento è stato applicato al `.gitignore` scritto
  da `po init` nei progetti scaffoldati.

- **Un secret reale, trovato e NON incluso in questa pubblicazione**:
  durante l'analisi pre-pubblicazione è emerso che un deployment reale
  separato di questa estensione (non questo repo, un altro checkout su
  macchina dell'operatore) ha un `.env` tracciato in git con una vera
  API key Evolution API e un vero numero di telefono, committati in due
  commit della sua history. Questo repo pubblicato NON deriva da quella
  history — parte da una history git pulita, azzerata apposta — quindi
  quel secret non è mai arrivato qui. Resta comunque una raccomandazione
  aperta per l'operatore: ruotare quella chiave sul proprio pannello
  Evolution API, dato che è comunque compromessa (committata in chiaro),
  indipendentemente da questo repo.

- **Bug reale introdotto e corretto nella stessa sessione**: uno stub
  locale non tracciato di `@mariozechner/pi-tui` (necessario per eseguire
  `extensions/orchestrator.ts` per davvero fuori dal runtime di `pi`, vedi
  Revisione 25) viveva "a mano" in `node_modules/` senza che nulla lo
  ricreasse — un `npm install` di routine durante questa stessa revisione
  lo ha silenziosamente rimosso (non tracciato da `package.json`/
  `package-lock.json`), facendo fallire con `ERR_MODULE_NOT_FOUND` tutti i
  test che importano il modulo vero (`smoke-test-watchdog.mjs`,
  `smoke-test-response-wakeup.mjs`, `smoke-test-worktree-cwd-guard.mjs`,
  `smoke-test-ticket-engine.mjs`, `e2e-full-flow.mjs`). Corretto con
  **`scripts/setup-dev-stubs.mjs`** (nuovo, `npm run setup-dev-stubs`):
  ricrea lo stub in modo idempotente e riproducibile — necessario dopo ogni
  `npm install` pulito (clone nuovo, CI, o di nuovo a mano come qui).
  **Attenzione esplicita nel file e nel README**: questo script va lanciato
  SOLO nel repo del pacchetto, mai in un progetto scaffoldato da `po init`
  che userai per davvero con `pi` — la risoluzione dei moduli Node preferisce
  sempre il `node_modules` più vicino al file che importa, quindi lo stub
  finito nel posto sbagliato "vincerebbe" silenziosamente sul pacchetto vero
  fornito dal runtime di `pi`, rompendo il rendering TUI reale.

- **`LICENSE`** (nuovo) — MIT, coerente con la licenza delle skill
  vendorizzate mattpocock (vedi `skills-vendor/mattpocock/VERSION.md`).

- **`.github/workflows/ci.yml`** (nuovo) — GitHub Actions su push/PR verso
  `main`: `npm install` → `setup-dev-stubs` → installa e avvia mosquitto →
  `check-syntax` → `check-skill-isolation` → tutta la suite
  `smoke-test-*.mjs` (inclusi i 5 script `--experimental-strip-types` che
  eseguono il vero `extensions/orchestrator.ts`) → `e2e-full-flow.mjs` → uno
  step dedicato che installa `po` globalmente per davvero (`npm install -g
  .`) e verifica `po init`/`po start --print-only` in una directory scratch.
  Nessuno step richiede la CLI `pi` reale (per costruzione: tutta questa
  suite è pensata per essere eseguibile senza, vedi Revisione 17/25).

- **`package.json`**: nome cambiato da `@otomatik/pi-mqtt-orchestrator` a
  `pi-mqtt-orchestrator` (lo scope `@otomatik/` non ha senso per un repo
  personale pubblico; resta `"private": true`, nessuna pubblicazione sul
  registro npm è prevista — solo GitHub), aggiunti `repository`/`homepage`/
  `license`.

**Nota onesta sui limiti di questa verifica**: l'installazione reale
dell'estensione via `pi extension install <url>` e l'esecuzione reale di
`po start` fino all'avvio effettivo di `planner-01` **non sono state
verificate da questa sessione stessa**, perché nessuno dei due ambienti di
esecuzione disponibili qui ha contemporaneamente la CLI `pi` E l'accesso di
rete necessario a `pi extension install` — vedi la spiegazione completa data
all'operatore in chat. È stato verificato tutto ciò che UNA volta installato
`po` compone e scaffolda correttamente (vedi sopra), lasciando all'operatore,
sulla propria macchina reale, solo l'ultimo miglio: `pi extension install
<url>` e il lancio vero e proprio di `po start`.

## Revisione 30 — agent_send risveglia SEMPRE il mittente (risposta o timeout), rifiuto ad avviarsi da dentro una worktree

**Incidente reale, in due parti, osservato durante una ripresa live del task
"URL Shortener" dopo il blocco della Revisione 29.** Il planner aveva
delegato il round 2 a `coder-01` via `agent_send` (fire-and-forget, senza
`agent_await`). `coder-01` ha lavorato per bene — implementazione completa,
`npm test` verde, commit fatto — e il suo turno è finito normalmente: il
meccanismo esistente (`agent_end`, quando c'è un inbound non ancora
soddisfatto) ha pubblicato la risposta esattamente come sempre. Ma il turno
del planner era anch'esso già finito nel frattempo, e **non c'era alcun
meccanismo che lo risvegliasse alla risposta**: `handleResponse()` si
limitava a risolvere una Promise interna (`pendingReplies`) che, se nessuno
la sta aspettando in quel momento con `agent_await`, non raggiunge nessuno.
A differenza di `handleCommand` (che sveglia SEMPRE il destinatario di un
task in arrivo via `pi.sendMessage(..., {deliverAs:"followUp",
triggerTurn:true})`), niente svegliava il MITTENTE quando la sua risposta
tornava. Risultato: lavoro completo, fermo, e il planner non lo sapeva —
nessun nuovo round, nessun errore, nessun WhatsApp (che in questo design non
è mai stato agganciato a "una risposta è arrivata", solo a
watchdog/finalize/abandon — quindi il suo silenzio qui era coerente col
design esistente, non un bug a parte).

Leggendo lo stesso transcript è emersa una SECONDA causa, più profonda,
dietro il fatto che `coder-01` non trovasse affatto il ticket/run atteso
(si era auto-diagnosticato "cross-instance DB issue" e aveva deciso di
procedere comunque, bypassando il layer ticket): l'istanza era stata
lanciata con la propria cwd **già dentro la worktree del task**
(`.../moa-test-project/.worktrees/url-shortener`), non nella root del
progetto. Ogni percorso che l'estensione calcola (`worktreePaths`,
`moaWorkspaceDir` → il DB SQLite `orchestrator.db`, `reportPath`,
`locksPath`) è costruito componendo su `identity.cwd` assumendo che SIA la
root — lanciata da dentro una worktree, ogni percorso si risolve un livello
più in profondità, in un albero annidato, vuoto, isolato (compreso un
`orchestrator.db` nuovo di zecca, senza nessuno dei ticket/run reali) invece
di dare errore. Combacia esattamente con la diagnosi che l'LLM stesso aveva
scritto nel proprio reasoning (path annidato `.worktrees/url-shortener/
.worktrees/url-shortener` per `report_append`).

**Fix implementati** (`extensions/orchestrator.ts`):
- **`handleResponse()`** (risposta reale arrivata): dopo aver risolto
  `pendingReplies` come prima, se nessun turno è attivamente bloccato in
  `agent_await` per quell'esatto `assignment_id` (nuovo campo
  `PendingReply.awaiting`, impostato/rimosso da `agent_await` intorno alla
  sua `Promise.race`), risveglia il mittente con
  `pi.sendMessage({customType:"orchestrator-response", ...}, {deliverAs:
  "followUp", triggerTurn:true})` — stesso identico meccanismo di
  `handleCommand`, contenuto: chi ha risposto e cosa ha detto.
- **Timeout di `agent_send`** (nessuna risposta entro `TIMEOUT_MS`, default
  30 min, `PI_ORCH_TIMEOUT_MS`): stesso trattamento — se non attivamente
  atteso, risveglia il mittente (`customType:"orchestrator-timeout"`) E
  tenta una notifica WhatsApp (best-effort, come le altre) — mezz'ora di
  silenzio su una delega reale è un segnale azionabile a sé, non solo un
  dettaglio da loggare.
- **`agent_await`**: imposta `entry.awaiting = true` per la durata della sua
  `Promise.race` (in un `finally`, qualunque ramo vinca), così una risposta
  che arriva mentre un turno la sta attivamente aspettando non genera ANCHE
  un risveglio ridondante — quel turno la riceve già come valore di ritorno
  della chiamata stessa.
- **Guardia in `session_start`**: se la cwd contiene un segmento
  `.worktrees` (non una sottostringa: un vero segmento di percorso),
  l'istanza si rifiuta di avviarsi — notifica d'errore esplicita, nessun
  tentativo di connessione MQTT, invece di calcolare percorsi sbagliati in
  silenzio per l'intera sessione.

**Verifica**: due nuovi test e2e VERI, stessa disciplina delle Revisioni
25/26/29 (importano ed eseguono per davvero `extensions/orchestrator.ts`,
non un mirror) — `scripts/smoke-test-response-wakeup.mjs` (13 asserzioni:
risveglio su risposta tardiva, non-duplicazione sotto `agent_await` attivo,
risveglio + tentativo WhatsApp su timeout, `agent_get` su assignment ignoto
invariato) e `scripts/smoke-test-worktree-cwd-guard.mjs` (5 asserzioni:
rifiuto su cwd dentro `.worktrees` come ultimo segmento e come segmento
intermedio, nessun evento "connected" mai emesso, nessun falso positivo su
un nome cartella che contiene la sottostringa ".worktrees" senza esserlo
come segmento, nessun blocco per una cwd legittima). `scripts/e2e-full-flow.mjs`
aggiornato (il suo harness registrava OGNI chiamata a `pi.sendMessage` come
se fosse un task in arrivo — corretto per filtrare solo `customType:
"orchestrator-inbound"`, dato che ora esistono anche gli altri due
customType su quello stesso canale). Suite completa rieseguita: tutti i 17
file `smoke-test-*.mjs`, `e2e-full-flow.mjs` (50 asserzioni),
`check-skill-isolation.mjs` — tutti verdi.

**Prompt aggiornati** (`prompts/planner.md`): nuova sezione che spiega il
nuovo comportamento di risveglio (non serve più `agent_await`/`agent_get`
per accorgersi che una risposta è arrivata) e ribadisce che questo non
sostituisce il layer ticket — una delega reale va sempre accompagnata da
`ticket_create`/`tickets_ready`, altrimenti il watchdog (Revisione 29) non
ha visibilità su quel lavoro; se `ticket_claim`/`run_status` non trovano
quanto atteso, il planner deve fermarsi ed escalare, non procedere alla
cieca (esattamente ciò che `coder-01` aveva fatto in questo incidente).

**Limiti onesti**: la guardia sulla cwd copre solo il caso "lanciato da
dentro `.worktrees/`" — non rileva altre cwd sbagliate che non contengono
quel segmento (es. una directory completamente estranea al progetto);
resta un controllo euristico basato sul nome del percorso, non una verifica
strutturale che la cwd sia davvero la root del progetto (che richiederebbe
risalire l'albero cercando `.pi/` o un marker equivalente — non
implementato in questo giro). Il risveglio su timeout di `agent_send`
presume che `TIMEOUT_MS` sia un'attesa ragionevole per il tipo di lavoro
delegato — un task legittimamente più lungo di 30 minuti genera comunque un
alert, il planner deve giudicare se è falso allarme.

## Revisione 29 — watchdog per ticket bloccati (incidente reale: un turno LLM troncato ha bloccato tutto senza che nessuno se ne accorgesse), nome istanza mai prefissato dal progetto

**Incidente reale che ha motivato questa revisione**: durante un test live,
un'istanza worker (via un provider `opencode-otomatik`/`deepseek-v4-flash`)
è entrata in una lunghissima deliberazione interna su un caso di test, la
risposta del provider è stata troncata ("Response was truncated before
completion"), e l'istanza è rimasta bloccata lì — **senza aver mai chiamato
un solo tool durante tutto quel turno** (nessun `report_append`, nessun
retry, nulla). Nessun meccanismo esistente se n'è accorto: l'utente ha
dovuto notare il blocco guardando manualmente il pannello. Richiesta
esplicita dell'operatore: un controllo periodico automatico che, se qualcosa
si blocca, informi il planner e gli permetta di agire.

**Perché l'heartbeat/presenza esistente NON basta**: il processo `pi` di
un'istanza bloccata a metà di una singola chiamata HTTP al provider ha
comunque l'event loop libero (una promise in attesa non blocca Node), quindi
`heartbeatTimer` continua a pubblicare `status: "working"` per tutta la
durata del blocco — un heartbeat vivo non è la stessa cosa di un progresso
reale. L'unico segnale osservabile dall'esterno, in un caso come questo, è
il tempo trascorso: un ticket rimasto `running` (impostato da `ticket_claim`)
troppo a lungo senza un `ticket_complete`.

**Design scelto — nessuna nuova colonna/tabella, un check periodico
sull'esistente**: `ticket.updated_at` mentre `status === "running"` È già
esattamente il timestamp di `ticket_claim` (`updateTicketStatus` lo
aggiorna a ogni cambio di stato, e nulla d'altro tocca la riga di un ticket
`running` prima di `ticket_complete`) — nessun evento di "progresso"
intermedio esiste nel sistema (verificato: gli unici `recordEvent()` sono
sul ciclo di vita del ticket), quindi non serve nessuna infrastruttura
nuova per rilevare lo stallo, solo confrontare `now - ticket.updated_at`
con una soglia.

**Implementazione** (`extensions/orchestrator.ts`):

- `WATCHDOG_INTERVAL_MS` (default 2 min) e `WATCHDOG_STALL_MS` (default 15
  min), configurabili via `PI_ORCH_WATCHDOG_INTERVAL_MS`/
  `PI_ORCH_WATCHDOG_STALL_MS` (stesso pattern già usato da
  `PI_ORCH_HEARTBEAT_MS`/`PI_ORCH_STALE_AFTER_MS`).
- `moaFindStalledTickets(storage, project, nowMs, stallMs)`: funzione pura
  data una `nowMs` esplicita (mai `Date.now()` internamente) — testabile con
  un orologio controllato, senza dover davvero aspettare in un test.
- `watchdogSweep(nowMs)`: **planner-only**, no-op per ogni altro ruolo e
  no-op finché non esiste ancora un workspace/DB (`moaStorage` nullo prima
  del primo `orchestrator_init`/`run_create`). Per ogni ticket stalled non
  ancora segnalato **a questo livello di soglia** (dedup per
  `ticket_id::running_since`, con un contatore di soglie superate — non un
  singolo flag booleano): registra un evento `ticket_stalled` su SQLite,
  lo pubblica su `run_events` (MQTT, best-effort), tenta una notifica
  WhatsApp (riusa `sendWhatsAppNotification`, stessa infrastruttura di
  Revisione 19), e **risveglia il turno del planner** con
  `pi.sendMessage({ customType: "orchestrator-watchdog", ... }, {
  deliverAs: "followUp", triggerTurn: true })` — esattamente lo stesso
  meccanismo con cui un `agent_send` in arrivo già risveglia un'istanza
  (`handleCommand`, vedi Revisione 26), riusato qui invece di inventarne uno
  nuovo.
- **Escalation, non un singolo avviso**: la soglia è un multiplo di
  `WATCHDOG_STALL_MS` (livello 1 al primo superamento, livello 2 dopo un
  altro periodo intero non risolto, ecc.) — se il planner ignora il primo
  avviso, ne arriva un altro più tardi invece di restare in silenzio.
  Riassegnare il ticket (un nuovo `ticket_claim`, quindi un nuovo
  `updated_at`) inizia un nuovo "episodio" e riarma l'alert.
- Timer registrato in `session_start` solo se `identity.role === "planner"`,
  fermato in `cleanShutdown()` insieme agli altri timer esistenti.
- Nuovo tool **`run_watchdog_check({ run_id? })`**: stessa verifica, a
  chiamata manuale, sola lettura (non registra nulla, non notifica
  nessuno) — utilizzabile da qualunque ruolo, utile subito dopo aver
  ripreso una sessione.
- `run_status` include ora anche `stalled_tickets` nel proprio output, così
  di norma non serve nemmeno chiamare `run_watchdog_check` a parte.

**Cosa succede quando il planner riceve l'avviso**: nessuna azione
automatica sull'istanza bloccata — da fuori un task genuinamente lento è
indistinguibile da uno davvero bloccato, quindi la decisione resta
dell'LLM planner (vedi la nuova sezione "Watchdog: se un'istanza si blocca"
in `prompts/planner.md`): un ping via `agent_send`, poi eventualmente
`ticket_complete(status: "failed")` + un nuovo ticket equivalente per
ripianificare su un'istanza fresca, o l'escalation diretta all'utente se il
blocco persiste — annotando sempre la decisione nel report.

**Verificato**: nuovo `scripts/smoke-test-watchdog.mjs` (e2e VERO, stessa
disciplina delle Revisioni 25/26 — importa ed esegue il vero
`extensions/orchestrator.ts`, non un mirror, contro un broker MQTT reale e
un DB SQLite reale su disco) con soglie ridotte via le env var sopra per
restare veloce: un worker claima un ticket e non lo tocca mai più
(simulando esattamente l'incidente reale), e il test verifica che il primo
alert non parta prima della soglia, che arrivi entro un tempo ragionevole
dopo, che porti con sé `ticket_id`/istanza assegnata nel messaggio (non un
avviso generico), che l'evento `ticket_stalled` sia realmente pubblicato su
MQTT E persistito su SQLite (visibile in `recent_events`), che una seconda
soglia superata generi un SECONDO alert (non uno solo, e non uno per ogni
tick del timer — niente spam), che completare il ticket lo tolga
immediatamente da `run_watchdog_check`/`run_status`, e che
`run_watchdog_check` funzioni anche chiamato da un'istanza non-planner
(sola lettura) pur senza avere un proprio timer di sweep. 15 asserzioni,
tutte verdi. Suite completa rieseguita (14 smoke test + `check-syntax` +
`check-skill-isolation` + `e2e-full-flow.mjs`, 50 asserzioni) — nessuna
regressione.

**Limite onesto, dichiarato esplicitamente**: questo è un rilevamento
euristico basato sul solo tempo trascorso, non una diagnosi certa — un task
genuinamente lento e un task davvero bloccato appaiono identici dall'esterno
finché la soglia non scade. È esattamente per questo che l'escalation
INFORMA il planner invece di uccidere/riassegnare automaticamente
l'istanza: la decisione resta a un giudizio (umano o LLM), non a
un'euristica. Il riarmo su un nuovo episodio (`ticket_id::running_since`) è
verificato per lettura del codice, non con un secondo ciclo di attesa
completo nel test e2e, per mantenere il tempo di esecuzione del test
ragionevole — una lacuna di copertura dichiarata, non nascosta.

**Nome istanza mai prefissato dal progetto (bug reale, corretto)**: lo
stesso giro di test ha mostrato le tab herdr intitolate "url-shortener
tdd-agent-01" invece di "tdd-agent-01" — causato dal planner che sceglieva
un `--instance` prefissato dallo slug del task, poi mostrato verbatim come
titolo del pannello (comportamento corretto di `displayName`/
`herdrRenamePane()`, non un bug del codice — il valore in ingresso era
sbagliato). Nessuna modifica al codice: `prompts/planner.md` guadagna una
regola esplicita, "usa sempre e solo `<ruolo>-NN`, mai con un prefisso del
progetto" — il `ticket_id`/`worktree_path` già passati in `agent_send`
identificano a quale task un'istanza sta lavorando, il nome dell'istanza
non deve farlo.

## Revisione 28 — verifica del primo test live reale (URL shortener), packaging/scaffolding progetti nuovi, QUICK-START.md, pulizia ridondanze logs, statistiche nel report, convenzione diagramma di progetto

**Richiesta dell'operatore**: dopo un primo test live reale della Revisione
27 (feature "URL shortener" completata in un progetto separato,
`moa-test-project`), sei osservazioni concrete: (1) il README del progetto
scaffoldato conteneva ancora `# @otomatik/pi-mqtt-orchestrator` perché era
stato copiato a mano il `package.json` dell'ESTENSIONE — serve un modo reale
di pacchettizzare/installare l'estensione e un comando che inizializzi un
progetto nuovo chiedendo il nome se non indicato; (2) `docs-sync` deve
scrivere anche un `QUICK-START.md` con installazione + un curl di esempio
già verificato e la risposta attesa; (3) verificare che l'intero storage
dell'orchestrator (DB SQLite, report, logs) sia stato eseguito nell'ordine
giusto, ed eliminare ridondanze tra report/log/DB; (4) statistiche di tempo
lavorato per agente/round nel report finale; (5) capire perché
`artifacts/diagrams/knowledge/policies/overrides/playbooks` risultavano
vuote nello screenshot del progetto di test — bug o comportamento previsto;
(6) manca un diagramma del flusso logico del progetto, da far leggere per
primo a ogni agente per risparmiare token.

### 1. Packaging/installazione — `scripts/create-project.mjs` + `npm link`, non un vero `pi orchestrator init`

**Verificato prima di implementare, non assunto**: non esiste in questo
codebase nessuna evidenza che la CLI `pi` supporti sottocomandi shell
registrati da un pacchetto — `pi.registerCommand()` registra solo uno
slash-command dentro una sessione `pi` già avviata (es. `/orchestrator`),
`pi.registerFlag()` solo flag CLI sull'invocazione `pi -e ...`. Inventare
`pi orchestrator init` come comando shell reale sarebbe stata una
funzionalità non verificata, in contrasto con la disciplina di questo
progetto (vedi tutte le revisioni precedenti che distinguono esplicitamente
cosa è stato testato da cosa è solo assunto).

L'equivalente reale e testato: nuovo `scripts/create-project.mjs`, esposto
anche come binario globale `pi-orchestrator-init` (campo `"bin"` in
`package.json`, richiede `npm link` in locale o `npm install -g` se il
pacchetto fosse mai pubblicato — `"private": true` non è stato toccato,
pubblicazione reale non richiesta). Lo script: crea la directory target
(rifiuta se non vuota, salvo `--force`); copia `extensions/agents/prompts/
mqtt/.env.example` dal pacchetto sorgente — **mai il `package.json` del
pacchetto stesso**, la causa diretta del bug osservato; scrive un
`package.json` NUOVO specifico del progetto (name = slug del `--name`,
dependencies/devDependencies lette dal pacchetto sorgente per restare
sincronizzate); copia anche `scripts/check-syntax.mjs` (autosufficiente);
pre-scrive `.pi/extensions/multiAgentOrchestrator/config/project.json` col
nome scelto, così `orchestrator_init` lo trova già impostato al primo uso;
scrive un `.gitignore` minimo e fa `git init` se serve (richiesto per
l'isolamento worktree, Revisioni 13/14). **Verificato end-to-end**: scaffold
di prova in una directory temporanea, `npm install` + `npm run check-syntax`
completati con successo; verificato anche via `npm link` reale (comando
`pi-orchestrator-init` funzionante identicamente, poi `npm unlink -g`).

**`prompts/planner.md`**, step `orchestrator_init` nella sezione "Layer
ticket/DAG persistente": ora controlla `details.config.project` — se vale
`"default"` (il fallback del flag MQTT `--project`, mai un nome scelto da
un umano), prova prima il campo `"name"` del `package.json` del progetto
(con guardia esplicita contro il caso in cui sia ancora quello
dell'estensione stessa), altrimenti chiede il nome esplicitamente
all'utente in chat — coprendo sia progetti scaffoldati con
`pi-orchestrator-init` (nome già pre-scritto, non richiesto di nuovo) sia
progetti creati in altro modo.

**`extensions/orchestrator.ts`**: `moaEnsureWorkspace()` guadagna un terzo
parametro opzionale `projectNameOverride` (il nome umano scelto, sempre
prioritario sul valore MQTT `--project` quando presente); il tool
`orchestrator_init` guadagna un parametro opzionale `project_name` che lo
passa a `moaEnsureWorkspace`. Il README del pacchetto stesso guadagna una
sezione "Installazione — due scenari diversi" (sviluppare l'estensione vs.
usarla per un progetto nuovo) con l'intero comando `npm link` →
`pi-orchestrator-init` → `npm install` → `docker compose` → `pi -e
extensions/orchestrator.ts --instance planner-01 --role planner` (solo
planner-01 va avviato a mano — coerente con la correzione dell'operatore
nelle revisioni precedenti), più una "Nota onesta" esplicita sul punto
sopra (nessun vero sottocomando `pi orchestrator init`).

### 2. `QUICK-START.md` scritto da docs-sync

Nuovo `prompts/docs-sync.md` bespoke (prima docs-sync cadeva sul fallback
generico `prompts/specialist.md` — verificato leggendo `loadRolePrompt()`,
che controlla `prompts/<role>.md` prima di ripiegare su
`prompts/specialist.md`). Oltre al mandato standard (aggiornare il README
del progetto, mai copiare quello/il `package.json` dell'estensione — con
riferimento esplicito al bug osservato in `moa-test-project`), un passo
dedicato: scrivere/aggiornare `QUICK-START.md` con i comandi di
installazione minimi e un esempio curl reale con la risposta attesa,
**preso dai test già eseguiti da reviewer nel report** (mai inventato — se
il report non contiene un esempio eseguito, tocca a docs-sync eseguirlo
davvero prima di scriverlo).

### 3. Verifica ordine di esecuzione reale + rimozione della ridondanza `logs/` interna

**Verifica diretta sul run reale** (`moa-test-project`, run
`01M0DR2TJX0JSASHR60JK1DZ1X`, staging corretto di `.db`+`.db-wal`+`.db-shm`
insieme — in WAL mode le scritture recenti vivono nel `.db-wal` finché non
c'è un checkpoint, quindi ispezionare solo il `.db` dà una vista non
aggiornata): 6 ticket esattamente in linea con le 4 fasi del piano
(tdd-agent → coder → [schema-migrator, security-evaluator, openapi-writer]
in parallelo → docs-sync), grafo `depends_on` corretto, timestamp
`ticket_started`/`ticket_done` in ordine coerente (tdd-agent 19:32→19:35,
coder 19:35→19:40, le tre fasi parallele tutte pronte insieme a 19:40:36 e
partite 19:43:59-19:44:03, docs-sync 19:47:09→19:47:51), `run_completed`
finale. **Esito: il design della Revisione 27 ha funzionato correttamente
al primo test reale, nessun problema di ordine trovato.**

**Ridondanza — distinzione tra due meccanismi diversi**: la cartella `logs/`
nella root del progetto (Revisione 18, `logEvent()` scrive
`logs/<istanza>.jsonl`, letta da `scripts/review-log.mjs` per confrontare il
comportamento REALE con quello riportato dagli LLM) è **attiva e utile**,
non toccata. La sottocartella `.pi/extensions/multiAgentOrchestrator/logs/`
(scaffold creato da `moaSubdirs()` ma **mai scritto da nessun tool** —
verificato con una ricerca su tutto `extensions/orchestrator.ts`) era invece
morta: rimossa da `moaSubdirs()`, con una nuova asserzione negativa in
`scripts/smoke-test-ticket-engine.mjs` a prevenire regressioni. La
cronologia eventi che quella cartella avrebbe dovuto contenere vive già
nella tabella SQLite `events`, letta da `run_status`.

### 4. Statistiche di tempo lavorato nel report finale

Nessuna modifica a schema/tool: la tabella `events` (già esistente) + gli
eventi `ticket_started`/`ticket_done`/`ticket_failed` in `recent_events` di
`run_status` bastano a calcolare la durata per ticket/agente. Modifica
puramente di prompt: `prompts/planner.md`, nel passo "Report finale", ora
chiama `run_status({ run_id })`, calcola le durate per ticket
(`ticket_done`/`ticket_failed`.created_at − `ticket_started`.created_at,
raggruppate per istanza assegnataria) e include una tabella markdown
(righe per ticket + totali per agente) nella sezione "## Report finale",
con un avviso onesto sul limite di 50 eventi di `recent_events` per run
molto lunghi.

### 5. Cartelle vuote (artifacts/diagrams/knowledge/policies/overrides/playbooks) — non un bug

Verificato contro i commenti espliciti nel codice della Revisione 26: sono
scaffold deliberatamente differito a un follow-up (es. un generatore di
mappa/indice dell'architettura), non un errore. **L'unica eccezione reale
era `logs/`** (vedi punto 3), ora rimossa. Le altre restano vuote per
design finché non verranno implementate le funzionalità corrispondenti — il
punto 6 (diagrammi) inizia proprio a riempire `diagrams/`.

### 6. Convenzione diagramma di progetto: `diagrams/architecture.mmd`

Nuovo file convenzionale (non ancora esistente prima di questa revisione):
`.pi/extensions/multiAgentOrchestrator/diagrams/architecture.mmd` — sorgente
Mermaid puro (senza wrapper markdown), **a livello di intero progetto, non
per singolo task**, che rappresenta lo stato architetturale CORRENTE
completo, aggiornato continuamente. Distinto da `docs/architecture.mmd` del
pacchetto stesso (che documenta l'architettura dell'ESTENSIONE, non del
progetto orchestrato — i due file rispondono a domande diverse). Mantenuto
da `architecture-diagrammer` se nel team (brief esteso in
`agents/roles.yaml`), altrimenti da `docs-sync` come fallback (nuovo step
in `prompts/docs-sync.md`). **Ogni ruolo worker** (`coder.md`,
`specialist.md`, `security-evaluator.md`, `docs-sync.md`) guadagna una
nuova sezione "Prima di iniziare: leggi il diagramma, se esiste" —
istruzione a controllarlo PRIMA di esplorare il codice da zero, per
risparmiare token, con la clausola esplicita che non è garantito che
esista (task ancora senza diagramma, o team senza `architecture-diagrammer`
e senza un giro precedente di `docs-sync`).

### Bug trovati e corretti durante l'implementazione

- `scripts/create-project.mjs` conteneva nei commenti la stringa letterale
  `"skills-vendor/mattpocock"`, che ha fatto **crashare** (non solo fallire)
  `scripts/check-skill-isolation.mjs` — il suo controllo grep-based
  allowlista solo un piccolo set noto di file, e questo riferimento
  inatteso (nella spiegazione di cosa lo scaffolder NON copia) veniva
  segnalato come violazione. Corretto riformulando i commenti per evitare
  la stringa esatta, senza indebolire il controllo reale.
- `scripts/smoke-test-specialist-prompt.mjs` usava `"docs-sync"` come
  esempio canonico di ruolo che ripiega sul template generico
  `specialist.md` — rotto nel momento in cui è stato creato
  `prompts/docs-sync.md` bespoke. Corretto: l'esempio generico è ora
  `"openapi-writer"` (con la regex di verifica dell'etichetta corretta da
  un valore inventato al testo reale in `roles.yaml`), e un nuovo blocco di
  test conferma esplicitamente che `docs-sync` ora risolve sul file
  bespoke.

**Verificato**: `npm run check-syntax`, `npm run check-skill-isolation`,
`scripts/smoke-test-ticket-engine.mjs` (nuove asserzioni su `logs/` rimossa
e sul rename via `project_name`), `scripts/smoke-test-specialist-prompt.mjs`
(corretto e con nuova copertura per `docs-sync`) — suite completa (13 smoke
test + `e2e-full-flow.mjs`) rieseguita senza regressioni dopo ogni modifica.
**Limite della verifica sui prompt** (stesso limite intrinseco della
Revisione 27): le modifiche a `prompts/*.md` non sono eseguibili
dall'harness di test esistente, che chiama i tool direttamente senza mai
leggere i file di prompt — la verifica di QUICK-START.md, delle statistiche
nel report e della convenzione del diagramma resta comportamentale, da
osservare nel prossimo test live reale.

## Revisione 27 — il layer ticket/DAG diventa comportamento di DEFAULT del planner (prompt), non più qualcosa da chiedere esplicitamente

**Richiesta dell'operatore**: dopo la Revisione 26 (codice/storage/tool), i
`prompts/*.md` non erano ancora stati aggiornati — il planner non sapeva che
i tool `orchestrator_init`/`run_create`/`spec_create`/`ticket_create`/
`tickets_ready`/`ticket_claim`/`ticket_complete`/`run_status` esistessero,
quindi senza un prompt utente che li nominasse esplicitamente non li avrebbe
mai usati. Richiesta esplicita: aggiornare i prompt perché il layer ticket
si attivi **sempre, di default**, per ogni task di sviluppo — senza che
l'utente debba descrivere il flusso ticket ogni volta.

**Modifiche a `prompts/planner.md`**:
- Nuova sezione "Layer ticket/DAG persistente (Revisione 26)" (subito dopo
  "Il piano di esecuzione è un tool, non un file"): spiega la distinzione
  MQTT/SQLite già decisa con l'operatore, ed elenca la sequenza
  `orchestrator_init` → `run_create` → `spec_create` → un `ticket_create`
  per ruolo/fase (con `depends_on` che rispecchia l'ordine delle fasi già
  confermate con l'utente, così il grafo ticket è una seconda
  rappresentazione dello STESSO piano, non una decisione separata) →
  `tickets_ready`.
- **Punto chiave sui permessi reali del tool `ticket_complete`** (verificato
  leggendo `extensions/orchestrator.ts`, non assunto): `ticket_claim` registra
  SEMPRE l'istanza chiamante come assegnataria (deve chiamarlo il worker),
  mentre `ticket_complete` è permesso solo all'assegnatario **o al planner**
  — quindi è il planner, non il worker, a chiamare `ticket_complete`, nello
  stesso momento in cui chiama `plan_advance` (quando giudica il contributo
  di una fase davvero concluso, non quando il worker smette di lavorarci e
  lo manda in revisione). Questo è un dettaglio di design deciso guardando
  il comportamento REALE del tool, non un'assunzione: la prima stesura di
  questa revisione assumeva erroneamente che fosse il worker a chiamare
  `ticket_complete` da solo, corretta prima di consegnare la modifica.
- Step 5b aggiunto a "Quando l'utente ti chiede di sviluppare qualcosa"
  (subito dopo `plan_set`): registra il piano anche sul layer ticket, annota
  `run_id`/`spec_id` nel file di report con `report_append`. Step 6
  (delegazione) include ora anche `ticket_id` nel prompt di `agent_send`.
  In "Quando vieni risvegliato da reviewer", il ramo "sei soddisfatto"
  chiama `ticket_complete` per tutti i ticket della fase insieme a
  `plan_advance`, poi `tickets_ready` per la fase successiva. Nota aggiunta
  su `run_status` come strumento complementare a `plan_get`, utile in
  particolare per un'istanza planner futura che riprende un task senza aver
  mai visto il worktree.

**Modifiche a `prompts/coder.md` e `prompts/specialist.md`**: nuovo step 0
("Come chiudi un round"/"Quando ricevi un task") — se il messaggio ricevuto
include un `ticket_id`, chiamare `ticket_claim` prima di iniziare; esplicito
che NON tocca a loro chiamare `ticket_complete` (tocca al planner). Il layer
resta opt-in dal punto di vista del worker: se il messaggio non include un
`ticket_id` (task senza `plan_set`, o ricevuto direttamente dall'utente),
procedono come prima, invariati.

**`prompts/reviewer.md` non è stato toccato**: `reviewer` non è mai una fase
a sé nel piano (`plan_set` la rifiuterebbe comunque: fase 1 deve essere
`coder`, e reviewer approva/respinge dentro la fase di coder, non ne apre
una propria) — quindi non riceve mai un `ticket_id` dal planner, resta fuori
dal layer ticket esattamente come resta fuori dalle fasi.

**Verificato**: `npm run check-syntax` ripetuto dopo le modifiche (nessun
file `.ts` toccato in questa revisione, solo prompt Markdown) — nessuna
regressione, come atteso. **Limite intrinseco, non aggirabile**: questa è
una modifica di contenuto per un LLM (i prompt), non di codice deterministico
— l'harness di test esistente (`scripts/smoke-test-ticket-engine.mjs`,
`scripts/e2e-full-flow.mjs`) guida i tool chiamandoli direttamente e non
legge mai i file `prompts/*.md`, quindi non può verificare se un planner
reale, leggendo il prompt aggiornato, chiamerà davvero questi tool nella
sequenza descritta. L'unica verifica possibile qui è stata di coerenza
testuale (i permessi/il comportamento dei tool citati nel prompt sono stati
riletti dal codice reale, non assunti) — la verifica comportamentale resta
da fare con un planner reale su un progetto di prova.

## Revisione 26 — layer ticket/DAG/SQLite (MultiAgentOrchestrator), vertical slice additivo su MQTT+worktree+roster+phase-gate

**Richiesta dell'operatore**: valutare e implementare un piano esterno
("MultiAgentOrchestrator") che descriveva un'estensione Pi da zero — runtime
persistente/resumable, workspace `.pi/extensions/multiAgentOrchestrator/`,
ticket canonici interni, dependency graph, execution waves, SQLite come
storage, Planner Playbook, riuso delle skill Matt Pocock (Wayfinder/Drill-
Grill-Me/To-Spec/To-Tickets). Il piano non teneva conto dello stato reale di
questo repo (MQTT, worktree per task, roster di 23 specialisti, phase-gate
`plan_set`/`plan_advance`, notifiche WhatsApp, skill già vendorizzate —
wayfinder/to-spec/grilling/domain-modeling, non to-tickets) — implementarlo
alla lettera avrebbe rischiato di ributtare via i fix nati dagli incidenti
reali delle Revisioni 20/23/24.

**Decisione presa con l'operatore, prima di scrivere codice** (due domande
esplicite): (1) i due layer convivono con responsabilità diverse — **MQTT
resta il bus per segnali runtime** ("è successo qualcosa": eventi, comandi,
notifiche), **SQLite diventa la source of truth persistente** per ciò che è
vero adesso (stato ticket, dipendenze, run, checkpoint, event log) — non una
sostituzione dell'uno con l'altro; (2) **slice verticale prima**: solo init
progetto + storage SQLite (con astrazione) + modello canonico spec/ticket +
dependency graph + scheduler READY/BLOCKED/wave, agganciato allo spawning
MQTT esistente. Playbook engine, replanning, fase di integrazione, budget,
architecture map/index, crash-retry con fencing token, e vendoring di
To-Tickets restano esplicitamente fuori da questo giro.

**Cosa è stato implementato, in `extensions/orchestrator.ts`** (stesso file
singolo, nessun modulo separato — la loadability di un'estensione Pi
multi-file non è mai stata verificata contro un `pi` reale, mentre il
pattern single-file è quello testato finora):

- **Workspace di progetto** `.pi/extensions/multiAgentOrchestrator/`
  (`config/specs/playbooks/diagrams/knowledge/policies/artifacts/logs/
  overrides/orchestratorStorage/orchestrator.db`), creato/aperto in modo
  idempotente da `moaEnsureWorkspace()` — non distrugge mai stato esistente
  (verificato: `config/project.json.created_at` invariato su init ripetuto).
- **`OrchestratorStorage`** (interfaccia) → **`SQLiteOrchestratorStorage`**
  (unica implementazione, `node:sqlite` — `DatabaseSync`, WAL mode) — nessun
  tool/Planner tocca SQL direttamente, solo l'interfaccia. Schema: `runs`,
  `specs`, `tickets`, `ticket_dependencies`, `events`, `checkpoints`,
  `schema_meta` (versione schema persistita, guardia contro l'apertura di un
  DB con schema PIÙ NUOVO di quello che il codice supporta — nessun motore
  di migrazione vero e proprio ancora, solo la guardia).
- **Ticket/spec canonici**: platform-independent, mai sincronizzati verso
  GitHub/Linear/Jira (nessun Ticket Publisher, come da richiesta del piano
  originale) — `spec_create` scrive sia in SQLite sia come file markdown
  sotto `specs/`.
- **Dependency graph deterministico**: `moaComputeReadyBlocked` (READY/
  BLOCKED/RUNNING/DONE/FAILED/CANCELLED, sempre calcolato, mai uno status
  ridondante salvato) e `moaComputeExecutionWaves` (livelli topologici del
  lavoro ancora da fare, con rilevamento esplicito di cicli).
- **8 nuovi tool**: `orchestrator_init`, `run_create`/`spec_create`/
  `ticket_create` (solo planner), `tickets_ready` (chiunque), `ticket_claim`
  (capability match contro role+skills risolti — vedi limite sotto),
  `ticket_complete` (solo assegnatario o planner; su "done" ricalcola e
  pubblica i ticket appena READY, e completa il run se tutti i ticket sono
  done — un fallimento NON propaga automaticamente ai dipendenti, propagarlo
  è compito del replanning, deliberatamente fuori scope), `run_status`
  (superficie di resumability: una sessione planner fresca la chiama invece
  di rigenerare il piano).
- **Topic MQTT nuovo**: `pi/{project}/runs/{run_id}/events` (QoS 0, non
  retained — puro segnale "è successo qualcosa"; un client che si
  (ri)connette legge sempre lo stato vero da `run_status`/`tickets_ready`,
  mai da un messaggio MQTT rigiocato). Pubblicato best-effort DOPO la
  scrittura SQLite corrispondente, mai prima — se il publish fallisce, la
  fonte di verità in SQLite è già corretta.

**Bug reale trovato scrivendo `scripts/smoke-test-ticket-engine.mjs`** (test
e2e VERO, stesso approccio della Revisione 25 — importa ed esegue il file
vero, non un mirror): `ticket_create` creava la riga del ticket in SQLite
PRIMA di validare gli id in `depends_on`, quindi un `depends_on` verso un
ticket inesistente lasciava comunque un ticket orfano nel run anche se la
tool call falliva con errore. Fix: validazione di tutti i `depends_on`
PRIMA di qualunque scrittura — un `ticket_create` fallito ora non lascia
nessuna traccia, non solo un dependency non collegata.

**Limite reale trovato, non corretto (fuori scope)**: `resolveCapabilities()`
(già esistente, usata da ogni tool) risolve skills/cli/mcp/model SOLO dal
campo `role:` che l'istanza ha in `agents.yaml` — non consulta MAI il flag
`--role` passato da riga di comando. Per un'istanza SENZA voce in
`agents.yaml` (esattamente lo scenario che `docs/architecture.md` §40
descrive come già funzionante: "non serve una voce in agents.yaml... la
risoluzione delle capability applica già i default di roles.yaml a
un'istanza sconosciuta, purché --role sia passato esplicitamente"), questo
NON è vero nel codice reale: skills/cli/mcp restano quelli (vuoti) del ruolo
"unassigned", e `--role` finisce per influenzare solo `identity.role`/il
nome visualizzato, non il capability matching. Scoperto scrivendo il test
di `ticket_claim` (un'istanza `security-evaluator-01` senza voce in
`agents.yaml` non otteneva le skill di `security-evaluator` da
`roles.yaml`) — il test è stato corretto per usare un'istanza REALE
dichiarata in `agents.yaml` (`reviewer-security-01`), ma il gap in
`resolveCapabilities()` resta e andrebbe affrontato separatamente (tocca
codice stabile e testato, usato da OGNI tool esistente — non da correggere
di riflesso dentro questa slice).

**Cosa resta deliberatamente fuori da questa slice** (vedi anche
`claude/architecture.md` nel progetto claude.ai collegato, dove è
documentata la valutazione completa del piano): Playbook engine
esplicito (i tool sopra sono chiamati direttamente dal planner, non
orchestrati da uno state machine dedicato), replanning strutturato (split/
merge/reassign di ticket), fase di integrazione dedicata, budget/controllo
costi, crash/timeout retry automatico con fencing token (un ticket lasciato
`running` da un processo morto resta visibile come `running` in
`run_status`/`tickets_ready` — non viene mai riassegnato automaticamente),
architecture map/index generator, vendoring di To-Tickets (le altre tre
skill — wayfinder/to-spec/grilling — restano quelle della Revisione 22, non
toccate).

**Verifica**: `scripts/smoke-test-ticket-engine.mjs`, test e2e VERO (non un
mirror) — 45 asserzioni: init idempotente, run/spec/ticket in SQLite con
file markdown su disco, eventi MQTT REALI osservati su un client reale
sottoscritto a `pi/{project}/runs/{run}/events`, dependency graph a 4 nodi
(A/B senza dipendenze, C←A, D←B+C) con wave `[[A,B],[C],[D]]`, capability
match/rifiuto su `ticket_claim`, catena claim→complete→newly-ready→run
auto-completato, un ticket fallito che NON propaga automaticamente al
dipendente, override del planner su un ticket non suo, e — lo scenario più
importante — un riavvio simulato (nuova `FakeInstance`, stessa directory di
progetto, stesso `run_id`) che rilegge lo stato esatto (4 done, 1 failed, 1
blocked, 6 ticket totali) dal file SQLite su disco, non da nessuna struttura
in memoria. Suite completa riverificata verde dopo il fix: 13 smoke test
(i 12 esistenti + questo nuovo), `check-syntax`, `check-skill-isolation`,
`scripts/e2e-full-flow.mjs` (50 asserzioni, 6 scenari) — nessuna regressione
sul layer MQTT/worktree/roster/phase-gate esistente.

`package.json`: `@sinclair/typebox` era già una dipendenza reale del file
(ogni tool, vecchio e nuovo, usa `Type.Object`) ma non era mai stata
dichiarata — solo "installata per davvero" ad-hoc per l'harness e2e (nota
della Revisione 25). Ora è in `devDependencies`, così `npm install` da solo
basta a far girare la suite di test, senza il passo manuale.

**Non verificato**: nessun test contro il binario `pi` reale (stesso limite
di ogni revisione precedente); `node:sqlite` è verificato solo contro Node
22.22.2 di questo sandbox — se la build di Node che `pi` usa realmente non
lo espone (o lo espone sotto un flag diverso), i tool del layer ticket
falliscono con un errore chiaro al primo uso, ma il resto dell'estensione
(MQTT/worktree/roster/phase-gate) continua a funzionare invariato, dato che
`node:sqlite` viene risolto pigramente solo dentro `SQLiteOrchestratorStorage`.

## Revisione 25: primo test e2e contro il codice VERO (non più mirror) — nessun bug trovato in `extensions/orchestrator.ts`

**Richiesta dell'utente**: fare test e2e sul flusso completo con alcune
varianti, e correggere qualunque cosa non funzionasse. Ogni "smoke test"
di questo progetto, da `smoke-test.mjs` in poi, è sempre stato una
reimplementazione MIRROR a mano della logica di `extensions/
orchestrator.ts` — mai il file vero. È un limite segnalato esplicitamente
nella sezione "Verifica" di quasi ogni revisione precedente, dalla 17 in
poi: un mirror può divergere silenziosamente dal codice reale (esattamente
il rischio con cui un mirror per definizione convive), e nessun test in
questo repo aveva mai eseguito il file vero end-to-end prima d'ora.

**Come funziona il nuovo harness (`scripts/e2e-full-flow.mjs`)**: importa
dinamicamente il vero `extensions/orchestrator.ts` con lo stesso loader
ESM reale di Node (`node --experimental-strip-types`) già usato da
`scripts/check-syntax.mjs` per verificarne la sintassi — ma qui il modulo
viene anche eseguito per davvero, non solo parsato. Due pacchetti che
`extensions/orchestrator.ts` importa esistono solo dentro il runtime di
`pi` e mancano in questo sandbox:
- `@mariozechner/pi-coding-agent` — non serve nessuno stub: nel file è
  usato SOLO in un `import type {...}`, cancellato del tutto da
  `--experimental-strip-types` (verificato leggendo ogni occorrenza nel
  file: zero usi a runtime).
- `@mariozechner/pi-tui` — usato a runtime, ma solo per `Text`/
  `visibleWidth`/`truncateToWidth`, e solo dentro `renderCall`/
  `renderResult`/`renderPool` (rendering TUI, mai eseguiti da questo
  harness). Uno stub locale minimo in `node_modules/@mariozechner/pi-tui/`
  (una classe `Text` banale + due funzioni di misura ingenue) basta a far
  risolvere l'`import` senza mai toccare logica vera.
`@sinclair/typebox` mancava per davvero (a differenza dei due pacchetti
sopra, è un pacchetto pubblico normale, necessario a runtime per ogni
`parameters: Type.Object(...)`) ed è stato installato con `npm install
@sinclair/typebox --no-save`.

Dato che TUTTO lo stato mutabile dell'estensione è chiuso dentro la
closure della funzione esportata di default (nessun `let`/`const` a
livello di modulo prima della riga 617 — verificato leggendo il file),
la STESSA istanza del modulo caricato può essere invocata una volta per
ogni agente simulato, ottenendo stato pienamente isolato per ciascuno —
esattamente come processi `pi` reali separati, senza bisogno di worker
thread o processi Node separati. Un piccolo harness (`FakeInstance`)
fornisce oggetti `pi`/`ctx` fedeli alla shape reale (`registerFlag`,
`getFlag`, `registerTool`, `on`, `registerCommand`, `appendEntry`,
`sendMessage`, `ctx.cwd`/`ctx.ui.notify`/`ctx.ui.setWidget`/
`ctx.sessionManager.getBranch`) e guida ogni istanza attraverso
`session_start` → `before_agent_start` → chiamate tool reali → (quando
serve simulare la fine di un turno LLM) `agent_end`, il tutto contro:
- un broker mosquitto locale reale (`mqtt://127.0.0.1:1883`) — pub/sub
  MQTT genuino, non simulato;
- worktree git reali dentro una scratch repo temporanea;
- `agents/agents.yaml`, `agents/roles.yaml` e tutti i `prompts/*.md`
  REALI di questo progetto, copiati (non reinventati) nella scratch repo;
- un server HTTP locale reale che finge Evolution API (stessa tecnica di
  `smoke-test-whatsapp-notify.mjs`), per verificare la notifica WhatsApp
  end-to-end come parte del flusso intero, non isolata.

**6 scenari eseguiti, 50 asserzioni, tutte contro il codice vero**:
1. Flusso completo di successo: planner → `worktree_list_open` (vuoto) →
   `worktree_create` → `plan_set` (2 fasi, fase 2 in parallelo
   `security-evaluator`+`docs-sync`) → gate reale di `agent_send` che
   rifiuta un invio a una fase locked → coder implementa per davvero
   (`isPalindrome` scritto su disco nel worktree) → reviewer approva →
   `agent_await` reale (non solo `agent_get` in polling) → `plan_advance`
   → fan-out parallelo reale a `security-evaluator`+`docs-sync` (via MQTT
   vero, non simulato) → `file_claim`/`file_release` → entrambi
   completano → `plan_advance` finale → `worktree_finalize` con merge
   git reale, rimozione worktree dal disco verificata, report presente
   nella directory principale, e la vera chiamata HTTP alla notifica
   WhatsApp verificata riga per riga (metodo, path, header `apikey`,
   corpo `{number, text}`).
2. Eccezione TDD (`tdd-agent` da solo in fase 1 → `coder` in fase 2 →
   `docs-sync` in fase 3) contro il vero validatore di `plan_set`: sia il
   rifiuto (piano senza `docs-sync` in ultima fase, piano TDD senza
   `coder` in fase 2) sia l'accettazione del piano valido, tutti contro
   la funzione reale, non un mirror.
3. `worktree_list_open` che scopre per davvero un worktree lasciato aperto
   da una "sessione precedente" (istanza fresca, senza alcuna memoria
   della precedente) — lo scenario esatto dell'incidente reale della
   Revisione 24 — seguito da un `worktree_abandon` reale di pulizia.
4. `worktree_finalize` bloccato da modifiche non committate nella
   directory principale (verificato che il worktree resti intatto e che
   il merge non parta nemmeno), poi un VERO conflitto di merge git
   (stessa riga di `README.md` modificata sia nel worktree che su main)
   con l'elenco automatico dei file in conflitto verificato contro il
   nome file reale, seguito da una risoluzione manuale simulata (cherry-
   pick diretto su main, bypassando `worktree_finalize` — lo stesso
   pattern dell'incidente reale) e pulizia con `worktree_abandon`.
5. Contesa reale `file_claim`/`file_release` tra due istanze
   `security-evaluator` sullo stesso worktree: seconda istanza rifiutata
   con il nome di chi detiene il lock, `file_release` senza detenerlo è
   un no-op reale, riclaim dopo il rilascio funziona.
6. Uno specialista (`security-evaluator`) trova un problema e invia
   DIRETTAMENTE a `coder` (bypassando reviewer) via `agent_send` reale
   con MQTT vero, e la risposta del coder torna allo STESSO specialista
   che aveva sollevato il problema, non a reviewer — la regola della
   Revisione 20, verificata qui per la prima volta contro il codice vero
   invece che contro un mirror.

**Esito: nessun bug trovato in `extensions/orchestrator.ts`.** Tutte le
50 asserzioni sono passate contro il codice reale senza richiedere
nessuna modifica alla logica dell'estensione. Onestà sul dove SONO stati
trovati bug — nell'harness stesso, non nel codice sotto test, corretti
prima di considerare il lavoro concluso:
- una race condition in `waitForInboundTask` (il helper dell'harness che
  attende la consegna reale via MQTT di un task): restituiva "l'evento
  più recente finora" invece di "l'evento a una posizione precisa",
  quindi due invii quasi simultanei verso la stessa istanza (il fan-out
  parallelo dello scenario 1) potevano far restituire lo stesso evento a
  due asserzioni diverse — un problema del test, non del codice reale
  (che consegnava entrambi i messaggi correttamente); corretto indicizzando
  per posizione esatta invece che "ultimo".
- il processo restava appeso dopo un'asserzione fallita, perché le
  istanze `FakeInstance` non ancora chiuse mantengono socket MQTT reali
  aperti (e i relativi timer) che tengono vivo l'event loop di Node;
  corretto tracciando ogni istanza creata e chiudendole tutte in un
  blocco `finally`, con uscita forzata (`process.exit`) a valle.
- un residuo di codice morto (una `fs.writeFileSync` con un path costruito
  male, mai raggiunta per davvero grazie a un mkdir successivo) rimosso.

**Verifica**: rieseguita anche l'intera suite di regressione esistente
dopo aver scritto/corretto l'harness — 12 smoke test, `check-syntax`,
`check-skill-isolation` — tutti verdi, nessuna modifica necessaria a
`extensions/orchestrator.ts` (questa revisione non tocca quel file: è
solo un nuovo strumento di verifica). **Non verificato**: nessun test
contro il binario `pi` reale o contro un vero ciclo di turni LLM — questo
harness sostituisce deterministicamente le decisioni che prenderebbe un
agente reale (FakeInstance guida i tool esattamente come farebbe un
planner/coder/reviewer/specialista, ma senza nessun LLM nel mezzo); MQTT
con TLS (`mqtts://`) o autenticazione username/password non testati (il
broker locale usato è senza auth); il lancio reale via herdr/tmux resta
non testato (nessun multiplexer di terminale reale in questo sandbox);
nessuno stress test con concorrenza oltre lo scenario di contesa
deliberata dello scenario 5.

## Revisione 24: incidente reale — una feature su 3 worktree, merge caotico + 5 richieste dell'utente

**Trovato dall'utente in un test reale**, con un planner reale in produzione
sul suo repo (non nel mio sandbox): ha chiesto la validazione del codice
fiscale in tre occasioni distinte, e ogni sessione planner — senza memoria
delle precedenti — ha creato il proprio worktree/branch (`task/codice-
fiscale`, `task/codice-fiscale-api`, `task/codice-fiscale-backend`) per
quella che era, concettualmente, la stessa funzionalità. Al momento di
integrare, il planner reale ha scoperto la frammentazione, ha trovato
anche la directory principale del progetto con modifiche non committate
(quasi certamente dall'aver applicato un aggiornamento di questo pacchetto
copiando i file dentro senza mai fare `git commit`), e — di fronte a un
conflitto di merge su `worktree_finalize` — ha bypassato il tool del tutto,
facendo un cherry-pick manuale di file specifici (`git checkout
task/codice-fiscale -- <file>`) direttamente nella working tree di main.
Ha funzionato (i test passavano), ma ha lasciato un worktree orfano che
nessun meccanismo esistente avrebbe mai ripulito, e un report frammentato
su più file invece che uno solo. L'utente ha poi fatto cinque richieste
esplicite, riportate qui integralmente perché ciascuna ha guidato una
parte distinta del fix:

1. Eliminare per sempre il problema dei worktree multipli per lo stesso
   task, e far riverificare `file_claim`/`file_release` per i conflitti a
   livello di singolo file tra agenti.
2. Un'unica cartella `reports/` per task, con tutti gli eventi in ordine
   cronologico, invece di una per ogni worktree.
3. Cancellare le cartelle worktree una volta che tutto è stato riportato
   nella directory principale.
4. Notifica WhatsApp per QUALUNQUE blocco/errore/domanda oltre lo scoping
   iniziale del planner, evitando però situazioni bloccanti quando non sono
   davvero necessarie.
5. Un ruolo di documentazione **sempre presente alla fine di ogni task**,
   con contenuto adattato al tipo di progetto (installazione per progetti
   di sviluppo, documentazione pertinente altrimenti).

**Diagnosi**: nessuna di queste è in realtà un bug isolato — sono
sintomi collegati della stessa causa radice. `worktree_create` è per-slug
by design (corretto), ma **niente permetteva a una nuova sessione planner
di scoprire un worktree già aperto e non finalizzato da una sessione
precedente**, quindi ogni richiesta "nuova" per la stessa feature generava
uno slug nuovo. Il report-per-worktree (richiesta 2) è conseguenza diretta
della moltiplicazione dei worktree, non un problema a parte: un solo
worktree per feature produce già un solo report (`reportPath()` scrive
dentro il worktree e il file finisce nella directory principale intatto
dopo un merge riuscito — verificato leggendo il codice, non serviva
cambiarlo). La cancellazione del worktree dopo successo (richiesta 3) era
**già implementata** in `worktree_finalize` (`git worktree remove` dopo un
merge riuscito) — il caso visibile nell'incidente era quello di un
conflitto (correttamente NON cancellato per permettere la revisione
manuale) aggravato dalla risoluzione manuale che ha bypassato il tool,
lasciando il worktree orfano perché nulla chiama mai `git worktree remove`
in quel percorso. Le notifiche WhatsApp (richiesta 4) esistevano solo sul
percorso di successo di `worktree_finalize`, mai su conflitto/blocco/stallo.
Il ruolo `docs-sync` (richiesta 5) esisteva già nel roster ma era
opzionale, proposto dinamicamente dal planner — poteva essere (ed è stato,
implicitamente, in questo genere di incidenti) dimenticato.

**Fix, in `extensions/orchestrator.ts`:**

- **`worktree_list_open`** (tool nuovo): elenca ogni worktree ancora aperto
  sotto `.worktrees/` — slug, branch, ultimo commit, e la riga `Task:` del
  suo report se esiste — leggendo `git worktree list --porcelain` più i
  file di report reali, nessuno stato nuovo da mantenere. `prompts/
  planner.md` ora impone di chiamarlo PRIMA di `worktree_create` per ogni
  task nuovo, e di chiedere esplicitamente all'utente se un worktree già
  aperto è la stessa cosa prima di crearne un altro.
- **`worktree_finalize`**: aggiunto un controllo preliminare — se la
  directory principale ha modifiche non committate, il merge non viene
  nemmeno tentato, ritorna un errore esplicito (`blocked_dirty_main`) e
  invia una notifica WhatsApp, invece di rischiare un merge fuorviante o,
  peggio, "pulito" ma sbagliato. Su un vero conflitto di merge, i file in
  conflitto vengono ora elencati automaticamente (`git diff --name-only
  --diff-filter=U` prima dell'abort, quando l'informazione è ancora
  disponibile) invece di lasciare solo il messaggio grezzo di git — e anche
  qui parte una notifica WhatsApp. Il percorso di successo è invariato.
- **`worktree_abandon`** (tool nuovo): chiude un worktree SENZA tentare
  merge — per il caso, visto nell'incidente reale, in cui il lavoro è già
  atterrato in main in altro modo (risoluzione manuale). Rifiuta se il
  worktree ha ancora modifiche non committate (per non perdere lavoro in
  silenzio), preserva il report copiandolo nella directory principale se
  non c'è già, rimuove worktree e branch (force-delete, dato che dopo una
  risoluzione manuale il branch potrebbe non essere raggiungibile dalla
  history di main), invia notifica WhatsApp.
- **`plan_set`**: nuova validazione strutturale — l'ULTIMA fase di
  qualunque piano deve includere `docs-sync`, altrimenti il tool rifiuta la
  dichiarazione del piano, esattamente con lo stesso meccanismo (ed
  esattamente per la stessa ragione: una regola che vive solo in prosa può
  essere violata da una decisione sbagliata in un momento di distrazione,
  vedi Revisione 20) già usato per "coder sempre in fase 1". Si applica
  solo ai task per cui il planner chiama `plan_set` — i task di sola
  documentazione restano ungated come prima, dato che IL TASK STESSO è già
  la documentazione.

**`agents/roles.yaml`**: brief di `docs-sync` ampliata per coprire
esplicitamente cosa deve produrre ora che è sempre l'ultima fase (cos'è il
progetto, come installarlo, cosa è stato fatto in QUESTO task, come
usarlo), più il caso dei task che non toccano codice (documentazione
mirata al task, senza sezioni che non hanno senso, es. niente
"installazione" se non pertinente).

**`prompts/planner.md`**: aggiunto l'uso di `worktree_list_open` prima di
`worktree_create` (punto 3 di "Quando l'utente ti chiede di sviluppare
qualcosa"), la regola `docs-sync` sempre in ultima fase (punto 6 di
"Selezione dinamica del team", oltre alla sezione sul piano come tool),
`notify_whatsapp` esplicito allo stallo dopo 3 round e a qualunque altro
blocco che richieda una decisione dell'utente oltre lo scoping iniziale,
una nota su come chiudere un worktree con `worktree_abandon` dopo una
risoluzione manuale, e una nota esplicita per **non bloccarsi quando non
serve davvero** (solo le decisioni che l'utente deve prendere lui
concettualmente meritano un HALT). **`prompts/coder.md`/
`prompts/specialist.md`**: `file_claim`/`file_release` ri-verificati contro
il codice reale (`extensions/orchestrator.ts`, righe ~2180-2250) — il
meccanismo advisory-lock era già corretto e non ha richiesto modifiche di
comportamento, solo linguaggio rafforzato ("nel dubbio, fai comunque la
claim") dato che worktree più longevi e riusati tra sessioni (grazie al
fix di cui sopra) rendono la sovrapposizione tra agenti più probabile, non
meno.

**Verifica**: suite completa riverificata verde — 12 smoke test (inclusi 2
nuovi casi in `smoke-test-plan-gate.mjs` per il rifiuto/accettazione del
vincolo `docs-sync`, e 3 nuovi casi in `smoke-test-worktree.mjs` per il
blocco su directory principale sporca, l'elenco automatico dei file in
conflitto, `worktree_list_open` e `worktree_abandon` — tutti contro repo
git reali in scratch directory, stesso pattern degli altri test worktree),
`check-syntax`, `check-skill-isolation`. I tre smoke test che richiedono un
broker MQTT reale (`smoke-test.mjs`, `smoke-test-pipeline.mjs`,
`smoke-test-multiround.mjs`) sono stati eseguiti con un broker mosquitto
locale avviato apposta e sono verdi. **Non verificato**: il fix per il
problema dei worktree multipli (`worktree_list_open` + la nuova istruzione
nel prompt del planner) non è stato testato contro un `pi` reale in un
secondo incidente live — la prossima volta che l'utente avvia una nuova
sessione planner per una feature potenzialmente già in corso è il test
reale che manca.

**Addendum (stessa giornata)**: risincronizzato anche il diagramma di
flusso completo, rimasto fermo alla Revisione 22 (non risincronizzato
nemmeno con la Revisione 23) — aggiunti i nuovi passi/nodi
`worktree_list_open`, il controllo di sovrapposizione worktree con
conferma esplicita all'utente, il vincolo `docs-sync` in `plan_set`, il
controllo preliminare + elenco file in conflitto + `worktree_abandon` in
`worktree_finalize`, herdr/tmux al posto di herdr/paseo (Revisione 23,
mai risincronizzato prima d'ora), e le notifiche WhatsApp sui casi di
blocco (con un'icona 📱 dedicata in legenda). Rigenerato con
`mmdc`/layout elk, verificato con uno screenshot reale della pagina HTML
risultante (non solo lettura del sorgente Mermaid) prima della consegna.
Il sorgente Mermaid è ora anche vendorizzato nel repo stesso, come
richiesto dall'utente, in **`docs/architecture.mmd`** — prima esisteva
solo come file di lavoro fuori dallo zip consegnato; ora chiunque cloni
il repo può rigenerare il diagramma senza dover chiedere di nuovo il
sorgente.

## Revisione 23: bug reale — paseo non lancia le istanze, sostituito con tmux

**Trovato dall'utente in un test reale**, non da me: ha chiesto a un
planner reale (avviato con `scripts/launch-planner.mjs`) di lanciare un
team di 5 istanze su un task vero (`codice-fiscale-backend`, piano TDD:
fase 1 `tdd-agent`, fase 2 `coder`, fase 3 `openapi-writer` +
`postman-collection-creator`). `paseo agent ls` mostrava le 5 istanze come
"idle" — sembravano partite — ma `agent_list` (presenza MQTT) restituiva
costantemente 0 peer, e nessun processo con `orchestrator.ts` nel comando
era visibile con `pgrep`. L'utente (tramite il planner reale) ha fatto un
lavoro di diagnosi eccellente in autonomia: broker MQTT su, porta 1883
aperta; `check-syntax` verde; `-e`/`--extension` è un flag reale di `pi`
(confermato da `pi --help`); un lancio diretto `nohup pi -e
extensions/orchestrator.ts --instance ... --role ... > log 2>&1 &`
(bypassando paseo del tutto) produceva ANCH'ESSO nessun processo
persistente e un log completamente vuoto.

**Causa radice, confermata in due parti separate:**

1. **`pi` richiede un vero TTY.** Un'app da terminale interattiva lanciata
   con stdout rediretto su file e in background (`nohup ... &`) esce
   subito, senza errori, senza output — comportamento atteso per questa
   classe di tool (non un bug dell'estensione), ma non documentato
   esplicitamente da nessuna parte finora. È esattamente il motivo per cui
   herdr/paseo sono stati scelti come meccanismo di lancio fin dall'inizio
   — ma va detto esplicitamente, per evitare che un futuro planner (o
   l'utente) perda tempo a diagnosticare un "bug" che è in realtà
   comportamento normale.
2. **`paseo run` non esegue comandi letterali — il mio integrazione della
   Revisione 21 (seguito 3) era sbagliata.** Ho ri-verificato
   paseo.sh/docs/cli con una fetch mirata dopo la segnalazione: il testo
   dopo `--provider <nome>` (incluso quello dopo un eventuale `--`) è un
   **prompt in linguaggio naturale** consegnato all'agente scelto come
   provider, non argv letterali di un comando da eseguire — non esiste
   nella documentazione ufficiale nessun sottocomando `exec`/`shell` per
   eseguire un comando così com'è dentro il pty di un workspace. La
   sintassi che avevo documentato (`paseo run --title <nome>
   --new-workspace local --background -- pi -e extensions/orchestrator.ts
   --instance <nome> --role <ruolo>`) veniva quindi consegnata a `pi` COME
   PROMPT: l'estensione non veniva mai caricata, `--instance`/`--role` non
   venivano mai interpretati come flag, e la sessione non si connetteva mai
   a MQTT — da qui gli "idle" in `paseo agent ls` e gli 0 peer in
   `agent_list`. Errore mio: la Revisione 21 (seguito 3) aveva scritto
   questa sintassi da documentazione pubblica ma **senza verificarla contro
   un caso d'uso reale** (era già segnalato "mai verificata contro un
   binario reale", ma il rischio concreto — che il meccanismo fosse
   strutturalmente incompatibile con quello che serve qui, non solo con
   sintassi leggermente sbagliata — non era stato colto).

**Fix**: `paseo` rimosso come opzione di lancio istanze in
`prompts/planner.md` (punto 8) — se lo trova disponibile, il planner lo
ignora esplicitamente per questo scopo, con la spiegazione del perché
incorporata nel prompt (per evitare che un futuro planner ritenti). Al suo
posto, **tmux** come fallback quando herdr non è disponibile:
`tmux new-session -d -s <nome-istanza> -c <working-dir> "pi -e
extensions/orchestrator.ts --instance <nome-istanza> --role <ruolo>"` —
sintassi tmux standard, stabile da anni, niente da verificare come per
herdr/paseo (a differenza di paseo, `tmux new-session` esegue letteralmente
il comando che gli si passa). Aggiunta anche una nota esplicita e
inequivocabile all'inizio del punto 8: non lanciare MAI un'istanza con
`nohup`/`&`/output rediretto su file, per nessun motivo — serve sempre un
vero pty (herdr, tmux, o un terminale aperto a mano).

`extensions/orchestrator.ts`: `paseoDetectAndLog()` lasciata invariata nel
comportamento (resta un no-op fuori da paseo, innocua) ma il commento
aggiornato per spiegare perché non è più usata dal meccanismo di lancio.
README aggiornato (Quickstart, sezione "Prova manuale", nota sul TTY).
Nessuna modifica a `plan_set`/`plan_advance`/`agent_send`.

**Verifica**: suite completa (12 smoke test + check-syntax +
check-skill-isolation) riverificata verde — nessuno di questi test
copriva/copre il meccanismo di lancio herdr/paseo/tmux (sono script Node
puri, indipendenti da `pi`), quindi il fix qui è verificato solo a livello
di lettura della documentazione ufficiale di paseo (ri-fetchata apposta
dopo la segnalazione) e di coerenza logica col comportamento osservato
dall'utente — non con un nuovo test end-to-end reale con tmux (l'utente non
lo ha ancora provato). **Prossimo passo consigliato**: l'utente riprova il
lancio del team con la sintassi tmux aggiornata e conferma che `agent_list`
mostri finalmente i peer attesi.

## Revisione 22: skill esterne vendorizzate (wayfinder/to-spec) solo per planner

Richiesta esplicita dell'utente: dare al solo ruolo `planner` accesso a due
skill esterne del repo pubblico [`mattpocock/skills`](https://github.com/mattpocock/skills)
— `wayfinder` (scompone un task grande/ambiguo in una mappa di ticket di
decisione) e `to-spec` (collassa la mappa/conversazione in una spec unica) —
senza `to-tickets`/`implement` (esplicitamente fuori scope) e senza nessuna
dipendenza da GitHub Issues.

**Vendoring (commit pinnato)**: clonato `mattpocock/skills` al commit
`9c9f36ccd3995266cd675468af71639c8dde1ec5` (2026-08-18), letti i `SKILL.md`
di `wayfinder`/`to-spec` prima di copiare qualunque file (nessuno script
eseguibile presente in nessuna delle skill vendorizzate — solo `SKILL.md` +
`agents/openai.yaml` + qualche `.md` di riferimento, quindi nessun rischio
di esecuzione alla cieca). Due dipendenze dirette scoperte leggendo i
`SKILL.md` (non anticipate nella richiesta originale, tranne `grilling` che
l'utente aveva già previsto):

- **`grilling`** — la primitiva di interrogazione a round, invocata da
  `wayfinder` incondizionatamente in ogni sessione di charting.
- **`domain-modeling`** — scoperta durante il vendoring: `wayfinder` la
  invoca esattamente negli stessi punti incondizionati di `grilling`
  ("call the Skill tool twice, for 'grilling' and 'domain-modeling'").
  Senza vendorizzarla, ogni charting fallirebbe quel passo.
- **`setup-matt-pocock-skills`** — richiesta da entrambe `wayfinder` e
  `to-spec` per configurare tracker/vocabolario del repo la prima volta.

Deliberatamente **non** vendorizzate: `research` e `prototype`, referenziate
da `wayfinder` ma solo condizionatamente (solo se un ticket di quel tipo
specifico viene creato) — vendorizzarle avrebbe ampliato lo scope ben oltre
le due skill richieste. Limite noto documentato in
`skills-vendor/mattpocock/VERSION.md`, `docs/agents/issue-tracker.md` e
`prompts/planner.md`: un ticket `research`/`prototype` generato da
wayfinder non è risolvibile in questo repo, il planner lo segnala
all'utente invece di tentare.

Le 5 skill vendorizzate vivono in `skills-vendor/mattpocock/<nome>/`, **fuori**
da `.pi/skills/`, `~/.pi/agent/skills/` e `.agents/skills/` — deliberatamente,
per non attivare la discovery automatica di Pi su tutti i ruoli. Changelog
completo del pin, motivazione di ogni skill vendorizzata, e procedura per un
aggiornamento futuro consapevole in `skills-vendor/mattpocock/VERSION.md`.

**Wiring per-ruolo — scoperta che ha cambiato l'approccio**: l'ipotesi di
partenza (un punto in `extensions/orchestrator.ts` dove il `--role` passato
determina gli argomenti del processo `pi` lanciato) non esiste nel codice —
verificato con un grep di `execFile`/`spawn`: l'unico uso è per il
self-report/rename verso herdr e per `git`, mai per lanciare un nuovo
processo `pi`. Le istanze del team vengono lanciate dal planner stesso via
shell seguendo `prompts/planner.md` (mai per un altro planner — l'architettura
non ne spawna mai un secondo); planner-01 stesso viene avviato a mano
dall'utente. Chiesto conferma esplicita all'utente su come procedere: creato
**`scripts/launch-planner.mjs`**, un vero artefatto di codice che compone il
comando `pi -e extensions/orchestrator.ts ... --role planner --skill <path>
--skill <path> ...` (i 5 path assoluti delle skill vendorizzate) e lo esegue
(`stdio: "inherit"`, sessione interattiva) — rifiuta esplicitamente se
qualcuno passa un `--role` diverso da `planner`. Supporta `--print-only` per
vedere il comando composto senza lanciarlo. README Quickstart e
`prompts/planner.md` aggiornati: planner-01 va SEMPRE avviato con questo
script, mai con `pi` a mano; per gli altri ruoli resta `pi` diretto, senza i
flag `--skill` di mattpocock (che non li riguardano).

**Setup del tracker**: eseguito il processo di `setup-matt-pocock-skills`
(esplorazione del repo, nessun `AGENTS.md`/`CLAUDE.md`/`CONTEXT.md`/remote
GitHub preesistente, skill `triage` non installata → Sezione B saltata,
nessun segnale di monorepo → single-context) scegliendo il tracker **"Local
Markdown"** (nessuna dipendenza da GitHub/GitLab Issues, come richiesto):
scritti `docs/agents/issue-tracker.md` e `docs/agents/domain.md` dai
template seed della skill, e creato `AGENTS.md` alla radice del repo con la
sezione `## Agent skills` (Issue tracker + Domain docs — niente sotto-sezione
Triage labels, `triage` non è installata).

**`agents/roles.yaml`**: aggiunte `wayfinder`/`to-spec` alla lista `skills`
del ruolo `planner` — resta un metadato dichiarativo/informativo, come già
per `skills`/`cli`/`mcp` sugli altri ruoli (vedi Revisione 21 (seguito));
il caricamento reale è quello di `scripts/launch-planner.mjs`, non questo
campo.

**`prompts/planner.md`**: nuova sezione "Scoping: quando usare
/skill:wayfinder invece delle domande dirette" — quando usarlo al posto
delle domande ad-hoc del punto 1 di "Selezione dinamica del team", il
limite noto su `research`/`prototype`, e la nota che il lancio è già
cablato dall'avvio (non serve fare nulla per "attivare" le skill). Aggiunta
anche una nota nel punto 8 (lancio del team) che chiarisce esplicitamente
che quelle istruzioni non riguardano mai un secondo planner.

**Verifica**: nuovo `scripts/check-skill-isolation.mjs` (6 controlli:
`skills-vendor/mattpocock/` fuori dalle directory di discovery automatica;
solo `planner` ha le skill mattpocock in `roles.yaml`; `launch-planner.mjs`
elenca tutte e 5 le skill; il comando composto con `--print-only` include
`--role planner` e i 5 path `--skill`; `launch-planner.mjs` rifiuta un
`--role` diverso da `planner`; nessun altro file del repo referenzia
`skills-vendor/mattpocock` fuori dai file attesi) — tutti verdi. Suite
completa (12 smoke test + check-syntax) riverificata verde, nessuna
modifica al comportamento di `plan_set`/`plan_advance`/`agent_send`.

**Verdetto onesto**: verificato con agenti reali — niente, in questa
revisione (nessun test e2e con subagenti impersonanti planner, a differenza
delle Revisioni 20/21). Verificato con logica/lettura del codice e comandi
reali eseguiti in questo sandbox — tutto il resto: il commit di
`mattpocock/skills` è stato clonato e letto per davvero (non assunto), i 5
`SKILL.md` letti integralmente prima di vendorizzare, `scripts/launch-planner.mjs`
eseguito per davvero con `--print-only` e verificato che rifiuta un
`--role` non-planner, `scripts/check-skill-isolation.mjs` eseguito ed è
verde, la suite di smoke test esistente rieseguita verde. **Non verificato**:
un vero binario `pi` non è installato in questo sandbox (stesso limite già
noto per herdr/paseo) — non è stato possibile lanciare un'istanza planner
reale e confermare che `/skill:wayfinder` risulti effettivamente riconosciuta
dal runtime `pi`, né che un'istanza coder realmente NON la veda. La sintassi
del flag `--skill <path>` è quella indicata dall'utente nella richiesta, non
verificata contro l'help reale del binario `pi` in questo sandbox (stessa
cautela già applicata a herdr/paseo: se non si comporta come atteso, non
indovinare varianti, chiedere indicazioni).

## Revisione 21 (seguito 3): eccezione TDD nel gate di fase + supporto paseo

Due richieste dirette dell'utente ("voglio", non domande):

**1. Eccezione TDD alla regola "coder sempre fase 1".** L'utente ha
osservato correttamente che per chi vuole sviluppare col paradigma TDD, il
`tdd-agent` deve scrivere i test PRIMA che coder implementi — quindi la
regola assoluta ("coder sempre fase 1, nessuna fase può precedere")
introdotta in Revisione 21 non è sempre vera. Ho rivisto la motivazione
originale della Revisione 20/21 ("nessuna fase può precedere coder perché
non ci sarebbe ancora codice su cui lavorare") e trovato che non si applica
al TDD: worktree e report vengono creati dal planner PRIMA che qualunque
fase parta, quindi `tdd-agent` ha già a disposizione la specifica del task
nel report — non ha bisogno del codice di coder per scrivere i test.

Eccezione implementata **a livello di codice**, deliberatamente stretta per
non riaprire il buco originale (uno specialista qualunque che si dichiara
"indipendente" per anticipare coder): la fase 1 può essere `["tdd-agent"]`
**da solo** se e solo se la fase 2 include `coder`. Non è ammesso
`tdd-agent` insieme ad altri ruoli in fase 1, e coder deve comparire
esattamente in fase 2 (non più tardi) — `coder` non può mai mancare dal
piano. Validazione in `plan_set` (`extensions/orchestrator.ts`) aggiornata
di conseguenza, con commento che spiega il ragionamento.

`prompts/planner.md`: la regola sulle fasi ora menziona esplicitamente
l'eccezione TDD e perché non si generalizza; aggiunta anche un'istruzione
proattiva — per task complessi o critici, il planner propone lui stesso
`tdd-agent` come parte del team, non solo se l'utente lo chiede
esplicitamente. `prompts/coder.md` aggiornato: se il piano usa l'eccezione
TDD, coder implementa contro la suite già scritta da `tdd-agent` (invece di
scriverne una nuova), può contattarlo via `agent_send` per chiarimenti, e
`tdd-agent` resta raggiungibile anche a fase 1 già completata (comportamento
già esistente del gate: i ruoli di fasi completate restano sempre
raggiungibili).

`scripts/smoke-test-plan-gate.mjs`: nuovi scenari 1b (piano TDD accettato),
1c (TDD + altro ruolo in fase 1 → ancora rifiutato), 1d (TDD senza coder in
fase 2 → rifiutato, coder non può mancare), 10b (gate: tdd-agent sempre
raggiungibile in fase 1, coder bloccato finché la fase 1 non avanza).

**2. Supporto paseo oltre a herdr.** L'utente vuole poter lanciare il team
di agenti anche con [paseo](https://paseo.sh) (github.com/getpaseo/paseo),
non solo herdr. Ricercata la CLI reale di paseo (architettura
client-daemon a "workspace", diversa da herdr che divide pannelli di
terminale): comandi documentati `paseo run --title <nome> --new-workspace
local|worktree --background -- <comando>`, `paseo ls/attach/send/logs/stop`,
env var `PASEO_AGENT_ID` (v0.1.34+) come modo confermato per un processo di
rilevare che gira sotto paseo.

`prompts/planner.md` (step di lancio del team) riscritto per rilevare quale
dei due strumenti è disponibile (`herdr --help`/`paseo --help`; se
entrambi, chiede all'utente quale usare; se nessuno, si ferma e chiede) e
usare la sintassi corretta per quello trovato — per paseo:
`paseo run --title <istanza> --new-workspace local --background -- pi -e
extensions/orchestrator.ts --instance <istanza> --role <ruolo>`
(`--new-workspace local`, non `worktree`, perché l'estensione gestisce già
da sé il proprio worktree con `worktree_create`; `--background` perché
sono istanze di ascolto a lungo termine, non comandi bloccanti).
Lato codice, `extensions/orchestrator.ts` aggiunge `paseoDetectAndLog()`
(chiamata in `session_start` accanto alle chiamate herdr esistenti):
rileva `PASEO_AGENT_ID` e lo registra nel log di debug, **senza** inventare
comandi di self-report/rename per paseo — a differenza di herdr
(`HERDR_PANE_ID` + `pane report-agent`/`agent rename`), non esiste nella
documentazione di paseo un comando equivalente confermato, quindi
l'integrazione resta volutamente solo di rilevamento, non fabbricata.
Come per herdr, esplicitamente documentato come "mai verificato contro un
binario paseo reale, solo contro la sua documentazione pubblica".

Nessuna rottura per gli utenti herdr-only: herdr resta il default provato,
paseo è un'alternativa aggiuntiva rilevata a runtime. Suite completa (12
script + check-syntax) riverificata verde dopo tutte le modifiche.

## Revisione 21 (seguito 2): 2 buchi reali trovati rispondendo a domande sul planner

L'utente ha segnalato un comportamento reale osservato in un test suo: ha
chiesto al planner un diagramma Mermaid del progetto, e il planner lo ha
prodotto **lui stesso** invece di delegarlo ad `architecture-diagrammer`.
Verificato nel prompt: la regola "NON implementarlo tu stesso" esisteva
SOLO dentro "Quando l'utente ti chiede di sviluppare qualcosa" — nessuna
regola equivalente e generica copriva richieste non di sviluppo (diagrammi,
documentazione, changelog). Aggiunta una nuova sezione in cima a
`prompts/planner.md` ("Il tuo ruolo: scomponi e delega, non eseguire") che
vale per QUALUNQUE richiesta, non solo lo sviluppo.

Rispondendo a un'altra domanda ("il planner può chiedere di creare un
nuovo specialista se non esiste nel roster?") ho trovato un secondo buco:
nessuna istruzione copriva questo caso. Aggiunto un passo esplicito in
"Selezione dinamica del team": se manca davvero una competenza nel roster,
il planner la propone all'utente (label + brief in stile roles.yaml) e, se
confermata, **aggiunge lui stesso una nuova voce ad `agents/roles.yaml`**
(file YAML normale, ha già i tool per leggerlo/scriverlo) — resta nel
roster per i task futuri, non va ripetuta.

Nessuna modifica al codice (`extensions/orchestrator.ts`), solo ai prompt.
Suite completa (12 script + check-syntax) riverificata verde.

## Revisione 21 (seguito): due follow-up da domande dell'utente sul repo

Dopo aver consegnato la Revisione 21, l'utente ha fatto domande puntuali di
audit sul repo (install/uso su un progetto esistente, `agents.yaml` vs
`roles.yaml`, `.gitignore`, prompt per specialista, skill/cli/mcp) — ho
risposto a tutte (vedi il messaggio in chat, non ripetuto qui) e applicato
due correzioni concrete che ha chiesto esplicitamente:

1. **Nota su `plan_set` e task che non toccano codice**: la validazione
   strutturale di `plan_set` rifiuta SEMPRE un piano la cui fase 1 non
   include `coder` — corretto per uno sviluppo, ma non calzava per task di
   sola documentazione/diagramma (`docs-sync`, `architecture-diagrammer`)
   dove non c'è nessun `coder` da mettere in fase 1. `prompts/planner.md`
   ora dice esplicitamente: per questi task NON chiamare `plan_set` affatto
   e delegare direttamente (il vincolo resta opt-in, quindi resta valido).
2. **Prompt dedicato per `security-evaluator`**: finora usava il template
   generico `specialist.md` come tutti gli altri 22 specialisti. Scritto
   `prompts/security-evaluator.md` su misura, con la checklist di
   sicurezza specifica emersa nei tre test e2e (esposizione PII/oracoli,
   rate-limit dimensionato al vero costo dell'operazione — non solo alla
   singola richiesta HTTP, osservabilità esterna quando più segnale si
   concentra in una chiamata sola, injection via chiavi non normalizzate,
   canali laterali da misurare per davvero non solo teorizzare) più il
   protocollo esplicito di riverifica-da-solo (Revisione 20).
   `scripts/smoke-test-specialist-prompt.mjs` aggiornato (usa `docs-sync`
   come esempio di fallback a `specialist.md`, aggiunto uno step dedicato
   che verifica che `security-evaluator` ora prenda priorità col proprio
   file). Suite completa (12 script + check-syntax) riverificata.

## Revisione 21: vincolo nel codice per l'ordine delle fasi + terzo test e2e

Su richiesta esplicita dell'utente, ho costruito la proposta lasciata aperta
a fine Revisione 20 ("il modo più affidabile per far rispettare l'ordine
delle fasi non è un agente osservatore, è un vincolo nel codice"). Il piano
di esecuzione a fasi, fino ad ora un file markdown libero
(`<slug>.plan.md`) scritto e aggiornato a mano dal planner, diventa un
**formato strutturato che il codice stesso legge e fa rispettare**.

**Design a due livelli** (`extensions/orchestrator.ts`):

1. **Validazione strutturale in `plan_set`** (solo il planner può chiamarlo):
   rifiuta un piano la cui fase 1 non include `coder`, o in cui un ruolo
   compare in più di una fase — esattamente il bug concreto della
   Revisione 20 (un planner che metteva `tdd-agent` in una fase prima di
   coder), ora impossibile da dichiarare, non solo scoraggiato in prosa.
2. **Validazione temporale in `agent_send`**: rifiuta — per chiunque, non
   solo per il planner — un invio verso un ruolo che appartiene a una fase
   ancora "locked" secondo il piano dichiarato, con un errore che indica
   quale fase precedente manca ancora. È l'unico controllo dell'intero
   codebase che blocca davvero un'azione invece di limitarsi a loggarla o
   segnalarla — una scelta deliberata: tutto il resto nel progetto resta
   best-effort per non introdurre fragilità, ma qui il costo di un falso
   positivo (un mancato invio quando in realtà andava bene) è molto minore
   del costo di un falso negativo (una fase che parte in anticipo).

Nuovi tool: `plan_set` (dichiara/estende il piano), `plan_advance` (segna
una fase completa, sblocca la successiva — no-op se già completa, rifiuta
se la fase è ancora locked), `plan_get` (sola lettura). Il vincolo è
**opt-in per task**: se `plan_set` non è mai stato chiamato per uno slug,
`agent_send` per quel task resta completamente libero come prima — nessuna
rottura di compatibilità con flussi ad hoc che non usano il piano.
`plan_set`/`plan_advance` generano comunque un `<slug>.plan.md` leggibile
in automatico, a scopo di consultazione, ma non è più la fonte di verità.

`prompts/planner.md` riscritto in tre punti (selezione del team, avvio di
un task nuovo, risveglio da reviewer/specialista) per usare i nuovi tool
invece di scrivere il file a mano; `coder.md`/`specialist.md` aggiornati
solo nei riferimenti descrittivi (non usano mai `agent_send` verso un
ruolo di fase 2+, quindi non erano soggetti al vincolo).

**Verifica**: nuovo `scripts/smoke-test-plan-gate.mjs` (11 scenari:
rifiuto strutturale fase-1-senza-coder, rifiuto ruolo-in-due-fasi, rifiuto
chiamante non-planner, invio a fase sbloccata sempre permesso, invio a
fase locked rifiutato, invio a ruolo fuori piano mai bloccato,
`plan_advance` non può saltare fasi, sblocco della fase successiva,
no-op su fase già completa, estensione di un piano preservando lo stato,
task senza piano = mai gated) — tutti verdi. Suite completa (12 smoke test
+ check-syntax) rieseguita dopo le modifiche: tutta verde.

**Terzo test e2e (agenti reali, stesso tipo di rigore delle Revisioni 20)**:
nuovo task sullo stesso progetto (endpoint batch `POST
/verifica-codice-fiscale-batch` sopra l'API di verifica esistente), team
coder/reviewer/security-evaluator/openapi-writer, planner reale con il
prompt riscritto — ha prodotto autonomamente un piano nella forma corretta
per `plan_set` (fase 1 = coder, fase 2 = security-evaluator +
openapi-writer in parallelo) senza bisogno di correzioni. **Verifica
mirata del vincolo**: mentre la fase 1 era ancora sbloccata-ma-non-completa
(reviewer non aveva ancora approvato), ho simulato un tentativo deliberato
di contattare `security-evaluator` (ruolo di fase 2) — rifiutato dal
codice reale con l'errore atteso; dopo `plan_advance(1)`, lo stesso invio
è stato immediatamente accettato. `scripts/review-log.mjs` sul run
completo conferma l'ordine causale esatto, incluso l'evento di rifiuto
registrato PRIMA di `plan_advance`, non dopo.

Il resto del flusso non è stato semplificato per far tornare i numeri:
reviewer ha trovato un vero bug (bypass del rate-limit su richieste
respinte prima della validazione, quota mai addebitata), corretto e
riverificato; security-evaluator ha trovato un problema reale specifico
del batching (un singolo HTTP hit può consumare un'intera finestra di
quota, invisibile a difese esterne basate sul conteggio richieste),
corretto con logging strutturato senza PII e riverificato dallo stesso
specialista (regola Revisione 20, non reviewer); openapi-writer ha
corretto due imprecisioni reali nella spec. Ogni round di test è stato
rieseguito in modo indipendente da me (non preso per buono dal report
dell'agente): 44 → 46 → 50 test, tutti verdi, zero regressioni. Merge in
main completato.

## Revisione 20: 3 correzioni da un'analisi e2e + bug reale in review-log.mjs + un secondo test di conferma

Su richiesta esplicita dell'utente, ho costruito e fatto girare un vero
test e2e (agenti reali, non script finti — vedi `claude/
e2e-codice-fiscale-analysis.md` nel progetto) sullo stesso task di un suo
test live precedente (API di verifica codice fiscale, stesso team coder/
reviewer/security-evaluator/openapi-writer), per capire se il flusso
avesse davvero "troppi round" come gli era sembrato. Dall'analisi sono
emersi 3 problemi concreti, corretti in questa revisione, più un bug reale
trovato per caso in `scripts/review-log.mjs` durante la riesecuzione della
suite di test.

**Correzione 1 — checklist di igiene HTTP spostata da security-evaluator a
reviewer.** Nel test, security-evaluator aveva dovuto rimandare indietro
un lavoro già approvato da reviewer per due problemi generici (limite
dimensione body assente, leak di un `TypeError` nativo nella risposta) —
controlli che non richiedono competenza di sicurezza specialistica.
`prompts/reviewer.md` ora include un punto 1b esplicito con questa
checklist, da verificare nello stesso round della revisione normale, non
dopo. `agents/roles.yaml` aggiorna la `brief` di `security-evaluator` per
non duplicare questi due controlli e concentrarsi su ciò che richiede
davvero competenza specialistica.

**Correzione 2 — regola unica su chi riverifica un fix richiesto da uno
specialista.** `prompts/coder.md` diceva sia "rimanda la mano a chi ti ha
scritto" sia "di norma comunque reviewer fa la verifica finale" — in
tensione tra loro, poteva risolversi diversamente da un run all'altro.
Deciso e reso esplicito: lo specialista che ha richiesto la correzione la
riverifica lui stesso (esegue di nuovo i suoi test/casi) — reviewer non
rientra in quel giro, la sua approvazione precedente resta valida.
Aggiornati sia `coder.md` che `specialist.md` con lo stesso testo,
eliminando l'ambiguità da entrambi i lati della conversazione.

**Correzione 3 — regola "coder è sempre fase 1" resa difensiva in
planner.md.** Facendo decidere team e piano a un planner "pulito" per
curiosità, avevo scoperto che poteva mettere uno specialista (`tdd-agent`)
in una fase PRIMA di coder, usando proprio l'eccezione prevista dal
prompt ("puoi lavorare in parallelo se non dipendi dal codice nuovo") per
giustificare una fase *precedente* invece che *parallela*. La regola in
`prompts/planner.md` ora è esplicita: "NESSUNA fase può precedere la fase
1", con l'esempio concreto di `tdd-agent` scritto direttamente nel prompt
come caso da NON ripetere (il worktree e il report vengono creati insieme
alla delega alla fase 1 — uno specialista "prima" di coder non avrebbe
nulla su cui lavorare).

**Bug reale trovato mentre ri-passavo la suite dopo queste modifiche**:
`scripts/smoke-test-debug-log.mjs` ha iniziato a fallire in modo
riproducibile (non c'entrava nulla con le correzioni sopra, sono prompt,
non codice). Causa: due eventi di istanze DIVERSE possono avere lo stesso
timestamp ISO (risoluzione al millisecondo) quando succedono abbastanza
vicini — e il sort di `review-log.mjs` non aveva un criterio per quel
caso, finendo per mettere un `wake_in` PRIMA dell'`agent_send_out` che
l'ha causato: esattamente la coppia che più conta per uno strumento
pensato per diagnosticare "chi ha svegliato chi". Primo tentativo di fix
(un comparatore "intelligente" dentro `.sort()` con un caso speciale per
questa coppia) non ha funzionato: se un comparatore restituisce 0 per la
maggior parte delle coppie e un valore diverso da zero solo per una
coppia specifica, non è un ordine totale valido, e V8 (Timsort) può
ignorare il vincolo (verificato: succedeva davvero). Fix vero: un secondo
passaggio esplicito e mirato DOPO il sort stabile per `ts`, che sposta
solo la coppia invio→risveglio con lo stesso `assignment_id` quando
davvero hanno lo stesso `ts` (mai quando il timestamp è realmente diverso
— lì l'ordine resta quello osservato, non va "corretto"). Aggiunto anche
un contatore monotono per-processo (`seq`) a ogni evento in
`extensions/orchestrator.ts`, per dare a `review-log.mjs` un aggancio in
più in futuro. Corretto anche l'assert del test stesso, che verificava la
posizione generica della stringa "planner-01"/"coder-01" nell'output
(fragile: coincide anche con le righe di `session_start`, dove un pareggio
di timestamp è innocuo) invece della riga specifica invio/risveglio che
il test dichiarava di voler verificare.

**Domanda dell'utente: un agente che guarda SOLO il flusso di scambi tra
agenti (non il codice) avrebbe potuto risolvere questi problemi a
runtime?** Risposta onesta, problema per problema:

- **Correzione 3 (ordine delle fasi)**: SÌ, ed è l'unico dei tre dove un
  osservatore-di-solo-flusso avrebbe potuto agire in modo davvero
  preventivo — confrontare il piano (`<slug>.plan.md`) con l'ordine reale
  degli `agent_send` è un controllo strutturale, non richiede leggere il
  codice. Ma la forma più affidabile di questo controllo non è un agente
  LLM che "nota" la violazione (può non notarla, o notarla tardi): è un
  vincolo scritto nel codice stesso (es. `agent_send` rifiuta un dispatch
  verso un ruolo di fase 2+ se il piano non segna la fase 1 completa) —
  deterministico, non costa un turno LLM, non dipende dal fatto che un
  agente "se ne accorga". Non l'ho implementato in questa revisione
  (richiederebbe che il piano diventi un formato che il codice può
  interpretare, non solo markdown libero per l'LLM planner — una scelta
  di design della Revisione 18 che avrebbe bisogno di essere rivista
  apposta) — lo lascio come possibile prossimo passo, vedi sotto.
- **Correzione 2 (chi riverifica dopo un fix di uno specialista)**: SOLO
  se la regola è già definita da qualche parte (come ho appena fatto).
  Senza una regola dichiarata, un osservatore non ha un "corretto" con cui
  confrontare il flusso osservato — può solo notare un pattern strano, non
  sa se è un errore. CON la regola definita (come ora), un osservatore
  potrebbe fare da rete di sicurezza aggiuntiva se un coder/specialista
  non la seguisse alla lettera (gli LLM non seguono le istruzioni al 100%
  delle volte) — ma è un controllo di riserva, non la soluzione primaria
  (che è appunto aver reso la regola inequivocabile nei prompt).
- **Correzione 1 (checklist di igiene mancante in reviewer)**: NO, e non
  per una limitazione implementativa ma di principio — un osservatore che
  guarda solo I MESSAGGI tra agenti non può sapere che manca un controllo
  sul CONTENUTO del codice; quello richiede leggere e capire il codice
  (esattamente il lavoro di reviewer/security). Al più, un osservatore
  potrebbe notare RETROSPETTIVAMENTE un pattern sospetto ("security ha
  respinto codice che reviewer aveva appena approvato" più volte in run
  diversi) e proporlo come materiale per una futura revisione dei prompt —
  è essenzialmente quello che ho fatto io a mano analizzando il primo
  test. Utile come segnale per migliorare i prompt nel tempo, ma non
  previene il problema nel run in cui accade.
- **Sul "fermare il flusso e far ricominciare"**: con l'architettura
  attuale (processi `pi` indipendenti coordinati via MQTT, ognuno gira il
  proprio turno LLM quando si risveglia) non esiste un modo per
  interrompere un turno agente GIÀ in corso — nessun segnale di
  "interrupt". Un agente osservatore potrebbe al massimo mandare un
  messaggio correttivo che l'agente "in errore" vedrà al SUO prossimo
  risveglio (dopo aver finito il turno corrente) — quindi è comunque
  "correggi al prossimo giro", non "ferma adesso", per qualunque
  violazione che non sia già prevenuta a monte (prima che l'agente
  sbagliato venga anche solo lanciato/attivato).

**In sintesi**: introdurre un agente "sempre presente" che guarda solo il
flusso avrebbe valore reale per UNA delle tre correzioni (l'ordine delle
fasi) se implementato come vincolo nel codice (non come agente LLM), e
come rete di sicurezza aggiuntiva per la seconda (con una regola già
definita). Per la terza (contenuto/qualità delle verifiche) serve
migliorare i prompt stessi, non un osservatore di flusso — è quello che
ho già fatto. Non l'ho costruito in questa revisione: resta una proposta
concreta per una prossima, con la scelta consapevole tra "vincolo nel
codice" (affidabile, ma richiede strutturare il piano oltre il markdown
libero attuale) e "agente osservatore" (più flessibile, ma solo
correttivo-al-turno-successivo, mai davvero preventivo a metà turno).

**Secondo test e2e, stesso task, con i prompt corretti** (per verificare
se le correzioni funzionano davvero, non solo sulla carta): il planner
"pulito" ri-testato con la regola rafforzata ora sceglie correttamente
(nessuna fase prima di coder — anzi, questa volta ha scelto di NON
includere affatto `tdd-agent`, giudicandolo ridondante col ciclo coder↔
reviewer, invece di provare a forzarlo in una fase sbagliata). Nel flusso
completo, reviewer ha approvato il coder al PRIMO round (la nuova
checklist ha funzionato: nessun rimando per igiene HTTP generica).
security-evaluator, ora scoperto dai controlli generici, ha però trovato
DUE problemi reali e distinti a un livello più profondo — un endpoint che
esponeva sempre il codice fiscale calcolato (un "oracolo" sfruttabile per
ricostruire CF di terzi da dati anagrafici pubblici) e, dopo il primo fix,
un rischio residuo di attribute-inference dato dall'assenza di
rate-limiting — richiedendo comunque 3 round di security-evaluator e 3 di
coder. **Risultato onesto, non edulcorato**: il conteggio totale round
(coder+reviewer+security+openapi) è rimasto lo stesso di prima (8), e il
tempo totale è stato più lungo (~20 minuti contro ~15) — non perché le
correzioni non abbiano funzionato (hanno funzionato esattamente come
previsto: reviewer cattura l'igiene generica al primo colpo, security si è
potuto concentrare su qualcosa di più sostanziale), ma perché in questo
run security ha scoperto un problema di sicurezza via via più profondo
mano a mano che il precedente veniva corretto — un pattern di revisione a
cascata legittimo (non rumore, non un difetto del processo), non
eliminabile semplicemente spostando controlli da un ruolo all'altro.
`scripts/review-log.mjs` sul secondo run conferma comunque zero anomalie
di flusso: fasi rispettate, nessuna partenza anticipata, causalità
invio→risveglio sempre corretta anche col fix del bug di sort.

**Verificato**: suite completa (11 script) + `check-syntax` ripassati
dopo le correzioni ai prompt, inclusa la nuova stabilità di
`smoke-test-debug-log.mjs` (5 run consecutivi, tutti verdi — prima
falliva in modo intermittente).

## Revisione 19: report come registro d'auditing completo + notifica WhatsApp di fine task

Due richieste distinte dopo un nuovo test live dell'utente (5 screenshot di
una sessione herdr reale: planner, coder-01, reviewer-01, security-01,
openapi-01).

**Parte A — il report non bastava a capire se il flusso era stato
rispettato.** L'utente ha notato nella status bar un momento in cui
coder-01, reviewer-01, security-01 e openapi-01 risultavano tutti "busy"
insieme, planner idle, e non aveva modo di dire dal solo report se fosse
corretto o un sintomo dello stesso bug della Revisione 18 (o un run
precedente ad essa). Richiesta esplicita: ogni `report_append` deve
registrare quando è avvenuto e lo stato di **tutti** gli agenti in quel
momento, così il report da solo (senza dover guardare i pannelli herdr in
diretta né incrociare `logs/*.jsonl`) è un registro sufficiente per
verificare — a mente fredda, anche da un'altra AI — se il flusso pianificato
dal planner (fasi, Revisione 18) è stato davvero rispettato.

**Fix**: nuova funzione `agentStatusSnapshot()` in
`extensions/orchestrator.ts` — costruisce una stringa con lo stato di ogni
agente noto: se stesso (calcolato da `inboundQueue.size`: `busy` se ha
lavoro in coda non ancora evaso, altrimenti `idle`, marcato `·io` per
distinguerlo dagli altri) più ogni voce nella `presence` Map (che finora
escludeva deliberatamente se stesso — per l'auditing serve invece la vista
completa, quindi lo snapshot la ricompone a parte). Due punti di scrittura:

- `report_append` ora appende sezione + una riga evento con timestamp e
  snapshot **nella stessa scrittura atomica** (`fs.appendFileSync` singola),
  non due scritture separate — altrimenti un altro agente potrebbe
  intercalare il proprio append fra le due e spezzare l'accoppiamento
  sezione↔stato.
- `agent_send` ha un nuovo parametro opzionale `slug`: se passato, dopo la
  pubblicazione MQTT tenta (best-effort, mai un throw se il report non
  esiste ancora o lo slug è sbagliato) di appendere anche lì una riga con
  mittente, destinatario, `assignment_id`, `hops`, `new_round` e lo stesso
  snapshot di stato. Tutti i prompt (`planner.md`, `coder.md`,
  `reviewer.md`, `specialist.md`) sono stati aggiornati con un'istruzione
  esplicita "passa sempre `slug` a `agent_send`" — senza quello, il report
  perde la metà degli eventi (gli invii, non solo gli append di sezione).

**Verificato**: nuovo `scripts/smoke-test-report-audit.mjs` (repo git
reale, mirror esatto di `agentStatusSnapshot()`/`report_append`/`agent_send`
con `presence` simulata) — conferma che sezione ed evento arrivano in un
unico append atomico, che lo stato di se stessi è marcato `·io` ed è
corretto in base al carico simulato, che ogni agente noto compare nello
snapshot, che l'audit di `agent_send` registra l'`assignment_id` (per
incrociarlo con `logs/*.jsonl`), e che uno slug mancante/sbagliato non fa
mai fallire l'invio del messaggio, solo salta silenziosamente l'audit.

Sull'osservazione specifica dello screenshot (quattro agenti "busy" insieme,
planner idle): non posso dire con certezza se quel run fosse precedente al
fix della Revisione 18 o si trattasse di un caso legittimo (una fase con più
ruoli in parallelo, che nel design è normale — es. più specialisti nella
stessa fase). Con questo audit trail, però, il prossimo test live lo dirà
in modo inequivocabile: basta guardare, nel report, se i "busy"
contemporanei corrispondono davvero a una fase del piano con più ruoli
assegnati insieme, o se invece uno di quegli agenti non ha mai ricevuto un
`agent_send` (quindi ha agito di propria iniziativa, lo stesso bug di prima).

**Parte B — notifica WhatsApp di fine task via Evolution API.** Richiesta:
quando il planner considera un task concluso (dopo `worktree_finalize`),
inviare un messaggio WhatsApp al numero in `DESTINATION_PHONE_NUMBER` (file
`.env`), tramite [Evolution API](https://github.com/EvolutionAPI/evolution-api).

**Attenzione a un nome ambiguo**: "instance" in Evolution API indica una
connessione/sessione WhatsApp autenticata (es. `mio-whatsapp`) — un concetto
completamente diverso dalla "istanza" di questo progetto (un agente pi come
`coder-01`). Ho tenuto i due concetti esplicitamente separati nei nomi delle
variabili (`EVOLUTION_INSTANCE_NAME`, non `INSTANCE_NAME`) e li ho
documentati con un commento dedicato in `.env.example`, proprio per evitare
confusione con `identity.instance` usato ovunque nel resto del codice.

**Implementazione**: nessuna nuova dipendenza npm. Un parser `.env`
scritto a mano (`loadEnvFile`/`getEnvVar` in `extensions/orchestrator.ts` —
gestisce commenti, righe vuote, valori tra virgolette; `process.env` ha
sempre precedenza sul file, la convenzione standard di dotenv) e `fetch`
nativo di Node per la chiamata HTTP (nessun client HTTP aggiuntivo). La
forma della richiesta, confermata contro la documentazione reale
dell'API v2: `POST {EVOLUTION_API_URL}/message/sendText/{EVOLUTION_INSTANCE_NAME}`,
header `apikey: <EVOLUTION_API_KEY>` (non `Authorization: Bearer`), corpo
`{"number": "<DESTINATION_PHONE_NUMBER>", "text": "<messaggio>"}`.
`worktree_finalize` ora, dopo il merge andato a buon fine, chiama
`sendWhatsAppNotification()` con un messaggio di default (personalizzabile
via nuovo parametro opzionale `notify_message`) — **best-effort e non
bloccante**: se `.env` manca, mancano variabili, o Evolution API risponde con
errore, il task resta comunque completato e salvato (il merge è già
avvenuto prima della notifica); l'esito (riuscita o motivo del fallimento)
viene solo registrato nel report e nel log di debug, mai propagato come
errore del task. Aggiunto anche un tool `notify_whatsapp` standalone, per
un eventuale invio manuale fuori dal flusso di `worktree_finalize`.

**Privacy**: il numero di destinazione viene mascherato (tutte le cifre
tranne le ultime 3) prima di finire scritto nel report — il report vive nel
repository/worktree, non è il posto giusto per un numero di telefono in
chiaro.

**Verificato**: nuovo `scripts/smoke-test-whatsapp-notify.mjs` — usa un vero
server HTTP locale (`node:http`, nessuna rete reale, nessun messaggio
WhatsApp davvero inviato) al posto di Evolution API per verificare la forma
esatta della richiesta (metodo, path, header `apikey`, corpo JSON), il
parsing corretto del `.env`, il caso di configurazione mancante (mai un
throw, elenca le variabili mancanti), e il caso di risposta di errore
dell'API (status HTTP e corpo della risposta entrambi presenti nel
dettaglio, non silenziati).

**Da confermare con l'utente**: non ho potuto verificare i nomi esatti delle
variabili nel suo `.env` reale (bridge verso la macchina locale non
disponibile in questa sessione) — ho usato `EVOLUTION_API_URL`,
`EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`, `DESTINATION_PHONE_NUMBER`
(quest'ultima esplicitamente indicata dall'utente); se il suo file usa nomi
diversi vanno allineati.

**Suite completa**: 11 script (i precedenti 9 + `smoke-test-report-audit.mjs`
+ `smoke-test-whatsapp-notify.mjs`) più `check-syntax`, tutti ripassati da
zero dopo queste modifiche — tutti OK.

## Revisione 18: il team parte tutto insieme — mancava un piano di esecuzione

Bug reale segnalato dall'utente in un test live: con un team dinamico
confermato, reviewer (e quasi tutti gli specialisti) sono partiti **subito**
invece di aspettare il loro turno.

**Causa**: `prompts/planner.md` diceva al planner di usare `agent_send` per
delegare "a ciascun ruolo del team confermato" — coder E ogni specialista
scelto, tutti nello stesso passo, nello stesso turno. Non esisteva nessun
passo in cui il planner decidesse un ORDINE: solo *chi* far parte del team,
mai *quando* ciascuno dovesse iniziare. Con la vecchia architettura statica
(planner→coder→reviewer→planner fisso, tre soli ruoli) l'ordine era
implicito nei prompt stessi (reviewer.md dice "aspetta un task da coder");
con il roster dinamico introdotto nella Revisione 15, quell'implicito è
sparito ma il codice/i prompt non l'hanno mai sostituito con qualcosa di
esplicito.

Architetturalmente il meccanismo di risveglio è corretto (verificato
leggendo `extensions/orchestrator.ts`): un turno parte SOLO quando
`handleCommand()` riceve un vero comando MQTT (`agent_send`), e
`herdr agent start ... -- -e extensions/orchestrator.ts --instance X --role
Y` lancia un'istanza vuota, senza nessun task incluso nel comando di
lancio. Quindi il colpevole non era il lancio delle istanze né il
meccanismo di risveglio — era semplicemente che il planner, seguendo il
proprio prompt alla lettera, mandava un `agent_send` a TUTTI subito.

**Fix — un piano di esecuzione a fasi, costruito e gestito dal planner a
runtime** (esattamente come proposto dall'utente): il planner ora, in fase
di selezione del team (`prompts/planner.md`, "Selezione dinamica del
team"), oltre a scegliere CHI include nel team costruisce anche un ordine —
una sequenza di **fasi**, ognuna con uno o più ruoli che partono insieme,
dove una fase parte solo quando TUTTI i ruoli della fase precedente hanno
segnalato il completamento:

- coder è sempre nella fase 1 (il suo eventuale ciclo di correzione diretto
  con reviewer resta un dettaglio interno di questa fase, non fasi
  separate — la fase 1 è completa solo quando reviewer approva
  definitivamente);
- ogni specialista, di default, va in una fase successiva a quella di
  coder — lo si mette in parallelo con coder SOLO con un'eccezione
  esplicita, motivata insieme al resto del team nella stessa proposta
  all'utente (es. un `architecture-diagrammer` che documenta l'architettura
  ESISTENTE, non dipende dal codice nuovo);
- ruoli senza dipendenze reciproche né rischio di collisione sui file vanno
  nella stessa fase (partono insieme); ruoli che dipendono dal lavoro di UN
  ALTRO specialista vanno in una fase ancora successiva a quella.

Il piano viene presentato all'utente **insieme** al team, nello stesso
messaggio di conferma (non è un dettaglio nascosto), e scritto in un file
proprio del task, `<worktree_path>/reports/<slug>.plan.md` — deliberatamente
un nome diverso dal "Playbook" del progetto più ampio descritto in
`architecture.md` (quello sopra lo Scheduler Engine, un concetto di livello
più alto non ancora implementato qui), per evitare confusione tra i due:
questo è solo il piccolo piano di esecuzione di UN task, scritto e
aggiornato esclusivamente dal planner (nessun altro agente ci scrive, quindi
zero rischio di lost-update, a differenza del report condiviso).

Il planner ora lancia via herdr TUTTE le istanze del team scelto (di ogni
fase) fin da subito, ma **delega il task solo ai ruoli della fase 1** — gli
altri restano online, in ascolto, inattivi. Quando si risveglia (perché
reviewer o uno specialista segnala un completamento), il planner ora
consulta il piano oltre al report: se la fase corrente non è ancora
completa (mancano risposte da altri ruoli della stessa fase), aspetta senza
fare nulla; se è completa ed esiste una fase successiva, delega ad essa e
segna il piano aggiornato; solo se era l'ultima fase procede come prima con
report finale + `worktree_finalize`. `prompts/coder.md`, `prompts/
reviewer.md` e `prompts/specialist.md` hanno anche una nuova sezione
"Aspetta il tuo turno" che ribadisce esplicitamente di non iniziare lavoro
di propria iniziativa se non si è ancora ricevuto un task — difesa in
profondità, dato che la causa architetturale principale (il planner che
delegava a tutti insieme) è quella corretta, ma non potendo verificare da
qui il comportamento esatto di lancio di `pi` sulla macchina reale
dell'utente, un secondo livello di protezione lato prompt non costa nulla.

**Sull'altra parte della richiesta dell'utente** (niente attese bloccanti,
ogni agente notifica e chiude il turno, solo il planner parla con
l'utente a fine ciclo): verificato che era **già** il design esistente —
tutti i prompt dicono esplicitamente di non usare `agent_await` in blocco
nel flusso normale, e il risveglio del planner è già trigger-by-message, non
polling/attesa. Nessuna modifica necessaria lì; `agent_await` resta
disponibile (ma sconsigliato) per eventuali casi limite.

**Nuovo: log di debug JSONL per diagnosticare bug di questo tipo in
futuro**, anche questo su richiesta esplicita dell'utente. Ogni istanza
scrive automaticamente (nessun tool che l'LLM deve ricordarsi di chiamare —
sono hook diretti nel codice: `session_start`, ogni `agent_send` in
entrata/uscita, l'inizio di ogni turno, `worktree_create`/`worktree_finalize`,
`report_append`, `file_claim`/`file_release`, fine turno) in
`logs/<istanza>.jsonl` — un file per istanza, quindi zero rischio di
lost-update (a differenza del report condiviso, qui non serve nessuna
tecnica di append atomico speciale: ogni istanza scrive solo il proprio
file). `logs/` è gitignorato nello stesso passaggio di `.worktrees/` (stessa
funzione `ensureWorktreesGitignored()`, estesa per coprire entrambi i
pattern nello stesso commit).
Il più importante: ogni evento `turn_start`/`agent_end` registra anche se
in quel momento esisteva un comando in arrivo non ancora evaso
(`had_pending_inbound`/`had_inbound`) — un turno che parte o finisce con
questo a `false` E senza nessun `wake_in` precedente nello stesso file è
la firma esatta di "un agente ha agito di propria iniziativa", il bug di
questa stessa revisione. `scripts/review-log.mjs` fonde tutti i
`logs/*.jsonl` di un test in un'unica timeline cronologica e segnala
esplicitamente questi casi sospetti.

**Verificato**: nuovo `scripts/smoke-test-debug-log.mjs` (repo git reale,
mirror esatto della logica di logging e della gitignore-extension), incluso
un caso che riproduce fedelmente il bug di questa revisione (un'istanza che
agisce senza `wake_in` precedente) e conferma che `review-log.mjs` la
segnala correttamente, e un caso "run pulito" che conferma l'assenza di
falsi positivi. Suite completa (9 script) ri-eseguita da zero, tutti
passano. Non ho potuto testare il nuovo comportamento del planner contro un
`pi`/herdr reali da questo sandbox — resta da confermare nel prossimo test
live dell'utente, guardando `logs/*.jsonl` con `scripts/review-log.mjs` per
vedere se ora la fase 1 parte da sola e le fasi successive aspettano
davvero.

## Revisione 17: crash vero di `pi` — virgola finale invalida, e un buco nel mio metodo di verifica

Il secondo crash vero segnalato dall'utente sulla sua macchina (il primo è
la Revisione 11). Errore esatto:

```
Error: Unknown options: --instance, --role
Error: Failed to load extension "...orchestrator.ts": Failed to load extension: ParseError: Unexpected token
 .../extensions/orchestrator.ts:366:2
```

**Causa**: in `loadRolePrompt()`, il ramo di fallback per gli specialisti
senza `prompts/<role>.md` costruisce il prompt di default con una `return (
"a" + "b" + "c", );` — una concatenazione di stringhe su più righe dentro
parentesi, con una virgola dopo l'ultima stringa e prima della `)` di
chiusura. È sintassi JS/TS realmente invalida (non è una chiamata di
funzione con argomenti, dove la virgola finale è ammessa — è
un'espressione tra parentesi/sequence expression, dove non lo è), e il
parser di `pi` l'ha correttamente rifiutata. Il secondo errore
(`Unknown options: --instance, --role`) è un sintomo, non un bug separato:
l'estensione non essendo caricata, le `pi.registerFlag` per `--instance`/
`--role` non sono mai state eseguite.

**Fix**: tolta la virgola. Ho anche cercato nell'intero file altre
occorrenze dello stesso pattern (`return (` multi-riga con virgola prima
della `)` di chiusura) — non ce n'erano altre, questa era l'unica.

**La parte più importante di questa revisione non è il fix, è il perché
non l'avevo già preso prima.** Per ogni singola revisione di questa intera
sessione, il mio unico controllo di sintassi prima di consegnare è stato
`esbuild --bundle`. Verificato ora per davvero: `esbuild --bundle` **non
segnala nessun errore** su questo identico file con la virgola invalida —
lo accetta silenziosamente e produce un bundle. Questo significa che
questa classe di bug (virgola finale invalida dentro un'espressione tra
parentesi) poteva essere scivolata attraverso il mio controllo in
qualunque revisione precedente senza che io me ne accorgessi: esbuild è un
bundler, non un validatore di sintassi completo, e la sua tolleranza non
coincide con quella del parser che `pi` usa davvero.

Ho provato come alternativa `node --experimental-strip-types --check`
(Node 22.6+), e qui ho trovato un secondo problema, più sottile: su un
file isolato piccolo lo stesso identico bug viene rilevato correttamente,
ma sul file reale intero (che è un modulo ES con `import` in testa) `node
--check` restituisce **exit 0 senza nessun errore**, anche con la virgola
invalida ancora presente — un falso negativo, non una conferma. Bisecando
il file riga per riga ho isolato la causa: `--check` non applica
correttamente lo strip dei tipi TypeScript quando il file viene rilevato
come modulo ES (per la presenza di `import`/`export` in testa) — anche un
`interface` troncato a metà, che dovrebbe fallire platealmente, passa con
exit 0. È una limitazione nota/sperimentale di come Node combina
`--check` con `--experimental-strip-types` per moduli ES, non una
stranezza di questo file. **La verifica affidabile è risultata essere
un'altra**: lasciare che il vero loader ESM di Node esegua (non solo
controlli) il file con `--experimental-strip-types`, senza `--check` —
lì il parsing è quello reale, quindi un errore di sintassi emerge come
`SyntaxError` genuino sulla riga esatta (confermato riproducendo sia la
versione col bug, che fallisce esattamente alla riga 366, sia quella
corretta, che invece supera il parsing e si ferma solo alla risoluzione
di un pacchetto come `@mariozechner/pi-tui`, disponibile solo dentro il
runtime di `pi` e non installabile qui — un errore di risoluzione moduli,
non di sintassi, quindi la sintassi è confermata valida).

**Nuovo script**: `scripts/check-syntax.mjs`, richiamabile con `npm run
check-syntax`, fa esattamente questo: importa dinamicamente il file con
`node --experimental-strip-types`, e distingue un vero `SyntaxError`
(fallisce, exit 1) da un errore di risoluzione moduli atteso fuori dal
runtime di `pi` (passa, exit 0). Aggiunto come primo passo del Quickstart
in `README.md`, prima ancora dei test — va rilanciato dopo ogni modifica a
`extensions/orchestrator.ts`. `esbuild --bundle` resta comunque utile
(verifica che il file si possa impacchettare, cattura import mancanti/
circolari), ma non è più — e non era mai stato, a quanto ho scoperto ora —
un sostituto di un vero controllo di sintassi.

**Verificato**: rigenerata la versione col bug in un file temporaneo per
confermare che `check-syntax.mjs` la rileva correttamente (fallisce alla
riga giusta) e che la versione corretta nel repo la supera; suite completa
degli 8 script di smoke test ri-eseguita da zero (broker locale riavviato,
`node_modules` reinstallato) e tutti passano.

## Revisione 16: coordinamento tra agenti paralleli + tab invece di split + domande di scoping

Tre richieste in seguito al live-test della Revisione 15:

1. Con più agenti attivi insieme, `herdr pane split` affolla tutti i
   pannelli nella stessa finestra e diventa illeggibile — meglio un nuovo
   tab per ciascuno.
2. Domanda aperta e legittima: con tutti gli agenti attivi, chi sa cosa deve
   fare e quando? Non si disturbano mai? Cosa succede se due vogliono
   scrivere sullo stesso file?
3. Il planner dovrebbe fare domande di scoping (solo backend? serve il
   deploy?) PRIMA di proporre il team, per restringere il roster invece di
   proporlo largo e farselo tagliare dopo.

**(3) e (1) sono modifiche di prompt**, in `prompts/planner.md`: aggiunto un
passo esplicito prima della lettura di `roles.yaml` in cui il planner, se lo
scope del task è ambiguo, fa 2-3 domande mirate all'utente (backend/
frontend? serve deploy? area sensibile per la sicurezza?) e usa le risposte
per escludere subito interi gruppi di ruoli. Per il lancio, il planner ora
prova prima a scoprire (con `herdr --help`/`herdr tab --help`, non
inventando comandi) se questa installazione di herdr ha un modo dedicato per
aprire un nuovo tab, e lo usa; ripiega su `herdr pane split` solo se non
trova nulla di dedicato, spiegandolo all'utente.

**(2) era una domanda con una risposta onesta scomoda**: no, prima di questa
revisione non c'era nessun meccanismo reale contro le collisioni — solo la
disciplina del prompt ("non sovrascrivere le sezioni precedenti"), che non
protegge da una vera race condition con più agenti attivi insieme. Due
rischi concreti, distinti:

- **Il file di report**: se due agenti leggono l'intero file, aggiungono la
  propria sezione in memoria e riscrivono tutto, quello che scrive per
  ultimo cancella silenziosamente la sezione dell'altro — un classico
  lost-update, non un errore di nessuno dei due singolarmente.
- **I file di codice**: due agenti che editano lo stesso file in parallelo
  possono sovrascriversi a vicenda allo stesso modo, senza alcun segnale a
  nessuno dei due.

**Fix per il report — `report_append`**, un nuovo tool: fa un append reale
(`fs.appendFileSync`, un'unica operazione sul file) invece del giro
leggi-tutto/modifica-in-memoria/riscrivi-tutto. Tutti i prompt (planner,
coder, reviewer, `specialist.md`) ora usano questo tool per ogni sezione
`## Round N`, non più il tool generico di scrittura file. Non è una garanzia
matematica di atomicità su ogni filesystem possibile, ma per scritture di
testo di dimensione tipica di una sezione di report, su un filesystem
locale, elimina la classe di race condition più probabile — più onesto dire
"riduce drasticamente" che "elimina in assoluto", ed è quello che il
commento nel codice dice.

**Fix per i file di codice — `file_claim`/`file_release`**, un lock
*advisory* (non imposto dal sistema operativo, funziona solo se gli agenti
lo controllano — e i prompt ora li istruiscono a farlo) sostenuto da un
registro JSON dentro il worktree (`.orchestrator-locks.json`, MAI quello
che finisce nel progetto principale — vedi sotto). `file_claim(slug, file)`
prova a prendere il lock su un percorso relativo al worktree: se libero, lo
assegna all'istanza chiamante; se già tenuto da qualcun altro, ritorna
`claimed: false` con chi lo tiene e da quando, così l'agente chiamante può
decidere di aspettare, lavorare su altro, o segnalarlo nel report invece di
scrivere comunque sopra. Un claim scade da solo dopo un TTL (default 20
minuti) — protegge dal caso di un agente che si blocca/crasha senza mai
rilasciare, che altrimenti terrebbe un file bloccato per sempre.
`file_release` lo libera quando l'agente ha finito. `prompts/planner.md`
istruisce anche a ragionare a monte, in fase di composizione del team, su
quali ruoli rischiano di toccare gli stessi file, per non fare affidamento
sul lock come unica difesa.

**Perché il registro dei lock non deve mai finire nel progetto principale**:
`worktree_finalize` ora cancella `.orchestrator-locks.json` PRIMA del commit
di sicurezza che fa sulle modifiche non ancora committate — è stato
coordination scratch state per quel task, non output del lavoro, e non ha
senso che sopravviva al merge.

**Verificato per davvero**: nuovo `scripts/smoke-test-coordination.mjs`
(pura logica fs + git reale, nessun mock) che copre: due append "quasi
simultanei" che sopravvivono entrambi senza perdite; `report_append` su un
report inesistente fallisce con un errore chiaro invece di creare
silenziosamente un file senza intestazione; claim/blocco/re-claim dello
stesso holder (rinnovo, non conflitto con se stesso)/release/release da
parte di un non-holder (no-op innocuo)/scadenza automatica di un claim
vecchio; e che `worktree_finalize` cancella davvero il registro dei lock
prima del merge — non finisce mai nella directory principale, mentre il
file di report (quello vero) sì. Ripassata anche l'intera suite di
regressione esistente (9 script in totale ora) — nessuna regressione.

**Limite onesto**: non ho potuto verificare il comportamento reale di
`herdr --help`/`herdr tab --help` da questo sandbox (nessun herdr qui) —
il prompt istruisce esplicitamente di scoprire il comando invece di
indovinarlo, ma non posso confermare che l'installazione dell'utente abbia
davvero un comando dedicato ai tab finché non lo prova lui. E il lock è
avviso, non imposizione: un agente che ignorasse `file_claim` (per un bug
del modello, non per malizia — qui non c'è nessuna minaccia avversaria)
potrebbe comunque scrivere sopra un file bloccato da un altro; è la stessa
limitazione di qualunque lock a livello applicativo senza enforcement del
sistema operativo, documentata esplicitamente nel prompt e nella
descrizione del tool stesso, non nascosta.

## Revisione 15: roster di agenti specialisti + selezione dinamica del team dal planner

Richiesta: partire da planner/coder/reviewer e arricchire il flusso con una
"pletora di agenti specializzati" coprendo l'intero ciclo di vita software
(testing/QA, infrastruttura/deployment, dati/persistenza, documentazione,
manutenzione/debito tecnico, UX/UI, più un agente "meta" che osserva il
flusso), con tre vincoli espliciti: (1) l'architecture-diagrammer deve usare
**Mermaid**; (2) deve esistere un agente che verifica che la documentazione
resti aggiornata; (3) deve essere il **planner** a decidere dinamicamente
quali agenti coinvolgere in base al task, **chiedendo conferma
all'utente sul team** (inclusa l'eventuale parallelizzazione con più
istanze dello stesso ruolo), e a lanciarli lui stesso via herdr.

**Roster aggiunto** — 23 nuovi ruoli in `agents/roles.yaml` (oltre a
planner/coder/reviewer), organizzati per fase come nella richiesta:
testing/QA (`tdd-agent`, `mutation-tester`, `e2e-simulator`),
infrastruttura (`dockerizer`, `k8s-orchestrator`, `cicd-architect`,
`cost-optimizer`), dati (`schema-migrator`, `data-seeder`), documentazione
(`openapi-writer`, `architecture-diagrammer`, `release-notes-writer`,
`docs-sync`, `postman-collection-creator`), manutenzione
(`dependency-health`, `refactoring-specialist`, `observability-agent`,
`security-evaluator`), UX/UI (`frontend-developer`, `a11y-tester`,
`design-to-code`, `speed-benchmarker`), più il ruolo meta
(`risk-assessor`, "The Observer"). `security-evaluator`/`dockerizer`/
`postman-collection-creator`/`speed-benchmarker`/`frontend-developer`
corrispondono ai cinque suggeriti in una conversazione precedente
(architecture.md), qui formalizzati come ruoli veri nel roster invece che
solo idee.

**"Esiste un agente per la documentazione sempre aggiornata?"**: no, non
c'era — aggiunto apposta `docs-sync` (Documentation Sync Agent): confronta
README/docs/spec con lo stato reale del codice nel worktree e corregge lui
stesso i disallineamenti trovati (è un task di documentazione, non serve
passare dal coder).

**Architecture Diagrammer → Mermaid**: la sua `brief` in `roles.yaml`
specifica esplicitamente di generare/aggiornare diagrammi in stile C4 come
blocchi ` ```mermaid` dentro un file markdown (`docs/architecture-diagram.md`
di default) — si rendono automaticamente in GitHub e in qualunque viewer
markdown, senza dover generare immagini a parte.

**Design — un template invece di 23 file scritti a mano**: invece di
scrivere 23 `prompts/<role>.md` quasi identici (enorme superficie da
mantenere), ho aggiunto un solo `prompts/specialist.md` generico con
placeholder `{{ROLE}}`/`{{ROLE_LABEL}}`/`{{BRIEF}}`, e ogni ruolo del
roster porta la propria missione in una `brief` dentro `roles.yaml`.
`loadRolePrompt()` in `orchestrator.ts` ora accetta la config del ruolo:
se esiste un `prompts/<role>.md` scritto a mano (planner/coder/reviewer,
o qualunque ruolo che qualcuno vuole personalizzare) quello vince sempre;
altrimenti, se il ruolo ha una `brief` in `roles.yaml`, usa
`prompts/specialist.md` riempito con la missione di quel ruolo; altrimenti
il fallback minimo pre-esistente. Ho anche scoperto (verificandolo,
leggendo `resolveCapabilities()`) che **non serve una voce in
`agents/agents.yaml`** per lanciare un'istanza di un ruolo del roster: la
risoluzione delle capability applica già i default di `roles.yaml` anche
per un'istanza sconosciuta, purché `--role` sia passato esplicitamente al
lancio — è esattamente il caso del planner che inventa un nome istanza al
volo.

**Meccanismo di selezione dinamica del team (in `prompts/planner.md`)**: prima
di delegare un task nuovo, il planner ora: legge `agents/roles.yaml`; sceglie
quali ruoli oltre a coder/reviewer sono pertinenti al task (mai l'intero
roster per task banali); valuta se proporre più istanze parallele dello
stesso ruolo quando il task è genuinamente divisibile; **presenta il team
proposto in chat e chiede conferma esplicita all'utente prima di lanciare
qualunque cosa**; solo dopo la conferma, per ogni istanza non ancora online
(verificato con `agent_list`), la lancia lui stesso col tool di shell della
sua toolbox eseguendo `herdr pane split` (nuovo pannello vuoto) seguito da
`herdr agent start <nome> --kind pi --pane <id> -- -e
extensions/orchestrator.ts --instance <nome> --role <ruolo>` — la stessa
combinazione di comandi herdr già documentata (Revisione 12) per nominare
il pannello al lancio, ora eseguita dal planner stesso invece che
dall'utente a mano.

**Limite onesto, esplicito nel prompt stesso**: `herdr pane split` per
aprire un pannello vuoto da riga di comando non è mai stato verificato
contro un herdr reale da questo sandbox (qui non c'è `herdr`) — è solo
menzionato nella documentazione della sua CLI, diversamente da `herdr agent
start`/`agent rename`/`pane report-agent` che sono verificati più a fondo
nelle revisioni precedenti. Il prompt del planner istruisce esplicitamente
di NON tentare varianti alla cieca se il comando non si comporta come
atteso, ma di fermarsi e chiedere all'utente di aprire il pannello lui
stesso — stesso principio di cautela usato per `herdr agent start
--pane --current` nella Revisione 12.

**Verificato per davvero**: nuovo `scripts/smoke-test-specialist-prompt.mjs`
che rispecchia la logica reale di `loadConfig()`/`loadRolePrompt()` e la
esegue contro i file VERI di `agents/roles.yaml` e `prompts/` (non un mock):
verifica che planner/coder/reviewer continuino a usare i propri file dedicati
invariati, che un ruolo nuovo del roster carichi `specialist.md` con
`{{ROLE}}`/`{{ROLE_LABEL}}`/`{{BRIEF}}` sostituiti correttamente, e che
**tutti e 23** i ruoli del roster rendano senza lasciare `{{...}}` non
sostituiti. Ripassata anche l'intera suite di regressione esistente
(inclusi i test worktree della Revisione 14) dopo le modifiche a
`orchestrator.ts` — nessuna regressione. Quello che NON ho potuto
verificare da questo sandbox: il comportamento reale del planner quando
prova a leggere `roles.yaml`, proporre un team e lanciare pannelli herdr
veri — quella parte dipende dal giudizio dell'LLM seguendo il prompt e dal
comportamento reale di `herdr pane split` sulla macchina dell'utente,
nessuno dei due testabile qui.

## Revisione 14: worktree annidato in `.worktrees/` invece che cartella sorella

Nella Revisione 13 il worktree di ogni task veniva creato come cartella
**sorella** del progetto (`<progetto>--wt-<slug>`, fuori dall'albero del
progetto). L'utente ha fatto live-test su Mac e ha notato la cosa
nell'explorer del suo editor — non si aspettava una cartella fuori dal
progetto — e ha chiesto di spostarlo dentro, in `.worktrees/<slug>`.

**Perché originariamente era fuori**: un worktree git annidato dentro
l'albero di cui è worktree lascia lì un file `.git` (non una cartella — un
puntatore al vero gitdir altrove) che il checkout principale, senza
accorgimenti, vede come percorso non tracciato in `git status` — rischio di
confondere tool che scansionano ricorsivamente il progetto.

**Fix**: `worktreePaths()` ora restituisce `<progetto>/.worktrees/<slug>`,
e prima di creare il primissimo worktree, `worktree_create` chiama una
nuova funzione `ensureWorktreesGitignored()` che:
1. legge (o crea) il `.gitignore` del progetto principale;
2. se non è già coperto da un pattern esistente (`.worktrees/`, o qualcosa
   di più ampio tipo `*`), aggiunge una riga `.worktrees/`;
3. committa subito quella modifica nel checkout principale, così il
   `.gitignore` stesso non resta come file non tracciato in giro.

Idempotente e non bloccante: se il commit del `.gitignore` fallisce (es.
`user.email`/`user.name` git non ancora configurati), la creazione del
worktree procede comunque — nel peggiore dei casi il `.gitignore` resta
modificato/non committato finché qualcuno (umano o agente) non lo committa.

**Verificato per davvero**: esteso `scripts/smoke-test-worktree.mjs` con due
asserzioni aggiuntive nel primo step — che il worktree sia effettivamente
dentro `.worktrees/` nella directory del progetto, e che **subito dopo** la
sua creazione `git status --porcelain` sul checkout principale sia
completamente pulito (niente `.worktrees/` non tracciato, niente
`.gitignore` non committato). Ho anche verificato a mano in questo sandbox,
fuori dal test automatico, che `git worktree add` crea le directory
intermedie mancanti da solo (non serve `mkdir -p .worktrees` prima) e che
`git worktree remove` funziona regolarmente anche con un worktree annidato.
Tutta la suite di regressione (incluso questo test) ripassata con successo
dopo la modifica.

**Nota per chi sta già usando la versione precedente**: se avevi già un
worktree creato con la vecchia convenzione (`<progetto>--wt-<slug>`, fuori
dal progetto) e non ancora finalizzato, `worktree_create`/`worktree_finalize`
con questa versione non lo troveranno più (cercano solo dentro
`.worktrees/`) — va finalizzato o rimosso a mano
(`git worktree remove <percorso-vecchio>`) prima di aggiornare, oppure va
semplicemente rilanciato da capo il task (il branch `task/<slug>` è lo
stesso, quindi il lavoro già fatto non si perde: `worktree_create` lo
riaggancia automaticamente al branch esistente, solo con un percorso
diverso).

## Revisione 13: isolamento del lavoro in un git worktree per task

Richiesta: che l'output di ogni task richiesto dall'utente venga prodotto in
un worktree git isolato, e che venga salvato nella directory principale del
progetto (e committato) solo quando l'intero flusso si conclude con
successo — non prima.

**Design**: due nuovi tool registrati in `extensions/orchestrator.ts`,
`worktree_create` e `worktree_finalize`, appoggiati su `git worktree`
(comando nativo di git, non una simulazione):

- `worktree_create(slug)` crea (o riusa, se già esiste per lo stesso slug —
  idempotente tra round) una worktree separata, sorella della directory di
  progetto, su un branch dedicato `task/<slug>`. Ritorna `worktree_path`.
- `worktree_finalize(slug, commit_message?)` fa un commit di sicurezza di
  qualunque modifica rimasta non committata nel worktree, poi fa `git merge
  --no-ff task/<slug>` nel branch corrente della directory principale, e
  rimuove il worktree. **Va chiamato solo dal planner**, solo quando è
  soddisfatto del lavoro (stesso punto in cui prima appendeva "## Report
  finale" e basta) — mai da coder o reviewer.

Ho scelto tool veri invece di una semplice convenzione di prompt ("lavora in
una sottocartella") perché l'isolamento e l'atomicità del salvataggio finale
sono proprietà che solo git può garantire davvero (un worktree è una
checkout reale con la sua working directory, non solo una cartella diversa
dentro lo stesso checkout) — un prompt può solo chiedere educatamente a un
LLM di rispettare una convenzione, un branch/worktree separato lo impedisce
strutturalmente.

**Gestione del conflitto di merge**: se `worktree_finalize` incontra un
conflitto, fa `git merge --abort` e lascia il worktree intatto (non lo
cancella) per una risoluzione manuale, invece di tentare di indovinare una
risoluzione automatica — un errore silenzioso qui sarebbe peggio di un
merge bloccato. La directory principale resta esattamente come prima del
tentativo di merge.

**Prompt aggiornati**: `prompts/planner.md`, `prompts/coder.md`,
`prompts/reviewer.md` (e il fallback `DEFAULT_ROLE_PROMPTS` in
`orchestrator.ts`) ora spiegano esplicitamente il worktree a ciascun ruolo:
il planner lo crea a inizio task (invece di creare `reports/<slug>.md`
direttamente nella directory di progetto, ora lo crea dentro
`worktree_path`) e include sempre `worktree_path` nei messaggi che manda a
coder/reviewer; coder e reviewer lavorano sempre dentro `worktree_path`
(mai nella directory principale) e, se sono loro il punto di ingresso senza
che il planner abbia già creato nulla, chiamano `worktree_create` da soli
prima di procedere — stessa logica già prevista per il file di report
(Revisione 9/10), estesa al worktree. Solo il planner chiama
`worktree_finalize`, e solo nel ramo "sono soddisfatto"; nel ramo "non sono
soddisfatto, avvio un nuovo round" il worktree resta quello che è, non
viene toccato. Se il planner deve escalare all'utente dopo 3 round senza
conclusione, il worktree resta deliberatamente aperto e non finalizzato,
così niente di non verificato finisce nella directory principale.

**Verificato per davvero, non solo per ispezione**: `git` è un binario vero
disponibile in questo sandbox (a differenza di `pi`/herdr), quindi ho scritto
`scripts/smoke-test-worktree.mjs`, che rispecchia esattamente la logica di
`orchestrator.ts` (le stesse funzioni `execGit`/`worktreePaths`/
`assertGitRepo`/`normalizePath`/`findExistingWorktree`, poi lo stesso flusso
di create/finalize) e la esegue contro repo git reali e temporanei
(`fs.mkdtempSync`). Copre: creazione, riuso idempotente con lo stesso slug,
rifiuto di uno slug non valido, il commit di sicurezza per modifiche lasciate
non committate, un ciclo completo di merge+pulizia con verifica che il file
finisca davvero nella directory PRINCIPALE e il worktree sparisca, e — il
caso più importante — un vero conflitto di merge (due modifiche diverse allo
stesso file, una nel worktree e una diretta sul main) per verificare che
l'abort preservi sia lo stato del main (stesso HEAD, `git status` pulito) sia
il worktree (non cancellato). **Tutti i test passano**, eseguiti per davvero
in questo sandbox: `node scripts/smoke-test-worktree.mjs` →
`WORKTREE SMOKE TEST PASSED`. Ho anche ri-eseguito l'intera suite di
regressione esistente (`smoke-test.mjs`, `smoke-test-pipeline.mjs`,
`smoke-test-multiround.mjs`, `smoke-test-late-broker.mjs`,
`smoke-test-shutdown-hang.mjs`) dopo le modifiche a `orchestrator.ts`: tutti
passano ancora, nessuna regressione.

Ho anche scoperto e gestito preventivamente (non da un bug riportato
dall'utente, ma da un test empirico reale in questo sandbox) un caso limite
di git: `git worktree remove` rifiuta se restano file non tracciati (anche
dopo un merge riuscito) — gestito con un fallback automatico a `--force` a
quel punto, dato che dopo un merge riuscito tutto ciò che conta è già al
sicuro sul branch principale. Ho anche protetto il confronto dei percorsi
dei worktree (`findExistingWorktree`) con `fs.realpathSync` invece di un
confronto testuale semplice, perché su macOS `/tmp` è un symlink verso
`/private/tmp` e git riporta sempre il percorso risolto — un confronto
ingenuo avrebbe rotto l'idempotenza proprio sulla macchina dell'utente.

**Limiti onesti**: non ho potuto testare questo contro un `pi`/herdr reali
da questo sandbox (nessuno dei due binari è disponibile qui) — quello che
NON è simulato è git stesso, che è un dipendente vero disponibile in questo
ambiente, quindi tutta la logica di worktree/merge/conflitto è verificata
con comandi git reali, non con un mock. Quello che resta da verificare sulla
macchina dell'utente è solo l'integrazione con gli agenti LLM veri: che
`worktree_create`/`worktree_finalize` vengano davvero chiamati nei momenti
giusti seguendo i prompt aggiornati (questo dipende dal comportamento
dell'LLM, non da bug di codice).

## Revisione 12: rinomina diretta del pannello herdr (`agent rename` / `pane rename`)

Le Revisioni 6/10 avevano provato il titolo del terminale (OSC) e il
protocollo di stato `pane report-agent` di herdr, ma il menu "new agent"
continuava a mostrare il nome della cartella di progetto invece
dell'istanza. L'utente ha girato il comando esatto suggerito dalla CLI di
herdr sulla sua macchina: `herdr agent rename <pane_id> <new_name>` o
`herdr pane rename <pane_id> <new_name>` — un comando diverso da quelli già
provati, che rinomina direttamente l'etichetta del pannello invece di
riportare uno stato che herdr potrebbe interpretare diversamente.

Aggiunta `herdrRenamePane()` in `extensions/orchestrator.ts`, chiamata una
volta a `session_start`: prova prima `herdr agent rename <pane_id> <nome>`
(via `$HERDR_BIN_PATH`/`$HERDR_PANE_ID`, stesso no-op fuori da herdr delle
altre funzioni herdr-specifiche), e se fallisce (way exit diverso da 0, non
un vero errore di rete) prova automaticamente `herdr pane rename <pane_id>
<nome>` come fallback — dato che non potevo confermare da questo sandbox
quale dei due sottocomandi esiste davvero sull'installazione dell'utente,
provo entrambi invece di sceglierne uno a caso. `<nome>` è sempre
`--instance` di default, o `--name` se passato.

**Verificato**: build pulita; riproduzione standalone che sostituisce il
binario herdr con uno script fittizio per controllare (a) che sia un no-op
fuori da herdr, (b) che gli argomenti del comando primario siano esatti, e
(c) che il fallback a `pane rename` scatti correttamente quando il primo
comando fallisce. Non ho potuto testarlo contro un herdr reale da questo
sandbox — se anche questo non dovesse funzionare, l'unica cosa che non ho
ancora provato è eseguire il comando a mano una volta sul pannello già
avviato per vedere l'effetto immediato, prima di fidarsi che l'automazione
lo stia facendo per te.

## Revisione 11: crash vero di `pi` — riga del widget più larga del pannello

Il più serio finora: `pi` usciva del tutto (`pi exiting due to
uncaughtException`), non solo il widget rotto. Errore esatto: `Rendered line
16 exceeds terminal width (127 > 126)`.

**Causa**: il mio fix della Revisione 8 misurava la larghezza col conteggio
di caratteri JS (`.length`), che per `⚡` e `●` è sbagliato — sono glifi resi
a doppia larghezza nella maggior parte dei terminali ma un solo carattere in
JS, quindi ogni riga sottostimava la propria larghezza di una colonna per
icona. Con la maggior parte delle larghezze quel margine passava
inosservato; alla larghezza esatta con cui `pi` ha reso il pannello, lo
sbaglio ha spinto la riga un carattere oltre il bordo, e il controllo
anti-crash di `pi` tratta *qualunque* riga di un widget custom che sfora
come errore fatale (non un semplice taglio) — uccidendo l'intero processo,
non solo il widget.

**Fix**: tolta tutta la logica di misurazione fatta in casa, sostituita con
`visibleWidth()`/`truncateToWidth()` importate da `@mariozechner/pi-tui` —
sono esattamente le due funzioni che il messaggio di crash di `pi` nomina
come soluzione per "a custom TUI component not truncating its output".

**Margine di sicurezza aggiunto**: costruendo una riproduzione standalone di
questo fix in sandbox (non ho un `pi` reale qui, quindi ho verificato con
`string-width`/`cli-truncate`, la stessa famiglia di librerie dedicata a
ANSI+caratteri larghi) ho scoperto che perfino QUESTE librerie possono
sbagliare di una colonna esattamente con `⚡` in testa alla stringa —
`string-width` da solo misura correttamente `⚡` come larghezza 2, ma
`cli-truncate` produceva comunque una riga 1 colonna oltre la larghezza
richiesta quando `⚡` era il primo carattere. Questo dimostra che la classe
di bug è facile da ripresentarsi anche in librerie dedicate e ampiamente
usate, non solo nel mio primo tentativo — e non posso verificare da qui che
le funzioni di `pi-tui` stesso non abbiano una stranezza equivalente. Dato
che una sola colonna di troppo è un crash duro (non un difetto estetico),
ho aggiunto un margine di sicurezza: ogni riga del widget viene ora
budgettata a `width - 1` invece della larghezza esatta — una colonna sprecata
non è un problema, un altro crash di `pi` sì.

**Verificato**: build pulita; riproduzione standalone del calcolo con
`string-width`/`cli-truncate` che riproduce esattamente lo scenario del
crash (larghezza 126, coder-01, "connecting…") e uno sweep di larghezze da
0 a 200 su tutti e tre i ruoli/modelli/stati di connessione — mai un
overflow, nemmeno riproducendo lo stesso difetto di `cli-truncate` che aveva
causato il crash originale. Non ho potuto testarlo contro un `pi` reale da
questo sandbox.

## Revisione 10: qualunque agente può essere il punto di ingresso

Richiesta: poter scrivere direttamente a QUALUNQUE dei tre agenti e far
convergere comunque tutto sullo stesso flusso — scrivendo a coder, reviewer
lo controlla come sempre e si conclude con il report del planner; scrivendo
a reviewer per un test nuovo, se fallisce va dal coder e torna indietro
finché non passa; scrivendo a planner, riparte il flusso normale.

**Verificato per ispezione che era già vero strutturalmente per il
trasporto**: `onRoleOrTeamMessage()` in `extensions/orchestrator.ts` instrada
in base a `target_role` e non fa mai nessun controllo su chi ha originato la
catena — non esiste nessun caso speciale "solo se viene da planner" da
nessuna parte nel codice di trasporto. Quindi qualunque agente può già
tecnicamente ricevere un compito "dal nulla" (un messaggio scritto
direttamente dall'utente in chat, non un inbound MQTT) e continuare la
catena normalmente: gli `hops` partono da 0 in quel caso (nessun
`currentInbound`), esattamente come per il planner nel flusso originale.

**Quello che MANCAVA e ho aggiunto** (solo nei prompt, nessun cambio al
trasporto):

- `prompts/coder.md`: nuova sezione "Se l'utente ti scrive direttamente un
  task nuovo" — prima non gestiva affatto l'essere il primo agente
  interpellato (assumeva sempre un file di report già creato dal planner).
  Ora, se non esiste ancora nessun report, lo crea lui con la stessa
  intestazione minima del planner, poi procede come sempre (implementa,
  testa, passa a reviewer) — la convergenza verso planner resta automatica,
  perché è reviewer a notificarlo sempre, indipendentemente da chi ha
  iniziato.
- `prompts/reviewer.md`: la sezione "Se l'utente ti scrive direttamente" (in
  precedenza pensata solo per "un test in più su un lavoro già aperto") ora
  gestisce anche l'essere il PRIMO agente interpellato (crea il report se
  manca del tutto, non solo se "non si trova"), e soprattutto il ciclo di
  correzione è ora esplicitamente un **loop**, non un singolo tentativo:
  "se fallisce di nuovo, ripeti — rimanda a coder, ri-verifica, e così via,
  finché il test non passa davvero", con un'indicazione di buon senso (dopo
  3-4 tentativi senza esito, notifica comunque planner invece di insistere
  da solo all'infinito) per evitare che si areni in un ping-pong interminabile
  col coder senza mai far intervenire nessuno.
- `prompts/planner.md`: una nota che chiarisce quando una nuova richiesta di
  funzionalità va trattata come task nuovo (nuovo slug, nuovo report) vs
  come continuazione di un task già aperto.

**Limite onesto**: come per la Revisione 9, questo è tutto comportamento
guidato da prompt — verificabile per ispezione a livello di trasporto (il
routing è davvero agnostico rispetto a chi origina la catena, l'ho
controllato nel codice), ma se i tre agenti seguano davvero queste
istruzioni quando li usi per davvero dipende dall'LLM, non da qualcosa che
posso testare da questo sandbox senza una `pi` reale.

## Revisione 9: report scritto condiviso + ciclo di revisione multi-round

Due richieste nuove, non bug: (1) un report scritto che raccolga i test
eseguiti da coder/reviewer con esempi ed esiti, e (2) la possibilità di
chiedere al reviewer un test aggiuntivo — se fallisce, deve tornare dal
coder, farsi ri-verificare, e solo allora riattivare il planner, che a sua
volta valuta se chiudere o ricominciare un intero nuovo round, fino a un
report finale per l'utente.

**File di report condiviso** (`reports/<slug>.md`, nella directory di lavoro
condivisa da tutti e tre): il planner lo crea all'inizio del task (slug
kebab-case scelto da lui), lo comunica esplicitamente nel prompt a coder e
reviewer (nessuna modifica al protocollo MQTT — è una convenzione nei
prompt, non un nuovo campo in `CommandEnvelope`, per restare compatibile con
tutto il resto). Coder e reviewer **appendono** (mai sovrascrivono) una
sezione `## Round N — <ruolo>` a ogni giro, con i test eseguiti per davvero
(non solo descritti), esempio/atteso/esito. Il planner, quando viene
riattivato, legge il file, decide se è sufficiente, e se sì appende
`## Report finale` col riepilogo completo di tutti i round prima di
comunicarlo all'utente.

**Ciclo multi-round e test ad hoc dal reviewer**: `prompts/reviewer.md` ora
gestisce esplicitamente anche l'essere interpellato **direttamente
dall'utente** (non solo da coder via MQTT) per un test che l'utente ritiene
mancante — stessa gestione: se fallisce, va al coder per la correzione, poi
ri-verifica, poi notifica planner. `prompts/planner.md` ora, quando viene
risvegliato dal reviewer, non si limita più a comunicare il completamento:
legge il report e decide se è davvero soddisfatto o se serve un altro giro
completo — con un tetto morbido di 3 round prima di chiedere indicazioni
all'utente invece di continuare da solo all'infinito (non c'è enforcement
tecnico automatico sul numero di round a questo stadio, quindi la disciplina è
nel prompt).

**Bug reale trovato e corretto mentre implementavo questo**: il limite di
hop (`MAX_HOPS`, la protezione anti-loop-infinito su `agent_send`) era
tarato a 5, calibrato sul flusso a una sola passata. Un solo giro di
rifiuto-poi-approvazione (planner→coder→reviewer→coder→reviewer→planner) da
solo consuma già 4 hop su 5 — con più round richiesti esplicitamente da
questa funzionalità, il planner che riavvia un nuovo giro avrebbe quasi
certamente sforato il limite e il messaggio sarebbe stato **scartato in
silenzio** (bug che avrebbe rotto esattamente il flusso richiesto). Corretto
in due modi: (1) alzato il default a 24 (resta comunque un tetto finito,
configurabile con `PI_ORCH_MAX_HOPS`); (2) aggiunto un parametro
`new_round: true` su `agent_send`, che azzera il conteggio hop invece di
ereditarlo dalla catena in corso — usato dal planner quando avvia
deliberatamente un nuovo round (non un semplice inoltro). Verificato con una
riproduzione standalone della formula (non testabile a runtime da questo
sandbox, perché vive dentro il tool registrato che richiede l'host reale di
`pi`): senza il flag, il caso "planner riavvia dopo un rifiuto+approvazione"
sfora davvero il limite; con `new_round: true`, riparte da 0.

**Nuovo smoke test**: `scripts/smoke-test-multiround.mjs`, a livello di
protocollo wire (client MQTT grezzi, stesso stile di
`smoke-test-pipeline.mjs`) — simula rifiuto→fix→riapprovazione→nuovo round
avviato dal planner→report finale, e verifica che il planner distingua
correttamente il messaggio "non ancora soddisfatto" da quello finale.
Passa insieme agli altri 4 smoke test, nessuna regressione.

**Limite onesto**: non ho potuto far girare il flusso vero con LLM reali
dentro `pi` da questo sandbox (nessuna CLI `pi` qui) — ho verificato la
logica di trasporto/hop a livello di protocollo e con riproduzioni
standalone, ma il comportamento effettivo dipende da quanto bene l'LLM di
ciascun ruolo segue le istruzioni nei prompt (scrivere davvero i test,
appendere invece di sovrascrivere, ecc.) — vale la pena osservarlo la prima
volta che lo provi per davvero.

## Revisione 8: bug reale nel troncamento colorato + limite onesto sul naming herdr

**Bug reale trovato e corretto**: `renderPool()` costruiva le righe già
colorate (`theme.fg(...)`, che avvolge il testo in codici ANSI invisibili) e
poi faceva `linea.slice(0, width)` su quella stringa colorata. I codici ANSI
contano come caratteri per `.slice()`, quindi il taglio arrivava molto prima
del punto in cui il testo *visibile* raggiungeva davvero `width` — ed era
diverso riga per riga a seconda di quanti span colorati conteneva ciascuna
riga. Questo è esattamente quello che si vedeva nello screenshot: il nome
del modello troncato in modo diverso su ogni riga (`llmproxy:reasoning-model`
intero, `llmproxy:codin` tagliato, `llmproxy` tagliato ancora di più), e
l'indicatore `● mqtt` a destra sparito del tutto (tagliato via insieme al
resto). Corretto con `renderLine()`: costruisce la riga da segmenti
`{text, color}`, tronca sul testo **semplice** (senza codici colore) fino a
`width`, e colora solo quello che sopravvive — quindi la lunghezza visibile
combacia sempre con `width`, indipendentemente da quanto colore c'è.
Verificato con una riproduzione standalone che include un `theme.fg()` che
avvolge davvero in ANSI (a differenza del test della Revisione 7, che usava
un `theme.fg()` finto senza colori e quindi non poteva far emergere questo
bug) — riproduce lo scenario esatto dello screenshot (3 agenti, terminale a
156 colonne) e conferma che ora il modello non si tronca e `● mqtt` compare.

**Limite onesto sul nome del pannello herdr**: dallo screenshot si vede che
il progetto ha già, tra le estensioni caricate, `herdr-agent-state.ts` —
un'estensione fornita **da herdr stesso** (secondo la sua documentazione,
installata in `~/.pi/agent/extensions/herdr-agent-state.ts` o
`$PI_CODING_AGENT_DIR/...`), che è probabilmente il reporter "ufficiale" di
stato verso herdr, generico per qualunque sessione `pi`. La documentazione
di herdr indica anche che herdr rileva gli agenti in DUE modi paralleli:
euristica (lettura della process table + pattern-matching sul contenuto
dello schermo) e integrazioni esplicite via hook/socket. Non ho modo di
sapere da questo sandbox — non ho un herdr reale, non ho accesso al
filesystem del tuo Mac in questa sessione, e la documentazione pubblica non
specifica le regole di precedenza — se `herdr-agent-state.ts` sovrascrive
quello che il nostro `herdrReportAgent()` riporta, se i due entrano in
conflitto, o se il rilevamento euristico su schermo ignora comunque
entrambi e usa la cartella di lavoro. Non voglio continuare a modificare
codice alla cieca su questo punto specifico senza un modo di verificarlo.

Due cose concrete che PUOI verificare tu, più veloci di un altro giro mio:

1. Da un terminale (fuori da qualunque pannello `pi`), con le 3 sessioni già
   avviate: `herdr agent list` — se lì i nomi sono già `planner-01` ecc.,
   il nostro fix funziona e il problema è solo nella schermata "new agent"
   (che, come detto in Revisione 7, sembra un elenco di profili salvati, non
   stato live).
2. Se anche `herdr agent list` mostra ancora il nome della cartella:
   `herdr agent rename planner-01 "Planner"` (e lo stesso per coder-01,
   reviewer-01) — è il meccanismo documentato più diretto, bypassa qualunque
   logica di rilevamento automatico.

## Revisione 7: widget ripulito (niente riga doppia, niente "@ default", modello per agente, indicatore mqtt a destra)

**Il menu "new agent" di herdr che mostra ancora `testMultiOrchestratorAgents`
tre volte non è lo stesso posto dove agisce `herdrReportAgent()`.** Quella
schermata ("new" → "agents" → "grouped") sembra un elenco di comandi/profili
già lanciati in passato per riavviarli rapidamente, non lo stato live dei
pannelli — `pane report-agent` (Revisione 6) aggiorna il nome di un agente
**mentre è in esecuzione e sta riportando stato**, non retroattivamente le
voci salvate in quell'elenco "new". Per verificare se il fix di Revisione 6
funziona davvero, serve guardare la sidebar di herdr **durante** una sessione
attiva (non la schermata "new agent"), oppure lanciare
`herdr agent list` da un terminale per vedere i nomi live. Se anche lì il
nome non cambia, usa il fallback manuale già documentato in Revisione 6
(`herdr agent rename <target> "Nome"`) — non ho un herdr reale per
verificarlo da questo sandbox, quindi non posso escludere che quell'elenco
"new" richieda un'azione separata (rinominare il profilo salvato) che è
fuori dal controllo del processo `pi` in esecuzione.

**Cosa NON è nostro**: la riga `~/Development/testCode/testMultiOrchestratorAgents`
seguita da `0.0%/1.0M (auto)` e `llmproxy` è la barra di stato **core di
`pi`** (cartella corrente, uso del context, proxy del modello) — nessuna di
quelle stringhe compare in `orchestrator.ts`. Non c'è un modo, da
un'estensione, di nascondere elementi che il core di `pi` disegna da solo;
se `pi` espone un'opzione per nasconderli va cercata nella configurazione di
`pi` stesso, non qui.

**Cosa invece era nostro ed era davvero doppio**: `⚡ coder-01 (coder) @
default` compariva sia come riga del widget (in fondo alla pagina) sia come
segmento aggiunto alla barra di stato core di `pi` via `ctx.ui.setStatus()`
— stesso identico testo, due punti diversi dello schermo. Rimosso del tutto
`ctx.ui.setStatus()`: il widget resta l'unica fonte di verità per lo stato
dell'orchestratore (identità propria, peer, connessione mqtt). `ctx.ui.notify()`
resta solo per i toast una tantum (connesso/errore), che non lasciano una
riga persistente.

**Redesign del widget** (`renderPool()` in `extensions/orchestrator.ts`):

```
⚡ coder-01 (coder) · claude-sonnet-5                              ● mqtt
● planner-01 (planner) · claude-opus-4.6 idle
● reviewer-01 (reviewer) · claude-sonnet-5 idle
```

- Rimosso `@ default` (e in generale `@ <project>`): l'icona ⚡ (io) vs ●
  (peer) distingue già chi è "questo pannello", il nome del progetto non
  aggiungeva informazione utile qui — resta invariato internamente per lo
  scoping dei topic MQTT, semplicemente non viene più stampato.
- Aggiunto il modello LLM di ciascun agente (`· <model>`), sia per te
  (`identity.model`, da `agents.yaml`/`roles.yaml`) sia per i peer — il campo
  `model` era già nella presence card pubblicata su MQTT, mancava solo nel
  rendering.
- Indicatore broker a destra, allineato al bordo della riga: `● mqtt` verde
  se connesso, rosso con `· connecting…`/`· reconnecting…` accanto se no
  (distingue il primo tentativo dal secondo con un nuovo flag `everConnected`).
  L'allineamento a destra è calcolato sulla lunghezza del testo *non
  colorato* (i codici ANSI di colore alterano la lunghezza della stringa se
  non se ne tiene conto).

Verificato: i 4 smoke test automatici passano senza regressioni; la
matematica del padding/allineamento è stata testata a parte con una
riproduzione standalone della funzione (varie larghezze, stato
connesso/connecting/reconnecting) — non ho potuto verificare il rendering
reale nella TUI di `pi` da questo sandbox.

## Revisione 6: nome del pannello herdr indipendente dall'istanza

Dagli screenshot, quattro voci nel menu "new agent" di herdr mostravano
tutte lo stesso nome della cartella di progetto (`testMultiOrchestratorAgents…`,
troncato), con solo il sottotitolo (`coder`/`reviewer`/`planner`/`pi`)
distinto — il primo tentativo (impostare il titolo del terminale via
escape OSC) era un'ipotesi ragionevole ma **sbagliata**: herdr non usa il
titolo del terminale per nominare un pannello, ha un proprio protocollo
dedicato.

Confermato leggendo la documentazione ufficiale di herdr
([integrations](https://herdr.dev/docs/integrations/) e
[cli-reference](https://herdr.dev/docs/cli-reference/)): herdr inietta
`HERDR_ENV=1`, `HERDR_PANE_ID`, `HERDR_BIN_PATH` (e `HERDR_SOCKET_PATH`) in
ogni processo che gestisce, e il modo con cui un processo può riportare/
sovrascrivere il proprio nome visualizzato è:

```bash
"$HERDR_BIN_PATH" pane report-agent "$HERDR_PANE_ID" \
  --source <id> --agent <nome-visualizzato> --state idle|working|blocked|unknown
```

Aggiunta `herdrReportAgent()` in `extensions/orchestrator.ts` che chiama
esattamente questo comando (via `child_process.execFile`, mai bloccante,
no-op completo se `HERDR_ENV` non è settato — quindi innocuo se lanciato
fuori da herdr o durante gli smoke test):

- chiamata a `session_start` con stato `"idle"`,
- a `before_agent_start` con stato `"working"` (il turno è iniziato),
- a `agent_end` con stato `"idle"` (il turno è finito),
- `--source` è sempre `--instance` (per distinguere le sorgenti dei report),
- `--agent` è `--name` se passato, altrimenti `--instance` — quindi di
  default il pannello si chiama esattamente come l'istanza, come richiesto;
  passa `--name` per un'etichetta diversa.

`setTerminalTitle()` (il tentativo precedente via OSC 0) resta nel codice
come fallback innocuo per qualunque altro terminale/multiplexer che legga
il titolo — non fa male, semplicemente herdr non lo guarda.

```bash
pi -e extensions/orchestrator.ts --instance planner-01 --role planner              # pannello herdr: "planner-01"
pi -e extensions/orchestrator.ts --instance planner-01 --role planner --name "Planner (progetto X)"   # pannello herdr: "Planner (progetto X)"
```

**Limite onesto**: ho verificato la forma esatta della chiamata (`pane
report-agent <pane_id> --source ... --agent ... --state ...`) contro la
documentazione pubblicata di herdr e con un test locale che sostituisce il
binario herdr con `/bin/echo` per controllare che gli argomenti siano
esattamente quelli attesi — non ho potuto eseguirla contro un binario herdr
reale né dentro un vero pannello herdr (nessun herdr installato in questo
sandbox, bridge verso il tuo Mac non connesso in questa sessione). Se per
qualche motivo il nome ancora non cambia (versione di herdr diversa da
quella documentata, binario non nel `PATH` atteso, ecc.), il fallback
manuale confermato nella stessa documentazione è:

```bash
herdr agent rename <target> "Nome scelto"   # target = pane id o nome live dell'agente
herdr agent rename <target> --clear         # per rimuovere il nome custom
```

oppure il keybinding `rename_pane` direttamente dentro herdr.

## Revisione 5: il widget dei peer non si aggiornava mai dopo il primo render

Con tutti e tre gli agenti finalmente connessi (screenshot da herdr), è
emerso che solo l'ultimo avviato (`reviewer-01`) mostrava la lista completa
dei peer — `planner-01` restava fermo a "0 peer(s)" e `coder-01` a "1
peer(s)" anche dopo che gli altri due si erano connessi.

Causa: `installPoolWidget()` veniva chiamato **una sola volta**, all'avvio.
`onPresenceMessage()` aggiornava correttamente la mappa `presence` in
memoria ogni volta che arrivava un nuovo messaggio di stato via MQTT, ma non
c'era nessun meccanismo che dicesse al widget "ridisegnati, i dati sono
cambiati" — quindi ogni pannello mostrava semplicemente lo snapshot di
quando si era disegnato l'ultima volta (nel caso di `reviewer-01`, questo
capitava dopo che gli altri due avevano già pubblicato la loro presenza
retained, quindi per puro ordine di avvio vedeva già tutto).

Corretto con una funzione `requestPoolRedraw()` che ri-registra il widget
(`ctx.ui.setWidget(...)`) ogni volta che qualcosa di rilevante cambia:
arrivo di un nuovo messaggio di presenza, connessione/riconnessione al
broker, o rimozione di un peer considerato stale. Non ho potuto verificare
a runtime il rendering vero e proprio del widget da questo sandbox (non ho
la CLI `pi` qui), ma la logica ricalca esattamente il pattern che
`coms-net.ts` usa per lo stesso identico scopo (`maybeRequestRender()`), che
è verificato funzionante nel repo di riferimento.

## Revisione 4: broker Docker irraggiungibile + Ctrl+C bloccato

Due bug reali emersi provando il pacchetto per davvero con Docker + MQTT
Explorer + herdr, entrambi confermati e corretti:

**1. `mqtt/mosquitto.conf` bindava sul loopback SBAGLIATO.** La riga
`listener 1883 127.0.0.1` diceva a mosquitto di ascoltare solo sul loopback
*interno al container*, che il port-forwarding di Docker non riesce a
raggiungere dall'host (il traffico pubblicato arriva sull'interfaccia di
rete del container, non sul suo loopback). Risultato: nessun client — né
MQTT Explorer né l'estensione — riusciva a connettersi, nonostante
`docker ps` mostrasse il container "Up" con la porta pubblicata
correttamente. Corretto in `mosquitto.conf`: ora bindiamo su `0.0.0.0`
*dentro* il container, e lasciamo che sia `mqtt/compose.yaml` (con
`127.0.0.1:1883:1883`) a restringere l'accesso al solo host locale — è il
livello giusto dove applicare quella restrizione quando si usa Docker.

**2. Ctrl+C non usciva più da `pi`.** Conseguenza diretta del bug 1: con il
client MQTT permanentemente irraggiungibile, la pubblicazione dello stato
"offline" in `cleanShutdown()` (QoS1) restava in coda per sempre in attesa
di una connessione che non sarebbe mai arrivata, e il processo non
terminava mai. Corretto con un `withTimeout()` che limita ogni operazione
di rete durante lo spegnimento (2s per la pubblicazione, 1.5s per la
disconnessione pulita, poi `client.end(true)` forzato comunque), più
un'uscita esplicita (`process.exit`) dopo la pulizia — un secondo Ctrl+C
mentre si sta già spegnendo forza l'uscita immediata. Nota tecnica di cui
tenere conto se si modifica questo codice: il timer di sicurezza del
timeout **non va reso `unref()`** — un timer "unref" non è garantito a
scattare se nient'altro tiene vivo l'event loop nel frattempo, il che
vanificherebbe proprio lo scopo del watchdog (l'ho scoperto scrivendo il
test qui sotto, che nella prima versione dava un falso positivo per lo
stesso motivo).

Verificato con due nuovi script:
- `scripts/smoke-test-shutdown-hang.mjs` — un client che non si connette mai
  (broker inesistente su una porta bloccata) esegue la stessa sequenza di
  spegnimento di `orchestrator.ts`: conclude in ~3.5s invece di restare
  bloccato per sempre. **PASSED**.
- la config di mosquitto corretta è stata ri-testata contro
  `scripts/smoke-test.mjs` e `scripts/smoke-test-pipeline.mjs` (nessuna
  regressione, entrambi **PASSED**).

Non ho potuto testare lo scenario Docker specifico da questo sandbox (non
ha un daemon Docker disponibile) — la diagnosi si basa sul comportamento
noto del networking Docker (isolamento del loopback per namespace di rete),
non su un test diretto contro un container reale.

## Revisione 3: connessione MQTT resiliente + widget sempre visibile

Provando il pacchetto per davvero (`pi v0.84.1` su macOS, tramite herdr) è
emerso un bug reale: se il broker MQTT non è ancora su nel momento in cui
`pi` parte, la vecchia logica (`await mqtt.connectAsync(...)` dentro un
`try/catch` che faceva `return` sull'errore) **rinunciava per sempre** —
niente widget, niente notifica, nessun retry, bisognava riavviare `pi` a
mano dopo aver acceso il broker. Corretto:

- `session_start` ora installa subito lo status bar e il widget "peer pool"
  (in fondo, sotto l'editor — la stessa richiesta di visibilità di `coms` su
  github.com/david-vega/pi-to-pi), PRIMA ancora di tentare la connessione,
  mostrando "connecting…" finché non è online;
- la connessione usa `mqtt.connect()` (non bloccante) invece di
  `connectAsync()` seguito da un `return` fatale: il client di mqtt.js
  ritenta da solo ogni 2s all'infinito; l'estensione fa subscribe + pubblica
  la presenza dentro l'handler dell'evento `"connect"`, che scatta sia al
  primo collegamento sia ad ogni riconnessione — quindi se il broker si
  riavvia o non era ancora su, l'agente si auto-ripara senza che tu debba
  fare nulla;
- verificato con un test dedicato (`scripts/smoke-test-late-broker.mjs`):
  un client parte con il broker spento, resta in attesa, il broker viene
  acceso 3 secondi dopo, il client si connette da solo — **PASSED**.

Nota a parte: l'errore `Failed to load theme "ocean-breeze"` che hai visto
non viene dalla nostra estensione — `orchestrator.ts` non imposta nessun
tema (verificato, nessun riferimento nel codice). È quasi certamente una
preferenza tema salvata altrove nella tua configurazione `pi` (magari da un
tentativo precedente con `coms`/`coms-net`, che nel repo di riferimento
mappano quell'estensione al tema "ocean-breeze"). Non blocca nulla (`pi`
torna al tema dark di default) — se vuoi toglierlo, va cercato nella
configurazione globale di `pi`, non in questo pacchetto.

### Un solo broker

Usa **Docker** (`docker compose -f mqtt/compose.yaml up -d`, container
`pi-orchestrator-mqtt-dev`) come unico broker di sviluppo. Se in un momento
di debug avevi installato anche `mosquitto` via Homebrew, disinstallalo per
evitare che i due possano entrare in conflitto sulla porta 1883 (o peggio,
che uno resti attivo in background e ti faccia credere di parlare con
l'altro):

```bash
brew services list | grep mosquitto   # controlla se è un servizio attivo
brew services stop mosquitto          # se sì, fermalo
brew uninstall mosquitto              # disinstalla il formula
lsof -i :1883                         # conferma che resti solo Docker in ascolto
```

Perdi così anche i binari locali `mosquitto_sub`/`mosquitto_pub`, ma non ti
servono: usa quelli già dentro il container, vedi sotto.

## Revisione 2: comportamento planner → coder → reviewer → planner

La prima versione di questo progetto dava a planner/coder/reviewer gli stessi
identici tool (`agent_send`, `agent_get`, `agent_await`, ...) ma **nessuna
istruzione su come usarli** — un agente con solo `agent_send` in mano non sa
da solo che deve delegare invece di implementare lui stesso. Controllando la
richiesta originale ("planner pianifica e affida al coder, coder finisce,
reviewer controlla e informa il planner") questo era un buco reale: senza
un'istruzione di ruolo, il planner avrebbe probabilmente provato a scrivere
il codice lui stesso.

Corretto aggiungendo:

- un hook `pi.on("before_agent_start", ...)` in `extensions/orchestrator.ts`
  che inietta un system prompt specifico per il ruolo risolto dell'istanza
  (stesso pattern di `pi-pi.ts` per il suo prompt da orchestratore);
- tre file `prompts/planner.md`, `prompts/coder.md`, `prompts/reviewer.md`,
  editabili senza toccare il codice, che codificano esattamente il flusso
  richiesto:
  - **planner**: riceve la richiesta umana → la scompone in un task → la
    delega con `agent_send(target_role: "coder")` → NON aspetta in blocco,
    informa l'utente e chiude il turno → viene risvegliato automaticamente
    da un nuovo turno quando il reviewer lo contatta con l'esito finale.
  - **coder**: riceve il task → implementa scrivendo/modificando file nella
    working directory condivisa → quando finito, `agent_send(target_role:
    "reviewer")` per chiedere la revisione → NON contatta direttamente il
    planner.
  - **reviewer**: riceve la richiesta di revisione → controlla davvero il
    codice (legge i file, eventualmente esegue test) → se approva,
    `agent_send(target_role: "planner")` per informarlo che il lavoro è
    fatto e verificato → se respinge, `agent_send(target_role: "coder")`
    con le correzioni richieste, e NON informa ancora il planner.
- ho anche corretto una piccola perdita di memoria: le entry di
  `pendingReplies` (risposte già arrivate o scadute) restavano in mappa per
  sempre se nessuno le interrogava; ora vengono liberate 5 minuti dopo la
  risoluzione.

## Verifica eseguita (in questa sessione, contro un broker Mosquitto reale)

Non avendo la CLI `pi` disponibile in questo sandbox cloud, ho verificato il
livello meccanico (routing dei topic, non il comportamento dell'LLM) con due
script Node indipendenti da `pi`:

- `scripts/smoke-test.mjs` — presenza retained, comando/risposta 1:1 con
  fencing token, deduplica di una redelivery QoS1 duplicata, stato offline
  alla disconnessione. **PASSED** (5/5 passi).
- `scripts/smoke-test-pipeline.mjs` — la catena esatta a 3 hop che i prompt
  di ruolo usano: `planner-01` delega a `target_role: "coder"` → `coder-01`
  riceve e delega a `target_role: "reviewer"` → `reviewer-01` riceve e
  informa `target_role: "planner"` → `planner-01` riceve la conferma finale.
  Tutto instradato tramite i topic `pi/<project>/roles/<role>/tasks`, non
  indirizzamento diretto per istanza. **PASSED**.

Quello che questi test NON possono verificare da qui: se il vero LLM (dentro
`pi`), leggendo il prompt di ruolo, si comporta effettivamente come descritto
(potrebbe comunque decidere di fare qualcos'altro — i prompt guidano ma non
costringono). Quella parte va verificata a mano sulla tua macchina, vedi
sotto.

## Cosa NON c'è (deliberatamente, vedi architecture.md "Scope V1")

- Scheduler Engine / DAG / playbook — questo pacchetto è solo il bus di
  comunicazione + comportamento di ruolo via prompt, non un motore di
  workflow con stato persistente.
- Agent Router a punteggio — `agent_send` con `target_role` fa un puro
  fan-out a tutte le istanze live di quel ruolo (nel nostro `agents.yaml` di
  esempio ce n'è una sola per ruolo, quindi in pratica è 1:1; con più
  istanze dello stesso ruolo tutte riceverebbero lo stesso task, senza
  arbitraggio claim/first-wins).
- max_iterations sul ciclo di rejection reviewer→coder — nei prompt ho
  descritto il rimbalzo coder↔reviewer in caso di correzioni, ma non c'è
  nessun contatore che lo fermi dopo N tentativi (quello è lavoro dello
  Scheduler Engine/nodo composito review-loop di architecture.md §0).
- TLS / ACL / mTLS / secrets management — broker di test deliberatamente
  aperto e locale.
- Enforcement reale di skills/cli/mcp per ruolo — `agents.yaml`/`roles.yaml`
  oggi sono solo informativi nella presence card; non limitano davvero quali
  tool Pi concede all'agente (quello dipende dai flag della CLI `pi` stessa).

## Come provarlo end-to-end con 3 agenti reali (herdr)

Serve: la CLI `pi`, un broker MQTT locale, e **herdr** per avere i tre agenti
in pannelli separati dello stesso terminale e vederli scambiarsi messaggi.

```bash
# 0. installa herdr (una tantum), se non già presente
curl -fsSL https://herdr.dev/install.sh | sh
# alternative: brew install herdr / mise use -g herdr

# 1. dentro pi-mqtt-orchestrator/
npm install

# 1.5 dalla Revisione 13 in poi, la directory di lavoro DEVE essere un repo
#     git (serve per l'isolamento in worktree) — se non lo è già:
git init && git add -A && git commit -m "init"

# 2. avvia il broker locale — Docker è il percorso consigliato: un solo
#    broker, nessun rischio di conflitto sulla porta 1883 con un'eventuale
#    installazione mosquitto locale (se ne hai una da brew e usi Docker,
#    disinstallala: due broker sulla stessa porta creano solo confusione,
#    vedi "Un solo broker" più sotto)
docker compose -f mqtt/compose.yaml up -d

# 3. avvia herdr dalla cartella pi-mqtt-orchestrator (importante: stessa
#    working directory per tutti e tre i pannelli, così coder e reviewer
#    vedono davvero gli stessi file su disco)
herdr
```

Dentro herdr, apri **tre pannelli** (`Ctrl+b, c` per un nuovo tab, oppure
`Ctrl+b, v`/`Ctrl+b, -` per split verticale/orizzontale) e in ciascuno lancia
un'istanza diversa, sempre dalla stessa directory:

```bash
# pannello 1 — planner SEMPRE tramite questo script, mai `pi` a mano (vedi
# subito sotto): è l'unico modo in cui le skill vendorizzate mattpocock
# (wayfinder/to-spec) vengono cablate nella sessione — vedi prompts/planner.md
node scripts/launch-planner.mjs --instance planner-01

# pannello 2
pi -e extensions/orchestrator.ts --instance coder-01 --role coder

# pannello 3
pi -e extensions/orchestrator.ts --instance reviewer-01 --role reviewer
```

(`--role` è opzionale su coder/reviewer se `agents/agents.yaml` ha già il
ruolo giusto per quell'`--instance`, ma passarlo esplicitamente non fa danno
ed evita ambiguità se stai improvvisando istanze non presenti nello yaml.
`scripts/launch-planner.mjs` forza sempre `--role planner` da solo, vedi il
file stesso.)

**Perché non `pi -e extensions/orchestrator.ts --instance planner-01 --role
planner` a mano, come per coder/reviewer**: un incidente reale (Revisione 38,
vedi più sotto) — lanciato così, il planner non ha `wayfinder`/`to-spec`
cablate (nessun `--skill`), e `prompts/planner.md` lo dichiara esplicitamente
non supportato per il ruolo planner. `scripts/launch-planner.mjs` esiste
apposta per comporre quei flag (vedi Revisione 22) — usalo sempre per
planner, anche in sviluppo locale del pacchetto stesso.

### Alternativa: lanciare E nominare il pannello in un solo comando

herdr riconosce `pi` come uno dei suoi "kind" nativi. Invece di lanciare `pi`
a mano e affidarti a `herdrRenamePane()`/`herdrReportAgent()` (Revisioni
6/10/12) per rinominare il pannello dopo, puoi dare il nome già al momento
del lancio con:

```bash
# solo per coder/reviewer/specialisti — per planner vedi il limite subito
# sotto, herdr non può nominare al volo un pannello lanciato da uno script
herdr agent start coder-01 --kind pi --pane --current -- \
  -e extensions/orchestrator.ts --instance coder-01 --role coder
```

**Limite per planner**: questa scorciatoia lancia `pi` direttamente (`--kind
pi`), quindi salta `scripts/launch-planner.mjs` — per planner userebbe `pi`
a mano esattamente come il caso sopra, senza le skill vendorizzate. Per
planner lancia comunque `node scripts/launch-planner.mjs --instance
planner-01` (senza `agent start`) e rinomina il pannello dopo, o a mano, o
lasciando che `herdrRenamePane()`/`herdrReportAgent()` (Revisioni 6/10/12)
lo facciano da soli all'avvio — sono già nel percorso di
`launch-planner.mjs`.

Da eseguire **dentro il pannello vuoto** dove vuoi far partire l'agente (la
shell del pannello deve essere in primo piano, senza nient'altro in
esecuzione — è esattamente lo stato in cui ti trovi appena apri un pannello
nuovo). `--kind pi` dice a herdr che l'eseguibile è `pi`; tutto quello dopo
`--` sono gli argomenti passati a `pi` così come sono (`-e ...`, `--instance
...`, `--role ...`); il primo argomento (`coder-01`) è il nome che herdr
userà per il pannello fin da subito, senza bisogno del rename successivo.

Non è un "crea il pannello e lancia" in un singolo comando in senso stretto:
`agent start` **richiede un pannello già esistente e vuoto** (`--pane ID`, o
`--current` per usare quello da cui lo lanci) — se stai partendo da zero,
prima apri il pannello (`Ctrl+b, c` in herdr, o `herdr pane split`), poi ci
lanci dentro `agent start`. Ripeti per gli altri due pannelli cambiando nome
e `--role`.

**Limite onesto**: non ho un herdr installato in questo sandbox per
verificarlo a runtime — la sintassi (`agent start <nome> --kind pi --pane ID
-- <args>`, `--current` per il pannello da cui lanci) viene dalla
documentazione ufficiale della CLI di herdr, non da un test diretto. Se
`--pane --current` non fosse la forma esatta accettata (potrebbe essere
`--current` come flag a sé stante invece che valore di `--pane`), prova
`herdr agent start --help` sulla tua installazione per la sintassi esatta
prima di scriverlo negli script. Se questo comando funziona come documentato,
rende superfluo il rename automatico che l'estensione prova a fare dopo —
ma lascio comunque quel codice attivo come rete di sicurezza per chi lancia
`pi` nel modo semplice, senza `agent start`.

Aspetta il messaggio "orchestrator ready" in tutti e tre i pannelli — a quel
punto ogni agente ha pubblicato la sua presenza retained e gli altri la
vedono (verificabile anche con `/orchestrator` in un pannello, o con il
widget sotto l'editor che mostra i peer online).

Poi, **nel pannello di planner-01**, scrivi qualcosa come:

```
sviluppami una mini funzione che fa il controllo di un codice fiscale
```

Cosa aspettarti, guardando gli altri pannelli:

1. planner-01 chiama `worktree_create`, crea
   `.pi/extensions/multiAgentOrchestrator/reports/<slug>.md` dentro il
   worktree (non nella cartella dove hai lanciato herdr — vedi Revisione 37),
   poi chiama
   `agent_send(target_role: "coder", ...)`, ti dice che ha assegnato il
   task, dove trova worktree/report, e torna disponibile per te.
2. nel pannello coder-01 parte automaticamente un nuovo turno ("[task from
   planner-01 (planner)] ...") — il coder implementa la funzione **dentro il
   worktree** (dovrebbe crearti un file tipo `codice-fiscale.ts` o simile lì,
   NON nella cartella principale dove hai lanciato herdr — se guardi lì non
   lo troverai ancora) e poi chiama `agent_send(target_role: "reviewer", ...)`.
3. nel pannello reviewer-01 parte un nuovo turno, il reviewer legge il file
   che il coder ha appena scritto dentro lo stesso worktree, lo valuta, ed
   esegue `agent_send(target_role: "planner", ...)` con l'esito.
4. nel pannello planner-01 parte un nuovo turno automatico con il messaggio
   del reviewer: se soddisfatto, chiama `worktree_finalize` — **solo a
   questo punto** il file compare davvero nella cartella principale del
   progetto (`git log` mostrerà un commit di merge `task/<slug>`) — e
   l'agente ti riporta che il lavoro è fatto, verificato e salvato.

Se il reviewer respinge, vedrai invece un altro giro: reviewer → coder → di
nuovo reviewer, finché non approva (nessun limite di tentativi a questo
stadio — vedi sopra) — durante tutti questi giri il worktree resta aperto e la
cartella principale resta inalterata, finché planner non chiama
`worktree_finalize` alla fine.

### Se qualcosa non parte

- "orchestrator: --instance is required" → manca `--instance` sulla riga di
  comando.
- "Cannot find module 'mqtt'" al caricamento dell'estensione → non hai
  eseguito `npm install` nella cartella che contiene `package.json` (deve
  essere la stessa da cui lanci `pi -e extensions/orchestrator.ts`).
- Il widget resta su "connecting…" / "reconnecting…" → il broker non è
  raggiungibile su `mqtt://localhost:1883` (default). Controlla
  `docker ps` — deve esserci `pi-orchestrator-mqtt-dev` con la porta
  `127.0.0.1:1883->1883/tcp`. Non serve riavviare `pi`: appena il broker
  risponde, il widget si aggancia da solo entro un paio di secondi.
- Nessun peer visibile con `agent_list` → controlla che tutti e tre i
  pannelli abbiano lo stesso `--project` — dalla Revisione 38 in poi non è
  più `default` per tutti, ma deriva dalla directory di lavoro (vedi
  Revisione 38 più sotto), quindi il caso tipico è aver lanciato uno dei tre
  pannelli da una cwd diversa dagli altri due, non un `--project` scordato.
- Un pannello vede agenti che non ti aspetti (di un ALTRO progetto sullo
  stesso broker) → prima della Revisione 38 questo era un bug reale, non
  solo un rischio teorico: `--project` non passato defaultava sempre alla
  stessa stringa letterale `default` per ogni progetto, quindi due progetti
  qualsiasi sullo stesso broker locale finivano sullo stesso albero di topic
  MQTT. Dalla Revisione 38, il default deriva dall'identità del progetto
  stesso (`config/project.json`, poi `package.json`, poi il nome della
  cartella) — se lo vedi ancora, controlla `.pi/extensions/multiAgentOrchestrator/config/project.json`
  in entrambi i progetti: se coincidono per errore (es. un progetto copiato
  con `cp -r` invece che scaffoldato con `po init`), passa `--project` a
  mano con un valore diverso in uno dei due.
- Il coder scrive codice ma il reviewer non lo trova → quasi certamente i
  pannelli non sono stati avviati dalla stessa directory di lavoro.

### Osservare i messaggi in transito

Utile per vedere davvero cosa si stanno dicendo gli agenti, non solo
fidarsi del risultato finale. Con il broker Docker (`pi-orchestrator-mqtt-dev`)
già attivo, da terminale, riusando i binari già dentro il container:

```bash
docker exec -it pi-orchestrator-mqtt-dev mosquitto_sub -t 'pi/#' -v
# oppure, ristretto al progetto — dalla Revisione 38 in poi il default non è
# più la stringa letterale "default" ma il "name" del package.json del
# progetto (qui, dentro pi-mqtt-orchestrator/ stesso, è "pi-mqtt-orchestrator";
# in un progetto scaffoldato da `po init` sarà lo slug scelto con --name):
docker exec -it pi-orchestrator-mqtt-dev mosquitto_sub -t 'pi/pi-mqtt-orchestrator/#' -v
```

`-v` stampa `topic payload` per ogni messaggio: vedrai il task del planner su
`pi/<project>/roles/coder/tasks`, la richiesta di revisione su
`pi/<project>/roles/reviewer/tasks`, il report finale su
`pi/<project>/roles/planner/tasks`, e la presenza (retained) su
`pi/<project>/agents/+/status` — dove `<project>` è quello risolto per la tua
directory di lavoro (vedi Revisione 38 per l'ordine esatto di risoluzione).

Se preferisci una GUI: [MQTT Explorer](https://mqttexplorer.com/) —
`brew install --cask mqtt-explorer` — connessione a host `localhost`, porta
`1883`, nessun TLS, nessuna credenziale (il broker di sviluppo accetta
connessioni anonime), topic di sottoscrizione lasciato al default `#`.
