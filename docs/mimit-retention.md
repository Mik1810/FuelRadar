# MIMIT active-only retention runbook

This runbook removes historical MIMIT snapshots from the shared Supabase
database. It is destructive and must not be run without explicit approval.
Disable the Vercel cron first, wait until no import is `running`, and use a
direct or session-mode PostgreSQL connection. Never put credentials in command
arguments or logs.

## Backup and rehearsal

Create a custom-format logical backup through a protected `PGSERVICE` entry:

```bash
PGSERVICE=fuelradar-remote pg_dump \
  --format=custom \
  --schema=fuelradar \
  --file=/secure/path/fuelradar-before-retention.dump
```

Record its SHA-256, inspect it with `pg_restore --list`, and restore it with
`--single-transaction --no-owner --no-privileges` into a disposable native
local PostgreSQL database with PostGIS. Run the cleanup and public API checks on
that restore before touching Supabase.

Immediately before the remote change, record database, schema, table, heap and
index sizes. Confirm exactly one active dataset, sixteen inactive datasets, no
running import, and enough disk headroom. Any drift aborts the operation and
requires a new review.

## Guarded logical cleanup

Run the following only after the backup restore succeeds and the expected
counts receive explicit approval:

```sql
begin;

set local lock_timeout = '10s';
set local statement_timeout = '10min';

select pg_advisory_xact_lock(
  hashtextextended('fuelradar:mimit-import:v1', 0)
);

lock table fuelradar.datasets in share row exclusive mode;

create temp table retention_guard on commit drop as
select
  max(id) filter (where is_active) as active_id,
  count(*) filter (where is_active) as active_count,
  count(*) filter (where not is_active) as inactive_count,
  (select count(*) from fuelradar.import_runs) as import_run_count
from fuelradar.datasets;

do $guard$
declare
  snapshot retention_guard%rowtype;
  running_count bigint;
begin
  select * into snapshot from retention_guard;
  select count(*) into running_count
  from fuelradar.import_runs
  where status = 'running';

  if snapshot.active_count <> 1
     or snapshot.inactive_count <> 16
     or running_count <> 0 then
    raise exception 'Retention preflight invariant failed';
  end if;
end
$guard$;

with deleted as (
  delete from fuelradar.datasets
  where id <> (select active_id from retention_guard)
  returning station_count, price_count
)
select
  count(*) as deleted_datasets,
  coalesce(sum(station_count), 0) as deleted_stations,
  coalesce(sum(price_count), 0) as deleted_prices
from deleted;

do $verify$
declare
  snapshot retention_guard%rowtype;
  dataset_count bigint;
  active_count bigint;
  station_count bigint;
  price_count bigint;
  stored_station_count bigint;
  stored_price_count bigint;
  import_run_count bigint;
  invalid_run_links bigint;
  orphan_prices bigint;
begin
  select * into snapshot from retention_guard;

  select count(*), count(*) filter (where is_active)
  into dataset_count, active_count
  from fuelradar.datasets;

  select station_count, price_count
  into stored_station_count, stored_price_count
  from fuelradar.datasets
  where id = snapshot.active_id;

  select count(*) into station_count from fuelradar.stations;
  select count(*) into price_count from fuelradar.prices;
  select count(*) into import_run_count from fuelradar.import_runs;

  select count(*) into invalid_run_links
  from fuelradar.import_runs
  where dataset_id is not null and dataset_id <> snapshot.active_id;

  select count(*) into orphan_prices
  from fuelradar.prices as price
  left join fuelradar.stations as station
    on station.dataset_id = price.dataset_id
   and station.id = price.station_id
  where station.id is null;

  if dataset_count <> 1
     or active_count <> 1
     or station_count <> stored_station_count
     or price_count <> stored_price_count
     or import_run_count <> snapshot.import_run_count
     or invalid_run_links <> 0
     or orphan_prices <> 0 then
    raise exception 'Retention postcondition failed';
  end if;
end
$verify$;

commit;
```

Deleting the datasets preserves `import_runs`; references to deleted snapshots
become `NULL` through the existing foreign key.

## Physical space recovery

`DELETE` alone does not shrink the relation files. In the approved maintenance
window, run these commands separately and outside a transaction:

```sql
vacuum (full, analyze) fuelradar.prices;
vacuum (full, analyze) fuelradar.stations;
vacuum (analyze) fuelradar.datasets;
vacuum (analyze) fuelradar.import_runs;
```

`VACUUM FULL` takes an `ACCESS EXCLUSIVE` lock and temporarily needs a new copy
of each relation. Keep the cron disabled throughout. If a vacuum fails, leave
imports paused, verify that the active dataset is intact, and schedule another
window; do not improvise another destructive operation.

Afterward, verify sizes directly in PostgreSQL, then smoke-test dataset status,
nearby search, and station detail before re-enabling the cron. Supabase dashboard
size metrics may lag behind the direct database measurement.
