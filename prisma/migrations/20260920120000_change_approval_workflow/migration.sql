CREATE TYPE "ChangeApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "change_approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "change_id" UUID NOT NULL,
  "approver_name" VARCHAR(160) NOT NULL,
  "approver_email" VARCHAR(320) NOT NULL,
  "role" VARCHAR(120),
  "decision" "ChangeApprovalDecision" NOT NULL DEFAULT 'PENDING',
  "comment" TEXT,
  "decided_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "change_approvals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "change_approvals_change_id_organization_id_fkey" FOREIGN KEY ("change_id", "organization_id") REFERENCES "change_requests"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "change_approvals_version_positive" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "change_approvals_id_organization_id_key" ON "change_approvals"("id", "organization_id");
CREATE INDEX "change_approvals_organization_id_change_id_decision_idx" ON "change_approvals"("organization_id", "change_id", "decision");

ALTER TABLE "change_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY change_approvals_tenant_isolation ON "change_approvals" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "change_approvals" TO app_runtime;
