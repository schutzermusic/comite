-- 015_organization_branding.sql
-- Adds per-organization workspace branding fields.
-- Idempotent: safe to re-run.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS workspace_name text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS brand_color text,
  ADD COLUMN IF NOT EXISTS email_from_name text,
  ADD COLUMN IF NOT EXISTS notification_name text,
  ADD COLUMN IF NOT EXISTS branding_enabled boolean NOT NULL DEFAULT true;
