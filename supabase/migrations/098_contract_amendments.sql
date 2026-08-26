-- ============================================================================
-- 098 — Aditivos contratuais como instrumento jurídico próprio (P2F.1)
--
-- POR QUE UMA TABELA NOVA, E NÃO `contract_documents`
--
-- `contract_documents.document_type` já aceita 'amendment', e isso basta para
-- guardar o PDF. Não basta para o INSTRUMENTO: um aditivo tem número próprio,
-- data de assinatura e data de efeito distintas, altera valor, altera prazo,
-- altera escopo e atinge cláusulas específicas. Nada disso cabe numa linha de
-- documento, que descreve um arquivo — não uma alteração contratual.
--
-- A alternativa de modelar cada aditivo como uma linha de `contracts` foi
-- descartada: um aditivo não é um contrato. Ele apareceria na carteira, seria
-- contado nas métricas de portfólio e somaria valor em duplicidade com o
-- mestre.
--
-- ESTRITAMENTE ADITIVA: nenhuma tabela existente é alterada, nenhuma coluna
-- removida ou renomeada, nenhuma política reescrita.
--
-- O PRINCÍPIO QUE GOVERNA O DESENHO
--
-- O valor e o prazo VIGENTES nunca são gravados por cima do contrato mestre.
-- `contracts.total_value` e `contracts.end_date` continuam sendo o que o
-- contrato ORIGINAL dizia, para sempre. O estado vigente é derivado dos efeitos
-- explicitamente registrados nos aditivos — e, quando não há como derivá-lo com
-- segurança, o produto diz que não sabe em vez de exibir um número plausível.
-- ============================================================================

BEGIN;

-- ── 1) O INSTRUMENTO ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.contract_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  -- O contrato MESTRE. `CASCADE` porque um aditivo não sobrevive ao contrato
  -- que ele altera — não existe aditivo órfão.
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,

  -- Número do aditivo tal como consta no papel ("1º Termo Aditivo", "TA-02").
  amendment_number text NOT NULL,
  title text,

  -- O PDF. Vive em `contract_documents`, que segue dono do arquivo: aqui só se
  -- referencia. `SET NULL` para que apagar um documento não apague o registro
  -- jurídico do aditivo.
  document_id uuid REFERENCES public.contract_documents(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'draft',

  signed_date date,
  -- Data a partir da qual o aditivo PRODUZ EFEITO. Distinta da assinatura de
  -- propósito: assina-se em março um aditivo que vigora a partir de maio, e
  -- confundir as duas aplica o efeito dois meses cedo.
  effective_date date,

  -- ── Efeito sobre o VALOR ──
  --
  -- Duas formas, porque as duas existem no papel: "fica acrescido de R$ X" e
  -- "o valor passa a ser R$ Y". Obrigar o usuário a converter uma na outra o
  -- faria fazer aritmética que o sistema deveria fazer, e perderia o que o
  -- documento efetivamente diz. As duas são mutuamente exclusivas.
  value_delta numeric,
  value_absolute numeric,

  -- ── Efeito sobre o PRAZO ──
  --
  -- Mesmo raciocínio: "prorrogado por 12 meses" e "vigorará até 31/12/2027".
  new_end_date date,
  term_extension_days integer,

  -- ── Efeito sobre o ESCOPO ──
  -- Texto livre: alteração de escopo não se reduz a número.
  scope_change text,

  notes text,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  -- Vocabulário fechado. `draft` é registrado mas SEM efeito;
  -- `signed`/`active` produzem efeito; `cancelled` nunca produz.
  CONSTRAINT contract_amendments_status_check
    CHECK (status IN ('draft', 'signed', 'active', 'cancelled')),

  -- Um aditivo declara o valor de UMA forma, nunca das duas: registrar
  -- "+R$ 100k" e "passa a R$ 900k" ao mesmo tempo cria duas verdades sobre a
  -- mesma cláusula, e a derivação teria de escolher uma sem base.
  CONSTRAINT contract_amendments_value_effect_check
    CHECK (NOT (value_delta IS NOT NULL AND value_absolute IS NOT NULL)),

  CONSTRAINT contract_amendments_term_effect_check
    CHECK (NOT (new_end_date IS NOT NULL AND term_extension_days IS NOT NULL)),

  -- Prorrogação é para frente. Um "extension" negativo seria uma redução de
  -- prazo disfarçada; quem reduz vigência informa a nova data.
  CONSTRAINT contract_amendments_extension_positive_check
    CHECK (term_extension_days IS NULL OR term_extension_days > 0),

  -- Número único por contrato, ignorando os excluídos.
  CONSTRAINT contract_amendments_number_not_blank
    CHECK (btrim(amendment_number) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_amendments_number
  ON public.contract_amendments(contract_id, btrim(lower(amendment_number)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_amendments_contract
  ON public.contract_amendments(contract_id, effective_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contract_amendments_document
  ON public.contract_amendments(document_id) WHERE document_id IS NOT NULL;

-- ── 2) CLÁUSULAS ATINGIDAS ─────────────────────────────────────────────────
--
-- Um aditivo pode alterar, acrescentar ou suprimir cláusulas. A cláusula
-- ORIGINAL nunca é apagada nem sobrescrita: ela continua sendo verdade
-- histórica sobre o que o contrato dizia antes. Esta tabela registra a
-- RELAÇÃO entre o aditivo e a cláusula, e é isso que permite exibir
-- "original → alterada por TA-01" sem destruir nenhum dos dois lados.

CREATE TABLE IF NOT EXISTS public.contract_amendment_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  amendment_id uuid NOT NULL REFERENCES public.contract_amendments(id) ON DELETE CASCADE,

  -- A cláusula atingida. Nula quando o efeito é `added`: a cláusula nova pode
  -- ainda não ter sido registrada.
  clause_id uuid REFERENCES public.contract_clauses(id) ON DELETE SET NULL,

  -- A cláusula que PASSA A VALER, quando o aditivo a substitui. Aponta para
  -- outra linha de `contract_clauses` — a nova redação — de modo que as duas
  -- coexistem e a sucessão fica explícita.
  replacement_clause_id uuid REFERENCES public.contract_clauses(id) ON DELETE SET NULL,

  effect text NOT NULL,
  note text,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_amendment_clauses_effect_check
    CHECK (effect IN ('altered', 'added', 'removed')),

  -- Alterar ou suprimir exige saber O QUE foi alterado ou suprimido.
  CONSTRAINT contract_amendment_clauses_target_check
    CHECK (effect = 'added' OR clause_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_contract_amendment_clauses_amendment
  ON public.contract_amendment_clauses(amendment_id);
CREATE INDEX IF NOT EXISTS idx_contract_amendment_clauses_clause
  ON public.contract_amendment_clauses(clause_id) WHERE clause_id IS NOT NULL;

-- ── 3) RLS ─────────────────────────────────────────────────────────────────
--
-- Idêntica em forma à de `contract_documents` (034): leitura para quem pode
-- ler o contrato, escrita para admin ou `contracts.edit`.

ALTER TABLE public.contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_amendment_clauses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contract_amendments_select ON public.contract_amendments;
CREATE POLICY contract_amendments_select ON public.contract_amendments
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_can_read_contract(contract_id));

DROP POLICY IF EXISTS contract_amendments_manage ON public.contract_amendments;
CREATE POLICY contract_amendments_manage ON public.contract_amendments
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id()
       AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

DROP POLICY IF EXISTS contract_amendment_clauses_select ON public.contract_amendment_clauses;
CREATE POLICY contract_amendment_clauses_select ON public.contract_amendment_clauses
FOR SELECT TO authenticated
USING (organization_id = current_user_organization_id()
       AND EXISTS (SELECT 1 FROM public.contract_amendments a
                    WHERE a.id = amendment_id AND current_user_can_read_contract(a.contract_id)));

DROP POLICY IF EXISTS contract_amendment_clauses_manage ON public.contract_amendment_clauses;
CREATE POLICY contract_amendment_clauses_manage ON public.contract_amendment_clauses
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id()
       AND (current_user_is_admin() OR current_user_has_permission('contracts.edit')));

COMMIT;
