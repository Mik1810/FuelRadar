import postgres from "postgres";

const LOCAL_DATABASE_URL =
  process.env.LOCAL_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const sql = postgres(LOCAL_DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
});
const rollbackAfterVerification = new Error("rollback-after-verification");

try {
  try {
    await sql.begin(async (transaction) => {
      const [dataset] = await transaction<{ id: number }[]>`
      select id
      from fuelradar.datasets
      where is_active
    `;

      if (!dataset) {
        throw new Error(
          "The local FuelRadar fixture does not contain an active dataset.",
        );
      }

      await transaction`
      insert into fuelradar.stations (
        dataset_id,
        id,
        operator,
        brand,
        station_type,
        name,
        address,
        city,
        province,
        location
      )
      select
        ${dataset.id},
        'plan-' || point::text,
        'Plan fixture',
        'FuelRadar',
        'Stradale',
        'Plan station ' || point::text,
        'Plan address',
        'Comune fixture',
        'IT',
        extensions.ST_SetSRID(
          extensions.ST_MakePoint(
            6.0 + (point % 300) * 0.04,
            36.0 + floor(point / 300.0) * 0.20
          ),
          4326
        )
      from generate_series(1, 10000) as point
    `;

      await transaction`analyze fuelradar.stations`;

      const explain = await transaction`
      explain (analyze, buffers, format json)
      with origin as (
        select extensions.ST_SetSRID(
          extensions.ST_MakePoint(12.4964, 41.9028),
          4326
        )::extensions.geography as location
      )
      select station.id
      from fuelradar.stations as station
      cross join origin
      where station.dataset_id = ${dataset.id}
        and extensions.ST_DWithin(
          station.location::extensions.geography,
          origin.location,
          10000
        )
    `;

      const serializedPlan = JSON.stringify(explain);
      if (!serializedPlan.includes("stations_location_geography_gist_idx")) {
        throw new Error(
          "The realistic nearby plan did not use stations_location_geography_gist_idx.",
        );
      }

      const [planDocument] = explain as Array<Record<string, unknown>>;
      const plan = planDocument?.["QUERY PLAN"] as
        | Array<{ "Execution Time"?: number; Plan?: { "Actual Rows"?: number } }>
        | undefined;
      const executionTime = plan?.[0]?.["Execution Time"];
      const rows = plan?.[0]?.Plan?.["Actual Rows"];

      console.info(
        `Nearby query plan: geography GiST index used, ${rows ?? "?"} rows in ${executionTime ?? "?"} ms.`,
      );

      throw rollbackAfterVerification;
    });
  } catch (error) {
    if (error !== rollbackAfterVerification) throw error;
  }
} finally {
  await sql.end({ timeout: 5 });
}
