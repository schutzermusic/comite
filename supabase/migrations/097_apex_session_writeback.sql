-- ============================================================
-- 097 — Writeback autônomo do Apex em project_work_sessions (P3B)
--
-- POR QUE ESTA MIGRATION EXISTE
-- -----------------------------
-- `project_work_sessions` (041) já modela Pessoa + Projeto + Etapa + Início +
-- Fim + Duração, então é a tabela certa para a sessão reconstruída — criar
-- outra duplicaria a verdade. Falta a ela, porém, tudo o que separa um registro
-- feito por gente de um registro feito por automação:
--
--   1. ATRIBUIÇÃO   `source` só aceita web_timer/manual_entry/manager_adjustment.
--                   Sem um valor próprio, uma sessão do Apex teria de se passar
--                   por ajuste de gestor — mentira de proveniência.
--   2. PROVENIÊNCIA de quais evidências a sessão saiu, por qual regra e com
--                   que confiança. Sem isso o writeback é inauditável.
--   3. IDEMPOTÊNCIA reprocessar a mesma evidência não pode duplicar sessão.
--   4. VERIFICAÇÃO  o P3B exige Decidir → Agir → VERIFICAR; o resultado da
--                   verificação precisa de onde morar.
--   5. CORREÇÃO     quando um humano corrige, a versão do Apex NÃO é apagada:
--                   fica marcada como substituída, com autor e momento.
--
-- ADITIVA E NÃO-DESTRUTIVA
-- ------------------------
-- Só colunas novas (todas anuláveis) e o alargamento de um CHECK. Nenhuma
-- linha existente é tocada, nenhum valor deixa de ser aceito, nada é apagado.
-- ============================================================

-- ── 1) Atribuição: novo valor de `source` ───────────────────────────────────
-- Alargar o CHECK aceita tudo que já era aceito e mais um valor. Nenhuma linha
-- existente pode violá-lo.
ALTER TABLE public.project_work_sessions
  DROP CONSTRAINT IF EXISTS project_work_sessions_source_check;

ALTER TABLE public.project_work_sessions
  ADD CONSTRAINT project_work_sessions_source_check
  CHECK (source IN ('web_timer', 'manual_entry', 'manager_adjustment', 'apex_reconstruction'));

-- ── 2) Proveniência, idempotência, verificação e correção ───────────────────
ALTER TABLE public.project_work_sessions
  -- Regra que resolveu a etapa (reason codes do motor de casamento).
  ADD COLUMN IF NOT EXISTS resolution_method   text,
  -- Confiança 0..1 no momento da decisão. Fica registrada: a política pode
  -- mudar depois, e a sessão precisa continuar explicando a si mesma.
  ADD COLUMN IF NOT EXISTS match_confidence    numeric(4,3)
                             CHECK (match_confidence IS NULL
                                    OR (match_confidence >= 0 AND match_confidence <= 1)),
  -- Ids sintéticos das evidências de origem (`source:record_id`).
  ADD COLUMN IF NOT EXISTS evidence_ids        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Chave determinística da reconstrução — base da idempotência.
  ADD COLUMN IF NOT EXISTS automation_key      text,
  ADD COLUMN IF NOT EXISTS reconstructed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status text
                             CHECK (verification_status IS NULL
                                    OR verification_status IN ('pending', 'verified', 'failed')),
  ADD COLUMN IF NOT EXISTS verification_note   text,
  ADD COLUMN IF NOT EXISTS verified_at         timestamptz,
  -- Correção humana: a linha do Apex sobrevive, apenas apontando a sucessora.
  ADD COLUMN IF NOT EXISTS superseded_by       uuid REFERENCES public.project_work_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corrected_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corrected_at        timestamptz,
  ADD COLUMN IF NOT EXISTS correction_note     text;

-- Idempotência: reprocessar a mesma evidência encontra a linha em vez de criar
-- outra. Parcial porque só sessões de automação têm chave.
CREATE UNIQUE INDEX IF NOT EXISTS work_sessions_automation_key_idx
  ON public.project_work_sessions (automation_key)
  WHERE automation_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_sessions_apex_idx
  ON public.project_work_sessions (organization_id, source, verification_status)
  WHERE source = 'apex_reconstruction';

-- ── 3) RLS: a MESMA permissão, com proveniência honesta ─────────────────────
-- A policy de 041 já permitia escrever sessão de terceiro, mas só sob
-- `source = 'manager_adjustment'` + `people.timesheet_approve`. Aqui o mesmo
-- gate passa a valer para `apex_reconstruction`.
--
-- Isso NÃO amplia privilégio: quem podia escrever para outra pessoa continua
-- sendo exatamente quem tem `people.timesheet_approve`. O que muda é a sessão
-- poder se declarar como automação em vez de se disfarçar de ajuste manual.
-- Continua valendo `created_by = auth.uid()`: não há caminho de service-role.
DROP POLICY IF EXISTS work_sessions_insert ON public.project_work_sessions;
CREATE POLICY work_sessions_insert ON public.project_work_sessions
FOR INSERT TO authenticated
WITH CHECK (
  organization_id = current_user_organization_id()
  AND (
       -- sessão própria, exige timesheet_use
       (person_id = current_user_person_id()
        AND current_user_has_permission('people.timesheet_use'))
       -- ajuste de gestor em nome de terceiro
    OR (source = 'manager_adjustment'
        AND current_user_has_permission('people.timesheet_approve'))
       -- reconstrução do Apex, sob o MESMO gate do ajuste de gestor
    OR (source = 'apex_reconstruction'
        AND current_user_has_permission('people.timesheet_approve'))
    OR current_user_is_admin()
  )
  AND (created_by IS NULL OR created_by = auth.uid())
);

NOTIFY pgrst, 'reload schema';
