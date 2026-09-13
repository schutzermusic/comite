-- ============================================================================
-- Migration: 168_apex_execution_provenance_and_recovery
--
-- PLANO DE RECUPERAÇÃO DURÁVEL DAS EXECUÇÕES DE IA DE CONTRATOS
--
-- ─── O que acontece hoje quando a hospedagem mata a função ──────────────────
--
-- Três linhas ficam mentindo, cada uma na sua tabela:
--
--   apex_jobs                          PROCESSING, com concessão vencida
--   contract_ai_analyses               running, para sempre
--   contract_clause_extraction_requests RUNNING, para sempre
--
-- A ceifa (`apex_jobs_reap`) conserta a PRIMEIRA. As outras duas ficam como
-- estão — e a tela do produto lê justamente as outras duas. O resultado é uma
-- análise eternamente "analisando", que nenhum processo vai terminar, porque o
-- processo que a começou deixou de existir.
--
-- ─── Por que isto exigiu uma coluna nova ────────────────────────────────────
--
-- Para reconciliar, é preciso saber QUAL execução começou QUAL análise. Hoje
-- não há essa relação: dá para adivinhar por contrato, por documento ou pela
-- análise mais recente — e adivinhar, aqui, significa marcar como abortada uma
-- análise que outro trabalhador está escrevendo neste instante.
--
-- `contract_ai_analyses.execution_job_id` é a menor relação durável que torna a
-- reconciliação DETERMINÍSTICA. Não é redesenho: é uma coluna anulável, com a
-- mesma FK composta de inquilino que o resto do módulo já usa.
--
-- ─── ORDEM DE RELEASE — não é opcional ──────────────────────────────────────
--
--   1. aplicar ESTA migration
--   2. publicar o código novo
--   3. só então recuperar o trabalho legado
--
-- O código novo ESCREVE `execution_job_id` ao inserir em `contract_ai_analyses`.
-- Publicá-lo contra um banco sem esta coluna faz TODA leitura de contrato
-- falhar na primeira escrita — a análise nem chega a nascer. Não existe "deploy
-- primeiro, migra depois" aqui.
--
-- O contrário é seguro, e é por isso que esta migration é ADITIVA: a coluna é
-- anulável e nenhum `NOT NULL`, `DEFAULT` ou gatilho a exige. O código ANTIGO,
-- que insere sem mencioná-la, continua funcionando entre o passo 1 e o passo 2.
-- Essa é a janela que torna a ordem segura executável sem downtime.
--
-- ─── O que esta migration NÃO faz ───────────────────────────────────────────
--
-- Não toca em nenhuma linha de produção. Não repara, não enfileira, não
-- cancela nada. Ela cria a coluna, os índices e as FUNÇÕES; quem as chama, e
-- quando, é decisão da aplicação e do operador.
--
-- E não inventa vocabulário: a análise abortada vira `failed` — status que já
-- existe — com um motivo de MÁQUINA no `error_message`. Não vira "falha do
-- provedor", porque não se sabe se o provedor falhou; o que se sabe é que a
-- EXECUÇÃO terminou. Nenhuma resposta de modelo é fabricada, e nenhuma revisão
-- humana é fabricada.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) PROVENIÊNCIA: qual execução começou esta análise
-- ---------------------------------------------------------------------------
ALTER TABLE public.contract_ai_analyses
  ADD COLUMN IF NOT EXISTS execution_job_id uuid;

-- Coerência de inquilino ESTRUTURAL, como em `ccer_job_tenant`. `SET NULL` na
-- exclusão porque a análise é o FATO e o trabalho é o MEIO: perder o registro
-- de quem a executou não pode apagar a leitura que ela produziu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'caa_execution_job_tenant') THEN
    ALTER TABLE public.contract_ai_analyses
      ADD CONSTRAINT caa_execution_job_tenant
      FOREIGN KEY (organization_id, execution_job_id)
      REFERENCES public.apex_jobs (organization_id, id) ON DELETE SET NULL;
  END IF;
END $$;

-- A consulta da reconciliação é "análises ainda `running` desta execução".
CREATE INDEX IF NOT EXISTS caa_execution_job
  ON public.contract_ai_analyses (execution_job_id)
  WHERE execution_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS caa_running_executions
  ON public.contract_ai_analyses (execution_job_id)
  WHERE status = 'running' AND execution_job_id IS NOT NULL;

COMMENT ON COLUMN public.contract_ai_analyses.execution_job_id IS
  'A execução de apex_jobs que INICIOU esta análise. Existe para que a '
  'reconciliação de execuções abortadas seja determinística, e nunca por '
  'proximidade de horário ou "análise mais recente". Anulável: análises '
  'anteriores a esta migration não têm a relação, e análises criadas fora da '
  'fila legitimamente não têm execução.';

-- ---------------------------------------------------------------------------
-- 2) RECONCILIAÇÃO das execuções abortadas
-- ---------------------------------------------------------------------------
--
-- Chamada pelo trabalhador logo DEPOIS da ceifa, e não dentro dela: o núcleo do
-- Apex é genérico e não conhece Contratos (o mesmo motivo pelo qual o
-- roteamento dinâmico mora em `apex_dynamic_route_providers`). Separar as duas
-- também as torna independentes do sucesso uma da outra — esta função decide
-- pelo ESTADO DURÁVEL, e não pelo que a ceifa acabou de devolver, de modo que
-- uma passagem que morra entre as duas é reconciliada pela passagem seguinte.
--
-- "Nenhum trabalhador ativo ainda é dono" é uma afirmação, não um palpite:
--
--     o trabalho não está PROCESSING  OU  a concessão dele já venceu
--
-- Uma concessão VIVA é posse legítima, e uma execução longa e saudável fica
-- exatamente assim por minutos. Reconciliar debaixo dela marcaria como abortado
-- um trabalho que está escrevendo o resultado agora.
CREATE OR REPLACE FUNCTION public.contracts_reconcile_orphaned_executions(
  p_limit integer DEFAULT 100
) RETURNS TABLE (analyses_reconciled integer, requests_reconciled integer)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_analyses integer := 0;
  v_requests integer := 0;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Reconciliação negada.' USING ERRCODE = '42501';
  END IF;

  -- ── 2.1 · análises órfãs ────────────────────────────────────────────────
  WITH orphan AS (
    SELECT a.id, a.organization_id, j.id AS job_id, j.status AS job_status,
           j.attempt_count, j.max_attempts
      FROM public.contract_ai_analyses a
      JOIN public.apex_jobs j
        ON j.id = a.execution_job_id AND j.organization_id = a.organization_id
     WHERE a.status = 'running'
       AND (j.status <> 'PROCESSING' OR j.lease_expires_at IS NULL OR j.lease_expires_at < now())
     ORDER BY a.created_at
     LIMIT p_limit
     FOR UPDATE OF a SKIP LOCKED
  ), reconciled AS (
    UPDATE public.contract_ai_analyses a
       SET status = 'failed',
           completed_at = now(),
           /*
             Motivo de MÁQUINA, e só o que é DEMONSTRÁVEL.

             Não é "o modelo falhou": ninguém sabe se o modelo falhou, e afirmar
             isso mandaria quem investiga olhar para o provedor em vez de para a
             hospedagem.

             E também não é "nenhuma resposta chegou". Depois de o processo ser
             morto, isso é INCOGNOSCÍVEL: a resposta pode ter chegado inteira,
             ter sido consumida pelo stream e ter morrido antes da escrita — e
             nesse caso o custo do provedor já foi pago. Dizer o contrário
             esconderia gasto real.

             O único fato determinístico é o da APLICAÇÃO: ela não persistiu um
             resultado antes de a execução ser abandonada.
           */
           error_message = 'WORKER_EXECUTION_TERMINATED',
           extracted_data = a.extracted_data || jsonb_build_object(
             'reconciliation', jsonb_build_object(
               'reason', 'WORKER_EXECUTION_TERMINATED',
               'detail', 'A execução foi encerrada antes de concluir e persistir o resultado.',
               'execution_job_id', o.job_id,
               'job_status_at_reconciliation', o.job_status,
               'attempt_count', o.attempt_count,
               'max_attempts', o.max_attempts,
               'reconciled_at', to_jsonb(now()),
               /*
                 O que se afirma é o que se pode provar. Se o provedor respondeu
                 — e portanto se houve custo — é INCOGNOSCÍVEL depois de o
                 processo morrer: por isso `unknown`, e não `false`.
                 O que É determinístico é que nada foi persistido.
               */
               'provider_response_state', 'unknown',
               'provider_response_persisted', false,
               -- Nenhum humano agiu. Registrar o contrário seria fabricar revisão.
               'human_action', false))
      FROM orphan o
     WHERE a.id = o.id
    RETURNING a.id
  )
  SELECT count(*)::integer INTO v_analyses FROM reconciled;

  -- ── 2.2 · pedidos duráveis órfãos ───────────────────────────────────────
  --
  -- O destino do PEDIDO segue o destino do TRABALHO, e não o da análise: se a
  -- ceifa devolveu o trabalho para PENDING, ele vai rodar de novo e o pedido
  -- volta a QUEUED; se o trabalho morreu, o pedido morre com ele. Fechar como
  -- FAILED um pedido cujo trabalho ainda vai rodar faria a tela dizer "falhou"
  -- enquanto a fila ainda trabalha.
  WITH orphan AS (
    SELECT r.id, j.status AS job_status
      FROM public.contract_clause_extraction_requests r
      JOIN public.apex_jobs j
        ON j.id = r.job_id AND j.organization_id = r.organization_id
     WHERE r.status = 'RUNNING'
       AND j.status IN ('PENDING','DEAD_LETTER','CANCELLED')
     ORDER BY r.requested_at
     LIMIT p_limit
     FOR UPDATE OF r SKIP LOCKED
  ), reconciled AS (
    UPDATE public.contract_clause_extraction_requests r
       SET status = CASE WHEN o.job_status = 'PENDING' THEN 'QUEUED' ELSE 'FAILED' END,
           -- `ccer_terminal_coherent`: completed_at existe exatamente nos
           -- estados terminais.
           completed_at = CASE WHEN o.job_status = 'PENDING' THEN NULL ELSE now() END,
           error_code = 'worker_execution_terminated',
           error_safe = 'A execução foi encerrada antes de concluir e persistir o resultado.'
      FROM orphan o
     WHERE r.id = o.id
    RETURNING r.id
  )
  SELECT count(*)::integer INTO v_requests FROM reconciled;

  RETURN QUERY SELECT v_analyses, v_requests;
END $$;
REVOKE ALL ON FUNCTION public.contracts_reconcile_orphaned_executions(integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contracts_reconcile_orphaned_executions(integer) IS
  'Fecha as linhas de domínio que uma execução morta deixou `running`. '
  'Determinística por execution_job_id — nunca por horário, contrato ou '
  '"análise mais recente". Idempotente: a segunda passagem não encontra mais '
  'nada `running` para reconciliar.';

-- ---------------------------------------------------------------------------
-- 3) RECUPERAÇÃO do trabalho COMBINADO legado
-- ---------------------------------------------------------------------------
--
-- ─── O problema específico ──────────────────────────────────────────────────
--
-- Existe em produção um `contracts.clause_extraction.execute` anterior à
-- divisão das fases. Ele executava extração E operacionalização em sequência. A
-- extração dele TERMINOU e persistiu cláusulas reais; a operacionalização foi
-- morta pela hospedagem no meio.
--
-- Uma retentativa normal desse trabalho rodaria o extrator OUTRA VEZ: uma
-- chamada longa e cara ao provedor para reproduzir um resultado que já está no
-- banco. É a coisa errada a fazer, e ela acontece sozinha na próxima ceifa.
--
-- ─── O invariante ───────────────────────────────────────────────────────────
--
--   SE existe prova durável de que a extração concluiu,
--   ENTÃO a recuperação enfileira a operacionalização dedicada
--        SEM rodar a extração de novo.
--
-- "Prova durável" é uma ANÁLISE DE EXTRAÇÃO CONCLUÍDA — `status='completed'`,
-- `kind='clause_extraction'`, do mesmo contrato e documento. Não é "existem
-- cláusulas": cláusulas podem vir de uma análise anterior, de importação ou de
-- digitação humana, e nenhuma dessas diz que ESTA execução terminou a leitura.
--
-- ─── A ponte legada, e por que ela é ESTREITA DOS DOIS LADOS ────────────────
--
-- Daqui para a frente a prova é exata: `execution_job_id = j.id`. Para as linhas
-- anteriores a esta migration a coluna é nula, e é preciso uma JANELA — mas uma
-- janela só é prova quando tem os dois lados.
--
-- Uma versão anterior desta função usava apenas `a.created_at >= j.locked_at`.
-- Isso tem dois defeitos, e os dois são fatais:
--
--   1. SEM TETO. Qualquer extração posterior e INDEPENDENTE do mesmo documento
--      cairia na janela, e o `ORDER BY completed_at DESC LIMIT 1` a adotaria
--      como prova desta execução. Seria a heurística de "análise mais recente"
--      entrando pela porta dos fundos.
--
--   2. ÂNCORA VOLÁTIL. A ceifa ZERA `locked_at`. Um trabalho já ceifado — que é
--      exatamente o estado em que um órfão passa a maior parte do tempo — perde
--      a âncora, e a ponte deixa de resolver para sempre.
--
-- A janela correta usa duas marcas DURÁVEIS, que nenhuma ceifa apaga:
--
--   piso  = `j.created_at`     — a extração do trabalho não pode ser anterior
--                                ao próprio trabalho;
--   teto  = o instante em que a operacionalização órfã COMEÇOU — porque, na
--           forma combinada legada, a extração necessariamente terminou ANTES
--           de a operacionalização começar.
--
-- Sem essa análise de operacionalização órfã não existe teto determinístico, e
-- a função RECUSA em vez de inventar um. Falhar fechado.
--
-- E não se escolhe "a melhor" candidata: CONTA-SE. Zero é `extraction_not_proven`,
-- mais de uma é `extraction_ambiguous`, e as duas escrevem nada. Só um conjunto
-- de tamanho exatamente um é prova — porque só aí a identificação é inequívoca.
--
-- A ponte NÃO se aplica a análises que já têm proveniência: quando
-- `execution_job_id` está preenchido e aponta para outra execução, a análise
-- não conta como prova.
--
-- ─── Dry-run por padrão ─────────────────────────────────────────────────────
--
-- `p_dry_run` é `true` por omissão. Uma função que repara produção por
-- descuido de argumento é uma função que vai reparar produção por descuido de
-- argumento. Quem quer executar diz isso por escrito.
CREATE OR REPLACE FUNCTION public.contracts_recover_legacy_extraction_job(
  p_job_id                      uuid,
  p_operationalization_version  text,
  p_job_max_attempts            integer DEFAULT 1,
  p_dry_run                     boolean DEFAULT true,
  /*
    As análises órfãs que quem autoriza LEU no plano e aprovou, uma a uma.

    Existe porque a versão anterior fechava, por predicado, TODA análise
    `running` do contrato/documento criada depois do trabalho legado. Esse
    predicado não distingue um órfão desta execução de uma análise legítima que
    outra pessoa começou cinco minutos atrás — e fechá-la como
    WORKER_EXECUTION_TERMINATED mataria trabalho vivo, em silêncio.

    Para linhas pré-168 não existe proveniência que desempate. Então não se
    adivinha: o dry-run ENUMERA as candidatas com id, tipo e horários, e a
    execução só toca exatamente os ids que voltarem aqui. NULL significa "não
    aprovei nenhuma", e nenhuma é fechada.
  */
  p_approved_orphan_analysis_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  j              public.apex_jobs%ROWTYPE;
  v_contract     uuid;
  v_document     uuid;
  v_request      public.contract_clause_extraction_requests%ROWTYPE;
  v_extraction   public.contract_ai_analyses%ROWTYPE;
  v_orphan_ops   public.contract_ai_analyses%ROWTYPE;
  v_upper_bound  timestamptz;
  v_candidates   integer;
  v_orphan_rows  jsonb := '[]'::jsonb;
  v_orphan_ids   uuid[] := ARRAY[]::uuid[];
  v_approved     uuid[] := COALESCE(p_approved_orphan_analysis_ids, ARRAY[]::uuid[]);
  v_unknown      uuid[];
  v_orphans_closed integer := 0;
  v_idempotency  text;
  v_existing_job uuid;
  v_enqueued     uuid;
  v_structured   integer;
  v_rejected     integer;
  v_mutations    jsonb := '[]'::jsonb;
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    RAISE EXCEPTION 'Recuperação negada.' USING ERRCODE = '42501';
  END IF;
  IF p_operationalization_version IS NULL OR btrim(p_operationalization_version) = '' THEN
    RAISE EXCEPTION 'A versão de operacionalização é obrigatória na chave de idempotência.'
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    `FOR UPDATE` e não `SKIP LOCKED`: a ceifa usa SKIP LOCKED, então enquanto
    esta transação segura a linha nenhum ceifador a devolve para PENDING debaixo
    da recuperação. As duas não podem agir sobre o mesmo trabalho ao mesmo tempo.
  */
  SELECT * INTO j FROM public.apex_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recoverable', false, 'reason', 'job_not_found',
                              'dry_run', p_dry_run);
  END IF;

  IF j.job_type <> 'contracts.clause_extraction.execute' THEN
    RETURN jsonb_build_object('recoverable', false, 'reason', 'not_a_legacy_extraction_job',
                              'job_type', j.job_type, 'dry_run', p_dry_run);
  END IF;

  -- Concessão VIVA é posse legítima: há um trabalhador executando agora.
  IF j.status = 'PROCESSING' AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at > now() THEN
    RETURN jsonb_build_object('recoverable', false, 'reason', 'lease_still_live',
                              'lease_expires_at', to_jsonb(j.lease_expires_at),
                              'dry_run', p_dry_run);
  END IF;

  -- Trabalho concluído não se ressuscita. Ele já teve o seu desfecho.
  IF j.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('recoverable', false, 'reason', 'job_already_completed',
                              'dry_run', p_dry_run);
  END IF;

  /*
    Já recuperado. Sai AQUI, e não mais adiante, porque a própria recuperação
    fecha a operacionalização órfã — e sem ela a janela de prova perde o teto.
    Uma segunda chamada cairia em `upper_boundary_unavailable`, que é seguro (não
    escreve nada) mas MENTE sobre o motivo: sugere um defeito de dados onde o que
    houve foi sucesso. Idempotência tem de devolver a verdade, não só o silêncio.
  */
  IF j.status = 'CANCELLED' AND j.last_error_code = 'recovered_without_extraction_rerun' THEN
    SELECT id INTO v_existing_job FROM public.apex_jobs
     WHERE organization_id = j.organization_id
       AND job_type = 'contracts.contract_operationalization.execute'
       AND idempotency_key = 'contract-operationalization:'
         || (j.payload->>'contract_id') || ':' || (j.payload->>'document_id') || ':'
         || (j.payload->>'request_id') || ':' || p_operationalization_version;
    RETURN jsonb_build_object('recoverable', false, 'reason', 'job_already_recovered',
                              'job_id', j.id,
                              'operationalization_job_id', v_existing_job,
                              'clause_extraction_rerun', false,
                              'dry_run', p_dry_run);
  END IF;

  v_contract := (j.payload->>'contract_id')::uuid;
  v_document := (j.payload->>'document_id')::uuid;
  IF v_contract IS NULL OR v_document IS NULL THEN
    RETURN jsonb_build_object('recoverable', false, 'reason', 'payload_without_identity',
                              'dry_run', p_dry_run);
  END IF;

  SELECT * INTO v_request FROM public.contract_clause_extraction_requests
   WHERE id = (j.payload->>'request_id')::uuid AND organization_id = j.organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recoverable', false, 'reason', 'request_not_found',
                              'dry_run', p_dry_run);
  END IF;

  -- ── caminho EXATO: proveniência de execução (linhas pós-168) ────────────
  SELECT * INTO v_extraction FROM public.contract_ai_analyses a
   WHERE a.organization_id = j.organization_id
     AND a.execution_job_id = j.id
     AND a.contract_id = v_contract
     AND a.document_id = v_document
     AND a.status = 'completed'
     AND a.extracted_data->>'kind' = 'clause_extraction';

  -- ── a operacionalização órfã: é ela quem dá o TETO da janela legada ─────
  SELECT * INTO v_orphan_ops FROM public.contract_ai_analyses a
   WHERE a.organization_id = j.organization_id
     AND a.contract_id = v_contract
     AND a.document_id = v_document
     AND a.status = 'running'
     AND a.extracted_data->>'kind' = 'contract_operationalization'
     AND (a.execution_job_id = j.id
          OR (a.execution_job_id IS NULL AND a.created_at >= j.created_at))
   ORDER BY a.created_at
   LIMIT 1;
  v_upper_bound := COALESCE(v_orphan_ops.started_at, v_orphan_ops.created_at);

  IF v_extraction.id IS NULL THEN
    -- ── ponte legada: janela LIMITADA DOS DOIS LADOS, e contagem ─────────
    IF v_upper_bound IS NULL THEN
      /*
        Sem a operacionalização órfã não há teto determinístico para a janela, e
        um piso sozinho adotaria como prova qualquer extração posterior e
        independente do mesmo documento. Recusar é a resposta correta.
      */
      RETURN jsonb_build_object('recoverable', false, 'reason', 'upper_boundary_unavailable',
                                'job_id', j.id, 'contract_id', v_contract,
                                'document_id', v_document, 'dry_run', p_dry_run);
    END IF;

    SELECT count(*)::integer INTO v_candidates FROM public.contract_ai_analyses a
     WHERE a.organization_id = j.organization_id
       AND a.contract_id = v_contract
       AND a.document_id = v_document
       AND a.status = 'completed'
       AND a.extracted_data->>'kind' = 'clause_extraction'
       AND a.execution_job_id IS NULL
       AND a.created_at >= j.created_at
       AND a.completed_at IS NOT NULL
       AND a.completed_at <= v_upper_bound;

    IF v_candidates = 0 THEN
      /*
        Sem prova, a recuperação NÃO acontece. O trabalho segue o caminho normal
        da fila e roda a extração — que é o certo, porque não se sabe se ela
        terminou. Inferir conclusão da mera existência de cláusulas seria pular
        uma leitura que talvez nunca tenha sido feita.
      */
      RETURN jsonb_build_object('recoverable', false, 'reason', 'extraction_not_proven',
                                'job_id', j.id, 'contract_id', v_contract,
                                'document_id', v_document,
                                'candidates', 0, 'dry_run', p_dry_run);
    END IF;
    IF v_candidates > 1 THEN
      /*
        Mais de uma extração concluída na janela: não dá para dizer QUAL é a
        desta execução. Escolher "a mais recente" seria exatamente a heurística
        que esta função existe para não usar.
      */
      RETURN jsonb_build_object('recoverable', false, 'reason', 'extraction_ambiguous',
                                'job_id', j.id, 'contract_id', v_contract,
                                'document_id', v_document,
                                'candidates', v_candidates, 'dry_run', p_dry_run);
    END IF;

    SELECT * INTO v_extraction FROM public.contract_ai_analyses a
     WHERE a.organization_id = j.organization_id
       AND a.contract_id = v_contract
       AND a.document_id = v_document
       AND a.status = 'completed'
       AND a.extracted_data->>'kind' = 'clause_extraction'
       AND a.execution_job_id IS NULL
       AND a.created_at >= j.created_at
       AND a.completed_at IS NOT NULL
       AND a.completed_at <= v_upper_bound;
  ELSE
    v_candidates := 1;
  END IF;

  v_structured := NULLIF(v_extraction.extracted_data->>'structured', '')::integer;
  v_rejected := NULLIF(v_extraction.extracted_data->>'rejected_without_evidence', '')::integer;

  -- ── a chave determinística, idêntica à que o handler produz ─────────────
  v_idempotency := 'contract-operationalization:' || v_contract::text || ':'
                || v_document::text || ':' || v_request.id::text || ':'
                || p_operationalization_version;
  SELECT id INTO v_existing_job FROM public.apex_jobs
   WHERE organization_id = j.organization_id
     AND job_type = 'contracts.contract_operationalization.execute'
     AND idempotency_key = v_idempotency;

  -- ── o PLANO ─────────────────────────────────────────────────────────────
  v_mutations := jsonb_build_array(
    jsonb_build_object(
      'table', 'apex_jobs', 'id', j.id,
      'from', jsonb_build_object('status', j.status, 'attempt_count', j.attempt_count),
      'to', jsonb_build_object('status', 'CANCELLED',
                               'last_error_code', 'recovered_without_extraction_rerun'),
      'why', 'A extração deste trabalho já concluiu e está persistida; deixá-lo '
          || 'retornável faria o extrator rodar de novo sobre o mesmo documento.'),
    jsonb_build_object(
      'table', 'contract_clause_extraction_requests', 'id', v_request.id,
      'from', jsonb_build_object('status', v_request.status),
      'to', jsonb_build_object('status', 'COMPLETED', 'analysis_id', v_extraction.id,
                               'proposed_count', v_structured, 'rejected_count', v_rejected),
      'why', 'O estado durável passa a refletir a evidência persistida da extração.'),
    jsonb_build_object(
      'table', 'apex_jobs', 'id', COALESCE(v_existing_job, '00000000-0000-0000-0000-000000000000'::uuid),
      'from', jsonb_build_object('status', CASE WHEN v_existing_job IS NULL THEN 'ABSENT' ELSE 'EXISTS' END),
      'to', jsonb_build_object('job_type', 'contracts.contract_operationalization.execute',
                               'idempotency_key', v_idempotency,
                               'max_attempts', p_job_max_attempts),
      'why', CASE WHEN v_existing_job IS NULL
                  THEN 'Enfileira exatamente uma operacionalização dedicada.'
                  ELSE 'Já existe: a chave determinística devolve o mesmo trabalho, sem duplicar.' END));

  /*
    As análises ainda `running` são ENUMERADAS, nunca fechadas por predicado.

    O trabalho combinado legado pode ter sido tentado mais de uma vez, e cada
    tentativa morta deixou a sua própria linha `running`; fechar só uma
    devolveria uma tela que continua dizendo "analisando". Mas o predicado que
    encontra essas linhas — mesmo contrato, mesmo documento, criada depois do
    trabalho — também encontra uma análise LEGÍTIMA que alguém começou agora.
    Para linhas pré-168 não há proveniência que separe as duas.

    Então o plano LISTA cada candidata com id, tipo e horários, e quem autoriza
    decide olhando. A execução fecha exatamente os ids aprovados, e mais nenhum.
  */
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'kind', a.extracted_data->>'kind',
           'status', a.status,
           'created_at', to_jsonb(a.created_at),
           'started_at', to_jsonb(a.started_at)) ORDER BY a.created_at), '[]'::jsonb),
         COALESCE(array_agg(a.id ORDER BY a.created_at), ARRAY[]::uuid[])
    INTO v_orphan_rows, v_orphan_ids
    FROM public.contract_ai_analyses a
   WHERE a.organization_id = j.organization_id
     AND a.contract_id = v_contract
     AND a.document_id = v_document
     AND a.status = 'running'
     AND a.execution_job_id IS NULL
     AND a.created_at >= j.created_at;

  /*
    Um id aprovado que NÃO está entre as candidatas aborta tudo. Pode ser um
    engano de digitação, um plano copiado de outro trabalho, ou uma linha que
    mudou de estado entre a leitura e a execução — e nenhuma dessas hipóteses
    justifica escrever. Falhar fechado.
  */
  v_unknown := ARRAY(SELECT x FROM unnest(v_approved) x WHERE NOT (x = ANY(v_orphan_ids)));
  IF array_length(v_unknown, 1) > 0 THEN
    RETURN jsonb_build_object('recoverable', false, 'reason', 'orphan_set_mismatch',
                              'job_id', j.id,
                              'approved_not_eligible', to_jsonb(v_unknown),
                              'eligible_orphan_analyses', v_orphan_rows,
                              'dry_run', p_dry_run);
  END IF;

  v_orphans_closed := COALESCE(array_length(v_approved, 1), 0);

  IF jsonb_array_length(v_orphan_rows) > 0 THEN
    v_mutations := v_mutations || jsonb_build_array(jsonb_build_object(
      'table', 'contract_ai_analyses', 'action', 'CLOSE_APPROVED_ORPHANS',
      'eligible', v_orphan_rows,
      'approved', to_jsonb(v_approved),
      'approved_count', v_orphans_closed,
      'from', jsonb_build_object('status', 'running'),
      'to', jsonb_build_object('status', 'failed', 'error_message', 'WORKER_EXECUTION_TERMINATED'),
      'why', 'A execução foi encerrada antes de concluir e persistir o resultado. '
          || 'Se o provedor respondeu é incognoscível; o que se sabe é que nada foi persistido. '
          || 'Só os ids aprovados são fechados; os demais permanecem como estão.'));
  END IF;

  -- As cláusulas e a análise de extração aparecem no plano como PRESERVADAS,
  -- explicitamente: o que a recuperação não toca também é uma decisão.
  v_mutations := v_mutations || jsonb_build_array(
    jsonb_build_object('table', 'contract_clauses', 'action', 'PRESERVE',
      'why', 'A leitura já aconteceu; recuperação não reescreve interpretação jurídica.'),
    jsonb_build_object('table', 'contract_ai_analyses', 'id', v_extraction.id,
      'action', 'PRESERVE',
      'why', 'É a prova durável da extração concluída, e a proveniência do resultado.'));

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'recoverable', true, 'dry_run', true, 'executed', false,
      'job_id', j.id, 'request_id', v_request.id, 'contract_id', v_contract,
      'document_id', v_document,
      'extraction_analysis_id', v_extraction.id,
      'extraction_completed_at', to_jsonb(v_extraction.completed_at),
      'orphan_operationalization_analysis_id', v_orphan_ops.id,
      -- A janela inteira, por escrito: quem autoriza a execução vê em que
      -- limites a prova foi procurada, e quantas candidatas havia.
      'proof_window_lower', to_jsonb(j.created_at),
      'proof_window_upper', to_jsonb(v_upper_bound),
      'candidates', v_candidates,
      -- As candidatas, UMA A UMA: é isto que quem autoriza lê antes de aprovar.
      'eligible_orphan_analyses', v_orphan_rows,
      'approved_orphan_analysis_ids', to_jsonb(v_approved),
      'orphan_analyses_to_close', v_orphans_closed,
      'operationalization_idempotency_key', v_idempotency,
      'operationalization_job_existing', v_existing_job,
      'clause_extraction_would_rerun', false,
      'mutations', v_mutations);
  END IF;

  -- ── execução ────────────────────────────────────────────────────────────
  UPDATE public.apex_jobs
     SET status = 'CANCELLED', completed_at = now(),
         locked_at = NULL, locked_by = NULL, lock_token = NULL, lease_expires_at = NULL,
         last_error_code = 'recovered_without_extraction_rerun',
         last_error_safe = 'Trabalho combinado legado encerrado: a extração já estava persistida '
                        || 'e a operacionalização foi enfileirada como trabalho dedicado.'
   WHERE id = j.id;

  /*
    Fecha SOMENTE os ids aprovados, e cada um deles só se AINDA for exatamente o
    que o plano descreveu: mesma organização, mesmo contrato, mesmo documento,
    ainda `running`, ainda sem proveniência.

    Essa repetição do predicado é a checagem otimista de concorrência. Entre a
    leitura do plano e esta escrita cabe outro processo: a análise pode ter
    concluído sozinha, ou ganhado proveniência. Se qualquer id aprovado deixou
    de casar, a contagem afetada não bate com a aprovada e a transação INTEIRA é
    abortada — sem trabalho cancelado, sem pedido fechado, sem enfileiramento.
  */
  IF array_length(v_approved, 1) > 0 THEN
    WITH closed AS (
      UPDATE public.contract_ai_analyses a
         SET status = 'failed', completed_at = now(),
             error_message = 'WORKER_EXECUTION_TERMINATED',
             extracted_data = a.extracted_data || jsonb_build_object(
               'reconciliation', jsonb_build_object(
                 'reason', 'WORKER_EXECUTION_TERMINATED',
                 'detail', 'A execução foi encerrada antes de concluir e persistir o resultado.',
                 'execution_job_id', j.id,
                 'legacy_recovery', true,
                 'reconciled_at', to_jsonb(now()),
                 -- Incognoscível depois de o processo morrer; nada é inventado,
                 -- e nenhum uso/token é fabricado.
                 'provider_response_state', 'unknown',
                 'provider_response_persisted', false,
                 'human_action', false))
       WHERE a.id = ANY(v_approved)
         AND a.organization_id = j.organization_id
         AND a.contract_id = v_contract
         AND a.document_id = v_document
         AND a.status = 'running'
         AND a.execution_job_id IS NULL
      RETURNING a.id
    )
    SELECT count(*)::integer INTO v_orphans_closed FROM closed;

    IF v_orphans_closed <> array_length(v_approved, 1) THEN
      RAISE EXCEPTION 'Conjunto de análises órfãs mudou desde o plano: % aprovadas, % elegíveis agora.',
        array_length(v_approved, 1), v_orphans_closed
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  UPDATE public.contract_clause_extraction_requests
     SET status = 'COMPLETED', completed_at = now(),
         analysis_id = v_extraction.id,
         proposed_count = COALESCE(proposed_count, v_structured),
         rejected_count = COALESCE(rejected_count, v_rejected),
         error_code = NULL, error_safe = NULL
   WHERE id = v_request.id;

  SELECT public.apex_jobs_enqueue(
    j.organization_id,
    'contracts.contract_operationalization.execute',
    v_idempotency,
    jsonb_build_object('request_id', v_request.id, 'contract_id', v_contract,
                       'document_id', v_document, 'requested_by', v_request.requested_by,
                       'operationalization_version', p_operationalization_version),
    1, now(), p_job_max_attempts, NULL, j.correlation_id) INTO v_enqueued;

  RETURN jsonb_build_object(
    'recoverable', true, 'dry_run', false, 'executed', true,
    'job_id', j.id, 'request_id', v_request.id, 'contract_id', v_contract,
    'document_id', v_document,
    'extraction_analysis_id', v_extraction.id,
    'orphan_operationalization_analysis_id', v_orphan_ops.id,
    'proof_window_lower', to_jsonb(j.created_at),
    'proof_window_upper', to_jsonb(v_upper_bound),
    'candidates', v_candidates,
    'eligible_orphan_analyses', v_orphan_rows,
    'approved_orphan_analysis_ids', to_jsonb(v_approved),
    'orphan_analyses_closed', v_orphans_closed,
    'operationalization_idempotency_key', v_idempotency,
    'operationalization_job_id', v_enqueued,
    'operationalization_job_was_existing', v_existing_job IS NOT NULL,
    'clause_extraction_rerun', false,
    'mutations', v_mutations);
END $$;
REVOKE ALL ON FUNCTION public.contracts_recover_legacy_extraction_job(uuid, text, integer, boolean, uuid[])
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.contracts_recover_legacy_extraction_job(uuid, text, integer, boolean, uuid[]) IS
  'Recupera um trabalho COMBINADO legado (extração + operacionalização) cuja '
  'extração já concluiu, sem rodar o extrator de novo. Dry-run por padrão. '
  'FALHA FECHADO: recusa com concessão viva, com trabalho já concluído, sem '
  'teto determinístico para a janela de prova, com zero candidatas '
  '(extraction_not_proven) e com mais de uma (extraction_ambiguous). Só um '
  'conjunto de tamanho exatamente um é prova. As análises órfãs NUNCA são '
  'fechadas por predicado: o dry-run as enumera e só os ids explicitamente '
  'aprovados são fechados, sob checagem otimista que aborta tudo se o conjunto '
  'mudou desde o plano.';

COMMIT;
