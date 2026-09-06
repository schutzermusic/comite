-- ============================================================
-- PLATAFORMA — apex_jobs: trabalho durável, posse por concessão, recuperação
-- Migration: 120_platform_apex_jobs
--
-- ─── A diferença entre esta tabela e a 119 ─────────────────────────────────
--
-- `domain_events` guarda o que JÁ ACONTECEU. `apex_jobs` guarda o que o Apex
-- AINDA PRECISA FAZER. Um é história, o outro é backlog; um é imutável, o
-- outro muda de estado a cada tentativa. Foi para não misturar os dois que
-- existem duas tabelas.
--
-- ─── Semântica de entrega ──────────────────────────────────────────────────
--
-- AT-LEAST-ONCE. Não exactly-once, e nenhum comentário deste repositório vai
-- afirmar o contrário. Entre o efeito colateral do handler e a gravação do
-- `COMPLETED` cabe um processo derrubado; quando ele voltar, o trabalho será
-- reivindicado outra vez. É por isso que TODO handler precisa ser idempotente:
-- a garantia de "uma vez só" mora no efeito, não na fila.
--
-- ─── Posse por concessão, e não por sinalizador ────────────────────────────
--
-- Reivindicar não é marcar uma coluna: é ganhar uma CONCESSÃO com prazo e com
-- um token. Concluir exige apresentar o token corrente. O cenário que isso
-- resolve é este, e ele acontece:
--
--   trabalhador A reivindica  →  A trava  →  a concessão expira
--   →  o ceifador devolve o trabalho  →  trabalhador B reivindica
--   →  A acorda e tenta concluir  →  RECUSADO
--
-- Sem o token, o A que acordou marcaria como concluído um trabalho que o B
-- está executando neste instante.
--
-- ─── Estado de infraestrutura não é verdade de negócio ─────────────────────
--
-- `DEAD_LETTER` diz que o Apex não conseguiu executar um trabalho. NÃO diz que
-- a obrigação contratual foi descumprida. Nenhum consumidor destas linhas pode
-- ler estado de fila como estado jurídico.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1) A fila
-- ------------------------------------------------------------
CREATE TABLE public.apex_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- NULLABLE porque trabalho nasce de três origens: evento, agenda e pedido
  -- explícito de operador. Exigir evento obrigaria a inventar um para toda
  -- materialização agendada.
  event_id          uuid,

  job_type          text NOT NULL
                      CHECK (job_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  payload_version   integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  idempotency_key   text NOT NULL CHECK (btrim(idempotency_key) <> ''),

  status            text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PROCESSING','COMPLETED','DEAD_LETTER','CANCELLED')),
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,

  run_after         timestamptz NOT NULL DEFAULT now(),
  attempt_count     integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts      integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),

  -- ---- a concessão ----
  locked_at         timestamptz,
  locked_by         text,
  lock_token        uuid,
  lease_expires_at  timestamptz,

  -- Código e mensagem SEGUROS. Objeto de exceção cru não é serializado aqui:
  -- ele carrega, com frequência, a URL do banco, o corpo do pedido ou o
  -- cabeçalho de autorização que causou a falha.
  last_error_code   text,
  last_error_safe   text,

  correlation_id    uuid,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,

  CONSTRAINT aj_org_id_unique UNIQUE (organization_id, id),
  -- Idempotência de trabalho, no banco. Duas ondas de acordar não podem virar
  -- dois trabalhos.
  CONSTRAINT aj_idempotent UNIQUE (organization_id, job_type, idempotency_key),
  -- Coerência de inquilino ESTRUTURAL entre trabalho e evento.
  CONSTRAINT aj_event_tenant FOREIGN KEY (organization_id, event_id)
    REFERENCES public.domain_events (organization_id, id) ON DELETE CASCADE,
  -- PROCESSING e concessão são a mesma coisa: não existe um sem o outro.
  CONSTRAINT aj_lease_coherent CHECK (
    (status = 'PROCESSING') =
    (lock_token IS NOT NULL AND locked_at IS NOT NULL AND locked_by IS NOT NULL
      AND lease_expires_at IS NOT NULL)),
  CONSTRAINT aj_terminal_coherent CHECK (
    (status IN ('COMPLETED','DEAD_LETTER','CANCELLED')) = (completed_at IS NOT NULL)),
  CONSTRAINT aj_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT aj_payload_small CHECK (pg_column_size(payload) <= 16384),
  CONSTRAINT aj_payload_no_secrets CHECK (public.apex_payload_is_safe(payload))
);

COMMENT ON TABLE public.apex_jobs IS
  'Fila de trabalho durável da plataforma. Entrega AT-LEAST-ONCE: handler tem '
  'de ser idempotente. DEAD_LETTER é estado de INFRAESTRUTURA — nunca estado '
  'contratual. Não substitui fiscal_jobs, que continua sendo do Fiscal.';
COMMENT ON COLUMN public.apex_jobs.lock_token IS
  'A posse do trabalho. Concluir/falhar exige apresentá-lo. É o que impede um '
  'trabalhador que dormiu de concluir o que outro está executando.';
COMMENT ON COLUMN public.apex_jobs.idempotency_key IS
  'Identidade estável do trabalho: event:<id> para trabalho causado por fato, '
  'chave de período para trabalho agendado. NUNCA o relógio atual.';

-- ------------------------------------------------------------
-- 2) Índices — cada um serve a uma consulta que roda a cada 10 minutos
-- ------------------------------------------------------------
CREATE INDEX aj_due_pending ON public.apex_jobs (run_after, created_at)
  WHERE status = 'PENDING';
CREATE INDEX aj_expiring ON public.apex_jobs (lease_expires_at)
  WHERE status = 'PROCESSING';
CREATE INDEX aj_org_status ON public.apex_jobs (organization_id, status, run_after);
CREATE INDEX aj_event ON public.apex_jobs (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX aj_correlation ON public.apex_jobs (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX aj_type_status ON public.apex_jobs (job_type, status);
CREATE INDEX aj_dead_letter_age ON public.apex_jobs (completed_at DESC)
  WHERE status = 'DEAD_LETTER';

CREATE FUNCTION public.apex_jobs_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_touch() FROM PUBLIC;
CREATE TRIGGER aj_touch BEFORE UPDATE ON public.apex_jobs
  FOR EACH ROW EXECUTE FUNCTION public.apex_jobs_touch();

-- ------------------------------------------------------------
-- 3) Enfileirar
-- ------------------------------------------------------------
CREATE FUNCTION public.apex_jobs_enqueue(
  p_organization_id uuid,
  p_job_type        text,
  p_idempotency_key text,
  p_payload         jsonb       DEFAULT '{}'::jsonb,
  p_payload_version integer     DEFAULT 1,
  p_run_after       timestamptz DEFAULT NULL,
  p_max_attempts    integer     DEFAULT 5,
  p_event_id        uuid        DEFAULT NULL,
  p_correlation_id  uuid        DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE job_id uuid; ev_org uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Trabalho sem organização.' USING ERRCODE = 'check_violation';
  END IF;
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Enfileiramento negado.' USING ERRCODE = '42501';
  END IF;

  IF p_event_id IS NOT NULL THEN
    SELECT organization_id INTO ev_org FROM public.domain_events WHERE id = p_event_id;
    -- Mensagem única para inexistente e alheio: ver o comentário do emissor.
    IF ev_org IS NULL OR ev_org <> p_organization_id THEN
      RAISE EXCEPTION 'Evento de origem inválido.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.apex_jobs (
    organization_id, event_id, job_type, payload_version, idempotency_key,
    payload, run_after, max_attempts, correlation_id)
  VALUES (
    p_organization_id, p_event_id, p_job_type, p_payload_version, p_idempotency_key,
    COALESCE(p_payload, '{}'::jsonb), COALESCE(p_run_after, now()), p_max_attempts,
    p_correlation_id)
  ON CONFLICT (organization_id, job_type, idempotency_key) DO NOTHING
  RETURNING id INTO job_id;

  -- Já existia: o trabalho está enfileirado ou já foi feito. Devolver o id em
  -- vez de erro é o que torna "acordar duas vezes" inofensivo.
  IF job_id IS NULL THEN
    SELECT id INTO job_id FROM public.apex_jobs
     WHERE organization_id = p_organization_id AND job_type = p_job_type
       AND idempotency_key = p_idempotency_key;
  END IF;
  RETURN job_id;
END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_enqueue(uuid, text, text, jsonb, integer, timestamptz, integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Reivindicar — um único comando, com SKIP LOCKED
-- ------------------------------------------------------------
-- SELECT primeiro e UPDATE depois seria uma corrida com nome de padrão: entre
-- os dois cabe outro trabalhador lendo a mesma linha. O UPDATE ... FROM
-- (SELECT ... FOR UPDATE SKIP LOCKED) faz seleção e posse virarem o MESMO
-- comando, e o SKIP LOCKED garante que dois trabalhadores concorrentes peguem
-- conjuntos disjuntos em vez de um esperar pelo outro.
CREATE FUNCTION public.apex_jobs_claim(
  p_worker         text,
  p_limit          integer DEFAULT 10,
  p_lease_seconds  integer DEFAULT 300
) RETURNS SETOF public.apex_jobs
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Reivindicação negada.' USING ERRCODE = '42501';
  END IF;
  IF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Lote de reivindicação fora do intervalo permitido.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  UPDATE public.apex_jobs j
     SET status           = 'PROCESSING',
         locked_at        = now(),
         locked_by        = p_worker,
         lock_token       = gen_random_uuid(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         -- A tentativa é contada AQUI. Contá-la na falha faria um trabalhador
         -- que morre no meio nunca gastar tentativa, e o trabalho ficaria
         -- girando para sempre sem nunca chegar a dead-letter.
         attempt_count    = j.attempt_count + 1
    FROM (
      SELECT id FROM public.apex_jobs
       WHERE status = 'PENDING' AND run_after <= now()
       ORDER BY run_after, created_at
       LIMIT p_limit
       FOR UPDATE SKIP LOCKED
    ) due
   WHERE j.id = due.id
  RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_claim(text, integer, integer) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.apex_jobs_claim(text, integer, integer) IS
  'Seleção e posse no MESMO comando, com FOR UPDATE SKIP LOCKED. Dois '
  'trabalhadores concorrentes recebem conjuntos disjuntos. A tentativa é '
  'contada na reivindicação, não na falha.';

-- ------------------------------------------------------------
-- 5) Concluir e falhar — exigem o token corrente
-- ------------------------------------------------------------
CREATE FUNCTION public.apex_jobs_complete(p_job_id uuid, p_lock_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE hit integer;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Conclusão negada.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.apex_jobs
     SET status = 'COMPLETED', completed_at = now(),
         locked_at = NULL, locked_by = NULL, lock_token = NULL, lease_expires_at = NULL,
         last_error_code = NULL, last_error_safe = NULL
   WHERE id = p_job_id AND status = 'PROCESSING' AND lock_token = p_lock_token;
  GET DIAGNOSTICS hit = ROW_COUNT;
  -- `false` e não exceção: o trabalhador que perdeu a concessão precisa SABER
  -- que perdeu, registrar isso e seguir — não abortar a transação do lote
  -- inteiro por causa de um trabalho que outro já assumiu.
  RETURN hit = 1;
END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_complete(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Retentativa só para falha TRANSITÓRIA. Falha determinística — payload
-- inválido, tipo desconhecido, inquilino cruzado, invariante de negócio — não
-- melhora por ser repetida: repetir só produz o mesmo erro cinco vezes e
-- adia a visibilidade.
CREATE FUNCTION public.apex_jobs_fail(
  p_job_id         uuid,
  p_lock_token     uuid,
  p_error_code     text,
  p_error_safe     text,
  p_retryable      boolean,
  p_backoff_base_seconds integer DEFAULT 30,
  p_backoff_cap_seconds  integer DEFAULT 3600
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE j public.apex_jobs%ROWTYPE; delay_seconds double precision; next_status text;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Registro de falha negado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO j FROM public.apex_jobs
   WHERE id = p_job_id AND status = 'PROCESSING' AND lock_token = p_lock_token
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'STALE'; END IF;

  IF p_retryable AND j.attempt_count < j.max_attempts THEN
    -- Recuo exponencial limitado, com tremor: sem o tremor, um lote inteiro
    -- que falhou junto volta junto e reproduz a mesma sobrecarga.
    delay_seconds := least(
      p_backoff_base_seconds * power(2, greatest(j.attempt_count - 1, 0)),
      p_backoff_cap_seconds);
    delay_seconds := delay_seconds * (0.8 + random() * 0.4);
    next_status := 'PENDING';
    UPDATE public.apex_jobs
       SET status = 'PENDING',
           run_after = now() + make_interval(secs => delay_seconds),
           locked_at = NULL, locked_by = NULL, lock_token = NULL, lease_expires_at = NULL,
           last_error_code = p_error_code, last_error_safe = left(p_error_safe, 2000)
     WHERE id = p_job_id;
  ELSE
    next_status := 'DEAD_LETTER';
    UPDATE public.apex_jobs
       SET status = 'DEAD_LETTER', completed_at = now(),
           locked_at = NULL, locked_by = NULL, lock_token = NULL, lease_expires_at = NULL,
           last_error_code = p_error_code, last_error_safe = left(p_error_safe, 2000)
     WHERE id = p_job_id;
  END IF;
  RETURN next_status;
END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_fail(uuid, uuid, text, text, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6) O ceifador
-- ------------------------------------------------------------
-- Trabalho PROCESSING com concessão vencida foi abandonado: o processo que o
-- tinha morreu, foi reciclado pela hospedagem ou perdeu a rede. Sem o ceifador
-- ele ficaria PROCESSING para sempre — invisível como pendente e nunca feito.
--
-- Três cuidados: não roubar concessão viva; INVALIDAR o token antigo (é isso
-- que faz o trabalhador zumbi ser recusado ao acordar); e não mexer na
-- contagem de tentativas, que já foi gasta na reivindicação.
CREATE FUNCTION public.apex_jobs_reap(
  p_limit integer DEFAULT 100,
  p_backoff_seconds integer DEFAULT 60
) RETURNS TABLE (released integer, dead_lettered integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Ceifa negada.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH expired AS (
    SELECT id, attempt_count, max_attempts
      FROM public.apex_jobs
     WHERE status = 'PROCESSING' AND lease_expires_at < now()
     ORDER BY lease_expires_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE public.apex_jobs j
       SET status = CASE WHEN e.attempt_count < e.max_attempts THEN 'PENDING' ELSE 'DEAD_LETTER' END,
           run_after = CASE WHEN e.attempt_count < e.max_attempts
                            THEN now() + make_interval(secs => p_backoff_seconds)
                            ELSE j.run_after END,
           completed_at = CASE WHEN e.attempt_count < e.max_attempts THEN NULL ELSE now() END,
           locked_at = NULL, locked_by = NULL,
           -- Invalida o token: o trabalhador antigo não conclui mais nada.
           lock_token = NULL, lease_expires_at = NULL,
           last_error_code = 'lease_expired',
           last_error_safe = 'A concessão expirou sem conclusão; o trabalho foi devolvido à fila.'
      FROM expired e
     WHERE j.id = e.id
    RETURNING j.status
  )
  SELECT count(*) FILTER (WHERE status = 'PENDING')::integer,
         count(*) FILTER (WHERE status = 'DEAD_LETTER')::integer
    FROM updated;
END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_reap(integer, integer) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7) Provedores dinâmicos de rota
-- ------------------------------------------------------------
-- O núcleo do trabalhador é genérico e não conhece Contratos. Um domínio que
-- precise rotear por CONFIGURAÇÃO (e não por tipo fixo) registra aqui uma
-- função que, dado um evento, devolve os tipos de trabalho que ele causa.
--
-- O nome da função vem desta tabela — escrita por migration, revogada de todo
-- papel de navegador — e nunca de payload. Executar código nomeado por dado
-- não confiável seria uma porta, não uma extensão.
CREATE TABLE public.apex_dynamic_route_providers (
  provider_function text PRIMARY KEY,
  owner_domain      text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- CONTRATO DO PROVEDOR
--
--   f(p_event_id uuid) RETURNS TABLE (job_type text, max_attempts integer)
--
--   · uma linha por trabalho que o evento causa;
--   · nenhuma linha quando o domínio não escuta este fato;
--   · uma linha com `job_type IS NULL` quando o domínio escuta este TIPO de
--     fato em OUTRA versão de schema.
--
-- A terceira forma existe porque "ninguém escuta" e "o consumidor ficou para
-- trás de uma mudança de schema" são situações diferentes, e tratá-las igual
-- esconderia a segunda. O núcleo não precisa saber de que domínio veio: precisa
-- saber que houve conflito de versão.
--
-- O nome tem de resolver para uma função REAL com a assinatura esperada, na
-- hora do registro. Sem isto, um erro de digitação numa migration só
-- apareceria dez minutos depois, dentro do trabalhador, como falha de
-- roteamento de todo evento.
CREATE FUNCTION public.apex_validate_route_provider() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p regprocedure;
BEGIN
  BEGIN
    p := (NEW.provider_function || '(uuid)')::regprocedure;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Provedor de rota % não existe com assinatura (uuid).', NEW.provider_function
      USING ERRCODE = 'check_violation';
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apex_validate_route_provider() FROM PUBLIC;
CREATE TRIGGER adrp_validate BEFORE INSERT OR UPDATE ON public.apex_dynamic_route_providers
  FOR EACH ROW EXECUTE FUNCTION public.apex_validate_route_provider();

-- ------------------------------------------------------------
-- 8) Roteamento
-- ------------------------------------------------------------
-- A sequência segura é: resolver rotas -> inserir trabalhos -> marcar roteado.
-- Nunca o inverso. Marcar antes deixaria um evento com aparência de tratado e
-- sem trabalho nenhum a mostrar por isso.
--
-- Tudo roda numa transação só, de modo que "inseriu trabalho mas não marcou"
-- não pode COMETER. Se a transação for perdida antes do COMMIT, o evento
-- continua PENDING e será roteado de novo — e a unicidade de
-- (organização, tipo, chave) garante que a segunda passada não duplique nada.
CREATE FUNCTION public.apex_route_pending_events(p_limit integer DEFAULT 100)
RETURNS TABLE (events_routed integer, jobs_created integer, events_failed integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  ev       public.domain_events%ROWTYPE;
  r        record;
  prov     record;
  n_routes integer;
  n_events integer := 0;
  n_jobs   integer := 0;
  n_failed integer := 0;
  job_id   uuid;
  was_new  boolean;
  version_mismatch boolean;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Roteamento negado.' USING ERRCODE = '42501';
  END IF;

  FOR ev IN
    SELECT * FROM public.domain_events
     WHERE routing_state = 'PENDING'
     ORDER BY recorded_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    n_routes := 0;
    version_mismatch := false;

    -- ---- rotas estáticas ----
    FOR r IN
      SELECT job_type, max_attempts FROM public.apex_event_routes
       WHERE event_type = ev.event_type AND schema_version = ev.schema_version AND enabled
    LOOP
      SELECT public.apex_jobs_enqueue(
        ev.organization_id, r.job_type, 'event:' || ev.id::text,
        jsonb_build_object('event_id', ev.id, 'event_type', ev.event_type,
                           'schema_version', ev.schema_version),
        1, now(), r.max_attempts, ev.id, ev.correlation_id) INTO job_id;
      n_routes := n_routes + 1;
    END LOOP;

    -- ---- rotas dinâmicas, por provedor registrado ----
    FOR prov IN
      SELECT provider_function FROM public.apex_dynamic_route_providers
       WHERE enabled ORDER BY provider_function
    LOOP
      FOR r IN EXECUTE format('SELECT job_type, max_attempts FROM %s($1)', prov.provider_function)
        USING ev.id
      LOOP
        IF r.job_type IS NULL THEN
          version_mismatch := true;
          CONTINUE;
        END IF;
        SELECT public.apex_jobs_enqueue(
          ev.organization_id, r.job_type, 'event:' || ev.id::text,
          jsonb_build_object('event_id', ev.id, 'event_type', ev.event_type,
                             'schema_version', ev.schema_version),
          1, now(), r.max_attempts, ev.id, ev.correlation_id) INTO job_id;
        n_routes := n_routes + 1;
      END LOOP;
    END LOOP;

    /*
      Zero consumidores tem DOIS significados, e confundi-los é como um evento
      se perde em silêncio:

        · ninguém escuta este tipo de fato        -> ROUTED com route_count = 0
        · alguém escuta OUTRA VERSÃO deste fato   -> FAILED, visível

      O segundo caso é um consumidor que ficou para trás de uma mudança de
      schema. Finalizá-lo como "sem consumidor" o esconderia exatamente de quem
      precisa vê-lo.
    */
    IF n_routes = 0 AND NOT version_mismatch THEN
      SELECT EXISTS (
        SELECT 1 FROM public.apex_event_routes
         WHERE event_type = ev.event_type AND enabled AND schema_version <> ev.schema_version
      ) INTO version_mismatch;
    END IF;

    IF version_mismatch AND n_routes = 0 THEN
      UPDATE public.domain_events
         SET routing_state = 'FAILED', route_count = 0,
             routing_error_code = 'unsupported_schema_version',
             routing_error_safe = 'Há consumidor para este tipo de fato em OUTRA versão de schema. '
                                  'O evento não foi descartado: ele aguarda decisão explícita.'
       WHERE id = ev.id;
      n_failed := n_failed + 1;
    ELSE
      UPDATE public.domain_events
         SET routing_state = 'ROUTED', routed_at = now(), route_count = n_routes,
             routing_error_code = NULL, routing_error_safe = NULL
       WHERE id = ev.id;
      n_events := n_events + 1;
      n_jobs := n_jobs + n_routes;
    END IF;
  END LOOP;

  RETURN QUERY SELECT n_events, n_jobs, n_failed;
END $$;
REVOKE ALL ON FUNCTION public.apex_route_pending_events(integer) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 9) Saúde operacional
-- ------------------------------------------------------------
-- Observabilidade de infraestrutura, não a Torre de Controle da Fase 9.
-- Contadores, nunca payload.
CREATE FUNCTION public.apex_jobs_health() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp STABLE AS $$
  SELECT jsonb_build_object(
    'due_pending_jobs',   (SELECT count(*) FROM public.apex_jobs WHERE status='PENDING' AND run_after <= now()),
    'pending_jobs',       (SELECT count(*) FROM public.apex_jobs WHERE status='PENDING'),
    'oldest_pending_age_seconds',
      (SELECT COALESCE(EXTRACT(epoch FROM now() - min(created_at))::bigint, 0)
         FROM public.apex_jobs WHERE status='PENDING' AND run_after <= now()),
    'processing_jobs',    (SELECT count(*) FROM public.apex_jobs WHERE status='PROCESSING'),
    'expired_leases',     (SELECT count(*) FROM public.apex_jobs WHERE status='PROCESSING' AND lease_expires_at < now()),
    'dead_letter_jobs',   (SELECT count(*) FROM public.apex_jobs WHERE status='DEAD_LETTER'),
    'unrouted_events',    (SELECT count(*) FROM public.domain_events WHERE routing_state='PENDING'),
    'failed_routing_events', (SELECT count(*) FROM public.domain_events WHERE routing_state='FAILED'),
    'oldest_unrouted_age_seconds',
      (SELECT COALESCE(EXTRACT(epoch FROM now() - min(recorded_at))::bigint, 0)
         FROM public.domain_events WHERE routing_state='PENDING'),
    'total_events',       (SELECT count(*) FROM public.domain_events)
  )
$$;
REVOKE ALL ON FUNCTION public.apex_jobs_health() FROM PUBLIC, anon, authenticated;

-- Inspeção de carta morta: o suficiente para decidir, sem devolver payload.
CREATE FUNCTION public.apex_jobs_dead_letters(p_limit integer DEFAULT 50)
RETURNS TABLE (
  id uuid, organization_id uuid, job_type text, attempt_count integer,
  max_attempts integer, last_error_code text, last_error_safe text,
  event_id uuid, correlation_id uuid, age_seconds bigint)
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp STABLE AS $$
  SELECT j.id, j.organization_id, j.job_type, j.attempt_count, j.max_attempts,
         j.last_error_code, j.last_error_safe, j.event_id, j.correlation_id,
         EXTRACT(epoch FROM now() - j.completed_at)::bigint
    FROM public.apex_jobs j
   WHERE j.status = 'DEAD_LETTER'
   ORDER BY j.completed_at DESC
   LIMIT greatest(1, least(p_limit, 500))
$$;
REVOKE ALL ON FUNCTION public.apex_jobs_dead_letters(integer) FROM PUBLIC, anon, authenticated;

-- Reprocessamento manual. Devolve à fila SEM apagar a falha anterior: a
-- história do erro é o que explica por que alguém reprocessou.
CREATE FUNCTION public.apex_jobs_replay(p_job_id uuid, p_extra_attempts integer DEFAULT 3)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE hit integer;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Reprocessamento negado.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.apex_jobs
     SET status = 'PENDING', run_after = now(), completed_at = NULL,
         max_attempts = attempt_count + greatest(1, p_extra_attempts)
   WHERE id = p_job_id AND status = 'DEAD_LETTER';
  GET DIAGNOSTICS hit = ROW_COUNT;
  RETURN hit = 1;
END $$;
REVOKE ALL ON FUNCTION public.apex_jobs_replay(uuid, integer) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 10) Postura de acesso
-- ------------------------------------------------------------
ALTER TABLE public.apex_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apex_dynamic_route_providers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.apex_jobs FROM anon, authenticated;
REVOKE ALL ON public.apex_dynamic_route_providers FROM anon, authenticated;

COMMIT;
