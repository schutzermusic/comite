-- ============================================================
-- INSIGHT Pessoas & Custos — ajustes manuais de quadro
-- Migration: 083_workforce_ajustes_manuais
--
-- POR QUE ESTA TABELA EXISTE, E POR QUE SEPARADA
--
-- O pacote do eSocial Download entregou, para 2025, apenas os totalizadores
-- consolidados e o detalhe de UM trabalhador. As guias daquele ano são reais e
-- completas; o quadro, não — o headcount apurado sai como 1 onde havia ~250.
-- Isso envenena tudo o que divide pela quantidade de pessoas: o custo médio de
-- janeiro/2025 aparecia como R$ 871.670 por colaborador.
--
-- O número correto existe fora do eSocial (folha analítica do escritório), e o
-- administrador pode informá-lo. Isso NÃO é um dado de demonstração: é uma
-- afirmação de uma pessoa a partir de um documento, e por isso carrega
-- procedência — quem lançou, quando e com base em quê.
--
-- SEPARADA de `esocial_competence_metrics` por um motivo concreto: aquela
-- tabela é REESCRITA por inteiro a cada reapuração (`recomputeMetrics`). Um
-- valor manual gravado lá seria silenciosamente apagado na próxima importação
-- — por exemplo quando a tabela de rubricas (S-1010) chegar. Aqui ele
-- sobrevive a qualquer reimportação, e é aplicado na LEITURA.
--
-- Acesso: leitura para quem vê Pessoas & Custos; escrita só para administrador.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.workforce_manual_headcount (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competence      text NOT NULL CHECK (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  /** Colaboradores no mês, conforme o documento citado em `source_note`. */
  headcount       integer NOT NULL CHECK (headcount >= 0),

  /**
   * De onde veio o número. Obrigatório: um lançamento manual sem origem
   * declarada é indistinguível de um palpite seis meses depois.
   */
  source_note     text NOT NULL CHECK (length(btrim(source_note)) >= 3),

  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, competence)
);

COMMENT ON TABLE public.workforce_manual_headcount IS
  'Quadro informado manualmente por competência, para meses em que o eSocial não '
  'entregou o detalhe por trabalhador. Aplicado na leitura; nunca sobrescrito pela reapuração.';

ALTER TABLE public.workforce_manual_headcount ENABLE ROW LEVEL SECURITY;

-- Leitura: mesma audiência do cockpit — o número aparece nos indicadores.
DROP POLICY IF EXISTS workforce_manual_headcount_read ON public.workforce_manual_headcount;
CREATE POLICY workforce_manual_headcount_read ON public.workforce_manual_headcount
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (current_user_is_admin() OR current_user_has_permission('people.view'))
);

-- Escrita: somente administrador. Corrigir o quadro de uma competência muda
-- custo médio e turnover do período — é ato de governança, não de operação.
DROP POLICY IF EXISTS workforce_manual_headcount_write ON public.workforce_manual_headcount;
CREATE POLICY workforce_manual_headcount_write ON public.workforce_manual_headcount
FOR ALL TO authenticated
USING (organization_id = current_user_organization_id() AND current_user_is_admin())
WITH CHECK (organization_id = current_user_organization_id() AND current_user_is_admin());

COMMIT;
