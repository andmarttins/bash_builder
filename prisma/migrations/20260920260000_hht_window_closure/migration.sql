SET LOCAL lock_timeout = '5s';
CREATE TYPE "HhtReportWindowStatus" AS ENUM ('OPEN', 'CLOSED');
ALTER TABLE "hht_report_windows"
  ADD COLUMN "status" "HhtReportWindowStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "closed_at" TIMESTAMPTZ(6),
  ADD COLUMN "closed_by_id" UUID;
ALTER TABLE "hht_report_windows"
  ADD CONSTRAINT "hht_report_windows_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "hht_report_windows_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "identity_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "hht_report_windows_organization_id_status_year_month_idx" ON "hht_report_windows"("organization_id", "status", "year", "month");
