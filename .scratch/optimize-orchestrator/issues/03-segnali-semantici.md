## Question

Passare da soglia di tempo a **segnali semantici per-harness** per distinguere
"sta ragionando" da "bloccato". Verificare se l'SDK di Pi espone eventi di
ciclo di vita del turno (inizio/fine turno, tool-call in corso). Se pi li
espone, agganciarli; se no, fallback su "ultima tool-call di successo" tracciata
dagli eventi — che già distingue il caso Revisione 29.

Type: research (SDK pi) — limite noto: `research` non vendorizzata → segnalare
all'operatore l'esito dell'indagine, non risolvere con skill assente.
Blocked by:
Status:
