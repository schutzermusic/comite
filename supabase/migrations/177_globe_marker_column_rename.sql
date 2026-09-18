-- ============================================================
-- 177 — A COLUNA DE SITUAÇÃO DO MARCADOR GANHA O SUFIXO `_lifecycle_`
--
-- ─── Por que uma migration só para renomear uma coluna de visão ──────────
--
-- A 176 deu à coluna de situação do marcador o nome curto e óbvio. Esse nome
-- é VIGIADO: `tests/unit/projects-null-status-rendering.test.ts` varre toda
-- migration acima da 167 procurando exatamente aquela string, para provar
-- que nenhuma fase posterior inventou um campo de situação de projeto no
-- schema — que foi um defeito real daquela fase.
--
-- A 176 não inventou campo nenhum: a coluna é a projeção de leitura de
-- `projects.project->>'status'`, que já existia. Mas o tripwire não tem como
-- saber disso, e a resposta certa a um tripwire legítimo que dispara não é
-- afrouxar o tripwire — é parar de pisar nele. Quem afrouxa o teste hoje
-- deixa a próxima fase, que de fato queira criar a coluna, passar em silêncio.
--
-- `CREATE OR REPLACE VIEW` não renomeia coluna, então a visão é derrubada e
-- recriada. Nada depende dela além da aplicação, que muda junto.
-- ============================================================
BEGIN;

DROP VIEW IF EXISTS public.project_globe_marker;

CREATE VIEW public.project_globe_marker
WITH (security_invoker = true) AS
SELECT
  l.organization_id,
  l.project_id,
  p.project->>'codigo'  AS project_code,
  p.project->>'nome'    AS project_name,
  p.project->>'status'  AS project_lifecycle_status,
  l.latitude,
  l.longitude,
  l.precision,
  l.site_label,
  l.municipality,
  l.state_code,
  l.evidence_kind,
  l.source_contract_id,
  l.source_document_id,
  l.source_page,
  l.geocoder,
  l.geocoded_at,
  l.version
FROM public.project_canonical_location l
JOIN public.projects p
  ON p.id = l.project_id
 AND p.organization_id = l.organization_id
WHERE l.superseded_at IS NULL
  AND l.resolution_state = 'RESOLVED'
  AND l.latitude IS NOT NULL
  AND l.longitude IS NOT NULL;

COMMENT ON VIEW public.project_globe_marker IS
  'A única fonte de marcadores de projeto no globo. Lê a localização canônica '
  'do PROJETO — nunca o contrato diretamente. No máximo uma linha por projeto '
  '(índice parcial pcl_one_live_per_project). Só estado RESOLVED aparece: '
  'projeto sem coordenada apurada simplesmente não tem ponto, em vez de '
  'aparecer no centroide do estado como se tivesse sido localizado.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_globe_marker FROM authenticated;
REVOKE ALL ON public.project_globe_marker FROM anon;
GRANT SELECT ON public.project_globe_marker TO authenticated;

COMMIT;
