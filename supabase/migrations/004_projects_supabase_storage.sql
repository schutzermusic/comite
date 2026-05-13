-- ============================================================
-- PROJECTS MODULE — Supabase persistence + project files
-- Migration: 004_projects_supabase_storage
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id              text PRIMARY KEY,
  project         jsonb NOT NULL,
  project_v2      jsonb,
  client_logo_url text,
  created_by      uuid REFERENCES auth.users(id),
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_client ON projects ((project->>'cliente'));
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects ((project->>'status'));
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);

CREATE TABLE IF NOT EXISTS project_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bucket_id     text NOT NULL DEFAULT 'project-files',
  object_path   text NOT NULL UNIQUE,
  public_url    text,
  file_name     text NOT NULL,
  content_type  text,
  file_size     bigint,
  category      text NOT NULL DEFAULT 'document',
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files (project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_category ON project_files (category);

CREATE OR REPLACE FUNCTION set_projects_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_projects_updated_at ON projects;
CREATE TRIGGER trg_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW
EXECUTE FUNCTION set_projects_updated_at();

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_files ENABLE ROW LEVEL SECURITY;

-- This app currently allows unauthenticated demo access. These policies keep the
-- existing UX working while moving persistence out of localStorage. Tighten them
-- to authenticated roles before exposing production data.
DROP POLICY IF EXISTS "projects_read" ON projects;
CREATE POLICY "projects_read" ON projects FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "project_files_read" ON project_files;
CREATE POLICY "project_files_read" ON project_files FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "project_files_insert" ON project_files;
CREATE POLICY "project_files_insert" ON project_files FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "project_files_delete" ON project_files;
CREATE POLICY "project_files_delete" ON project_files FOR DELETE TO anon, authenticated USING (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-files',
  'project-files',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "project_files_storage_read" ON storage.objects;
CREATE POLICY "project_files_storage_read"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'project-files');

DROP POLICY IF EXISTS "project_files_storage_insert" ON storage.objects;
CREATE POLICY "project_files_storage_insert"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'project-files');

DROP POLICY IF EXISTS "project_files_storage_update" ON storage.objects;
CREATE POLICY "project_files_storage_update"
ON storage.objects FOR UPDATE TO anon, authenticated
USING (bucket_id = 'project-files')
WITH CHECK (bucket_id = 'project-files');

DROP POLICY IF EXISTS "project_files_storage_delete" ON storage.objects;
CREATE POLICY "project_files_storage_delete"
ON storage.objects FOR DELETE TO anon, authenticated
USING (bucket_id = 'project-files');
