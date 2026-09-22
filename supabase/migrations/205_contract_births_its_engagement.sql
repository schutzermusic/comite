-- ============================================================================
-- 205 — TODO CONTRATO NOVO NASCE COM O SEU PAI
--
-- ─── A lacuna que a 204 revelou ──────────────────────────────────────────
--
-- A 197 deu um engajamento a cada contrato EXISTENTE. A 204 ensinou a escrita
-- a derivar o pai a partir do contrato. Nenhuma das duas resolve o contrato
-- que nasce DEPOIS: ele entra com `engagement_id` nulo, não há de onde
-- derivar, e a primeira regra de medição criada sobre ele bate no NOT NULL.
--
-- Isso apareceu numa prova viva que cria o próprio contrato dentro da
-- transação — e é exatamente o que aconteceria em produção no primeiro
-- contrato cadastrado após esta entrega.
--
-- ─── Por que o pai nasce EM ANÁLISE, sempre ──────────────────────────────
--
-- O backfill da 197 derivou a situação do contrato porque aqueles contratos
-- JÁ ERAM produção: marcá-los como "em análise" teria apagado, de uma vez,
-- valor autorizado que a empresa já reconhecia.
--
-- Contrato NOVO é o caso oposto, e o §6 do escopo é literal: "a newly
-- uploaded contract remains Em análise until reviewed. It must not
-- immediately affect active authorized-value/backlog KPIs." Derivar
-- `AUTHORIZED` de um `status = 'active'` digitado na tela de cadastro faria o
-- valor entrar no KPI no instante do upload, antes de qualquer revisão — que
-- é precisamente o que a regra proíbe.
--
-- Os KPIs antigos NÃO mudam: eles leem `contracts`, e `contracts` continua
-- com o status que a pessoa informou. Quem passa a esperar revisão é o número
-- NOVO — o valor autorizado consolidado da carteira.
--
-- ─── O contrato continua sendo a fonte regente ───────────────────────────
--
-- O gatilho de depois da inserção registra a autorização `formal_contract`
-- como REGENTE. Um contrato assinado é a fonte mais forte que existe; o que
-- espera revisão é a promoção do TRABALHO a autorizado, não a autoridade do
-- instrumento.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.contracts_ensure_engagement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_engagement uuid; v_number text;
BEGIN
  IF NEW.engagement_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Número próprio só quando não colide: duplicata histórica de
  -- `contract_number` existe, e derrubar o cadastro por causa dela seria
  -- trocar um problema de rótulo por um contrato que não entra.
  v_number := CASE WHEN NEW.contract_number IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.commercial_engagements x
       WHERE x.organization_id = NEW.organization_id
         AND x.engagement_number = NEW.contract_number)
    THEN NEW.contract_number END;

  INSERT INTO public.commercial_engagements (
    organization_id, engagement_number, title, counterparty_party_id, counterparty_name,
    currency, status, origin, owner_user_id, created_by)
  VALUES (
    NEW.organization_id, v_number, NEW.title, NEW.counterparty_party_id,
    COALESCE(nullif(btrim(NEW.counterparty_name), ''), 'Contraparte não informada'),
    NEW.currency,
    -- SEMPRE em análise. Ver o cabeçalho.
    'UNDER_ANALYSIS', 'formal_contract', NEW.owner_user_id, NEW.created_by)
  RETURNING id INTO v_engagement;

  NEW.engagement_id := v_engagement;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_ensure_engagement() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_ensure_engagement_before
  BEFORE INSERT ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_ensure_engagement();

/*
  A autorização entra DEPOIS da inserção porque ela referencia o contrato, e
  o contrato só existe ao fim do BEFORE. Valor e vigência vêm do próprio
  instrumento — nada é inventado, e nulo continua nulo.
*/
CREATE OR REPLACE FUNCTION public.contracts_register_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.engagement_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.commercial_engagement_authorizations (
    organization_id, engagement_id, source_kind, contract_id,
    authorized_value, currency, effective_from, effective_until,
    governing, state, created_by)
  VALUES (
    NEW.organization_id, NEW.engagement_id, 'formal_contract', NEW.id,
    NEW.total_value, NEW.currency, NEW.start_date, NEW.end_date,
    -- Regente SÓ se o engajamento ainda não tem regente. Um contrato que chega
    -- para um trabalho já regido por proposta aceita entra sem reger, e a
    -- troca continua sendo ato humano (§D).
    NOT EXISTS (SELECT 1 FROM public.commercial_engagement_authorizations a
                 WHERE a.organization_id = NEW.organization_id
                   AND a.engagement_id = NEW.engagement_id
                   AND a.governing AND a.state = 'ACTIVE'),
    'ACTIVE', NEW.created_by)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.contracts_register_authorization() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER contracts_register_authorization_after
  AFTER INSERT ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.contracts_register_authorization();

/*
  E o vínculo projeto↔contrato passa a poder nascer ANTES do espelho: a 197
  espelha em `engagement_project_links` na inserção de `contract_project_links`,
  e agora todo contrato tem pai no momento em que existe — então o espelho
  nunca mais encontra `engagement_id` nulo.

  Esta linha não é redundante com a 197: lá o gatilho existia, aqui a
  PRECONDIÇÃO dele passa a valer sempre.
*/

COMMIT;
