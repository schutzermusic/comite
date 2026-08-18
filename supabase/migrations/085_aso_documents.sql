-- ============================================================
-- INSIGHT — Documentos de ASO (Atestado de Saúde Ocupacional)
-- Migration: 085_aso_documents
--
-- POR QUE O PDF IMPORTA, SE O eSOCIAL JÁ TEM O S-2220
--
-- O evento S-2220 diz que houve exame, de que tipo e qual o resultado. Ele NÃO
-- diz até quando o exame vale — o leiaute não tem esse campo. Até aqui a
-- validade era INFERIDA (periodicidade anual da NR-7, e só para o exame
-- periódico); todo o resto ficava em "sem vencimento apurável".
--
-- O ASO impresso, esse, quase sempre traz a data de validade escrita. Subir o
-- PDF troca uma inferência por um fato declarado, e é por isso que este módulo
-- existe. A coluna `validity_basis` registra qual dos dois sustenta a data:
--
--   declared_document     — estava escrito no ASO. É fato.
--   inferred_periodicity  — deduzido do tipo de exame. É premissa nossa.
--   undetermined          — nenhum dos dois. Fica ausente, nunca "em dia".
--
-- A segunda razão é conferência: o RH transmite o S-2220 a partir do mesmo
-- papel. Divergência entre o PDF e o evento (data, tipo, resultado) é erro de
-- transmissão, e só aparece quando as duas fontes existem lado a lado.
--
-- Segurança: ASO é dado de saúde. O bucket é PRIVADO e sem policy de cliente —
-- o arquivo só sai por rota autenticada. A tabela exige permissão de dado
-- sensível, como esocial_sst_events (084).
-- ============================================================
BEGIN;

-- ── Bucket privado dos PDFs ──────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('aso-documents', 'aso-documents', false, 20971520) -- 20 MB
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = EXCLUDED.file_size_limit;

-- Sem policy de cliente: upload e download passam pela API com service role.
DROP POLICY IF EXISTS aso_documents_no_client_access ON storage.objects;

CREATE TABLE IF NOT EXISTS public.aso_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Vínculo. `person_id` pode ficar nulo quando o PDF chega antes de a pessoa
  -- existir no cadastro; o documento NÃO é recusado por isso — fica pendente
  -- de vínculo, visível, em vez de ser descartado.
  person_id          uuid REFERENCES public.people(id) ON DELETE SET NULL,
  worker_cpf_hash    text,
  worker_name_raw    text,                    -- nome como saiu do PDF

  -- Arquivo
  file_name          text NOT NULL,
  storage_bucket     text NOT NULL DEFAULT 'aso-documents',
  object_path        text NOT NULL UNIQUE,
  mime_type          text,
  file_size          bigint,
  checksum           text,                    -- SHA-256 do arquivo

  -- ── Extraído do documento ──
  exam_date          date,
  -- Normalizado para o domínio do tpExameOcup do eSocial, para poder comparar.
  exam_kind          text,
  exam_result        text,                    -- '1' apto | '2' inapto
  valid_until        date,
  validity_basis     text NOT NULL DEFAULT 'undetermined'
                       CHECK (validity_basis IN ('declared_document', 'inferred_periodicity', 'undetermined')),
  doctor_name        text,
  doctor_crm         text,
  company_name       text,

  extraction_method  text NOT NULL DEFAULT 'deterministic'
                       CHECK (extraction_method IN ('deterministic', 'ai', 'manual')),
  -- 0..1. Abaixo do piso a leitura vai para revisão humana em vez de virar dado.
  extraction_confidence numeric(4,3),
  /** Campos que não puderam ser lidos, com o motivo. Alimenta a revisão. */
  extraction_issues  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── Conferência com o eSocial ──
  esocial_event_id   text,                    -- S-2220 casado, quando há
  match_status       text NOT NULL DEFAULT 'pending'
                       CHECK (match_status IN ('pending', 'matched', 'divergent', 'no_esocial_event')),
  /** [{field, document, esocial}] — o par de valores que diverge. */
  divergences        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── Curadoria humana ──
  status             text NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review', 'confirmed', 'rejected')),
  reviewed_by        uuid REFERENCES auth.users(id),
  reviewed_at        timestamptz,
  notes              text,

  uploaded_by        uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aso_documents_person_idx
  ON public.aso_documents (organization_id, person_id);

CREATE INDEX IF NOT EXISTS aso_documents_worker_idx
  ON public.aso_documents (organization_id, worker_cpf_hash);

-- Consulta de vencimento: só interessa onde há data apurada e o documento
-- não foi rejeitado.
--
-- Os dois índices abaixo ficam dentro de um guarda porque a migration 089
-- RENOMEIA `valid_until` → `validity_date` e `status` → `review_status`, e
-- recria os índices com os nomes novos. `CREATE INDEX IF NOT EXISTS` não
-- salvaria: o Postgres resolve as colunas na análise sintática, antes de olhar
-- se o índice já existe — então, numa base pós-089, a 085 falharia ao ser
-- reexecutada. E reexecutar tudo é o modo NORMAL de uso do runner, não uma
-- exceção; uma migration antiga que só roda uma vez quebra o runner inteiro.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aso_documents' AND column_name = 'valid_until'
  ) THEN
    EXECUTE $ix$
      CREATE INDEX IF NOT EXISTS aso_documents_validity_idx
        ON public.aso_documents (organization_id, valid_until)
        WHERE valid_until IS NOT NULL AND status <> 'rejected'
    $ix$;
    EXECUTE $ix$
      CREATE INDEX IF NOT EXISTS aso_documents_review_idx
        ON public.aso_documents (organization_id, status)
        WHERE status = 'pending_review'
    $ix$;
  END IF;
END;
$$;

-- Mesmo arquivo enviado duas vezes não vira dois ASOs.
CREATE UNIQUE INDEX IF NOT EXISTS aso_documents_checksum_uq
  ON public.aso_documents (organization_id, checksum)
  WHERE checksum IS NOT NULL;

ALTER TABLE public.aso_documents ENABLE ROW LEVEL SECURITY;

-- Leitura: dado de saúde, mesma régua de esocial_sst_events (084).
DROP POLICY IF EXISTS aso_documents_read ON public.aso_documents;
CREATE POLICY aso_documents_read ON public.aso_documents
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR current_user_has_permission('people.payroll_view_sensitive')
    OR current_user_has_permission('people.view_sensitive_data')
  )
);

-- Escrita direta pelo cliente: apenas curadoria (confirmar/rejeitar/anotar).
-- O upload e a extração passam pela rota, com service role.
DROP POLICY IF EXISTS aso_documents_review ON public.aso_documents;
CREATE POLICY aso_documents_review ON public.aso_documents
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.view_sensitive_data'))
)
WITH CHECK (
  organization_id = current_user_organization_id()
);

CREATE OR REPLACE FUNCTION public.touch_aso_documents()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aso_documents_touch ON public.aso_documents;
CREATE TRIGGER aso_documents_touch
  BEFORE UPDATE ON public.aso_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_aso_documents();

COMMENT ON TABLE public.aso_documents IS
  'ASOs em PDF enviados pelo RH. Fonte DECLARADA da validade do exame, que o evento S-2220 do eSocial não carrega.';
COMMENT ON COLUMN public.aso_documents.validity_basis IS
  'O que sustenta valid_until: declared_document (escrito no ASO, fato), inferred_periodicity (deduzido do tipo, premissa) ou undetermined (ausente — nunca ler como "em dia").';
COMMENT ON COLUMN public.aso_documents.divergences IS
  'Diferenças entre o PDF e o evento S-2220 correspondente. Divergência é erro de transmissão, e só é detectável com as duas fontes lado a lado.';

COMMIT;
