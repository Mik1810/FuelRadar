import { connectLocalDatabase, getLocalDatabaseUrl } from "./local-database";

const sql = connectLocalDatabase(getLocalDatabaseUrl());

try {
  const [status] = await sql<
    {
      server_version: string;
      postgis_version: string;
      application_tables: number;
      nearby_rpc: boolean;
    }[]
  >`
    select
      current_setting('server_version') as server_version,
      extensions.postgis_lib_version() as postgis_version,
      (
        select count(*)::int
        from information_schema.tables
        where table_schema = 'fuelradar'
          and table_name in ('datasets', 'stations', 'prices', 'import_runs')
      ) as application_tables,
      to_regprocedure(
        'fuelradar.nearby_stations(double precision,double precision,double precision,fuelradar.fuel_type,fuelradar.service_mode,integer)'
      ) is not null as nearby_rpc
  `;

  if (
    !status ||
    !status.server_version.startsWith("17.") ||
    status.application_tables !== 4 ||
    !status.nearby_rpc
  ) {
    throw new Error("The native FuelRadar database is incomplete.");
  }

  console.info(
    `PostgreSQL ${status.server_version}, PostGIS ${status.postgis_version}: native FuelRadar database ready.`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
