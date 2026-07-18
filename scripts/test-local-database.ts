import { databaseName, getLocalDatabaseUrl } from "./local-database";

const databaseUrl = new URL(getLocalDatabaseUrl());
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("PG")),
);

const child = Bun.spawn(
  ["pg_prove", "supabase/tests/nearby.test.sql"],
  {
    env: {
      ...inheritedEnvironment,
      PGDATABASE: databaseName(databaseUrl.toString()),
      PGHOST: databaseUrl.hostname,
      PGPASSWORD: decodeURIComponent(databaseUrl.password),
      PGPORT: databaseUrl.port || "5432",
      PGUSER: decodeURIComponent(databaseUrl.username),
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
const exitCode = await child.exited;
if (exitCode !== 0) process.exit(exitCode);
