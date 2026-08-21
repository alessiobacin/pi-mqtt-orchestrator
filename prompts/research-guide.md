# Guida di ricerca web per il planner (Ticket 09)

Questa guida definisce COME il planner fa la ricerca web approfondita sul task
prima dello scoping, quando la merita. È estratta in file proprio (invece di
gonfiare ulteriormente `prompts/planner.md`) così il prompt principale resta
leggibile; il planner la consulta come riferimento al bisogno.

## Quando usarla (e quando no)

**Usa la ricerca web approfondita** quando il task:
- coinvolge sviluppo/tooling dove può esistere già un progetto o una libreria
  adatta a riusare/inspirare ("trova progetti simili"),
- richiede competenze verticali per cui esistono tool/CLI/MCP/skill consolidati
  da scegliere,
- è abbastanza grande/ambiguo da giustificare ≥ 2–3 passaggi di ricerca prima
  di proporre team e piano.

**Riduci o salta la ricerca** (procedi con lo scoping diretto / grilling breve)
quando il task è:
- banale e già chiaro,
- non-dev (es. documentazione interna, note, analisi su materiale già in repo),
- oppure già perfettamente inquadrato dall'utente (nessuna scelta di tooling,
  nessuna reinvenzione possibile).

Il planner decide caso per caso, NON la applica per ogni task.

## Flusso consigliato (faithful all'intent dell'operatore)

1. **Ricevi la richiesta** (es. "sviluppa un'app che valida il codice fiscale
   di un cittadino italiano").
2. **Ricerca web di progetti simili**: cerca chi ha già risolto lo stesso
   problema; consulta repo/fonti/demo. Leggi con attenzione i 2–3 risultati
   migliori.
3. **Sessione di raffinamento (grilling)**: sulla base della ricerca poni
   all'operatore le domande per rifinire lo scope. Se esiste già una soluzione
   identica/abbastanza vicina, SUGGERISCI esplicitamente di riusarla/adottarla
   o prenderne spunto, invece di reinventarla.
4. **Tooling migliore per ruolo**: per ogni agente del team candidato, ricerca
   le CLI/MCP/skill/playbook migliori per il suo compito specifico (es.
   validation → package dedicated + test; REST → OpenAPI). Raccogli le
   raccomandazioni concrete.
5. **Proposta**: presenta all'operatore il team E le raccomandazioni di
   tooling, chiedendo conferma su entrambi.
6. **Documento esaustivo**: al confermare, produce/aggiorna il documento delle
   attività con ownership e dipendenze (vedi `po deps`/preflight, Ticket 10).

## Nota onesta su disponibilità di uno strumento di ricerca

Questo progetto NON garantisce che l'istanza planner abbia uno strumento di
ricerca web (websearch/browser) cablato. Se non lo trovi tra i tool
disponibili:
- NON bloccarti: **segnala all'operatore** che la ricerca web non è disponibile
  in questa sessione e procedi con lo scoping diretto + grilling (fallback già
  coperto dal metodo di scoping integrato).
- Il valore del flusso qui sopra è soprattutto nelle STEP 3→6 (raffinamento +
  tooling + documento), che valgono anche senza ricerca automatica: in quel
  caso il planner formula le stesse domande di scoping e propone il tooling
  dalla propria conoscenza, dichiarandolo.

## Cosa NON fa mai

- Non inventa progetti/tool che non ha verificato (se non può ricercare, non
  cita repo immaginari).
- Non sostituisce il consenso dell'operatore: team e tooling restano proposti,
  mai auto-approvati.
- Non esegue la ricerca a oltranza: 2–3 passaggi mirati, poi decide.
