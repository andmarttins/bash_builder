ALTER TABLE "hht_reports" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "hht_reports" ADD CONSTRAINT "hht_reports_version_positive" CHECK ("version" > 0);
