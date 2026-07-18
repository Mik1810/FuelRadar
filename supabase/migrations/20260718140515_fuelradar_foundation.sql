-- The hosted project already has these prerequisites. IF NOT EXISTS keeps the
-- baseline safe there while making a fresh local/preview database reproducible.
CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "extensions";
CREATE SCHEMA IF NOT EXISTS "fuelradar";
