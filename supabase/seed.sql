-- Small, deterministic Rome fixture for local development. Production imports
-- replace this data through the atomic dataset workflow.
WITH dataset AS (
	INSERT INTO fuelradar.datasets (
		extraction_date,
		stations_extraction_date,
		prices_extraction_date,
		activated_at,
		is_active,
		station_count,
		price_count
	)
	VALUES ('2026-07-18', '2026-07-18', '2026-07-18', now(), true, 4, 5)
	RETURNING id
), inserted_stations AS (
	INSERT INTO fuelradar.stations (
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
	SELECT
		dataset.id,
		fixture.id,
		'Gestore fixture',
		'FuelRadar',
		'Stradale',
		fixture.name,
		fixture.address,
		'Roma',
		'RM',
		extensions.ST_SetSRID(
			extensions.ST_MakePoint(fixture.longitude, fixture.latitude),
			4326
		)
	FROM dataset
	CROSS JOIN (
		VALUES
			('rome-cheap', 'Fixture economico', 'Via economica 1', 12.5000, 41.9060),
			('rome-near', 'Fixture vicino', 'Via vicina 2', 12.4970, 41.9030),
			('rome-far', 'Fixture lontano', 'Via lontana 3', 12.5150, 41.9150),
			('florence-outside', 'Fixture fuori raggio', 'Via Firenze 4', 11.2558, 43.7696)
	) AS fixture(id, name, address, longitude, latitude)
	RETURNING dataset_id, id
)
INSERT INTO fuelradar.prices (
	dataset_id,
	station_id,
	fuel_type,
	service_mode,
	price,
	communicated_at
)
SELECT
	inserted_stations.dataset_id,
	fixture.station_id,
	fixture.fuel_type::fuelradar.fuel_type,
	fixture.service_mode::fuelradar.service_mode,
	fixture.price,
	'2026-07-18 08:30:00'::timestamp
FROM inserted_stations
JOIN (
	VALUES
		('rome-cheap', 'benzina', 'self', 1.600),
		('rome-near', 'benzina', 'self', 1.700),
		('rome-near', 'benzina', 'served', 1.850),
		('rome-far', 'benzina', 'self', 1.700),
		('florence-outside', 'benzina', 'self', 1.500)
) AS fixture(station_id, fuel_type, service_mode, price)
	ON fixture.station_id = inserted_stations.id;
