BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT extensions.plan(11);

SELECT extensions.is(
	(
		SELECT count(*)::integer
		FROM fuelradar.nearby_stations(
			41.9028,
			12.4964,
			5,
			'benzina',
			'self',
			50
		)
	),
	3,
	'nearby returns only active, in-radius, matching prices'
);

SELECT extensions.is(
	(
		SELECT string_agg(station_id, ',' ORDER BY ordinal_position)
		FROM fuelradar.nearby_stations(
			41.9028,
			12.4964,
			5,
			'benzina',
			'self',
			50
		) WITH ORDINALITY AS result(station_id, operator, brand, station_type, name, address, city, province, latitude, longitude, fuel_type, service_mode, price, communicated_at, distance_km, ordinal_position)
	),
	'rome-cheap,rome-near,rome-far',
	'nearby sorts by price, distance, then station id'
);

SELECT extensions.is(
	(
		SELECT station_id
		FROM fuelradar.nearby_stations(
			41.9028,
			12.4964,
			5,
			'benzina',
			'served',
			50
		)
	),
	'rome-near',
	'service mode is an independent filter'
);

SELECT extensions.is(
	(
		SELECT count(*)::integer
		FROM fuelradar.nearby_stations(
			41.9028,
			12.4964,
			51,
			'benzina',
			'self',
			50
		)
	),
	0,
	'the database rejects searches beyond the maximum radius'
);

SELECT extensions.ok(
	(
		SELECT bool_and(distance_km >= 0 AND distance_km <= 5)
		FROM fuelradar.nearby_stations(
			41.9028,
			12.4964,
			5,
			'benzina',
			'self',
			50
		)
	),
	'distances are returned in kilometres'
);

SELECT extensions.ok(
	(
		SELECT bool_and(relrowsecurity)
		FROM pg_class
		WHERE oid IN (
			'fuelradar.datasets'::regclass,
			'fuelradar.stations'::regclass,
			'fuelradar.prices'::regclass,
			'fuelradar.import_runs'::regclass
		)
	),
	'RLS is enabled on every application table'
);

SELECT extensions.ok(
	NOT has_schema_privilege('anon', 'fuelradar', 'USAGE')
	AND NOT has_table_privilege('anon', 'fuelradar.datasets', 'SELECT')
	AND NOT has_table_privilege('authenticated', 'fuelradar.prices', 'SELECT'),
	'browser roles cannot access the application schema or tables'
);

SELECT extensions.ok(
	NOT has_function_privilege(
		'anon',
		'fuelradar.nearby_stations(double precision, double precision, double precision, fuelradar.fuel_type, fuelradar.service_mode, integer)',
		'EXECUTE'
	)
	AND has_function_privilege(
		'service_role',
		'fuelradar.nearby_stations(double precision, double precision, double precision, fuelradar.fuel_type, fuelradar.service_mode, integer)',
		'EXECUTE'
	),
	'only the server role can execute the nearby RPC'
);

DELETE FROM fuelradar.import_runs;

INSERT INTO fuelradar.import_runs (status)
VALUES ('running');

SELECT extensions.is(
	(
		SELECT count(*)::integer
		FROM fuelradar.import_runs
		WHERE status = 'running'
	),
	1,
	'the first running import can be recorded'
);

INSERT INTO fuelradar.import_runs (status)
VALUES ('running')
ON CONFLICT DO NOTHING;

SELECT extensions.is(
	(
		SELECT count(*)::integer
		FROM fuelradar.import_runs
		WHERE status = 'running'
	),
	1,
	'the partial unique index rejects a duplicate running import'
);

INSERT INTO fuelradar.import_runs (status)
VALUES ('failed'), ('failed');

SELECT extensions.is(
	(
		SELECT count(*)::integer
		FROM fuelradar.import_runs
		WHERE status = 'failed'
	),
	2,
	'the running-only invariant allows multiple terminal imports'
);

SELECT * FROM extensions.finish();

ROLLBACK;
