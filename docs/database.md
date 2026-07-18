# Database workflow

FuelRadar reuses an existing Supabase PostgreSQL project while keeping all app
objects isolated in the `fuelradar` schema. The application never connects to
Supabase directly from the browser.

## Connection roles

- `DATABASE_URL` is used only by Next.js server code. On Vercel it should be the
  Supavisor transaction-pooler URL on port `6543`.
- `MIGRATION_DATABASE_URL` is used only by local migration tooling. Use the
  direct connection when IPv6 is available, otherwise the session pooler on
  port `5432`.
- `LOCAL_DATABASE_URL` points only to the native PostgreSQL instance in WSL.
- `CRON_SECRET` authenticates the future import endpoint and is unrelated to
  database access.

Never prefix these variables with `NEXT_PUBLIC_`. The runtime PostgreSQL client
uses a single pooled connection per server instance and disables prepared
statements, as required by Supavisor transaction mode.

## Initial setup

Install dependencies and copy the environment template:

```bash
bun install
cp .env.example .env.local
```

Fill `.env.local` with the connection strings from the Supabase **Connect**
panel. Do not commit that file.

Local development uses PostgreSQL 17, PostGIS and pgTAP installed directly in
WSL. Docker and the local Supabase stack are not required. After the one-time
package installation and creation of the local `fuelradar` superuser, use:

```bash
bun run db:reset
bun run db:start
bun run db:test
bun run db:test:import
bun run db:explain
bun run import:mimit:local
```

The default development connection is
`postgresql://fuelradar:fuelradar@127.0.0.1:5432/fuelradar_local`. This is an
intentionally public local-only credential and must never be reused in
production. `db:reset` recreates only `fuelradar_local`, applies every committed
migration in order and loads `supabase/seed.sql`. PostgreSQL itself is managed
by systemd (`systemctl status postgresql`).

## Schema changes

Drizzle TypeScript declarations live under `src/server/db/schema.ts`. Generate a
reviewable SQL migration after changing them:

```bash
bun run db:generate
bun run db:check
```

Generated SQL lives in `supabase/migrations/`. PostGIS functions, RLS, grants
and database functions that Drizzle cannot express should be added to the same
migration explicitly.

To connect the CLI to the existing hosted project, authenticate and use the
project reference shown in Supabase settings:

```bash
bunx supabase login
bunx supabase link --project-ref YOUR_PROJECT_REF
```

Always inspect the remote plan before applying pending migrations:

```bash
bun run db:push:dry
bun run db:push
```

The CLI stores applied versions in `supabase_migrations.schema_migrations`, so
later pushes skip migrations already recorded. Do not run remote reset commands.

## Safe verification

With `DATABASE_URL` configured, verify connectivity without printing hosts,
users or passwords:

```bash
bun run db:verify
```
