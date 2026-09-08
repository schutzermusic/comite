-- ============================================================
-- Fase 7.5 red-team — 150: DOCUMENTOS DE PROJETO PRIVADOS
-- ============================================================
--
-- `project-files` nasceu público para logos e depois passou a receber PDFs de
-- documento e cronograma. Bucket público ignora RLS no download por URL.
-- Produção ainda tem somente cinco logos neste bucket, portanto separamos os
-- usos antes do onboarding de dados reais:
--
--   project-files      — legado público, somente imagens de logo;
--   project-documents  — privado, documentos/cronogramas via signed URL.
--
-- As URLs dos logos existentes não mudam.
-- ============================================================
BEGIN;

-- Mover bytes não é operação SQL transacional do catálogo de Storage.
-- Se outro ambiente já tiver documentos no bucket público, parar é mais
-- seguro do que quebrar a URL ou fingir que o objeto foi privatizado.
DO $existing_documents$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.project_files
     WHERE bucket_id = 'project-files' AND category <> 'logo'
  ) THEN
    RAISE EXCEPTION
      'MANUAL_STORAGE_MIGRATION_REQUIRED: mova documentos existentes para project-documents antes da 150.';
  END IF;
END $existing_documents$;

-- O bucket legado continua público para não quebrar URLs de branding, mas
-- deixa de aceitar PDF ou qualquer objeto que não seja imagem.
UPDATE storage.buckets
   SET public = true,
       allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']
 WHERE id = 'project-files';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'project-documents',
  'project-documents',
  false,
  10485760,
  ARRAY['application/pdf','image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- A linha de metadados e o objeto precisam concordar sobre a classe. Isso
-- impede um cliente de gravar um documento no bucket público e registrá-lo
-- sob um nome inocente.
DROP POLICY IF EXISTS project_files_insert ON public.project_files;
CREATE POLICY project_files_insert ON public.project_files
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = public.current_user_organization_id()
  AND public.current_user_has_permission('projects.upload')
  AND created_by = auth.uid()
  AND (
    (category = 'logo' AND bucket_id = 'project-files' AND public_url IS NOT NULL)
    OR
    (category IN ('document','cronograma') AND bucket_id = 'project-documents' AND public_url IS NULL)
  )
  AND EXISTS (
    SELECT 1 FROM public.projects p
     WHERE p.id = project_files.project_id
       AND p.organization_id = public.current_user_organization_id()
  )
);

-- O bucket público recebe apenas o formato canônico de logo. SELECT permanece
-- para compatibilidade da API do Storage, embora o download público não use RLS.
DROP POLICY IF EXISTS project_files_storage_insert ON storage.objects;
CREATE POLICY project_files_storage_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-files'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = public.current_user_organization_id()
  AND name ~ '^[0-9a-fA-F-]{36}/[^/]+/[0-9]+-logo-[^/]+$'
  AND public.current_user_has_permission('projects.upload')
);

DROP POLICY IF EXISTS project_files_storage_update ON storage.objects;
CREATE POLICY project_files_storage_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-files'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = public.current_user_organization_id()
  AND name ~ '^[0-9a-fA-F-]{36}/[^/]+/[0-9]+-logo-[^/]+$'
  AND public.current_user_has_permission('projects.view')
)
WITH CHECK (
  bucket_id = 'project-files'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = public.current_user_organization_id()
  AND name ~ '^[0-9a-fA-F-]{36}/[^/]+/[0-9]+-logo-[^/]+$'
  AND public.current_user_has_permission('projects.upload')
);

DROP POLICY IF EXISTS project_documents_storage_select ON storage.objects;
CREATE POLICY project_documents_storage_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'project-documents'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = public.current_user_organization_id()
  AND public.current_user_has_permission('projects.view')
);

DROP POLICY IF EXISTS project_documents_storage_insert ON storage.objects;
CREATE POLICY project_documents_storage_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-documents'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = public.current_user_organization_id()
  AND name ~ '^[0-9a-fA-F-]{36}/[^/]+/[0-9]+-(document|cronograma)-[^/]+$'
  AND public.current_user_has_permission('projects.upload')
);

DROP POLICY IF EXISTS project_documents_storage_update ON storage.objects;
CREATE POLICY project_documents_storage_update ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-documents'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = public.current_user_organization_id()
  AND public.current_user_has_permission('projects.view')
)
WITH CHECK (
  bucket_id = 'project-documents'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = public.current_user_organization_id()
  AND name ~ '^[0-9a-fA-F-]{36}/[^/]+/[0-9]+-(document|cronograma)-[^/]+$'
  AND public.current_user_has_permission('projects.upload')
);

DROP POLICY IF EXISTS project_documents_storage_delete ON storage.objects;
CREATE POLICY project_documents_storage_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'project-documents'
  AND (CASE WHEN name ~ '^[0-9a-fA-F-]{36}/' THEN split_part(name, '/', 1)::uuid ELSE NULL END)
      = public.current_user_organization_id()
  AND public.current_user_has_permission('projects.upload')
);

COMMIT;
