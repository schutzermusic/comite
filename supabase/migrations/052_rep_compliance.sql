-- ============================================================
-- PONTO OFICIAL (REP-P) — Compliance foundation
-- Migration: 052_rep_compliance
-- Date:      2026-07-17
-- Purpose:   Fase 9 (spec §22.2) — módulo vendável de ponto oficial:
--            1) people.cpf — identificador legal do trabalhador
--               (Portaria 671 usa CPF como chave);
--            2) rep_settings — dados do empregador/REP-P por org
--               (CNPJ, razão social, fuso, desenvolvedor);
--            3) attendance_punches ganha NSR (número sequencial de
--               registro, atômico por org via tabela de contador) e
--               integrity_hash (SHA-256 ENCADEADO com o registro
--               anterior — adulteração quebra a cadeia), atribuídos
--               por TRIGGER no banco (nunca pelo client);
--            4) imutabilidade fiscal: trigger bloqueia UPDATE dos
--               campos de marcação (tipo, horário, pessoa, NSR, hash);
--               só metadados de workflow podem mudar;
--            5) rep_file_exports — trilha auditável dos arquivos
--               fiscais gerados (AFD/AEJ/espelho) com SHA-256.
-- Dependencies:
--   005 (pgcrypto, helpers), 038 (people), 045 (attendance_punches)
--   053_rep_perm_seeds (RBAC — data only)
-- NOTE: Idempotente, transação única, RLS 030-safe.
-- LEGAL: o layout byte a byte do AFD e a assinatura ICP-Brasil são
--        validados na homologação (Anexo da Portaria 671) — este
--        schema entrega a integridade/sequência exigidas.
-- ============================================================

BEGIN;

-- ============================================================
-- 1) people.cpf — chave legal do trabalhador
-- ============================================================
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS cpf text
    CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');

CREATE UNIQUE INDEX IF NOT EXISTS people_org_cpf_unique_idx
  ON public.people (organization_id, cpf)
  WHERE cpf IS NOT NULL;

-- ============================================================
-- 2) rep_settings — empregador/REP-P (singleton por organização)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rep_settings (
  organization_id     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  employer_id_type    text NOT NULL DEFAULT 'cnpj' CHECK (employer_id_type IN ('cnpj','cpf')),
  employer_id         text NOT NULL DEFAULT '' ,          -- CNPJ (14) ou CPF (11), só dígitos
  employer_name       text NOT NULL DEFAULT '',           -- razão social
  employer_cei        text,                               -- CAEPF/CNO quando aplicável
  timezone            text NOT NULL DEFAULT 'America/Sao_Paulo',
  -- desenvolvedor do REP-P (para o atestado técnico / cabeçalho AFD)
  developer_id_type   text NOT NULL DEFAULT 'cnpj' CHECK (developer_id_type IN ('cnpj','cpf')),
  developer_id        text NOT NULL DEFAULT '',
  developer_name      text NOT NULL DEFAULT 'Insight Apex',
  rep_p_version       text NOT NULL DEFAULT '1.0.0',
  active              boolean NOT NULL DEFAULT false,     -- módulo ligado?
  notes               text,
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_rep_settings_updated_at ON public.rep_settings;
CREATE TRIGGER trg_rep_settings_updated_at
BEFORE UPDATE ON public.rep_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3) NSR + hash encadeado em attendance_punches
-- ============================================================
ALTER TABLE public.attendance_punches
  ADD COLUMN IF NOT EXISTS nsr bigint,
  ADD COLUMN IF NOT EXISTS integrity_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_org_nsr_unique_idx
  ON public.attendance_punches (organization_id, nsr)
  WHERE nsr IS NOT NULL;

-- contador atômico por organização (evita corrida do max()+1)
CREATE TABLE IF NOT EXISTS public.rep_nsr_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  last_nsr        bigint NOT NULL DEFAULT 0
);
-- counters são infra interna: nenhum acesso direto de client
ALTER TABLE public.rep_nsr_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.assign_punch_nsr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_nsr bigint;
  v_prev_hash text;
  v_cpf text;
BEGIN
  -- NSR atômico por organização (row lock no contador)
  INSERT INTO rep_nsr_counters (organization_id, last_nsr)
  VALUES (NEW.organization_id, 0)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE rep_nsr_counters
     SET last_nsr = last_nsr + 1
   WHERE organization_id = NEW.organization_id
   RETURNING last_nsr INTO v_nsr;

  -- hash do registro anterior (cadeia de integridade)
  SELECT integrity_hash INTO v_prev_hash
    FROM attendance_punches
   WHERE organization_id = NEW.organization_id AND nsr = v_nsr - 1;

  SELECT cpf INTO v_cpf FROM people WHERE id = NEW.person_id;

  NEW.nsr := v_nsr;
  NEW.integrity_hash := encode(
    digest(
      v_nsr::text
        || coalesce(v_cpf, NEW.person_id::text)
        || NEW.type
        || to_char(NEW.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        || coalesce(v_prev_hash, 'GENESIS'),
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_nsr ON public.attendance_punches;
CREATE TRIGGER trg_attendance_nsr
BEFORE INSERT ON public.attendance_punches
FOR EACH ROW EXECUTE FUNCTION public.assign_punch_nsr();

-- ============================================================
-- 4) Imutabilidade fiscal — campos de marcação nunca mudam
--    (workflow: apenas status/correção/metadata podem ser alterados)
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_punch_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.person_id            IS DISTINCT FROM OLD.person_id
     OR NEW.type              IS DISTINCT FROM OLD.type
     OR NEW.occurred_at       IS DISTINCT FROM OLD.occurred_at
     OR NEW.nsr               IS DISTINCT FROM OLD.nsr
     OR NEW.integrity_hash    IS DISTINCT FROM OLD.integrity_hash
     OR NEW.client_event_id   IS DISTINCT FROM OLD.client_event_id
     OR NEW.organization_id   IS DISTINCT FROM OLD.organization_id
  THEN
    RAISE EXCEPTION 'Marcação de ponto é imutável (Portaria 671): corrija criando novo registro'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_immutable ON public.attendance_punches;
CREATE TRIGGER trg_attendance_immutable
BEFORE UPDATE ON public.attendance_punches
FOR EACH ROW EXECUTE FUNCTION public.protect_punch_immutability();

-- backfill: numera marcações antigas (ordem cronológica) e encadeia hash
DO $$
DECLARE
  r record;
  v_nsr bigint;
  v_prev text;
  v_cpf text;
  v_hash text;
BEGIN
  FOR r IN
    SELECT id, organization_id, person_id, type, occurred_at
      FROM attendance_punches
     WHERE nsr IS NULL
     ORDER BY organization_id, occurred_at, created_at
  LOOP
    INSERT INTO rep_nsr_counters (organization_id, last_nsr)
    VALUES (r.organization_id, 0)
    ON CONFLICT (organization_id) DO NOTHING;

    UPDATE rep_nsr_counters
       SET last_nsr = last_nsr + 1
     WHERE organization_id = r.organization_id
     RETURNING last_nsr INTO v_nsr;

    SELECT integrity_hash INTO v_prev
      FROM attendance_punches
     WHERE organization_id = r.organization_id AND nsr = v_nsr - 1;

    SELECT cpf INTO v_cpf FROM people WHERE id = r.person_id;

    v_hash := encode(digest(
      v_nsr::text || coalesce(v_cpf, r.person_id::text) || r.type
        || to_char(r.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        || coalesce(v_prev, 'GENESIS'), 'sha256'), 'hex');

    -- bypass do trigger de imutabilidade: desabilita momentaneamente
    ALTER TABLE attendance_punches DISABLE TRIGGER trg_attendance_immutable;
    UPDATE attendance_punches SET nsr = v_nsr, integrity_hash = v_hash WHERE id = r.id;
    ALTER TABLE attendance_punches ENABLE TRIGGER trg_attendance_immutable;
  END LOOP;
END $$;

-- ============================================================
-- 5) rep_file_exports — trilha dos arquivos fiscais gerados
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rep_file_exports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  file_type        text NOT NULL CHECK (file_type IN ('afd','aej','espelho','comprovante')),
  period_start     date,
  period_end       date,
  person_id        uuid REFERENCES people(id) ON DELETE SET NULL,
  file_name        text NOT NULL,
  sha256           text NOT NULL,
  record_count     int NOT NULL DEFAULT 0,
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rep_file_exports_org_idx
  ON public.rep_file_exports (organization_id, generated_at DESC);

-- exportações também são imutáveis (trilha fiscal)
DROP TRIGGER IF EXISTS trg_rep_exports_append_only ON public.rep_file_exports;
CREATE TRIGGER trg_rep_exports_append_only
BEFORE UPDATE OR DELETE ON public.rep_file_exports
FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

-- ============================================================
-- 6) Row Level Security
-- ============================================================
ALTER TABLE public.rep_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rep_file_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_settings_select ON public.rep_settings;
CREATE POLICY rep_settings_select ON public.rep_settings
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.rep_manage')
    OR current_user_has_permission('people.attendance_view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS rep_settings_write ON public.rep_settings;
CREATE POLICY rep_settings_write ON public.rep_settings
FOR ALL TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.rep_manage') OR current_user_is_admin())
)
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.rep_manage') OR current_user_is_admin())
);

DROP POLICY IF EXISTS rep_exports_select ON public.rep_file_exports;
CREATE POLICY rep_exports_select ON public.rep_file_exports
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('people.rep_manage')
    OR current_user_has_permission('audit.view')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS rep_exports_insert ON public.rep_file_exports;
CREATE POLICY rep_exports_insert ON public.rep_file_exports
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (current_user_has_permission('people.rep_manage') OR current_user_is_admin())
  AND (generated_by IS NULL OR generated_by = auth.uid())
);

COMMIT;

-- ============================================================
-- Manual verification checklist (staging)
--   1. Re-run -> no-op.
--   2. INSERT punch -> nsr = anterior+1, integrity_hash preenchido.
--   3. INSERT concorrente -> NSRs distintos (contador com row lock).
--   4. UPDATE occurred_at/type de punch -> restrict_violation.
--   5. UPDATE status='corrected' -> permitido (workflow).
--   6. UPDATE/DELETE em rep_file_exports -> bloqueado.
--
-- ROLLBACK (manual):
--   DROP TABLE IF EXISTS rep_file_exports, rep_nsr_counters, rep_settings;
--   DROP TRIGGER IF EXISTS trg_attendance_nsr ON attendance_punches;
--   DROP TRIGGER IF EXISTS trg_attendance_immutable ON attendance_punches;
--   DROP FUNCTION IF EXISTS assign_punch_nsr(), protect_punch_immutability();
--   ALTER TABLE attendance_punches DROP COLUMN IF EXISTS nsr, DROP COLUMN IF EXISTS integrity_hash;
--   ALTER TABLE people DROP COLUMN IF EXISTS cpf;
-- ============================================================
