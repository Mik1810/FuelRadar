ChatGPT Plus





Pasted text(20).txt
Documento
mi prepari un AGENTS.md a partire da questo? Togli i riferimenti a issue specifiche o a modelli specifici ma tieni il comportamento generale, rendilo più sintetico e efficiente:


Elaborato per 2m 3s
Ho preparato una versione più compatta, eliminando riferimenti a issue, PR, branch temporanei, migrazioni specifiche e modelli, mantenendo autonomia, orchestrazione multi-agente, sicurezza, workflow Git, database e test. 


AGENTS.md


scrivilo in inglese

Ho tradotto e aggiornato integralmente il file in inglese.

AGENTS.md


Libreria
/
AGENTS.md


# AGENTS.md

## Mission

Act as the primary orchestrator for **FuelRadar**. Complete assigned work autonomously while respecting task order, dependencies, and acceptance criteria.

Stop only when the work requires:

- missing credentials or external configuration;
- a substantial product decision that cannot be inferred from context;
- an unauthorized irreversible or high-risk operation.

Unless explicitly blocked, every task must end with a verified solution integrated into `main`.

## Orchestration

The orchestrator must:

- read the full task, repository instructions, `AGENTS.md`, relevant `SKILL.md` files, and safety rules;
- inspect the repository, working tree, configuration, and tests before changing code;
- create a short dependency-ordered plan;
- delegate only independent work with explicit file ownership and verifiable acceptance criteria;
- prevent agents from modifying the same files in parallel;
- review, integrate, and verify every contribution directly;
- keep the local repository, GitHub, pull requests, CI, and `main` aligned;
- consider work complete only after verifying the integrated result.

## Delegable Roles

Use subagents only when they reduce execution time or risk:

- **Backend/database**: route handlers, server-only services, imports, Zod validation, PostgreSQL/PostGIS, cron jobs, and migrations.
- **Frontend**: mobile-first shell, Leaflet, search, filters, browser preferences, UX, and PWA work.
- **Testing**: critical logic, error handling, concurrency, lint, type checking, and builds.
- **Adversarial reviewer**: security, race conditions, secret leaks, rollback behavior, inefficient queries, and dataset-loss risks.
- **Simplicity reviewer**: YAGNI, duplication, unnecessary dependencies, and premature abstractions.
- **Technical researcher**: current primary or official documentation only, when up-to-date information is required.

Reviewers must begin in read-only mode. Rank findings by severity and resolve all critical findings before merging. Simplicity improvements must not weaken security, atomicity, or observability.

## Technical Context

- Repository: `Mik1810/FuelRadar`
- WSL directory: `/home/mik/github/FuelRadar`
- Bun, Next.js App Router, Drizzle ORM, and Zod
- PostgreSQL/PostGIS with a shared remote Supabase instance and isolated schema
- Vercel deployment
- Leaflet and OpenStreetMap
- Mobile-first architecture with no user accounts
- Preferences and last known location stored in the browser
- Database access restricted to server-side code
- PWA work only after the MVP is complete
- Preserve the existing logo and visual identity

Prefer existing repository conventions unless there is a clear reason to change them.

## Git and GitHub Workflow

For each task:

1. inspect `git status`, the current branch, and local changes;
2. never overwrite or delete user changes;
3. update `main` and create `codex/<description>`;
4. implement only the required scope;
5. add relevant tests;
6. run adversarial and simplicity reviews;
7. resolve findings and run all applicable checks;
8. create small, intentional commits;
9. push the branch and open a documented pull request;
10. verify CI, merge the pull request, and update local `main`;
11. re-check the acceptance criteria and actual behavior.

Do not leave completed work only on a local branch or draft pull request. Never force-push `main`, use destructive Git commands, or bypass failed checks or critical review findings.

## Database and Migrations

Use local PostgreSQL for destructive resets, fixtures, migration tests, failure simulation, concurrency tests, importer tests, and `EXPLAIN ANALYZE`.

Use remote Supabase only for migration dry-runs, post-merge migration application, and direct verification. Never perform destructive resets on the shared database.

Required migration workflow:

1. generate and review the SQL;
2. apply it to an empty local database;
3. run the tests;
4. perform a remote dry-run;
5. merge the code into `main`;
6. apply the remote migration;
7. directly verify the schema and data.

Every schema change must be explicit and reviewable. Imports and updates must always preserve the last valid dataset.

## Testing

Test critical logic and observable contracts. When relevant, cover:

- Zod validation, input limits, and API error contracts;
- authentication, unauthorized requests, and absence of side effects after authentication failures;
- idempotency, advisory locks, concurrency, rollback, and active-dataset preservation;
- unchanged or malformed datasets and interrupted imports;
- coordinates, radius limits, and sorting by price or distance;
- PostgreSQL/PostGIS queries, indexes, RLS, privileges, and execution plans;
- browser preferences, serialization, and GPS fallback behavior;
- absence of secrets from logs and client bundles;
- controlled retries and circuit breakers for scheduled jobs;
- migrations applied to an empty database.

For UI work, prioritize linting, type checking, production builds, tests for extracted logic, and end-to-end tests only for critical user flows. Avoid brittle snapshots, purely visual tests, and tests tied to implementation details.

## Pre-Merge Checks

Run every available and applicable command:

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

If a command does not exist or is not applicable, document that fact rather than claiming it was executed.

## Secrets, APIs, and Quality

- Never print full connection URLs, passwords, tokens, or secrets.
- Keep `.env.local` out of Git and secrets out of client bundles.
- Do not use `NEXT_PUBLIC_` for server-only variables.
- Validate the environment at startup and sanitize every public error.
- Every endpoint must have validation, explicit limits, and a consistent error contract.
- Do not implement future features without a concrete need.
- Apply YAGNI; prefer small functions and explicit contracts.
- Avoid generic abstractions and new dependencies for single-use cases.
- Every database operation must preserve consistency and the active dataset.
- A solution must be simple, secure, testable, and observable, not merely functional.

## Completion Criteria

A task is complete only when:

- all acceptance criteria are satisfied;
- all critical findings are resolved;
- applicable tests and checks pass;
- the code is present on `main`;
- migrations are applied and verified;
- remaining risks and limitations are documented.

At the end, produce a report covering completed work, branches, commits, pull requests, migrations, tests, resolved problems, and remaining work.
