# FuelRadar Status

The ordered backlog lives in GitHub epic #37 and issues #38–#54.

## Complete

- Next.js/Bun web foundation and removal of the Expo runtime (#38).
- Vercel project, production deployment and custom-domain DNS configuration.
- Supabase project reuse with isolated `fuelradar` schema and PostGIS enabled.
- Local environment variables kept outside Git through `.env.local`.
- Official MIMIT source format and product freshness rule documented.
- Canonical FuelRadar domain, pure MIMIT parser, offline fixtures and parser
  diagnostics (#39).

## In progress

- Supabase migration workflow with Drizzle and Zod (#40).

## Next

- PostgreSQL/PostGIS schema and nearby-query contract (#41).
- Atomic MIMIT importer (#42).

Do not add implementation tasks here. Create or update the corresponding GitHub
issue so ordering, acceptance criteria and discussion stay in one place.
