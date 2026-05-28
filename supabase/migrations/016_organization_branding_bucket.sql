-- 016_organization_branding_bucket.sql
-- Public bucket for organization logos. Uploads are mediated by the API
-- route (service role); SELECT is public so logos can render anywhere.

INSERT INTO storage.buckets (id, name, public)
VALUES ('org-branding', 'org-branding', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
