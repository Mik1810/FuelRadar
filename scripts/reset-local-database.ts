import postgres from "postgres";

import {
  adminDatabaseUrl,
  connectLocalDatabase,
  databaseName,
  getLocalDatabaseUrl,
} from "./local-database";

const databaseUrl = getLocalDatabaseUrl();
const name = databaseName(databaseUrl);
const identifier = `"${name}"`;
const admin = postgres(adminDatabaseUrl(databaseUrl), {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  onnotice: () => {},
});

try {
  await admin.unsafe(`drop database if exists ${identifier} with (force)`);
  await admin.unsafe(`create database ${identifier} owner fuelradar`);
  await admin.unsafe(
    `alter database ${identifier} set search_path = public, extensions`,
  );

  await admin.unsafe(`
    do $roles$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end
    $roles$;
  `);
} finally {
  await admin.end({ timeout: 5 });
}

const sql = connectLocalDatabase(databaseUrl);

try {
  const migrationFiles = await Array.fromAsync(
    new Bun.Glob("supabase/migrations/*.sql").scan({
      cwd: process.cwd(),
      absolute: true,
    }),
  );
  migrationFiles.sort();

  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
  `);

  for (const path of migrationFiles) {
    const fileName = path.split("/").at(-1);
    const match = fileName?.match(/^(\d+)_([^.]+)\.sql$/);
    if (!fileName || !match) {
      throw new Error(`Invalid migration filename: ${path}`);
    }

    await sql.begin(async (transaction) => {
      await transaction.unsafe(await Bun.file(path).text());
      await transaction`
        insert into supabase_migrations.schema_migrations (version, name)
        values (${match[1]}, ${match[2]})
      `;
    });
    console.info(`Applied ${fileName}`);
  }

  await sql.unsafe(await Bun.file("supabase/seed.sql").text());
  console.info(`Reset ${name} and loaded the local seed.`);
} finally {
  await sql.end({ timeout: 5 });
}
