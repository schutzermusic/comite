-- ============================================================================
-- 206 — O VOCABULÁRIO DE ORIGEM DO FOLLOW-UP VOLTA A TER UMA AUTORIDADE SÓ
--
-- ─── O erro que esta migration desfaz ────────────────────────────────────
--
-- A 156 já tinha resolvido isto: os papéis de origem válidos vivem em
-- `apex_followup_source_kinds()`, e a tabela os cobra pela constraint
-- `af_source_kind`. Uma função, uma lista, um lugar para mudar.
--
-- A 198 não viu essa função e criou uma SEGUNDA constraint,
-- `apex_followups_source_kind_check`, com a lista escrita à mão. O resultado
-- foi o que sempre é quando duas regras descrevem o mesmo campo: elas
-- discordaram. A lista nova acrescentou os papéis comerciais e PERDEU
-- `'contract'`, `'contract_obligation_instance'`, `'contract_billing_condition'`,
-- `'contract_risk'`, `'contract_guarantee'` e `'contract_insurance_requirement'`
-- — papéis que o motor de acompanhamento usa de verdade.
--
-- Quem encontrou foi `contracts-operationalization-live`, ao tentar abrir um
-- acompanhamento de contrato e receber violação de CHECK. Sem essa prova, o
-- primeiro acompanhamento de contrato em produção teria falhado.
--
-- ─── A correção ──────────────────────────────────────────────────────────
--
-- A constraint duplicada sai. A função canônica ganha os quatro papéis
-- comerciais. `af_source_kind` continua sendo quem cobra, e continua sendo a
-- única que cobra.
--
-- Isto é exatamente a regra do escopo — "reuse existing canonical
-- architecture, do not create parallel domains" — aplicada ao próprio
-- trabalho desta entrega.
-- ============================================================================

BEGIN;

ALTER TABLE public.apex_followups
  DROP CONSTRAINT IF EXISTS apex_followups_source_kind_check;

CREATE OR REPLACE FUNCTION public.apex_followup_source_kinds() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[
  -- ---- os papéis originais da 156, intactos ----
  'contract',
  'contract_clause',
  'contract_obligation_instance',
  'contract_billing_condition',
  'contract_risk',
  'contract_guarantee',
  'contract_insurance_requirement',
  -- ---- os papéis comerciais, acrescentados ----
  'commercial_opportunity',
  'commercial_proposal',
  'commercial_engagement',
  'internal_service_order'
] $$;

/*
  `af_source_kind` não é recriada: ela chama a função, e a função acabou de
  mudar. Recriar a constraint revalidaria a tabela inteira sem necessidade —
  a lista só CRESCEU, e nenhuma linha existente pode ter deixado de ser
  válida.
*/

COMMIT;
