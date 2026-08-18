-- ============================================================
-- INSIGHT eSOCIAL — benefícios abertos por tipo
-- Migration: 082_esocial_beneficios_por_natureza
--
-- "Benefícios por tipo" era desenhado por rateio fixo sobre a massa (22% vale
-- alimentação, 35% saúde, 12% odontológico…). Nenhum desses percentuais fora
-- declarado por ninguém: o gráfico era uma hipótese com aparência de apuração.
--
-- O único lugar onde vale-alimentação se distingue de plano de saúde é a
-- NATUREZA da rubrica (natRubr) na tabela do empregador (S-1010). Esta coluna
-- guarda o agregado por tipo já na apuração, para que o gráfico não precise
-- reler o XML.
--
-- Fica vazia enquanto a tabela de rubricas não cobrir a folha — e, vazia, o
-- painel diz que o dado depende do S-1010 em vez de inventar a composição.
-- ============================================================
BEGIN;

ALTER TABLE public.esocial_competence_metrics
  ADD COLUMN IF NOT EXISTS benefits_by_nature jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.esocial_competence_metrics.benefits_by_nature IS
  'Benefícios por tipo em centavos: {va, vr, health, dental, transport, other}. '
  'Agrupado pela natureza (natRubr) declarada no S-1010; vazio sem a tabela de rubricas.';

COMMIT;
