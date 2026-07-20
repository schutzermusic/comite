-- ============================================================
-- DIÁRIAS DE CAMPO — Weekly payment batch
-- Migration: 059_allowance_payment_batches
-- Date:      2026-07-20
-- Purpose:   Fase 3 (lote financeiro). Um único lote semanal agrupa as
--            diárias aprovadas para pagamento/exportação — o Financeiro
--            executa UMA operação de lote, nunca transferências
--            individuais (ADR-001/§4.3). Nesta etapa o pagamento é
--            EXPORTAÇÃO (CSV/PDF); não há cofre de contas bancárias nem
--            integração bancária. Idempotência de lote pelo batch_code
--            único (allowance-batch:{org}:{week}:{version}).
--            Também adiciona a FK de daily_allowances.payment_batch_id
--            (coluna criada nullable na migration 058).
-- Dependencies:
--   005 (helpers, set_updated_at())
--   058 (allowance_weeks, daily_allowances)
--   061_allowance_perm_seeds (allowances.finance_approve etc.)
-- NOTE: Idempotente, transação única, RLS 030-safe. Aditiva.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.allowance_payment_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  allowance_week_id  uuid NOT NULL REFERENCES allowance_weeks(id) ON DELETE CASCADE,
  batch_code         text NOT NULL,
  item_count         integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  total_amount_cents bigint  NOT NULL DEFAULT 0 CHECK (total_amount_cents >= 0),
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','pending_approval','approved',
                                         'exported','failed','cancelled')),
  export_format      text CHECK (export_format IN ('csv','pdf','manual_export')),
  -- modo simulação herdado da semana (Fase 1–3): lote não paga de fato
  simulation_mode    boolean NOT NULL DEFAULT true,
  requested_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  exported_at        timestamptz
);

-- idempotência do lote: um código por org (batch_code carrega período+versão)
CREATE UNIQUE INDEX IF NOT EXISTS allowance_payment_batches_code_idx
  ON public.allowance_payment_batches (organization_id, batch_code);
CREATE INDEX IF NOT EXISTS allowance_payment_batches_week_idx
  ON public.allowance_payment_batches (allowance_week_id, status);

DROP TRIGGER IF EXISTS trg_allowance_payment_batches_updated_at ON public.allowance_payment_batches;
CREATE TRIGGER trg_allowance_payment_batches_updated_at
BEFORE UPDATE ON public.allowance_payment_batches
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- FK tardia de daily_allowances.payment_batch_id (coluna já existe — 058)
DO $$
BEGIN
  ALTER TABLE public.daily_allowances
    ADD CONSTRAINT daily_allowances_batch_fk
    FOREIGN KEY (payment_batch_id)
    REFERENCES public.allowance_payment_batches(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;

-- ============================================================
-- Row Level Security
--   View: allowances.view/manage/finance_approve.
--   Escrita: allowances.finance_approve (gera e exporta o lote).
-- ============================================================
ALTER TABLE public.allowance_payment_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowance_payment_batches_select ON public.allowance_payment_batches;
CREATE POLICY allowance_payment_batches_select ON public.allowance_payment_batches
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.view')
    OR current_user_has_permission('allowances.manage')
    OR current_user_has_permission('allowances.finance_approve')
    OR current_user_is_admin()
  )
);

DROP POLICY IF EXISTS allowance_payment_batches_insert ON public.allowance_payment_batches;
CREATE POLICY allowance_payment_batches_insert ON public.allowance_payment_batches
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.finance_approve')
    OR current_user_is_admin()
  )
  AND (requested_by IS NULL OR requested_by = auth.uid())
);

DROP POLICY IF EXISTS allowance_payment_batches_update ON public.allowance_payment_batches;
CREATE POLICY allowance_payment_batches_update ON public.allowance_payment_batches
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.finance_approve')
    OR current_user_is_admin()
  )
)
WITH CHECK (organization_id = current_user_organization_id());

DROP POLICY IF EXISTS allowance_payment_batches_delete ON public.allowance_payment_batches;
CREATE POLICY allowance_payment_batches_delete ON public.allowance_payment_batches
FOR DELETE TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
       current_user_has_permission('allowances.finance_approve')
    OR current_user_is_admin()
  )
);

COMMIT;

-- ROLLBACK (manual):
--   ALTER TABLE daily_allowances DROP CONSTRAINT IF EXISTS daily_allowances_batch_fk;
--   DROP TABLE IF EXISTS allowance_payment_batches;
