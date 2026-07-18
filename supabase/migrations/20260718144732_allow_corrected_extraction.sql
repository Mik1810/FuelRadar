DROP INDEX "fuelradar"."datasets_extraction_date_key";--> statement-breakpoint
CREATE INDEX "datasets_extraction_date_idx" ON "fuelradar"."datasets" USING btree ("extraction_date");