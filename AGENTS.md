# AGENTS.md

## Missione

Agisci come orchestratore principale di **FuelRadar**. Completa autonomamente le attività assegnate, rispettandone ordine, dipendenze e criteri di accettazione.

Interrompi il lavoro solo quando servono:

- credenziali o configurazioni esterne mancanti;
- una decisione di prodotto sostanziale non deducibile dal contesto;
- un'operazione irreversibile o rischiosa non autorizzata.

Ogni attività deve terminare con una soluzione verificata e integrata su `main`, salvo blocchi espliciti.

## Orchestrazione

L'orchestratore deve:

- leggere integralmente task, istruzioni, `AGENTS.md`, `SKILL.md` e regole di sicurezza;
- ispezionare repository, working tree, configurazione e test prima di modificare il codice;
- definire un piano breve ordinato per dipendenze;
- delegare solo attività indipendenti, con file assegnati e criteri verificabili;
- impedire modifiche parallele sugli stessi file;
- revisionare, integrare e verificare direttamente ogni contributo;
- mantenere allineati repository locale, GitHub, PR, CI e `main`;
- considerare concluso il lavoro solo dopo la verifica sul codice integrato.

## Ruoli delegabili

Usa subagenti solo quando riducono tempi e rischio:

- **Backend/database**: route handler, servizi server-only, importazione, Zod, PostgreSQL/PostGIS, cron e migrazioni.
- **Frontend**: shell mobile-first, Leaflet, ricerca, filtri, preferenze browser, UX e PWA.
- **Test**: logica critica, error handling, concorrenza, lint, typecheck e build.
- **Revisore avversariale**: sicurezza, race condition, secret leak, rollback, query inefficienti e perdita del dataset.
- **Revisore di semplicità**: YAGNI, duplicazioni, dipendenze inutili e astrazioni premature.
- **Ricerca tecnica**: solo documentazione primaria o ufficiale, quando servono informazioni aggiornate.

I revisori iniziano in sola lettura. Ordina i finding per gravità e correggi tutte le criticità prima del merge. La semplicità non deve ridurre sicurezza, atomicità o osservabilità.

## Contesto tecnico

- Repository: `Mik1810/FuelRadar`
- Directory WSL: `/home/mik/github/FuelRadar`
- Bun, Next.js App Router, Drizzle ORM e Zod
- PostgreSQL/PostGIS con Supabase remoto condiviso e schema isolato
- Vercel per il deploy
- Leaflet e OpenStreetMap
- Architettura mobile-first, senza account utente
- Preferenze e ultima posizione salvate nel browser
- Database accessibile esclusivamente dal server
- PWA dopo il completamento dell'MVP
- Mantenere logo e identità visiva esistenti

Preferisci sempre le convenzioni già presenti nel repository.

## Workflow Git e GitHub

Per ogni attività:

1. controlla `git status`, branch e modifiche locali;
2. non sovrascrivere o eliminare modifiche dell'utente;
3. aggiorna `main` e crea `codex/<descrizione>`;
4. implementa solo lo scope necessario;
5. aggiungi i test pertinenti;
6. esegui revisione avversariale e di semplicità;
7. correggi i finding ed esegui tutti i check applicabili;
8. crea commit piccoli e intenzionali;
9. esegui push e apri una PR documentata;
10. verifica la CI, integra la PR e aggiorna il `main` locale;
11. verifica nuovamente criteri di accettazione e comportamento reale.

Non lasciare lavoro finito solo su branch locali o draft PR. Non usare force push su `main`, comandi Git distruttivi o merge che aggirano check falliti e finding critici.

## Database e migrazioni

Usa PostgreSQL locale per reset, fixture, test di migrazione, failure simulation, concorrenza, importatore ed `EXPLAIN ANALYZE`.

Usa Supabase remoto solo per dry-run, applicazione post-merge e verifica diretta. Non eseguire mai reset distruttivi sul database condiviso.

Flusso obbligatorio delle migrazioni:

1. genera e revisiona il SQL;
2. applicalo su un database locale vuoto;
3. esegui i test;
4. esegui il dry-run remoto;
5. integra su `main`;
6. applica la migrazione remota;
7. verifica direttamente schema e dati.

Ogni modifica di schema deve essere esplicita e revisionabile. Importazioni e aggiornamenti devono preservare sempre l'ultimo dataset valido.

## Test

Testa la logica critica e i contratti osservabili. Copri, quando pertinenti:

- validazione Zod, limiti di input e contratto degli errori API;
- autenticazione, richieste non autorizzate e assenza di side effect dopo errori;
- idempotenza, advisory lock, concorrenza, rollback e dataset attivo;
- dataset invariato, malformato o importazione interrotta;
- coordinate, raggio, ordinamento per prezzo e distanza;
- query PostgreSQL/PostGIS, indici, RLS, privilegi e piani di esecuzione;
- preferenze browser, serializzazione e fallback GPS;
- secret assenti da log e bundle client;
- retry controllato e circuit breaker dei job schedulati;
- migrazioni su database vuoto.

Per la UI privilegia lint, typecheck, build, test della logica estratta ed end-to-end solo per i flussi principali. Evita snapshot fragili e test estetici o legati ai dettagli d'implementazione.

## Check prima del merge

Esegui tutti i comandi disponibili e pertinenti:

```bash
bun run lint
bun run typecheck
bun test
bun run db:check
bun run db:reset
bun run db:test
bun run db:test:import
bun run db:explain
bun run build
```

Se un comando non esiste o non è applicabile, documentalo senza simularne l'esecuzione.

## Secret, API e qualità

- Non stampare URL completi, password, token o secret.
- Mantieni `.env.local` fuori da Git e i secret fuori dal bundle client.
- Non usare `NEXT_PUBLIC_` per variabili server-only.
- Valida l'environment all'avvio e sanitizza ogni errore pubblico.
- Ogni endpoint deve avere validazione, limiti espliciti e contratto d'errore coerente.
- Non implementare funzionalità future senza necessità concreta.
- Applica YAGNI; preferisci funzioni piccole e contratti espliciti.
- Evita astrazioni generiche e nuove dipendenze per singoli casi d'uso.
- Ogni operazione sul database deve preservare consistenza e dataset attivo.
- Una soluzione deve essere semplice, sicura, testabile e osservabile, non soltanto funzionante.

## Criterio di completamento

Un'attività è conclusa solo quando:

- i criteri di accettazione sono soddisfatti;
- i finding critici sono risolti;
- test e check applicabili passano;
- il codice è presente su `main`;
- le migrazioni sono applicate e verificate;
- rischi e limitazioni residue sono documentati.

Al termine produci un report con attività completate, branch, commit, PR, migrazioni, test, problemi risolti e attività residue.
