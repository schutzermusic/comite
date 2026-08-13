-- ============================================================
-- INSIGHT eSOCIAL — classificação de rubricas, bases apuradas e cobertura
-- Migration: 081_esocial_rubricas_e_bases
--
-- Três correções que os dados reais da primeira importação expuseram:
--
--  1. GUIAS MULTIPLICADAS PELAS RETIFICAÇÕES.
--     O eSocial reemite o totalizador INTEIRO a cada reprocessamento da
--     competência, e o pacote do Download entrega todas as versões. A apuração
--     somava todas: abril/2026 saiu com INSS, IRRF e FGTS 3× maiores que os
--     reais. Agora só a versão de maior `nrRecArqBase` entra.
--
--  2. FOLHA BRUTA INFLADA POR DESCONTOS E INFORMATIVAS.
--     No S-1200 o `vrRubr` vem SEMPRE positivo e a natureza não é declarada;
--     quem separa provento de desconto é o `tpRubr` da tabela de rubricas
--     (S-1010). A regra anterior ("valor negativo = desconto") nunca disparava,
--     então pensão, empréstimo e rubricas de base entravam na massa salarial.
--
--  3. NÃO DAVA PARA SABER QUANDO O NÚMERO ERA CONFIÁVEL.
--     Sem medir a cobertura da tabela de rubricas, "horas extras: R$ 0,00"
--     parecia um fato quando na verdade era ausência de dicionário.
--
-- Aditiva e idempotente: só acrescenta colunas.
-- ============================================================
BEGIN;

-- ── Competência ──────────────────────────────────────────────
ALTER TABLE public.esocial_competence_metrics
  -- Horas extras em HORAS (qtdRubr), não só em reais: é o que o indicador de
  -- HE% pede, e não há como inferi-lo do valor.
  ADD COLUMN IF NOT EXISTS overtime_hours       numeric(12,2) NOT NULL DEFAULT 0,

  -- Cobertura da tabela de rubricas nesta competência. `rubric_total` é tudo o
  -- que o S-1200 declarou; `rubric_mapped` é a parte com definição conhecida.
  -- A razão entre as duas decide se os indicadores de composição podem ser
  -- exibidos ou se o cockpit deve mostrar a base apurada pelos totalizadores.
  ADD COLUMN IF NOT EXISTS rubric_total_cents   bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rubric_mapped_cents  bigint NOT NULL DEFAULT 0,

  -- Parte do INSS retida dos segurados, contida em inss_cents. Separá-la
  -- permite mostrar "empresa x empregado" sem uma segunda leitura do XML.
  ADD COLUMN IF NOT EXISTS inss_withheld_cents  bigint,

  -- Base de cálculo do FGTS apurada pelo eSocial (S-5013). Junto de
  -- cp_base_cents, é a medida COMPLETA da remuneração do mês — existe em toda
  -- competência fechada, inclusive naquelas cujo detalhe do S-1200 já saiu da
  -- janela de retenção.
  ADD COLUMN IF NOT EXISTS fgts_base_cents      bigint;

COMMENT ON COLUMN public.esocial_competence_metrics.gross_payroll_cents IS
  'Soma das rubricas classificadas como provento (tpRubr=1) pela tabela S-1010. '
  'Vale apenas quando rubric_mapped_cents cobre a folha; caso contrário use cp_base_cents.';

COMMENT ON COLUMN public.esocial_competence_metrics.inss_cents IS
  'INSS total da guia: soma dos códigos de receita do contribuinte (infoCRContrib) '
  'na versão mais recente do S-5011 — patronal + RAT + terceiros + retido dos segurados.';

-- ── Área / lotação ───────────────────────────────────────────
ALTER TABLE public.esocial_area_metrics
  -- Base apurada pelo governo para a lotação. Ao contrário de gross_cents, não
  -- depende da tabela de rubricas estar completa.
  ADD COLUMN IF NOT EXISTS base_cents bigint NOT NULL DEFAULT 0;

COMMIT;
