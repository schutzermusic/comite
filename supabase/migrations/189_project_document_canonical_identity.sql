-- ============================================================================
-- 189 — O DOCUMENTO CANÔNICO DO PROJETO
--
-- ─── O problema ───────────────────────────────────────────────────────────
--
-- Evidência de medição e documento de projeto eram dois caminhos de upload
-- para o mesmo PDF. Quem anexava o "Relatório de montagem" na medição não o
-- via em Documentos; quem o enviava em Documentos não o via na medição. A
-- saída natural do usuário era subir o arquivo duas vezes — dois objetos no
-- Storage, duas linhas, duas histórias de auditoria, e nenhuma delas sabendo
-- da outra.
--
-- ─── A decisão ────────────────────────────────────────────────────────────
--
-- UM arquivo, UM registro: `public.project_files`, que já é o acervo do
-- projeto, já mora no bucket privado `project-documents` (150) e já é fonte
-- de evidência reconhecida por `project_measurement_resolve_source` (131,
-- `source_type = 'project_file'`). O que faltava não era tabela — era a
-- LIGAÇÃO do arquivo com o marco contratual e com a etapa de cronograma.
--
-- Por isso esta migration NÃO cria repositório novo. Ela acrescenta três
-- colunas de vínculo, classifica a origem, e publica UMA leitura que expõe o
-- mesmo acervo em vários contextos.
--
-- ─── O que ela recusa criar ───────────────────────────────────────────────
--
--   · nenhuma cópia de documento contratual. `contract_documents` continua
--     sendo do módulo Contratos; a leitura abaixo o REFERENCIA (identidade,
--     título, tipo) e deliberadamente NÃO devolve caminho de objeto — o
--     download acontece em Contratos, sobre o mesmo byte.
--   · nenhum caminho de escrita novo. O INSERT continua sendo o da 150, com
--     os mesmos predicados de permissão; o que muda é que os vínculos agora
--     precisam pertencer ao MESMO inquilino.
--   · nenhum estado de medição, aceite ou faturamento. Anexar arquivo não
--     mede, não aceita e não fatura. Esta migration não escreve uma linha
--     sequer em `project_measurements`.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) OS VÍNCULOS do documento canônico
-- ---------------------------------------------------------------------------
/*
  `timeline_item_id` já existia (032). Os três abaixo completam a identidade
  que a §6 do pedido exige preservar: contrato, marco e medição.

  Todos são ON DELETE SET NULL, e não CASCADE: apagar um marco não pode apagar
  o PDF do relatório de ensaio. O documento sobrevive ao vínculo — ele é
  evidência do que aconteceu, não um detalhe do marco.
*/
ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS contract_id uuid
    REFERENCES public.contracts(id) ON DELETE SET NULL;

ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS contract_milestone_id uuid
    REFERENCES public.contract_milestones(id) ON DELETE SET NULL;

ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS measurement_id uuid
    REFERENCES public.project_measurements(id) ON DELETE SET NULL;

/*
  A CLASSE documental da evidência, no vocabulário que o contrato usa.

  Texto com CHECK, e não enum: a lista cresce com o tipo de obra, e uma
  migration para cada novo tipo de laudo seria atrito sem ganho. `NULL` é
  legítimo — documento de projeto que não é evidência de medição.
*/
ALTER TABLE public.project_files
  ADD COLUMN IF NOT EXISTS evidence_category text;

DO $evidence_category_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'project_files_evidence_category_check'
       AND conrelid = 'public.project_files'::regclass
  ) THEN
    ALTER TABLE public.project_files
      ADD CONSTRAINT project_files_evidence_category_check
      CHECK (evidence_category IS NULL OR evidence_category IN (
        'relatorio_medicao', 'relatorio_tecnico', 'relatorio_inspecao',
        'relatorio_ensaio', 'databook', 'protocolo', 'aceite',
        'relatorio_fotografico', 'desenho', 'procedimento', 'documento_suporte'
      ));
  END IF;
END $evidence_category_check$;

CREATE INDEX IF NOT EXISTS project_files_contract_milestone_idx
  ON public.project_files (contract_milestone_id)
  WHERE contract_milestone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS project_files_measurement_idx
  ON public.project_files (measurement_id)
  WHERE measurement_id IS NOT NULL;

COMMENT ON COLUMN public.project_files.contract_milestone_id IS
  'O marco contratual que este documento evidencia. A MESMA identidade que '
  'Contratos, o cronograma e a medição usam — nunca uma cópia do marco.';
COMMENT ON COLUMN public.project_files.measurement_id IS
  'A instância de medição a que o documento foi anexado, quando ela já existe. '
  'NULL não significa "não é evidência": significa que a medição canônica '
  'ainda não foi materializada, e o vínculo de marco continua valendo.';
COMMENT ON COLUMN public.project_files.evidence_category IS
  'Classe documental da evidência (relatório de medição, ensaio, databook…). '
  'Não é estado: anexar não mede, não aceita e não torna elegível.';

-- ---------------------------------------------------------------------------
-- 2) O VÍNCULO NÃO ATRAVESSA O INQUILINO
-- ---------------------------------------------------------------------------
/*
  A política da 150 continua inteira — organização, permissão, autoria, classe
  e bucket. O que se acrescenta é a exigência de que contrato, marco e medição
  apontados pertençam à MESMA organização da linha.

  Sem isso, um cliente poderia gravar um documento seu carregando o id de um
  marco de outro inquilino. Não vazaria conteúdo (a RLS de leitura do outro
  lado continua fechada), mas criaria um vínculo cruzado que a auditoria teria
  de explicar depois — e explicar depois é como esses vínculos sobrevivem.
*/
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
  AND (
    project_files.contract_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.contracts c
       WHERE c.id = project_files.contract_id
         AND c.organization_id = public.current_user_organization_id()
    )
  )
  AND (
    project_files.contract_milestone_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.contract_milestones m
       WHERE m.id = project_files.contract_milestone_id
         AND m.organization_id = public.current_user_organization_id()
    )
  )
  AND (
    project_files.measurement_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.project_measurements pm
       WHERE pm.id = project_files.measurement_id
         AND pm.organization_id = public.current_user_organization_id()
         AND pm.project_id = project_files.project_id
    )
  )
);

-- ---------------------------------------------------------------------------
-- 3) A LEITURA ÚNICA — um acervo, vários contextos
-- ---------------------------------------------------------------------------
/*
  ─── O recorte ───────────────────────────────────────────────────────────

  Entra por `project_id`. Saem DUAS procedências, e a coluna `origin` diz qual:

    PROJECT              documento de execução do projeto
    MEASUREMENT_EVIDENCE o mesmo acervo, classificado como evidência de um
                         marco contratual — MESMA linha, mesmo id, mesmo byte
    CONTRACT             documento do módulo Contratos, REFERENCIADO

  Um documento de projeto nunca aparece duas vezes: `origin` é derivado do
  vínculo da própria linha, não de uma segunda consulta unida à primeira.

  ─── Por que o documento contratual vem sem caminho ──────────────────────

  Porque o download dele é de Contratos. Devolver `object_path` aqui daria a
  Projetos um segundo caminho até o mesmo byte — e um segundo caminho é como
  um dia se justifica uma segunda cópia. A tela mostra identidade, tipo e
  status, e leva a pessoa ao contrato.

  ─── RLS ─────────────────────────────────────────────────────────────────

  `security_invoker = true`. Quem não lê `project_files` não lê a parte de
  projeto; quem não lê `contract_documents` não lê a parte contratual. A
  visão não abre um milímetro, e o braço contratual entra pelo vínculo
  GOVERNADO (175) — nunca por semelhança de nome.
*/
CREATE OR REPLACE VIEW public.project_document_read_model
WITH (security_invoker = true) AS
SELECT
  f.organization_id,
  f.project_id,
  f.id                                        AS document_id,
  CASE WHEN f.contract_milestone_id IS NOT NULL
         OR f.document_type = 'measurement_evidence'
       THEN 'MEASUREMENT_EVIDENCE' ELSE 'PROJECT' END
                                              AS origin,
  f.file_name                                 AS title,
  f.document_type,
  f.evidence_category,
  f.category,
  f.bucket_id,
  f.object_path,
  f.public_url,
  f.content_type,
  f.file_size,
  f.contract_id,
  f.contract_milestone_id,
  f.measurement_id,
  f.timeline_item_id,
  f.created_by                                AS uploaded_by,
  f.created_at                                AS uploaded_at,
  NULL::text                                  AS contract_document_status
FROM public.project_files f
WHERE f.category <> 'logo'

UNION ALL

SELECT
  cd.organization_id,
  l.project_id,
  cd.id                                       AS document_id,
  'CONTRACT'                                  AS origin,
  cd.title,
  cd.document_type,
  NULL::text                                  AS evidence_category,
  NULL::text                                  AS category,
  -- Referência, não caminho. O byte é lido em Contratos.
  NULL::text                                  AS bucket_id,
  NULL::text                                  AS object_path,
  NULL::text                                  AS public_url,
  NULL::text                                  AS content_type,
  NULL::bigint                                AS file_size,
  cd.contract_id,
  NULL::uuid                                  AS contract_milestone_id,
  NULL::uuid                                  AS measurement_id,
  NULL::uuid                                  AS timeline_item_id,
  cd.uploaded_by,
  cd.created_at                               AS uploaded_at,
  cd.status                                   AS contract_document_status
FROM public.contract_documents cd
JOIN public.project_contract_link_governed l
  ON l.organization_id = cd.organization_id
 AND l.contract_id = cd.contract_id;

COMMENT ON VIEW public.project_document_read_model IS
  'O acervo documental de um projeto em UMA leitura, com a procedência ao lado '
  '(PROJECT / MEASUREMENT_EVIDENCE / CONTRACT). Evidência de medição é a MESMA '
  'linha de project_files — não uma cópia. Documento contratual entra como '
  'REFERÊNCIA, sem caminho de objeto: o download é do módulo Contratos.';

GRANT SELECT ON public.project_document_read_model TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_document_read_model FROM authenticated;
REVOKE ALL ON public.project_document_read_model FROM anon;

COMMIT;
