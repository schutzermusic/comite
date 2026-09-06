-- ============================================================
-- PLATAFORMA — domain_events: o fato durável e a caixa de saída transacional
-- Migration: 119_platform_domain_events
--
-- ─── O que esta tabela é ───────────────────────────────────────────────────
--
-- Um registro APPEND-ONLY de fatos de negócio que já aconteceram, gravado na
-- MESMA transação da mutação autoritativa que os produziu. Nada mais.
--
-- ─── O que esta tabela NÃO é ───────────────────────────────────────────────
--
-- Não é event sourcing. As tabelas de domínio (`contracts`,
-- `contract_obligation_instances`, `fiscal_documents`, `projects`) continuam
-- sendo a verdade. Apagar `domain_events` inteira não faria o Apex perder um
-- contrato sequer — faria perder a CAUSALIDADE e o trabalho pendente.
--
-- Não é fila de comandos. Fato no passado mora aqui; trabalho a fazer mora em
-- `apex_jobs` (migration 120). Misturar os dois é o erro que transforma um
-- registro histórico em backlog mutável.
--
-- Não é log de auditoria. `audit_logs` responde "quem tentou fazer o quê";
-- este responde "que fato durável ocorreu e o que ele causou". Uma ação pode
-- produzir os dois, e nenhum substitui o outro.
--
-- ─── A invariante que justifica o arquivo ──────────────────────────────────
--
-- Proibido:   UPDATE domínio; COMMIT; INSERT evento depois.
-- Obrigatório: BEGIN; UPDATE domínio; INSERT evento; COMMIT.
--
-- Entre o COMMIT e o INSERT posterior cabe um processo derrubado, e o que
-- sobra é um fato que aconteceu de verdade e que o Apex nunca vai saber que
-- aconteceu. É por isso que a emissão é feita por gatilho ou por função
-- chamada de dentro da transação — nunca por uma segunda ida ao banco.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) Guarda de segredo no payload
-- ------------------------------------------------------------
-- O payload é JSON pequeno e versionado. Token, senha, cookie, segredo de
-- certificado, XML/PDF cru e credencial de provedor NÃO entram — não porque
-- alguém pretenda colocá-los, mas porque um evento é lido por muito mais gente
-- e por muito mais tempo do que a rota que o emitiu.
--
-- A verificação é por NOME DE CHAVE, recursiva, e é IMMUTABLE para poder valer
-- como CHECK. Ela não tenta adivinhar segredo por formato do valor: isso
-- produziria falso positivo em número de contrato e falso negativo em token
-- curto. Nome de chave é o que o emissor controla e o que a revisão lê.
CREATE FUNCTION public.apex_payload_key_is_forbidden(p_key text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(p_key) ~ '(password|passwd|secret|token|api[_-]?key|apikey|bearer|authorization|cookie|session|credential|private[_-]?key|passphrase|access[_-]?key|client[_-]?secret|refresh[_-]?token|certificate|pfx|p12)'
$$;

CREATE FUNCTION public.apex_payload_is_safe(p_payload jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE k text; v jsonb;
BEGIN
  IF p_payload IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(p_payload) = 'object' THEN
    FOR k, v IN SELECT * FROM jsonb_each(p_payload) LOOP
      IF public.apex_payload_key_is_forbidden(k) THEN RETURN false; END IF;
      IF NOT public.apex_payload_is_safe(v) THEN RETURN false; END IF;
    END LOOP;
  ELSIF jsonb_typeof(p_payload) = 'array' THEN
    FOR v IN SELECT * FROM jsonb_array_elements(p_payload) LOOP
      IF NOT public.apex_payload_is_safe(v) THEN RETURN false; END IF;
    END LOOP;
  END IF;
  RETURN true;
END $$;

COMMENT ON FUNCTION public.apex_payload_is_safe(jsonb) IS
  'Recusa payload que carregue chave com nome de segredo, em qualquer '
  'profundidade. Verifica NOME de chave, não formato de valor: adivinhar '
  'segredo pelo valor erraria nos dois sentidos.';

-- ------------------------------------------------------------
-- 2) A tabela
-- ------------------------------------------------------------
CREATE TABLE public.domain_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Texto namespaced, nunca ENUM: um ENUM obrigaria migration para cada fato
  -- novo, e o vocabulário cresce a cada fase. O formato é conferido:
  -- <domínio>.<entidade>.<fato_no_passado>.
  event_type          text NOT NULL
                        CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$'),
  -- A versão do payload é COLUNA, não sufixo do nome. `..._v2` no event_type
  -- obrigaria todo consumidor a fazer parsing de string para saber o que leu.
  schema_version      integer NOT NULL CHECK (schema_version > 0),

  -- Sujeito autoritativo primário do fato.
  aggregate_type      text NOT NULL CHECK (btrim(aggregate_type) <> ''),
  aggregate_id        uuid NOT NULL,

  -- `occurred_at` é o tempo do NEGÓCIO; `recorded_at` é o tempo do banco. Os
  -- dois existem porque um trabalhador que roda no dia 11 sobre um fato do dia
  -- 10 tem de ativar a obrigação em 10 — a hora da execução não é a hora do
  -- fato.
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  recorded_at         timestamptz NOT NULL DEFAULT now(),

  actor_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source              text NOT NULL DEFAULT 'system'
                        CHECK (source IN ('human','system','cron','provider','integration')),

  -- Correlação é a "história"; causação é o "pai". Juntas fazem a cadeia
  -- consultável sem que ninguém precise adivinhar o que disparou o quê.
  correlation_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  causation_event_id  uuid,

  -- Identidade de NEGÓCIO do fato. UUID aleatório não é idempotência: ele torna
  -- toda retentativa um fato novo.
  idempotency_key     text NOT NULL CHECK (btrim(idempotency_key) <> ''),

  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ---- metadados de roteamento (o ÚNICO trecho mutável da linha) ----
  routing_state       text NOT NULL DEFAULT 'PENDING'
                        CHECK (routing_state IN ('PENDING','ROUTED','FAILED')),
  route_count         integer NOT NULL DEFAULT 0 CHECK (route_count >= 0),
  routing_error_code  text,
  routing_error_safe  text,
  routed_at           timestamptz,

  CONSTRAINT de_org_id_unique UNIQUE (organization_id, id),
  -- A garantia de idempotência mora no banco, não no chamador.
  CONSTRAINT de_idempotent UNIQUE (organization_id, event_type, idempotency_key),
  -- Causação SEMPRE do mesmo inquilino — estruturalmente, não por convenção.
  CONSTRAINT de_causation_tenant FOREIGN KEY (organization_id, causation_event_id)
    REFERENCES public.domain_events (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT de_no_self_causation CHECK (causation_event_id IS DISTINCT FROM id),
  CONSTRAINT de_routed_coherent CHECK ((routing_state = 'ROUTED') = (routed_at IS NOT NULL)),
  CONSTRAINT de_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  -- Payload é referência, não conteúdo. 16 KB é folgado para um punhado de ids
  -- e apertado demais para um XML ou um PDF em base64.
  CONSTRAINT de_payload_small CHECK (pg_column_size(payload) <= 16384),
  CONSTRAINT de_payload_no_secrets CHECK (public.apex_payload_is_safe(payload))
);

COMMENT ON TABLE public.domain_events IS
  'Fatos de negócio duráveis, gravados na MESMA transação da mutação '
  'autoritativa. NÃO é event sourcing: as tabelas de domínio continuam sendo a '
  'verdade. NÃO é fila de comandos: trabalho a fazer mora em apex_jobs. NÃO '
  'substitui audit_logs.';
COMMENT ON COLUMN public.domain_events.occurred_at IS
  'Tempo do FATO DE NEGÓCIO. É ele que governa a ativação de obrigação, não a '
  'hora em que o trabalhador acordou.';
COMMENT ON COLUMN public.domain_events.idempotency_key IS
  'Identidade de negócio estável, ex.: obligation-instance:<id>:history:<id>. '
  'UUID aleatório sozinho NÃO é idempotência.';

-- ------------------------------------------------------------
-- 3) Índices — só os que caminho real percorre
-- ------------------------------------------------------------
-- O varredor de eventos não roteados roda a cada 10 minutos. Sem índice
-- parcial ele leria a tabela inteira para sempre encontrar quase nada, e o
-- custo cresceria com a história em vez de com o backlog.
CREATE INDEX de_unrouted ON public.domain_events (recorded_at)
  WHERE routing_state = 'PENDING';
CREATE INDEX de_org_recorded ON public.domain_events (organization_id, recorded_at DESC);
CREATE INDEX de_type_version ON public.domain_events (event_type, schema_version);
CREATE INDEX de_aggregate ON public.domain_events (organization_id, aggregate_type, aggregate_id, occurred_at DESC);
CREATE INDEX de_correlation ON public.domain_events (correlation_id);
CREATE INDEX de_causation ON public.domain_events (causation_event_id) WHERE causation_event_id IS NOT NULL;
-- Roteamento por vínculo de obrigação casa (organização, tipo, versão).
CREATE INDEX de_org_type_version ON public.domain_events (organization_id, event_type, schema_version)
  WHERE routing_state = 'PENDING';

-- ------------------------------------------------------------
-- 4) Imutabilidade factual
-- ------------------------------------------------------------
-- Fato não se reescreve. Só os metadados de roteamento evoluem, e apenas por
-- caminho de servidor. Um evento cujo `payload` pudesse ser editado depois
-- deixaria de ser prova de coisa alguma.
CREATE FUNCTION public.domain_events_reject_fact_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.organization_id    IS DISTINCT FROM OLD.organization_id
  OR NEW.event_type         IS DISTINCT FROM OLD.event_type
  OR NEW.schema_version     IS DISTINCT FROM OLD.schema_version
  OR NEW.aggregate_type     IS DISTINCT FROM OLD.aggregate_type
  OR NEW.aggregate_id       IS DISTINCT FROM OLD.aggregate_id
  OR NEW.occurred_at        IS DISTINCT FROM OLD.occurred_at
  OR NEW.recorded_at        IS DISTINCT FROM OLD.recorded_at
  OR NEW.actor_user_id      IS DISTINCT FROM OLD.actor_user_id
  OR NEW.source             IS DISTINCT FROM OLD.source
  OR NEW.correlation_id     IS DISTINCT FROM OLD.correlation_id
  OR NEW.causation_event_id IS DISTINCT FROM OLD.causation_event_id
  OR NEW.idempotency_key    IS DISTINCT FROM OLD.idempotency_key
  OR NEW.payload            IS DISTINCT FROM OLD.payload THEN
    RAISE EXCEPTION 'Um fato registrado não é reescrito: domain_events.% é append-only (evento %).',
      'campos factuais', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.domain_events_reject_fact_rewrite() FROM PUBLIC;

CREATE TRIGGER de_facts_immutable BEFORE UPDATE ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.domain_events_reject_fact_rewrite();

-- Apagar evento não é desfazer: é fingir que o fato não aconteceu. A aplicação
-- não pode; o caminho privilegiado (exclusão de inquilino inteiro) continua
-- aberto pela mesma fronteira que a 110 desenhou.
CREATE TRIGGER de_no_erasure BEFORE DELETE ON public.domain_events
  FOR EACH ROW EXECUTE FUNCTION public.contracts_reject_history_erasure();

-- ------------------------------------------------------------
-- 5) O emissor controlado
-- ------------------------------------------------------------
-- Toda emissão passa por aqui. Um INSERT direto continuaria possível para o
-- dono do banco, mas nenhum caminho da aplicação o usa: é esta função que
-- valida inquilino, causação e idempotência, e é ela que os testes provam.
-- SECURITY INVOKER, e não DEFINER, de propósito. DEFINER trocaria a identidade
-- do chamador pela do dono ANTES de qualquer verificação, o que teria dois
-- efeitos ruins: `current_user` deixaria de dizer quem chamou (as guardas
-- abaixo viriam sempre verdadeiras) e a função passaria a enxergar toda linha
-- de todo inquilino — o material de que oráculo cross-tenant é feito. Como
-- INVOKER, a fronteira é dupla e real: sem EXECUTE o navegador não entra, e se
-- entrasse não teria INSERT em `domain_events`.
--
-- Os gatilhos de emissão da 121 SÃO definer, porque precisam gravar o evento
-- mesmo quando quem mutou a tabela de domínio foi `authenticated`. São
-- funções sem parâmetro e sem ramificação por dado de usuário.
CREATE FUNCTION public.emit_domain_event(
  p_organization_id    uuid,
  p_event_type         text,
  p_schema_version     integer,
  p_aggregate_type     text,
  p_aggregate_id       uuid,
  p_idempotency_key    text,
  p_payload            jsonb        DEFAULT '{}'::jsonb,
  p_occurred_at        timestamptz  DEFAULT NULL,
  p_source             text         DEFAULT 'system',
  p_actor_user_id      uuid         DEFAULT NULL,
  p_correlation_id     uuid         DEFAULT NULL,
  p_causation_event_id uuid         DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  new_id        uuid;
  existing      public.domain_events%ROWTYPE;
  cause_org     uuid;
  cause_corr    uuid;
  effective_corr uuid;
  caller_org    uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Evento sem organização: todo fato pertence a um inquilino.'
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    Defesa em profundidade. A função é revogada de `anon` e `authenticated`, de
    modo que o navegador não a alcança; se um dia alcançar, a organização que
    ele AFIRMA ter deixa de valer como prova — vale a que o perfil diz.
  */
  IF current_user IN ('authenticated','anon') THEN
    caller_org := public.current_user_organization_id();
    IF caller_org IS NULL OR caller_org <> p_organization_id THEN
      RAISE EXCEPTION 'Emissão negada.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'Organização inexistente.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ---- causação: mesmo inquilino, sempre ----
  IF p_causation_event_id IS NOT NULL THEN
    SELECT organization_id, correlation_id INTO cause_org, cause_corr
      FROM public.domain_events WHERE id = p_causation_event_id;
    /*
      A mensagem é a MESMA para "não existe" e "é de outro inquilino". Duas
      mensagens diferentes responderiam, para quem tem um UUID na mão, se
      aquele evento existe em outra organização — que é o oráculo que a Fase 2
      fechou na função de sondagem de cláusula.
    */
    IF cause_org IS NULL OR cause_org <> p_organization_id THEN
      RAISE EXCEPTION 'Evento causador inválido.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- A cadeia causal herda a correlação do pai quando o chamador não impõe uma.
  effective_corr := COALESCE(p_correlation_id, cause_corr, gen_random_uuid());

  INSERT INTO public.domain_events (
    organization_id, event_type, schema_version, aggregate_type, aggregate_id,
    occurred_at, actor_user_id, source, correlation_id, causation_event_id,
    idempotency_key, payload)
  VALUES (
    p_organization_id, p_event_type, p_schema_version, p_aggregate_type, p_aggregate_id,
    COALESCE(p_occurred_at, now()), p_actor_user_id, p_source, effective_corr,
    p_causation_event_id, p_idempotency_key, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (organization_id, event_type, idempotency_key) DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NOT NULL THEN RETURN new_id; END IF;

  -- ---- já existia: mesma identidade, mesmo significado? ----
  SELECT * INTO existing FROM public.domain_events
   WHERE organization_id = p_organization_id
     AND event_type = p_event_type
     AND idempotency_key = p_idempotency_key;

  /*
    Retentativa idêntica devolve o evento que já está lá. Mesma chave com
    SIGNIFICADO diferente é recusada: aceitá-la calada faria a segunda emissão
    desaparecer, e o chamador acharia que gravou o que não gravou.
  */
  IF existing.schema_version = p_schema_version
     AND existing.aggregate_type = p_aggregate_type
     AND existing.aggregate_id = p_aggregate_id
     AND existing.payload = COALESCE(p_payload, '{}'::jsonb) THEN
    RETURN existing.id;
  END IF;

  RAISE EXCEPTION
    'Chave de idempotência % reusada com significado diferente para %.',
    p_idempotency_key, p_event_type USING ERRCODE = 'unique_violation';
END $$;

REVOKE ALL ON FUNCTION public.emit_domain_event(
  uuid, text, integer, text, uuid, text, jsonb, timestamptz, text, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.emit_domain_event(
  uuid, text, integer, text, uuid, text, jsonb, timestamptz, text, uuid, uuid, uuid) IS
  'Único caminho de emissão. Server-only. Valida inquilino, exige causação do '
  'MESMO inquilino sem revelar existência alheia, herda correlação do causador '
  'e resolve idempotência: retentativa idêntica devolve o evento existente, '
  'chave reusada com outro significado é recusada. Deve ser chamada DENTRO da '
  'transação da mutação autoritativa.';

-- ------------------------------------------------------------
-- 6) Registro estático de rotas
-- ------------------------------------------------------------
-- (event_type, schema_version) -> job_type. Nasce VAZIO, de propósito: nenhum
-- dos cinco fatos do vocabulário inicial tem, hoje, um consumidor automático
-- que não seria especulação sobre a Fase 5, 6 ou 7. O primeiro consumidor real
-- da Fase 4 é dinâmico (vínculo de ativação de obrigação, migration 121), e
-- ele é resolvido pela função de roteamento com regra explícita.
--
-- Semear rota para fase que não existe seria inventar consumidor.
CREATE TABLE public.apex_event_routes (
  event_type      text    NOT NULL,
  schema_version  integer NOT NULL CHECK (schema_version > 0),
  job_type        text    NOT NULL CHECK (btrim(job_type) <> ''),
  max_attempts    integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  enabled         boolean NOT NULL DEFAULT true,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_type, schema_version, job_type)
);

COMMENT ON TABLE public.apex_event_routes IS
  'Registro ESTÁTICO de rotas evento -> trabalho, por versão de schema. Nasce '
  'vazio: rota para consumidor que ainda não existe seria consumidor '
  'inventado. Rotas dinâmicas (vínculo de obrigação) são resolvidas por regra '
  'explícita em apex_route_pending_events.';

-- ------------------------------------------------------------
-- 7) Postura de acesso
-- ------------------------------------------------------------
-- Infraestrutura de servidor. O navegador não lê a fila de fatos do Apex e não
-- escreve nela. A RLS existe como defesa em profundidade — a fronteira real é
-- a ausência de grant.
ALTER TABLE public.domain_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apex_event_routes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.domain_events     FROM anon, authenticated;
REVOKE ALL ON public.apex_event_routes FROM anon, authenticated;
-- TRUNCATE não é filtrado por RLS e o DEFAULT ACL do schema o concede. A 118
-- corrigiu o default para o dono atual; o REVOKE explícito acima é o que torna
-- esta migration independente daquela correção continuar valendo.

COMMIT;
