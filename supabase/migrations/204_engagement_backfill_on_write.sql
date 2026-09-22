-- ============================================================================
-- 204 — O PAI SE DERIVA SOZINHO NA ESCRITA
--
-- ─── O que a suíte viva encontrou ────────────────────────────────────────
--
-- A 201 tornou `engagement_id` obrigatório em `project_measurements` e em
-- `contract_measurement_requirements`. Correto como invariante — e QUEBRADO
-- como contrato de escrita: todo caminho que já escrevia nessas tabelas passa
-- `contract_id` e não conhece o pai.
--
-- Isso não é hipótese. `contracts-operationalization-live` falhou em 11 provas
-- com "null value in column engagement_id", e o mesmo aconteceria em produção
-- com `project_measurement_ensure_for_milestone`,
-- `project_measurements_materialize`, a materialização por gatilho de
-- cronograma (190) e qualquer inserção futura.
--
-- ─── Por que gatilho, e não parâmetro em cada função ─────────────────────
--
-- Porque o pai é DERIVÁVEL: toda regra e toda medição contratada já apontam
-- para um contrato, e todo contrato aponta para o seu engajamento. Exigir que
-- cada chamador repita esse caminho é pedir que oito lugares acertem a mesma
-- consulta — e o primeiro que esquecer produz um erro de NOT NULL no meio de
-- uma materialização noturna.
--
-- O gatilho preenche APENAS quando o valor vem nulo. Quem informa o pai
-- explicitamente — o trabalho autorizado sem contrato — continua mandando, e
-- o gatilho não encosta. Não há caminho em que ele sobrescreva uma escolha.
--
-- ─── O que continua impossível ───────────────────────────────────────────
--
-- Linha sem contrato E sem engajamento. Aí não há de onde derivar, e o
-- NOT NULL recusa — que é o comportamento certo: uma medição que não pende
-- nem de instrumento nem de trabalho autorizado não pende de nada.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.commercial_engagement_fill_from_contract()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.engagement_id IS NOT NULL OR NEW.contract_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.engagement_id INTO NEW.engagement_id
    FROM public.contracts c
   WHERE c.id = NEW.contract_id AND c.organization_id = NEW.organization_id;
  RETURN NEW;
END $$;

/*
  SECURITY DEFINER com EXECUTE revogado de todo mundo.

  A função só roda como gatilho, e gatilho executa com o privilégio do dono da
  tabela — não precisa de GRANT nenhum. Deixar o EXECUTE aberto criaria uma
  função SECURITY DEFINER alcançável por `anon`, que é exatamente o que a
  auditoria permanente da 146 proíbe.
*/
REVOKE ALL ON FUNCTION public.commercial_engagement_fill_from_contract()
  FROM PUBLIC, anon, authenticated;

-- Mesmo tratamento para o espelho de vínculo criado na 197: ele também é
-- SECURITY DEFINER e também não deve ter EXECUTE concedido a ninguém.
REVOKE ALL ON FUNCTION public.engagement_project_links_mirror_contract()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER cmr_fill_engagement
  BEFORE INSERT ON public.contract_measurement_requirements
  FOR EACH ROW EXECUTE FUNCTION public.commercial_engagement_fill_from_contract();

CREATE TRIGGER pm_fill_engagement
  BEFORE INSERT ON public.project_measurements
  FOR EACH ROW EXECUTE FUNCTION public.commercial_engagement_fill_from_contract();

/*
  `contract_billing_events.engagement_id` é NULÁVEL, e o gatilho vale do mesmo
  jeito: a ponte da 201 já preenche o pai, mas os outros caminhos de criação
  de faturamento (marco, ajuste, supersessão) não conhecem o campo. Sem isto,
  metade das linhas novas nasceria sem pai e a carteira consolidada veria
  faturamento contratado desaparecer do trabalho a que pertence.
*/
CREATE TRIGGER cbe_fill_engagement
  BEFORE INSERT ON public.contract_billing_events
  FOR EACH ROW EXECUTE FUNCTION public.commercial_engagement_fill_from_contract();

-- ---------------------------------------------------------------------------
-- O vínculo projeto↔engajamento também precisa existir na escrita
--
-- `pm_engagement_project_linked` exige a linha em `engagement_project_links`.
-- Para trabalho contratado ela nasce do espelho de `contract_project_links` —
-- mas só a partir da 197. Vínculos criados ANTES existem em
-- `contract_project_links` e podem não ter espelho se o contrato ganhou
-- engajamento depois. Esta reconciliação fecha a lacuna, e é idempotente.
-- ---------------------------------------------------------------------------
INSERT INTO public.engagement_project_links (organization_id, engagement_id, project_id, created_at)
SELECT DISTINCT l.organization_id, c.engagement_id, l.project_id, l.created_at
  FROM public.contract_project_links l
  JOIN public.contracts c ON c.id = l.contract_id AND c.organization_id = l.organization_id
 WHERE c.engagement_id IS NOT NULL
ON CONFLICT (organization_id, engagement_id, project_id) DO NOTHING;

COMMIT;
