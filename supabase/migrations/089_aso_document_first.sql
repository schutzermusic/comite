-- ============================================================
-- INSIGHT — ASO com o DOCUMENTO ORIGINAL como fonte primária
-- Migration: 089_aso_document_first
--
-- O QUE MUDA EM RELAÇÃO À 085
--
-- A 085 nasceu como um complemento do eSocial: o PDF entrava para declarar a
-- validade que o S-2220 não carrega. Na prática o RH tem o papel muito antes de
-- ter o pacote do eSocial Download — e amarrar o controle de saúde ocupacional
-- à importação deixava a seção inútil justamente no começo, que é quando ela
-- mais precisa funcionar.
--
-- Aqui a ordem se inverte, de forma explícita e permanente:
--
--   O ASO EM PDF É A FONTE PRIMÁRIA. O S-2220 é conferência OPCIONAL.
--
-- Consequências que esta migration grava no esquema:
--
-- 1. O ARQUIVO ORIGINAL É INTOCÁVEL. `original_file_url` aponta para o objeto
--    como ele subiu, byte a byte. Nada do que a leitura ou a revisão produzem
--    volta para o arquivo — tudo vive em colunas separadas.
--
-- 2. LEITURA E REVISÃO SÃO DUAS CAMADAS. `extracted_fields_json` é o que a
--    máquina leu e NUNCA é reescrito; `reviewed_fields_json` guarda apenas os
--    campos que uma pessoa corrigiu. Antes, a correção manual sobrescrevia a
--    leitura e apagava a evidência de que houve correção — o que impedia tanto
--    auditar o revisor quanto medir o extrator.
--
-- 3. DOIS EIXOS DE STATUS, PORQUE SÃO DUAS PERGUNTAS DIFERENTES.
--    `review_status` responde "o que o RH decidiu sobre este papel".
--    `esocial_match_status` responde "o eSocial concorda com ele" — e a segunda
--    resposta NUNCA bloqueia a primeira. `not_imported` é o estado normal de
--    quem ainda não importou nada, não uma pendência.
--
--    `document_status` é a projeção de leitura de `review_status`, mantida por
--    trigger (nunca escrita à mão). Existe para que indicadores e índices leiam
--    um vocabulário estável — pending_review | approved | rejected |
--    needs_correction — sem depender do vocabulário do fluxo de revisão. O
--    quinto estado da tela, `missing`, é por COLABORADOR e não por documento:
--    ele significa "não há linha aqui", e por definição não pode ser uma linha.
--
-- 4. NENHUM ASO É APROVADO SOZINHO. O default é `pending`, e a aprovação exige
--    um `reviewed_by`. `review_history` guarda quem fez o quê e quando.
-- ============================================================
BEGIN;

-- ── 1) Colunas novas ─────────────────────────────────────────
ALTER TABLE public.aso_documents
  -- Referência estável ao objeto ORIGINAL, no formato `bucket/caminho`.
  -- Não é URL pública de propósito: o bucket é privado e o acesso sai por link
  -- assinado de curta duração, emitido na leitura.
  ADD COLUMN IF NOT EXISTS original_file_url     text,
  ADD COLUMN IF NOT EXISTS worker_registration   text,
  -- CNPJ do empregador impresso no ASO. Fica ao lado de company_name porque o
  -- nome sozinho não identifica: razão social muda, CNPJ não.
  ADD COLUMN IF NOT EXISTS company_cnpj          text,
  -- Quem REALIZOU o exame. Coluna própria, e não um sinônimo de company_name:
  -- o ASO emitido pelo próprio empregador é exatamente o que não deveria
  -- acontecer, e fundir os dois campos esconderia isso.
  ADD COLUMN IF NOT EXISTS clinic_name           text,
  /** ["ruído","poeira mineral"] — riscos ocupacionais como impressos no ASO. */
  ADD COLUMN IF NOT EXISTS occupational_risks    jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Leitura da máquina, congelada. Fonte da verdade sobre o que o extrator viu. */
  ADD COLUMN IF NOT EXISTS extracted_fields_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Só os campos que uma pessoa corrigiu. Vazio = ninguém mexeu em nada. */
  ADD COLUMN IF NOT EXISTS reviewed_fields_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** [{at, by, action, note, fields}] — trilha de revisão, append-only. */
  ADD COLUMN IF NOT EXISTS review_history        jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Frase pronta da divergência com o S-2220, quando existe. */
  ADD COLUMN IF NOT EXISTS divergence_summary    text;

-- ── 2) `status` vira `review_status`, com vocabulário de fluxo ─
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aso_documents' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aso_documents' AND column_name = 'review_status'
  ) THEN
    ALTER TABLE public.aso_documents RENAME COLUMN status TO review_status;
  END IF;
END;
$$;

ALTER TABLE public.aso_documents
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.aso_documents DROP CONSTRAINT IF EXISTS aso_documents_status_check;
ALTER TABLE public.aso_documents ALTER COLUMN review_status DROP DEFAULT;

UPDATE public.aso_documents
SET review_status = CASE review_status
  WHEN 'pending_review' THEN 'pending'
  WHEN 'confirmed'      THEN 'approved'
  ELSE review_status
END
WHERE review_status IN ('pending_review', 'confirmed');

ALTER TABLE public.aso_documents ALTER COLUMN review_status SET DEFAULT 'pending';

ALTER TABLE public.aso_documents DROP CONSTRAINT IF EXISTS aso_documents_review_status_check;
ALTER TABLE public.aso_documents
  ADD CONSTRAINT aso_documents_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'rejected', 'correction_requested'));

-- Aprovar exige um revisor identificado. Sem isso, "aprovado" seria um estado
-- que o sistema pode alcançar sozinho — exatamente o que este módulo proíbe.
--
-- NOT VALID de propósito: a regra vale para toda escrita a partir de agora, mas
-- não reprova a migration por causa de uma linha antiga sem revisor registrado.
-- Recusar o backfill aqui deixaria a base sem a regra, que é o pior dos dois.
ALTER TABLE public.aso_documents DROP CONSTRAINT IF EXISTS aso_documents_approval_needs_reviewer;
ALTER TABLE public.aso_documents
  ADD CONSTRAINT aso_documents_approval_needs_reviewer
  CHECK (review_status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
  NOT VALID;

-- ── 3) `document_status`: projeção de leitura, mantida por trigger ─
ALTER TABLE public.aso_documents
  ADD COLUMN IF NOT EXISTS document_status text;

UPDATE public.aso_documents
SET document_status = CASE review_status
  WHEN 'approved'             THEN 'approved'
  WHEN 'rejected'             THEN 'rejected'
  WHEN 'correction_requested' THEN 'needs_correction'
  ELSE 'pending_review'
END
WHERE document_status IS NULL;

ALTER TABLE public.aso_documents ALTER COLUMN document_status SET DEFAULT 'pending_review';
ALTER TABLE public.aso_documents ALTER COLUMN document_status SET NOT NULL;

ALTER TABLE public.aso_documents DROP CONSTRAINT IF EXISTS aso_documents_document_status_check;
ALTER TABLE public.aso_documents
  ADD CONSTRAINT aso_documents_document_status_check
  CHECK (document_status IN ('pending_review', 'approved', 'rejected', 'needs_correction'));

-- ── 4) `match_status` vira `esocial_match_status`, e opcional de verdade ─
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aso_documents' AND column_name = 'match_status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aso_documents' AND column_name = 'esocial_match_status'
  ) THEN
    ALTER TABLE public.aso_documents RENAME COLUMN match_status TO esocial_match_status;
  END IF;
END;
$$;

ALTER TABLE public.aso_documents
  ADD COLUMN IF NOT EXISTS esocial_match_status text NOT NULL DEFAULT 'not_imported';

ALTER TABLE public.aso_documents DROP CONSTRAINT IF EXISTS aso_documents_match_status_check;
ALTER TABLE public.aso_documents ALTER COLUMN esocial_match_status DROP DEFAULT;

-- 'pending' e 'no_esocial_event' diziam a mesma coisa por dois caminhos: não há
-- evento com que comparar. Viram um estado só, e um estado NEUTRO.
UPDATE public.aso_documents
SET esocial_match_status = 'not_imported'
WHERE esocial_match_status IN ('pending', 'no_esocial_event');

ALTER TABLE public.aso_documents ALTER COLUMN esocial_match_status SET DEFAULT 'not_imported';

ALTER TABLE public.aso_documents DROP CONSTRAINT IF EXISTS aso_documents_esocial_match_status_check;
ALTER TABLE public.aso_documents
  ADD CONSTRAINT aso_documents_esocial_match_status_check
  CHECK (esocial_match_status IN ('not_imported', 'matched', 'divergent', 'not_applicable'));

-- ── 5) `valid_until` vira `validity_date` ────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aso_documents' AND column_name = 'valid_until'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aso_documents' AND column_name = 'validity_date'
  ) THEN
    ALTER TABLE public.aso_documents RENAME COLUMN valid_until TO validity_date;
  END IF;
END;
$$;

ALTER TABLE public.aso_documents
  ADD COLUMN IF NOT EXISTS validity_date date;

-- ── 6) Método de extração com o vocabulário do produto ───────
ALTER TABLE public.aso_documents DROP CONSTRAINT IF EXISTS aso_documents_extraction_method_check;
ALTER TABLE public.aso_documents ALTER COLUMN extraction_method DROP DEFAULT;

UPDATE public.aso_documents
SET extraction_method = CASE extraction_method
  WHEN 'deterministic' THEN 'text_layer'
  WHEN 'ai'            THEN 'ocr_ai'
  ELSE extraction_method
END
WHERE extraction_method IN ('deterministic', 'ai');

ALTER TABLE public.aso_documents ALTER COLUMN extraction_method SET DEFAULT 'text_layer';
ALTER TABLE public.aso_documents
  ADD CONSTRAINT aso_documents_extraction_method_check
  CHECK (extraction_method IN ('text_layer', 'ocr_ai', 'manual'));

-- ── 7) Backfill do acervo existente ──────────────────────────
UPDATE public.aso_documents
SET original_file_url = storage_bucket || '/' || object_path
WHERE original_file_url IS NULL;

-- A leitura das linhas antigas nunca foi guardada à parte. Reconstituí-la a
-- partir das colunas é a melhor aproximação disponível, e é honesta: nas linhas
-- que ninguém revisou, coluna e leitura são de fato a mesma coisa.
UPDATE public.aso_documents
SET extracted_fields_json = jsonb_strip_nulls(jsonb_build_object(
  'examDate',       to_jsonb(exam_date),
  'examKind',       to_jsonb(exam_kind),
  'result',         to_jsonb(exam_result),
  'validityDate',   to_jsonb(validity_date),
  'validityBasis',  to_jsonb(validity_basis),
  'doctorName',     to_jsonb(doctor_name),
  'doctorCrm',      to_jsonb(doctor_crm),
  'workerName',     to_jsonb(worker_name_raw),
  'companyName',    to_jsonb(company_name),
  'companyCnpj',    to_jsonb(company_cnpj),
  'clinicName',     to_jsonb(clinic_name)
))
WHERE extracted_fields_json = '{}'::jsonb;

-- ── 8) Índices que citavam os nomes antigos ──────────────────
DROP INDEX IF EXISTS public.aso_documents_review_idx;
CREATE INDEX IF NOT EXISTS aso_documents_pending_review_idx
  ON public.aso_documents (organization_id, review_status)
  WHERE review_status = 'pending';

-- Vencimento só interessa sobre documento APROVADO: um ASO que ninguém conferiu
-- não pode produzir nem "vencido" nem "em dia".
DROP INDEX IF EXISTS public.aso_documents_validity_idx;
CREATE INDEX IF NOT EXISTS aso_documents_validity_idx
  ON public.aso_documents (organization_id, validity_date)
  WHERE validity_date IS NOT NULL AND document_status = 'approved';

-- ── 9) Trigger: projeta document_status e carimba updated_at ──
CREATE OR REPLACE FUNCTION public.touch_aso_documents()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  -- document_status NUNCA é escrito pela aplicação: é a leitura de
  -- review_status. Derivar aqui é o que impede os dois de divergirem.
  NEW.document_status := CASE NEW.review_status
    WHEN 'approved'             THEN 'approved'
    WHEN 'rejected'             THEN 'rejected'
    WHEN 'correction_requested' THEN 'needs_correction'
    ELSE 'pending_review'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aso_documents_touch ON public.aso_documents;
CREATE TRIGGER aso_documents_touch
  BEFORE INSERT OR UPDATE ON public.aso_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_aso_documents();

-- ── 10) Documentação ─────────────────────────────────────────
COMMENT ON TABLE public.aso_documents IS
  'ASOs em PDF enviados pelo RH. FONTE PRIMÁRIA do controle de saúde ocupacional: os indicadores funcionam só com estes documentos, sem depender de importação do eSocial. O S-2220 entra apenas como conferência opcional.';
COMMENT ON COLUMN public.aso_documents.original_file_url IS
  'bucket/caminho do PDF ORIGINAL, preservado sem transformação. Acesso sempre por link assinado de curta duração — o bucket é privado.';
COMMENT ON COLUMN public.aso_documents.extracted_fields_json IS
  'O que a máquina leu do PDF, congelado. Nunca reescrito por revisão: é a evidência de que houve correção e a única forma de medir o extrator.';
COMMENT ON COLUMN public.aso_documents.reviewed_fields_json IS
  'Apenas os campos que uma pessoa corrigiu. As colunas planas (exam_date, validity_date, …) são a leitura sobreposta pela revisão — este JSON diz o que veio de gente.';
COMMENT ON COLUMN public.aso_documents.review_status IS
  'Decisão humana: pending | approved | rejected | correction_requested. Nenhum documento chega a approved sem reviewed_by (constraint).';
COMMENT ON COLUMN public.aso_documents.document_status IS
  'Projeção de leitura de review_status (pending_review | approved | rejected | needs_correction), mantida por trigger. Não escrever à mão. O estado missing é por colaborador, não por documento.';
COMMENT ON COLUMN public.aso_documents.esocial_match_status IS
  'Conferência OPCIONAL com o S-2220: not_imported (estado normal de quem não importou — não é pendência), matched, divergent (alerta, nunca bloqueio) ou not_applicable (falta data no papel para comparar).';
COMMENT ON COLUMN public.aso_documents.validity_date IS
  'Data até quando o exame vale. Ler sempre junto de validity_basis: sem isso não dá para distinguir fato declarado no papel de premissa nossa.';

COMMIT;
