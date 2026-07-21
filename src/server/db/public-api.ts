import "server-only";

import { z } from "zod";

import { nearbySearchSchema, type NearbySearch } from "@/domain/nearby";
import {
  datasetStatusSchema,
  getDatasetFreshness,
  publicNearbyStationSchema,
  publicStationDetailSchema,
  stationIdSchema,
  type DatasetStatus,
  type NearbyStationsResult,
  type StationDetailResult,
} from "@/domain/public-api";
import { sqlClient } from "@/server/db/client";

const nearbyDatabaseRowSchema = z.object({
  extractionDate: z.iso.date(),
  station: publicNearbyStationSchema.nullable(),
});

const stationDatabaseRowSchema = z.object({
  extractionDate: z.iso.date(),
  station: publicStationDetailSchema.nullable(),
});

const datasetDatabaseRowSchema = datasetStatusSchema.omit({ freshness: true });

export async function getNearbyStations(
  input: NearbySearch,
): Promise<NearbyStationsResult> {
  const search = nearbySearchSchema.parse(input);
  const rows = await sqlClient<Record<string, unknown>[]>`
    with active_dataset as (
      select extraction_date
      from fuelradar.datasets
      where is_active
    )
    select
      active_dataset.extraction_date::text as "extractionDate",
      case when nearby.station_id is null then null else jsonb_build_object(
        'id', nearby.station_id,
        'operator', nearby.operator,
        'brand', nearby.brand,
        'stationType', nearby.station_type,
        'name', nearby.name,
        'address', nearby.address,
        'city', nearby.city,
        'province', nearby.province,
        'latitude', nearby.latitude,
        'longitude', nearby.longitude,
        'fuelType', nearby.fuel_type,
        'serviceMode', nearby.service_mode,
        'price', nearby.price,
        'communicatedAt', nearby.communicated_at,
        'distanceKm', nearby.distance_km
      ) end as station
    from active_dataset
    left join lateral fuelradar.nearby_stations(
      ${search.latitude}::double precision,
      ${search.longitude}::double precision,
      ${search.radiusKm}::double precision,
      ${search.fuelType}::fuelradar.fuel_type,
      ${search.serviceMode}::fuelradar.service_mode,
      ${search.limit}::integer
    ) as nearby on true
    order by nearby.price asc, nearby.distance_km asc, nearby.station_id asc
  `;
  const parsedRows = nearbyDatabaseRowSchema.array().parse(rows);
  const firstRow = parsedRows[0];

  if (!firstRow) return { status: "dataset-unavailable" };

  return {
    status: "ok",
    extractionDate: firstRow.extractionDate,
    stations: parsedRows.flatMap(({ station }) => (station ? [station] : [])),
  };
}

export async function getStationDetail(
  stationIdInput: string,
): Promise<StationDetailResult> {
  const stationId = stationIdSchema.parse(stationIdInput);
  const rows = await sqlClient<Record<string, unknown>[]>`
    with active_dataset as (
      select id, extraction_date
      from fuelradar.datasets
      where is_active
    ),
    target_station as (
      select
        station.dataset_id,
        station.id,
        jsonb_build_object(
          'id', station.id,
          'operator', station.operator,
          'brand', station.brand,
          'stationType', station.station_type,
          'name', station.name,
          'address', station.address,
          'city', station.city,
          'province', station.province,
          'latitude', extensions.ST_Y(station.location),
          'longitude', extensions.ST_X(station.location),
          'prices', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'fuelType', price.fuel_type,
                'serviceMode', price.service_mode,
                'price', price.price::double precision,
                'communicatedAt', to_char(
                  price.communicated_at,
                  'YYYY-MM-DD"T"HH24:MI:SS'
                )
              ) order by price.fuel_type, price.service_mode
            )
            from (
              select *
              from fuelradar.prices
              where dataset_id = station.dataset_id and station_id = station.id
              limit 8
            ) as price
          ), '[]'::jsonb)
        ) as value
      from active_dataset
      join fuelradar.stations as station
        on station.dataset_id = active_dataset.id
       and station.id = ${stationId}
    )
    select
      active_dataset.extraction_date::text as "extractionDate",
      target_station.value as station
    from active_dataset
    left join target_station on target_station.dataset_id = active_dataset.id
  `;
  const row = stationDatabaseRowSchema.array().parse(rows)[0];

  if (!row) return { status: "dataset-unavailable" };
  if (!row.station) {
    return { status: "station-not-found", extractionDate: row.extractionDate };
  }

  return {
    status: "ok",
    extractionDate: row.extractionDate,
    station: row.station,
  };
}

export async function getActiveDatasetStatus(
  now: Date = new Date(),
): Promise<DatasetStatus | null> {
  const rows = await sqlClient<Record<string, unknown>[]>`
    with active_dataset as (
      select *
      from fuelradar.datasets
      where is_active
    ),
    latest_import as (
      select status, started_at, finished_at, duration_ms
      from fuelradar.import_runs
      order by started_at desc, id desc
      limit 1
    )
    select
      active_dataset.extraction_date::text as "extractionDate",
      active_dataset.stations_extraction_date::text as "stationsExtractionDate",
      active_dataset.prices_extraction_date::text as "pricesExtractionDate",
      to_char(
        active_dataset.imported_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) as "importedAt",
      to_char(
        active_dataset.activated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) as "activatedAt",
      active_dataset.station_count as "stationCount",
      active_dataset.price_count as "priceCount",
      case when latest_import.status is null then null else jsonb_build_object(
        'status', latest_import.status,
        'startedAt', to_char(
          latest_import.started_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'finishedAt', case when latest_import.finished_at is null then null else
          to_char(
            latest_import.finished_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          )
        end,
        'durationMs', latest_import.duration_ms
      ) end as "latestImport"
    from active_dataset
    left join latest_import on true
  `;
  const row = datasetDatabaseRowSchema.array().parse(rows)[0];

  if (!row) return null;

  return datasetStatusSchema.parse({
    ...row,
    freshness: getDatasetFreshness(row.extractionDate, now),
  });
}
