-- ============================================================
-- PROJECTS RLS HARDENING
-- Migration: 008_projects_rls_hardening
-- Date:      2026-05-13
-- Purpose:   Replace the demo-grade RLS policies installed by
--            004_projects_supabase_storage.sql with strict
--            organization-scoped + permission-gated policies on
--            projects, project_files, and the project-files
--            storage bucket. Adds organization_id columns,
--            backfills orphans, and locks down anon access.
-- Dependencies: 004_projects_supabase_storage,
--               005_auth_rbac_foundation,
--               007_auth_rbac_hardening
-- NOTE: Idempotent. Wrapped in a single transaction. Re-running
--       this migration must be a no-op.
-- NOTE: Storage object path convention enforced here is
--       '<organization_id>/<project_id>/<filename>'. Application
--       code (services/projects.ts, agent F) must produce paths
--       in that shape or storage writes will be denied.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) Schema additions
--    Attach organization_id to both projects and project_files.
--    Nullable for now; the backfill in section 2 plus the
--    SET NOT NULL at the end of section 2 make them mandatory.
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES organizations(id) ON DELETE RESTRICT;

ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS organization_id uuid
  REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS projects_organization_id_idx
  ON projects(organization_id);

CREATE INDEX IF NOT EXISTS project_files_organization_id_idx
  ON project_files(organization_id);

-- ============================================================
-- 2) Backfill organization_id for legacy rows
--    Strategy:
--      a) Find an anchor organization. Prefer the oldest existing
--         organizations row. If the table is empty, create a
--         'Default Organization' placeholder so the NOT NULL
--         constraints applied at the end of this section can hold.
--      b) For projects: prefer the creator's profile org; fall back
--         to the anchor org.
--      c) For project_files: prefer the parent project's
--         organization_id (set in step b); fall back to the anchor.
--      d) Promote organization_id to NOT NULL on both tables.
--    profiles.user_id is the FK to auth.users(id) (see 005), so
--    the join is profiles.user_id = projects.created_by.
-- ============================================================

DO $$
DECLARE
  first_org uuid;
BEGIN
  SELECT id INTO first_org
  FROM organizations
  ORDER BY created_at ASC
  LIMIT 1;

  IF first_org IS NULL THEN
    INSERT INTO organizations (name, slug)
    VALUES ('Default Organization', 'default')
    ON CONFLICT (slug) DO NOTHING;

    SELECT id INTO first_org
    FROM organizations
    WHERE slug = 'default'
    LIMIT 1;
  END IF;

  IF first_org IS NULL THEN
    RAISE EXCEPTION 'Could not resolve an anchor organization for projects backfill';
  END IF;

  UPDATE projects
  SET organization_id = COALESCE(
        organization_id,
        (SELECT p.organization_id
           FROM profiles p
          WHERE p.user_id = projects.created_by
          LIMIT 1),
        first_org
      )
  WHERE organization_id IS NULL;

  UPDATE project_files pf
  SET organization_id = COALESCE(
        pf.organization_id,
        (SELECT pr.organization_id
           FROM projects pr
          WHERE pr.id = pf.project_id
          LIMIT 1),
        first_org
      )
  WHERE pf.organization_id IS NULL;
END;
$$;

ALTER TABLE projects        ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE project_files   ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- 3) Ensure owner_admin has projects.delete
--    005 already grants owner_admin every permission via the
--    "all_permissions" CTE, so this is a defensive idempotent
--    no-op for environments where that seed has drifted.
-- ============================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.key = 'owner_admin'
  AND r.organization_id IS NULL
  AND p.key = 'projects.delete'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4) Drop legacy (demo-grade) policies from 004
-- ============================================================

DROP POLICY IF EXISTS projects_read   ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;

DROP POLICY IF EXISTS project_files_read   ON project_files;
DROP POLICY IF EXISTS project_files_insert ON project_files;
DROP POLICY IF EXISTS project_files_delete ON project_files;

DROP POLICY IF EXISTS project_files_storage_read   ON storage.objects;
DROP POLICY IF EXISTS project_files_storage_insert ON storage.objects;
DROP POLICY IF EXISTS project_files_storage_update ON storage.objects;
DROP POLICY IF EXISTS project_files_storage_delete ON storage.objects;

-- ============================================================
-- 5) New tight policies on projects
--    All restricted to role 'authenticated' (anon explicitly
--    excluded). All require org match. Writes additionally
--    require the specific projects.<action> permission. INSERT
--    pins created_by to the caller. UPDATE blocks moving a
--    project to another organization.
-- ============================================================

CREATE POLICY projects_select ON projects
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('projects.view_all')
    OR current_user_has_permission('projects.view')
    OR current_user_has_permission('projects.view_assigned')
  )
);

CREATE POLICY projects_insert ON projects
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('projects.create')
  AND created_by = auth.uid()
);

CREATE POLICY projects_update ON projects
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('projects.edit')
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('projects.edit')
);

CREATE POLICY projects_delete ON projects
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('projects.delete')
);

-- ============================================================
-- 6) New tight policies on project_files
--    File rows are immutable (no UPDATE policy, matches 004).
--    INSERT additionally verifies that the parent project lives
--    in the caller's organization to prevent attaching a row to
--    a foreign project_id whose org happens to also match the
--    caller (defense in depth).
-- ============================================================

CREATE POLICY project_files_select ON project_files
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('projects.view')
);

CREATE POLICY project_files_insert ON project_files
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('projects.upload')
  AND created_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_files.project_id
      AND p.organization_id = current_user_organization_id()
  )
);

CREATE POLICY project_files_delete ON project_files
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND current_user_has_permission('projects.upload')
);

-- ============================================================
-- 7) Storage policies on storage.objects for 'project-files'
--    Path convention: '<org_id>/<project_id>/<filename>'.
--    The first path segment must be a uuid equal to the
--    caller's current organization_id. A defensive regex guard
--    short-circuits to NULL (deny) for malformed paths instead
--    of raising an invalid-uuid error inside the policy.
-- ============================================================

CREATE POLICY project_files_storage_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-files'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = current_user_organization_id()
  AND current_user_has_permission('projects.view')
);

CREATE POLICY project_files_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-files'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = current_user_organization_id()
  AND current_user_has_permission('projects.upload')
);

CREATE POLICY project_files_storage_update
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-files'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = current_user_organization_id()
  AND current_user_has_permission('projects.view')
)
WITH CHECK (
  bucket_id = 'project-files'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = current_user_organization_id()
  AND current_user_has_permission('projects.upload')
);

CREATE POLICY project_files_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-files'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = current_user_organization_id()
  AND current_user_has_permission('projects.upload')
);

COMMIT;

-- ============================================================
-- 8) Manual verification checklist
--    Run these after applying the migration in a staging DB:
--
--    1. As an authenticated user in Org A:
--         SELECT * FROM projects WHERE organization_id = '<Org B id>';
--       -> must return 0 rows.
--    2. As anon (no session):
--         SELECT * FROM projects;
--       -> must return 0 rows / be denied.
--    3. As a user without 'projects.create':
--         INSERT INTO projects(id, project, organization_id, created_by) ...
--       -> must be denied.
--    4. As any user, INSERT with created_by != auth.uid()
--       -> must be denied.
--    5. As any user, UPDATE projects SET organization_id = '<other org>'
--       -> must be denied (WITH CHECK fails).
--    6. As Org A user, upload to storage path
--         '<Org B id>/<project_id>/foo.pdf'
--       -> must be denied.
--    7. As owner_admin in Org A:
--         DELETE FROM projects WHERE id = '<some project in Org A>';
--       -> must succeed.
-- ============================================================
