CREATE TYPE "ChangeWorkflowStepName" AS ENUM ('GENERAL_INFORMATION', 'TRIGGERS', 'IMPLEMENTATION_PLAN', 'RISK_ASSESSMENT', 'APPROVAL', 'VERIFICATION');
CREATE TYPE "ChangeWorkflowStepStatus" AS ENUM ('PENDING', 'COMPLETED');

CREATE TABLE "change_workflow_steps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "change_id" UUID NOT NULL,
  "step" "ChangeWorkflowStepName" NOT NULL,
  "status" "ChangeWorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "completed_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "change_workflow_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_workflow_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "change_workflow_steps_change_id_organization_id_fkey" FOREIGN KEY ("change_id", "organization_id") REFERENCES "change_requests"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "change_workflow_steps_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "identity_users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "change_workflow_steps_change_id_step_key" UNIQUE ("change_id", "step"),
  CONSTRAINT "change_workflow_steps_id_organization_id_key" UNIQUE ("id", "organization_id")
);

CREATE INDEX "change_workflow_steps_organization_id_change_id_step_idx" ON "change_workflow_steps"("organization_id", "change_id", "step");
ALTER TABLE "change_workflow_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_workflow_steps" FORCE ROW LEVEL SECURITY;
CREATE POLICY change_workflow_steps_tenant_isolation ON "change_workflow_steps" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "change_workflow_steps" TO app_runtime;

INSERT INTO "change_workflow_steps" ("organization_id", "change_id", "step", "status", "notes", "completed_at", "updated_at")
SELECT "change_requests"."organization_id", "change_requests"."id", steps."step",
  CASE WHEN steps."ordinal" < "change_requests"."current_step" OR "change_requests"."status" = 'COMPLETED' THEN 'COMPLETED'::"ChangeWorkflowStepStatus" ELSE 'PENDING'::"ChangeWorkflowStepStatus" END,
  CASE WHEN steps."ordinal" < "change_requests"."current_step" OR "change_requests"."status" = 'COMPLETED' THEN 'Etapa inferida durante a migração do fluxo controlado.' ELSE NULL END,
  CASE WHEN steps."ordinal" < "change_requests"."current_step" OR "change_requests"."status" = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE NULL END,
  CURRENT_TIMESTAMP
FROM "change_requests"
CROSS JOIN unnest(enum_range(NULL::"ChangeWorkflowStepName")) WITH ORDINALITY AS steps("step", "ordinal");
