ALTER TABLE "change_requests" ADD COLUMN "created_by_id" UUID;
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "identity_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "change_approvals" ADD COLUMN "approver_user_id" UUID;
ALTER TABLE "change_approvals" ADD COLUMN "approver_membership_id" UUID;
ALTER TABLE "change_approvals" ADD COLUMN "approver_membership_role" "MembershipRole";

UPDATE "change_approvals"
SET "approver_user_id" = "identity_users"."id",
    "approver_membership_id" = "memberships"."id",
    "approver_membership_role" = "memberships"."role"
FROM "identity_users"
JOIN "memberships" ON "memberships"."identity_user_id" = "identity_users"."id"
  AND "memberships"."organization_id" = "change_approvals"."organization_id"
WHERE "identity_users"."email" = "change_approvals"."approver_email";

ALTER TABLE "change_approvals" ALTER COLUMN "approver_user_id" SET NOT NULL;
ALTER TABLE "change_approvals" ALTER COLUMN "approver_membership_id" SET NOT NULL;
ALTER TABLE "change_approvals" ALTER COLUMN "approver_membership_role" SET NOT NULL;
ALTER TABLE "change_approvals" ADD CONSTRAINT "change_approvals_approver_user_id_fkey" FOREIGN KEY ("approver_user_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_approvals" ADD CONSTRAINT "change_approvals_approver_membership_id_fkey" FOREIGN KEY ("approver_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "change_approvals_change_id_approver_user_id_key" ON "change_approvals"("change_id", "approver_user_id");
