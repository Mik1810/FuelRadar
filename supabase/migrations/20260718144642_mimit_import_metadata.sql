ALTER TABLE "fuelradar"."datasets" ADD COLUMN "source_fingerprint" text;--> statement-breakpoint
UPDATE "fuelradar"."datasets"
SET "source_fingerprint" = 'legacy:' || "id"::text
WHERE "source_fingerprint" IS NULL;--> statement-breakpoint
ALTER TABLE "fuelradar"."datasets" ALTER COLUMN "source_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fuelradar"."datasets" ADD COLUMN "metadata_fingerprint" text;--> statement-breakpoint
ALTER TABLE "fuelradar"."datasets" ADD COLUMN "source_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "fuelradar"."import_runs" ADD COLUMN "source_fingerprint" text;--> statement-breakpoint
ALTER TABLE "fuelradar"."import_runs" ADD COLUMN "metadata_fingerprint" text;--> statement-breakpoint
ALTER TABLE "fuelradar"."import_runs" ADD COLUMN "source_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "fuelradar"."import_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_source_fingerprint_key" ON "fuelradar"."datasets" USING btree ("source_fingerprint");--> statement-breakpoint
ALTER TABLE "fuelradar"."import_runs" ADD CONSTRAINT "import_runs_duration_ms_check" CHECK ("fuelradar"."import_runs"."duration_ms" is null or "fuelradar"."import_runs"."duration_ms" >= 0);
