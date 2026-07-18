CREATE TYPE "fuelradar"."fuel_type" AS ENUM('benzina', 'diesel', 'gpl', 'metano');--> statement-breakpoint
CREATE TYPE "fuelradar"."import_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "fuelradar"."service_mode" AS ENUM('self', 'served');--> statement-breakpoint
CREATE TABLE "fuelradar"."datasets" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fuelradar"."datasets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"extraction_date" date NOT NULL,
	"stations_extraction_date" date NOT NULL,
	"prices_extraction_date" date NOT NULL,
	"source_etag" text,
	"source_last_modified" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"is_active" boolean DEFAULT false NOT NULL,
	"station_count" integer NOT NULL,
	"price_count" integer NOT NULL,
	CONSTRAINT "datasets_station_count_check" CHECK ("fuelradar"."datasets"."station_count" >= 0),
	CONSTRAINT "datasets_price_count_check" CHECK ("fuelradar"."datasets"."price_count" >= 0),
	CONSTRAINT "datasets_activation_check" CHECK (not "fuelradar"."datasets"."is_active" or "fuelradar"."datasets"."activated_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "fuelradar"."import_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fuelradar"."import_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"status" "fuelradar"."import_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"dataset_id" bigint,
	"source_etag" text,
	"source_last_modified" text,
	"station_count" integer,
	"price_count" integer,
	"diagnostics" jsonb,
	"error_message" text,
	CONSTRAINT "import_runs_finished_at_check" CHECK ("fuelradar"."import_runs"."finished_at" is null or "fuelradar"."import_runs"."finished_at" >= "fuelradar"."import_runs"."started_at"),
	CONSTRAINT "import_runs_station_count_check" CHECK ("fuelradar"."import_runs"."station_count" is null or "fuelradar"."import_runs"."station_count" >= 0),
	CONSTRAINT "import_runs_price_count_check" CHECK ("fuelradar"."import_runs"."price_count" is null or "fuelradar"."import_runs"."price_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fuelradar"."prices" (
	"dataset_id" bigint NOT NULL,
	"station_id" text NOT NULL,
	"fuel_type" "fuelradar"."fuel_type" NOT NULL,
	"service_mode" "fuelradar"."service_mode" NOT NULL,
	"price" numeric(7, 3) NOT NULL,
	"communicated_at" timestamp NOT NULL,
	CONSTRAINT "prices_pkey" PRIMARY KEY("dataset_id","station_id","fuel_type","service_mode"),
	CONSTRAINT "prices_price_check" CHECK ("fuelradar"."prices"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE "fuelradar"."stations" (
	"dataset_id" bigint NOT NULL,
	"id" text NOT NULL,
	"operator" text NOT NULL,
	"brand" text NOT NULL,
	"station_type" text NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"province" text NOT NULL,
	"location" geometry(point, 4326) NOT NULL,
	CONSTRAINT "stations_pkey" PRIMARY KEY("dataset_id","id")
);
--> statement-breakpoint
ALTER TABLE "fuelradar"."import_runs" ADD CONSTRAINT "import_runs_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "fuelradar"."datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuelradar"."prices" ADD CONSTRAINT "prices_station_fkey" FOREIGN KEY ("dataset_id","station_id") REFERENCES "fuelradar"."stations"("dataset_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuelradar"."stations" ADD CONSTRAINT "stations_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "fuelradar"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_extraction_date_key" ON "fuelradar"."datasets" USING btree ("extraction_date");--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_one_active_idx" ON "fuelradar"."datasets" USING btree ("is_active") WHERE "fuelradar"."datasets"."is_active" = true;--> statement-breakpoint
CREATE INDEX "import_runs_started_at_idx" ON "fuelradar"."import_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "prices_nearby_lookup_idx" ON "fuelradar"."prices" USING btree ("dataset_id","fuel_type","service_mode","price","station_id");--> statement-breakpoint
CREATE INDEX "stations_dataset_idx" ON "fuelradar"."stations" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "stations_city_idx" ON "fuelradar"."stations" USING btree ("dataset_id","city");--> statement-breakpoint
CREATE INDEX "stations_location_gist_idx" ON "fuelradar"."stations" USING gist ("location");--> statement-breakpoint
-- ST_DWithin on geography works in metres. This matching expression index keeps
-- the radius predicate index-assisted without sacrificing geometry ergonomics.
CREATE INDEX "stations_location_geography_gist_idx"
	ON "fuelradar"."stations"
	USING gist (("location"::extensions.geography));--> statement-breakpoint

CREATE OR REPLACE FUNCTION "fuelradar"."nearby_stations"(
	"p_latitude" double precision,
	"p_longitude" double precision,
	"p_radius_km" double precision,
	"p_fuel_type" "fuelradar"."fuel_type",
	"p_service_mode" "fuelradar"."service_mode",
	"p_limit" integer DEFAULT 50
)
RETURNS TABLE (
	"station_id" text,
	"operator" text,
	"brand" text,
	"station_type" text,
	"name" text,
	"address" text,
	"city" text,
	"province" text,
	"latitude" double precision,
	"longitude" double precision,
	"fuel_type" "fuelradar"."fuel_type",
	"service_mode" "fuelradar"."service_mode",
	"price" double precision,
	"communicated_at" text,
	"distance_km" double precision
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $function$
	WITH origin AS (
		SELECT extensions.ST_SetSRID(
			extensions.ST_MakePoint(p_longitude, p_latitude),
			4326
		)::extensions.geography AS location
		WHERE p_latitude BETWEEN -90 AND 90
			AND p_longitude BETWEEN -180 AND 180
			AND p_radius_km > 0
			AND p_radius_km <= 50
			AND p_limit > 0
	)
	SELECT
		s.id AS station_id,
		s.operator,
		s.brand,
		s.station_type,
		s.name,
		s.address,
		s.city,
		s.province,
		extensions.ST_Y(s.location) AS latitude,
		extensions.ST_X(s.location) AS longitude,
		p.fuel_type,
		p.service_mode,
		p.price::double precision AS price,
		to_char(p.communicated_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS communicated_at,
		measurement.distance_m / 1000.0 AS distance_km
	FROM "fuelradar"."datasets" AS d
	JOIN "fuelradar"."prices" AS p ON p.dataset_id = d.id
	JOIN "fuelradar"."stations" AS s
		ON s.dataset_id = p.dataset_id
		AND s.id = p.station_id
	CROSS JOIN origin
	CROSS JOIN LATERAL (
		SELECT extensions.ST_Distance(
			s.location::extensions.geography,
			origin.location
		) AS distance_m
	) AS measurement
	WHERE d.is_active
		AND p.fuel_type = p_fuel_type
		AND p.service_mode = p_service_mode
		AND extensions.ST_DWithin(
			s.location::extensions.geography,
			origin.location,
			p_radius_km * 1000.0
		)
	ORDER BY p.price ASC, measurement.distance_m ASC, s.id ASC
	LIMIT LEAST(p_limit, 200)
$function$;--> statement-breakpoint

-- No table is reachable from a browser role. The application and import job use
-- the server-only database connection; service_role remains available for future
-- server-side Supabase RPC usage.
ALTER TABLE "fuelradar"."datasets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fuelradar"."stations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fuelradar"."prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fuelradar"."import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON SCHEMA "fuelradar" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "fuelradar" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "fuelradar" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "fuelradar"."nearby_stations"(
	double precision,
	double precision,
	double precision,
	"fuelradar"."fuel_type",
	"fuelradar"."service_mode",
	integer
) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

GRANT USAGE ON SCHEMA "fuelradar" TO service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "fuelradar" TO service_role;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "fuelradar" TO service_role;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "fuelradar"."nearby_stations"(
	double precision,
	double precision,
	double precision,
	"fuelradar"."fuel_type",
	"fuelradar"."service_mode",
	integer
) TO service_role;
