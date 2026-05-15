-- ============================================================
-- DELIBERATIONS MODULE - Supabase persistence + RLS
-- Migration: 010_deliberations_supabase
-- Date:      2026-05-13
-- Purpose:   Replace the in-memory mock store for the
--            Deliberations / Pautas module with real
--            public.deliberations + public.deliberation_votes
--            tables, strictly organization-scoped and
--            permission-gated.
-- Dependencies:
--   005_auth_rbac_foundation  (organizations, profiles,
--                              committees, committee_members,
--                              current_user_organization_id(),
--                              current_user_has_permission(),
--                              current_user_is_admin(),
--                              set_updated_at() trigger fn,
--                              deliberations.* permission seeds)
--   006_contracts_supabase    (reference pattern, JSONB usage)
--   008_projects_rls_hardening (reference pattern, anti-org-move)
--   009_risks_supabase        (most recent pattern - copied idiom)
-- NOTE: Idempotent. Wrapped in a single transaction.
--       Re-running this migration must be a no-op.
-- NOTE: committee_members confirmed in 005 has columns
--       (committee_id, user_id) — used directly in policies.
-- NOTE: Does not modify deliberations.* permission seeds
--       (those live in 005 and are already correct).
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1) Table public.deliberations
--    Heavy JSONB on stages/minutes/linked_entities/audit_trail
--    /execution_items/financial_impact/dependent_committee_ids
--    so that we don't have to break out every nested TS shape.
--    Status + vote_result enforced by CHECK constraints rather
--    than enums to keep migrations cheap.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deliberations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code                     text,
  title                    text NOT NULL,
  description              text,
  status                   text NOT NULL DEFAULT 'draft'
                             CHECK (status IN (
                               'draft','submitted','in_review','in_voting',
                               'awaiting_minutes','resolved','in_execution',
                               'closed','returned_for_revision','withdrawn'
                             )),
  vote_result              text
                             CHECK (vote_result IS NULL OR vote_result IN (
                               'approved','rejected','pending',
                               'no_quorum','returned_for_revision'
                             )),
  priority                 text,
  confidentiality          text DEFAULT 'normal',
  owner_committee_id       uuid REFERENCES committees(id) ON DELETE SET NULL,
  dependent_committee_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assignee_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date                 timestamptz,
  voting_window_start      timestamptz,
  voting_window_end        timestamptz,
  current_stage_id         text,
  stages                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  minutes                  jsonb,
  linked_entities          jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution_items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_trail              jsonb NOT NULL DEFAULT '[]'::jsonb,
  financial_impact         jsonb,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  closed_at                timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS deliberations_org_idx
  ON public.deliberations (organization_id);
CREATE INDEX IF NOT EXISTS deliberations_org_status_idx
  ON public.deliberations (organization_id, status);
CREATE INDEX IF NOT EXISTS deliberations_owner_committee_idx
  ON public.deliberations (organization_id, owner_committee_id);
CREATE INDEX IF NOT EXISTS deliberations_updated_idx
  ON public.deliberations (organization_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS deliberations_voting_window_idx
  ON public.deliberations (organization_id, voting_window_end)
  WHERE status = 'in_voting';

-- updated_at trigger. set_updated_at() is defined in 005.
DROP TRIGGER IF EXISTS trg_deliberations_updated_at ON public.deliberations;
CREATE TRIGGER trg_deliberations_updated_at
BEFORE UPDATE ON public.deliberations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2) Table public.deliberation_votes
--    Append-mostly audit table. Cached voter_name so audit
--    history survives a profile rename. Partial UNIQUE index
--    treats NULL stage_id as the empty string so a missing
--    stage collapses to a single conflict bucket.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deliberation_votes (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  deliberation_id           uuid NOT NULL REFERENCES deliberations(id) ON DELETE CASCADE,
  stage_id                  text,
  voter_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  voter_name                text NOT NULL,
  vote                      text NOT NULL CHECK (vote IN ('yes','no','abstain')),
  justification             text,
  has_conflict_of_interest  boolean NOT NULL DEFAULT false,
  voted_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS deliberation_votes_unique_voter_stage
  ON public.deliberation_votes (deliberation_id, voter_id, COALESCE(stage_id, ''));

CREATE INDEX IF NOT EXISTS deliberation_votes_org_idx
  ON public.deliberation_votes (organization_id);
CREATE INDEX IF NOT EXISTS deliberation_votes_delib_idx
  ON public.deliberation_votes (deliberation_id);
CREATE INDEX IF NOT EXISTS deliberation_votes_voter_idx
  ON public.deliberation_votes (voter_id);

-- ============================================================
-- 3) Row Level Security
--    All policies restricted to role 'authenticated'.
--    Permissions live in 005 (deliberations.view,
--    deliberations.view_all, deliberations.view_own,
--    deliberations.view_committee, deliberations.create,
--    deliberations.vote, deliberations.approve,
--    deliberations.reject, deliberations.close, etc.).
-- ============================================================

ALTER TABLE public.deliberations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliberation_votes  ENABLE ROW LEVEL SECURITY;

-- ----- deliberations: SELECT
DROP POLICY IF EXISTS deliberations_select ON public.deliberations;
CREATE POLICY deliberations_select ON public.deliberations
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('deliberations.view_all')
    OR current_user_has_permission('deliberations.view')
    OR (
         current_user_has_permission('deliberations.view_own')
         AND submitted_by = auth.uid()
       )
    OR (
         current_user_has_permission('deliberations.view_committee')
         AND owner_committee_id IN (
           SELECT committee_id FROM committee_members
           WHERE user_id = auth.uid()
         )
       )
  )
);

-- ----- deliberations: INSERT
DROP POLICY IF EXISTS deliberations_insert ON public.deliberations;
CREATE POLICY deliberations_insert ON public.deliberations
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('deliberations.create')
  AND submitted_by = auth.uid()
);

-- ----- deliberations: UPDATE
DROP POLICY IF EXISTS deliberations_update ON public.deliberations;
CREATE POLICY deliberations_update ON public.deliberations
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('deliberations.approve')
    OR current_user_has_permission('deliberations.reject')
    OR current_user_has_permission('deliberations.close')
    OR current_user_has_permission('deliberations.create')
  )
)
WITH CHECK (
  organization_id = current_user_organization_id()
);

-- ----- deliberations: DELETE
-- Only owner_admin can hard-delete. The supported soft path is
-- updating status='withdrawn' through deliberations_update.
DROP POLICY IF EXISTS deliberations_delete ON public.deliberations;
CREATE POLICY deliberations_delete ON public.deliberations
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_is_admin()
);

-- ----- deliberation_votes: SELECT
-- Org-scoping is enough at this layer; the parent SELECT policy
-- on `deliberations` already gates which deliberations the
-- caller can see, and the EXISTS join below ensures the vote
-- belongs to a deliberation visible in the caller's org.
DROP POLICY IF EXISTS deliberation_votes_select ON public.deliberation_votes;
CREATE POLICY deliberation_votes_select ON public.deliberation_votes
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND EXISTS (
    SELECT 1 FROM deliberations d
    WHERE d.id = deliberation_votes.deliberation_id
      AND d.organization_id = current_user_organization_id()
  )
);

-- ----- deliberation_votes: INSERT
-- A user can only cast their own vote, only while the parent
-- deliberation is 'in_voting', and only if they have the
-- deliberations.vote permission.
DROP POLICY IF EXISTS deliberation_votes_insert ON public.deliberation_votes;
CREATE POLICY deliberation_votes_insert ON public.deliberation_votes
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND voter_id = auth.uid()
  AND current_user_has_permission('deliberations.vote')
  AND EXISTS (
    SELECT 1 FROM deliberations d
    WHERE d.id = deliberation_votes.deliberation_id
      AND d.organization_id = current_user_organization_id()
      AND d.status = 'in_voting'
  )
);

-- ----- deliberation_votes: UPDATE
-- Permissive: voter may amend their own vote while voting is
-- still possible (RLS does not re-check parent status here to
-- allow last-minute corrections). If the business rule becomes
-- "votes are strictly immutable once cast", swap USING/WITH
-- CHECK to (false) or drop this policy entirely.
DROP POLICY IF EXISTS deliberation_votes_update ON public.deliberation_votes;
CREATE POLICY deliberation_votes_update ON public.deliberation_votes
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND voter_id = auth.uid()
  AND current_user_has_permission('deliberations.vote')
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND voter_id = auth.uid()
  AND current_user_has_permission('deliberations.vote')
);

-- ----- deliberation_votes: DELETE
-- Intentionally NO delete policy. Votes are append-only;
-- conflict resolution flows through UPDATE.

COMMIT;

-- ============================================================
-- 4) Manual verification checklist
--    Run these after applying the migration in a staging DB.
--
--    1. As anon (no session):
--         SELECT * FROM deliberations;
--         SELECT * FROM deliberation_votes;
--       -> both must be denied / return 0 rows.
--    2. As authenticated user in Org A:
--         SELECT * FROM deliberations WHERE organization_id = '<Org B id>';
--       -> 0 rows.
--    3. INSERT into deliberations with submitted_by != auth.uid()
--       -> denied by deliberations_insert.WITH CHECK.
--    4. INSERT into deliberation_votes for a deliberation whose
--       status != 'in_voting'
--       -> denied by deliberation_votes_insert.WITH CHECK.
--    5. INSERT into deliberation_votes with voter_id != auth.uid()
--       -> denied.
--    6. UPDATE deliberations SET organization_id = '<other org>'
--       -> denied (WITH CHECK fails).
--    7. INSERT two deliberation_votes for the same
--       (deliberation_id, voter_id, stage_id) tuple
--       -> second insert denied by
--          deliberation_votes_unique_voter_stage.
--    8. DELETE FROM deliberations as non-admin
--       -> denied. As owner_admin -> succeeds. Soft path is
--          UPDATE status='withdrawn'.
-- ============================================================
