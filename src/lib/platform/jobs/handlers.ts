/**
 * Registro TIPADO de handlers.
 *
 * ─── Entrega at-least-once ─────────────────────────────────────────────────
 *
 * Entre o efeito colateral de um handler e a gravação do `COMPLETED` cabe um
 * processo derrubado. Quando ele voltar, o mesmo trabalho será reivindicado de
 * novo. Por isso cada handler declara, por escrito, o que torna a segunda
 * execução inofensiva — e por isso nenhum comentário aqui promete exactly-once.
 *
 * ─── Despacho tipado, não dinâmico ─────────────────────────────────────────
 *
 * O tipo de trabalho é procurado neste objeto e mais nada. Nunca se constrói um
 * nome de função a partir de payload: dado persistido é entrada, e executar
 * código nomeado por entrada é uma porta, não um mecanismo de extensão.
 */
import { OPERATIONALIZATION_JOB_MAX_ATTEMPTS } from './budget';
import { TerminalJobError, RetryableJobError } from './errors';
import type { ClaimedJob, HandlerContext, HandlerRegistry, JobHandler } from './types';
import type { JobType } from './registry';

const materialize: JobHandler<'contracts.obligations.materialize'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'A chave de ocorrência é derivada do período pela função da Fase 3; rodar duas '
    + 'vezes no mesmo dia devolve zero ocorrências novas.',
  async run(payload, { job, supabase }) {
    const { data, error } = await supabase.rpc('contracts_run_obligation_materialization', {
      p_organization_id: job.organization_id,
      p_as_of: payload.as_of,
      p_horizon_days: payload.horizon_days,
    });
    if (error) throw rpcError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
};

const externalActivation: JobHandler<'contracts.obligation.external_activation.apply'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'Ativar o que já está ativado não produz transição, logo não produz histórico, '
    + 'logo não produz fato novo. A reentrega do mesmo evento é inofensiva.',
  async run(payload, { job, supabase }) {
    /*
      Coerência de inquilino ANTES da execução. O vínculo estrutural entre
      trabalho e evento já é FK composta no banco; esta checagem existe para
      que uma divergência apareça como falha terminal e nomeada, e não como um
      handler que roda sobre o evento de outra organização por um instante.
    */
    const { data: event, error: eventError } = await supabase
      .from('domain_events')
      .select('id, organization_id, event_type, schema_version')
      .eq('id', payload.event_id)
      .eq('organization_id', job.organization_id)
      .maybeSingle<{ id: string; organization_id: string; event_type: string; schema_version: number }>();
    if (eventError) throw rpcError(eventError);
    if (!event) {
      throw new TerminalJobError('event_tenant_mismatch',
        'O evento de origem não pertence à organização do trabalho.');
    }

    const { data, error } = await supabase.rpc('contract_obligations_apply_external_activation', {
      p_event_id: payload.event_id,
    });
    if (error) throw rpcError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
};

const scheduleAnchor: JobHandler<'contracts.obligation.schedule_anchor.apply'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'A instância guarda a medição/data aplicada. Reentregar o mesmo evento '
    + 'não cria instância nem nova materialização.',
  async run(payload, { job, supabase }) {
    await assertEventTenant(supabase, job, payload.event_id);
    const { data: event, error: eventError } = await supabase
      .from('domain_events')
      .select('aggregate_id, aggregate_type, event_type')
      .eq('id', payload.event_id)
      .eq('organization_id', job.organization_id)
      .maybeSingle<{ aggregate_id: string; aggregate_type: string; event_type: string }>();
    if (eventError) throw rpcError(eventError);
    if (!event || event.aggregate_type !== 'project_measurement'
        || !['projects.measurement.schedule_changed', 'projects.measurement.accepted'].includes(event.event_type)) {
      throw new TerminalJobError('invalid_schedule_anchor_event',
        'O evento não representa agenda ou aceite de uma medição.');
    }
    const { data, error } = await supabase.rpc('contract_obligations_apply_schedule_anchor', {
      p_measurement_id: event.aggregate_id,
      p_organization_id: job.organization_id,
    });
    if (error) throw rpcError(error);
    return { measurement_id: event.aggregate_id, obligations_resolved: Number(data ?? 0) };
  },
};

const followupExecution: JobHandler<'platform.followups.execute'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'A RPC bloqueia cada acompanhamento e grava last_nudge_at/escalated_at ou '
    + 'uma verificação única antes de liberar a linha.',
  async run(payload, { job, supabase }) {
    const { data, error } = await supabase.rpc('apex_followups_execute_due', {
      p_organization_id: job.organization_id,
      p_as_of: payload.as_of,
      p_limit: payload.limit,
    });
    if (error) throw rpcError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
};

/**
 * Uma leitura, duas saídas — em DOIS trabalhos.
 *
 * O mesmo pedido durável ainda produz a INTERPRETAÇÃO (o que o contrato diz,
 * em `contract_clauses`) e a OPERACIONALIZAÇÃO (o que o contrato exige, em
 * obrigações, condições de faturamento, garantias, seguros e reajuste). Do
 * ponto de vista de quem subiu o PDF continua sendo UM ato: "o cliente mandou
 * o contrato; entenda". Ninguém precisa disparar duas análises.
 *
 * O que mudou é ONDE cada etapa roda. As duas chamadas longas ao modelo viviam
 * dentro da mesma invocação da hospedagem, em sequência. A primeira gastava o
 * tempo de vida da função e a segunda era morta pelo host no meio — sem
 * `catch`, sem estado terminal, sem diagnóstico, porque o processo que
 * escreveria o diagnóstico é o que deixou de existir.
 *
 * Agora: uma etapa longa de provedor por execução. A extração termina, o
 * pedido durável é fechado e SÓ ENTÃO a operacionalização é ENFILEIRADA, para
 * ganhar uma invocação inteira e um tempo de vida próprio. Ver
 * `./budget.ts` para o invariante que isso preserva.
 *
 * O preço é explícito: as cláusulas ficam persistidas antes de a
 * operacionalização existir. Não é sucesso parcial silencioso — o enfileiramento
 * é parte da mesma execução e a sua falha falha o trabalho, e a operacionalização
 * tem estado terminal próprio, visível na análise e no pedido.
 */
const clauseExtraction: JobHandler<'contracts.clause_extraction.execute'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'O pedido durável tem no máximo uma execução ABERTA por documento, e as duas leituras '
    + 'pulam por impressão digital (família, página, trecho) o que já foi estruturado.',
  async run(payload, { job, supabase }) {
    const { data: request, error: reqError } = await supabase
      .from('contract_clause_extraction_requests')
      .select('id, organization_id, contract_id, document_id, status, requested_by')
      .eq('id', payload.request_id)
      .eq('organization_id', job.organization_id)
      .maybeSingle<{
        id: string; organization_id: string; contract_id: string;
        document_id: string; status: string; requested_by: string | null;
      }>();
    if (reqError) throw rpcError(reqError);
    if (!request) {
      throw new TerminalJobError('request_tenant_mismatch',
        'O pedido de extração não pertence à organização do trabalho.');
    }
    // Já fechado: outra tentativa da mesma reivindicação, ou reprocessamento
    // manual de algo que terminou. Nada a fazer, e nada de errado.
    if (request.status === 'COMPLETED' || request.status === 'CANCELLED') {
      return { request_id: request.id, status: request.status, skipped: true };
    }

    await supabase
      .from('contract_clause_extraction_requests')
      .update({ status: 'RUNNING', started_at: new Date().toISOString() })
      .eq('id', request.id);

    /*
      O extrator é carregado sob demanda. Ele alcança o gateway server-only;
      deixá-lo no topo faria todo caminho que
      apenas MENCIONA o registro de handlers arrastar isso junto.
    */
    const { extractClausesFromDocument } = await import('@/lib/ai/contract-clause-extractor');

    try {
      /*
        ─── Zero extração duplicada ──────────────────────────────────────────

        A entrega é at-least-once, e a segunda entrega deste trabalho chega
        depois de a PRIMEIRA já ter lido o documento inteiro. Reler seria uma
        chamada longa e cara ao provedor para reproduzir, palavra por palavra,
        um resultado que já está persistido.

        A prova é EXATA: uma análise de extração concluída cuja `execution_job_id`
        é esta execução. Não é "existem cláusulas" — cláusulas podem vir de uma
        análise anterior, de importação ou de digitação humana, e nenhuma delas
        diz que ESTA execução terminou a leitura. E não é "a análise mais
        recente deste contrato", que reaproveitaria a leitura de um documento
        para outro.
      */
      const done = await completedExtractionFor(supabase, job, request);
      const result = done ?? await extractClausesFromDocument(
        request.contract_id, request.document_id, request.requested_by, job.id,
      );

      await supabase
        .from('contract_clause_extraction_requests')
        .update({
          status: 'COMPLETED',
          completed_at: new Date().toISOString(),
          analysis_id: result.analysisId,
          proposed_count: result.proposedCount,
          rejected_count: result.rejectedCount,
          error_code: null,
          error_safe: null,
        })
        .eq('id', request.id);

      /*
        A operacionalização é enfileirada DEPOIS de a persistência da extração
        terminar. Na outra ordem, um enfileiramento bem-sucedido seguido de uma
        escrita falha deixaria um trabalho a jusante apontando para um pedido
        que ainda diz RUNNING.

        A falha do enfileiramento é a falha DESTE trabalho, deliberadamente:
        engoli-la deixaria o documento com cláusulas e sem estrutura
        operacional, com aparência de plenamente lido.
      */
      const operationalJobId = await enqueueContractOperationalization(supabase, job, request);

      return {
        request_id: request.id,
        analysis_id: result.analysisId,
        structured_interpretations: result.proposedCount,
        rejected_without_evidence: result.rejectedCount,
        reused_persisted_extraction: done !== null,
        operationalization_job_id: operationalJobId,
      };
    } catch (error) {
      // A classificação decide se o pedido volta à fila ou morre aqui. Só o
      // segundo caso fecha o pedido — fechá-lo numa falha transitória
      // esconderia trabalho que ainda vai acontecer.
      const { classifyJobError } = await import('./errors');
      const classified = classifyJobError(error);
      if (!classified.retryable) {
        await supabase
          .from('contract_clause_extraction_requests')
          .update({
            status: 'FAILED', completed_at: new Date().toISOString(),
            error_code: classified.code, error_safe: classified.safe,
          })
          .eq('id', request.id);
        throw new TerminalJobError(classified.code, classified.safe);
      }
      await supabase
        .from('contract_clause_extraction_requests')
        .update({ status: 'QUEUED', error_code: classified.code, error_safe: classified.safe })
        .eq('id', request.id);
      throw new RetryableJobError(classified.code, classified.safe);
    }
  },
};

/**
 * A extração desta execução já concluiu e está persistida?
 *
 * Devolve o resultado PERSISTIDO, na forma que o handler já usa, ou null quando
 * não há prova. A consulta é ancorada em `execution_job_id` — a proveniência
 * exata que a migration 168 criou justamente para que esta pergunta tivesse uma
 * resposta determinística em vez de uma heurística.
 *
 * Uma análise de OUTRA execução não conta, ainda que seja do mesmo documento:
 * reanalisar um documento depois de uma revisão é legítimo, e tratar a leitura
 * antiga como prova faria a reanálise devolver silenciosamente o resultado
 * velho.
 */
async function completedExtractionFor(
  supabase: HandlerContext['supabase'],
  job: ClaimedJob,
  request: ClauseExtractionRequestRow,
): Promise<{ analysisId: string; proposedCount: number; rejectedCount: number } | null> {
  const { data, error } = await supabase
    .from('contract_ai_analyses')
    .select('id, status, extracted_data')
    .eq('organization_id', job.organization_id)
    .eq('contract_id', request.contract_id)
    .eq('document_id', request.document_id)
    .eq('execution_job_id', job.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1);
  if (error) throw rpcError(error);
  const row = (data ?? [])[0] as
    { id: string; extracted_data: Record<string, unknown> | null } | undefined;
  if (!row) return null;
  const extracted = row.extracted_data ?? {};
  if (extracted.kind !== 'clause_extraction') return null;
  return {
    analysisId: row.id,
    proposedCount: Number(extracted.structured ?? 0),
    rejectedCount: Number(extracted.rejected_without_evidence ?? 0),
  };
}

interface ClauseExtractionRequestRow {
  readonly id: string;
  readonly organization_id: string;
  readonly contract_id: string;
  readonly document_id: string;
  readonly requested_by: string | null;
}

/**
 * Enfileira a etapa longa seguinte, UMA vez.
 *
 * ─── A chave ───────────────────────────────────────────────────────────────
 *
 * Determinística e derivada só de identidade estável: organização (implícita na
 * unicidade do `apex_jobs`), contrato, documento, pedido durável e versão do
 * pipeline. Nada de relógio, nada de aleatório — uma chave com `now()` dentro
 * faria cada nova tentativa da extração criar mais uma operacionalização do
 * mesmo documento, e a fila viraria uma multiplicação de chamadas caras ao
 * provedor sobre o mesmo PDF.
 *
 * A unicidade real é do banco: `aj_idempotent UNIQUE (organization_id,
 * job_type, idempotency_key)` com `ON CONFLICT DO NOTHING`, que devolve o id do
 * trabalho que JÁ existe. Duas execuções concorrentes da extração convergem
 * para o mesmo trabalho em vez de correrem para criar dois.
 *
 * A versão do pipeline entra na chave de propósito: quando a operacionalização
 * mudar de versão, o mesmo documento PODE ser reoperacionalizado — e essa é uma
 * decisão de produto explícita, não um acidente de reentrega.
 */
async function enqueueContractOperationalization(
  supabase: HandlerContext['supabase'],
  job: ClaimedJob,
  request: ClauseExtractionRequestRow,
): Promise<string | null> {
  /*
    A versão vem do módulo de operacionalização, carregado sob demanda: ele
    alcança o gateway server-only, e prendê-lo no topo faria todo caminho que
    apenas MENCIONA o registro de handlers arrastar o provedor junto.
  */
  const { OPERATIONALIZATION_VERSION } = await import('@/lib/ai/contract-operationalization');
  const idempotencyKey = `contract-operationalization:${request.contract_id}:`
    + `${request.document_id}:${request.id}:${OPERATIONALIZATION_VERSION}`;

  const { data, error } = await supabase.rpc('apex_jobs_enqueue', {
    p_organization_id: job.organization_id,
    p_job_type: 'contracts.contract_operationalization.execute',
    p_idempotency_key: idempotencyKey,
    p_payload: {
      request_id: request.id,
      contract_id: request.contract_id,
      document_id: request.document_id,
      requested_by: request.requested_by,
      operationalization_version: OPERATIONALIZATION_VERSION,
    },
    p_payload_version: 1,
    p_run_after: new Date().toISOString(),
    /*
      UMA tentativa de trabalho, no primeiro Portão de Dado Real. Cada tentativa
      é uma operação Sonnet potencialmente cara sobre um contrato inteiro, e três
      delas gastariam três vezes antes de qualquer humano ver que algo está
      errado. O que queremos agora é falha → estado terminal visível →
      retentativa DELIBERADA. Ver OPERATIONALIZATION_JOB_MAX_ATTEMPTS.
    */
    p_max_attempts: OPERATIONALIZATION_JOB_MAX_ATTEMPTS,
    p_event_id: null,
    p_correlation_id: job.correlation_id,
  });
  if (error) throw rpcError(error);
  return (data as string | null) ?? null;
}

/**
 * Operacionalização: UMA etapa longa de provedor, sozinha na sua invocação.
 *
 * ─── Por que ela não reexecuta a extração ──────────────────────────────────
 *
 * Este handler não conhece `extractClausesFromDocument` e não tem como chegar
 * nele: a única importação de IA aqui é a da operacionalização. Uma repetição
 * deste trabalho — por reentrega, por ceifa de concessão ou por tentativa nova
 * — repete a operacionalização e nada mais. As cláusulas já estão persistidas e
 * o pedido durável já está COMPLETED antes de este trabalho sequer existir.
 *
 * ─── Idempotência do EFEITO ────────────────────────────────────────────────
 *
 * A repetição é inofensiva porque `operationalizeContractDocument` pula, por
 * impressão digital (família, página, trecho), tudo que já foi estruturado. O
 * que a segunda execução acrescenta é uma linha de análise nova — o registro de
 * que a leitura foi refeita — e nenhuma duplicata de obrigação, garantia,
 * seguro, condição de faturamento ou regra de reajuste.
 */
const contractOperationalization: JobHandler<'contracts.contract_operationalization.execute'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'A operacionalização pula por impressão digital (família, página, trecho) o que já foi '
    + 'estruturado, e o enfileiramento é único por contrato/documento/pedido/versão.',
  async run(payload, { job, supabase }) {
    /*
      Coerência de inquilino ANTES de qualquer chamada ao provedor. Sem esta
      leitura, um payload de outra organização gastaria minutos de modelo antes
      de alguém descobrir que ele não deveria ter rodado.
    */
    const { data: request, error: reqError } = await supabase
      .from('contract_clause_extraction_requests')
      .select('id, organization_id, contract_id, document_id')
      .eq('id', payload.request_id)
      .eq('organization_id', job.organization_id)
      .maybeSingle<{ id: string; organization_id: string; contract_id: string; document_id: string }>();
    if (reqError) throw rpcError(reqError);
    if (!request) {
      throw new TerminalJobError('request_tenant_mismatch',
        'O pedido de origem não pertence à organização do trabalho.');
    }
    if (request.contract_id !== payload.contract_id || request.document_id !== payload.document_id) {
      throw new TerminalJobError('operationalization_payload_mismatch',
        'O trabalho aponta para um contrato ou documento diferente do pedido de origem.');
    }

    const { operationalizeContractDocument } = await import('@/lib/ai/contract-operationalization');
    try {
      const ops = await operationalizeContractDocument(
        payload.contract_id, payload.document_id, payload.requested_by, job.id,
      );
      return {
        request_id: payload.request_id,
        analysis_id: ops.analysisId,
        counts: ops.counts,
        materialized: ops.materializedInstances,
        awaiting_schedule_anchor: ops.awaitingScheduleAnchor,
        requires_attention: ops.requiresAttention,
      };
    } catch (error) {
      /*
        O caminho normal de falha, e ele PRECISA ser alcançável: o tempo limite
        do provedor (180s) mais a margem de persistência cabem, com folga, no
        tempo de vida da função. Quando o host mata a execução antes, nenhuma
        destas linhas roda — e é exatamente isso que `./budget.ts` impede.
      */
      const { classifyJobError } = await import('./errors');
      const classified = classifyJobError(error);
      if (classified.retryable) throw new RetryableJobError(classified.code, classified.safe);
      throw new TerminalJobError(classified.code, classified.safe);
    }
  },
};

/**
 * Amendment onboarding keeps the PDF before AI runs. A failed model call only
 * changes the durable request/amendment analysis state; it never publishes a
 * partial effect. The final database RPC persists the interpretation and all
 * effect rows atomically.
 */
const amendmentExtraction: JobHandler<'contracts.amendment_extraction.execute'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'One durable request and one amendment are keyed to the canonical document; effect fingerprints '
    + 'are unique, and the final extraction is committed atomically.',
  async run(payload, { job, supabase }) {
    const { data: request, error } = await supabase
      .from('contract_amendment_ingestion_requests')
      .select('id, organization_id, status, amendment_id')
      .eq('id', payload.request_id).eq('organization_id', job.organization_id)
      .maybeSingle<{ id: string; organization_id: string; status: string; amendment_id: string | null }>();
    if (error) throw rpcError(error);
    if (!request) {
      throw new TerminalJobError('request_tenant_mismatch',
        'O pedido de aditivo não pertence à organização do trabalho.');
    }
    if (request.status === 'COMPLETED' || request.status === 'REQUIRES_ATTENTION'
        || request.status === 'CANCELLED') {
      return { request_id: request.id, status: request.status, skipped: true };
    }

    try {
      const { extractContractAmendment } = await import('@/lib/ai/contract-amendment-extractor');
      return await extractContractAmendment(payload.request_id, payload.contract_id,
        payload.document_id) as unknown as Record<string, unknown>;
    } catch (cause) {
      const { classifyJobError } = await import('./errors');
      const classified = classifyJobError(cause);
      const exhausted = classified.retryable && job.attempt_count >= job.max_attempts;
      await supabase.from('contract_amendment_ingestion_requests').update({
        status: classified.retryable && !exhausted ? 'QUEUED' : 'FAILED',
        completed_at: classified.retryable && !exhausted ? null : new Date().toISOString(),
        error_code: classified.code,
        error_safe: classified.safe,
      }).eq('id', request.id).eq('organization_id', job.organization_id);
      if (request.amendment_id) {
        await supabase.from('contract_amendments').update({
          analysis_state: classified.retryable && !exhausted ? 'queued' : 'failed',
        }).eq('id', request.amendment_id).eq('organization_id', job.organization_id);
      }
      if (classified.retryable) throw new RetryableJobError(classified.code, classified.safe);
      throw new TerminalJobError(classified.code, classified.safe);
    }
  },
};

/**
 * The PDF already exists in durable private storage before this handler runs.
 * A failure changes only the intake state; it cannot create partial contract
 * truth, and a retry reuses the same hash/intake identity.
 */
const onboardingExtraction: JobHandler<'contracts.onboarding_extraction.execute'> = {
  payloadVersion: 1,
  idempotencyBasis: 'One intake is unique per organization, uploader and document hash; ready results are never reapplied.',
  async run(payload, { job, supabase }) {
    const { data: intake, error } = await supabase.from('contract_onboarding_intakes')
      .select('id,organization_id,status,contract_id').eq('id', payload.intake_id)
      .eq('organization_id', job.organization_id)
      .maybeSingle<{ id: string; organization_id: string; status: string; contract_id: string | null }>();
    if (error) throw rpcError(error);
    if (!intake) throw new TerminalJobError('intake_tenant_mismatch',
      'A entrada de contrato não pertence à organização do trabalho.');
    if (intake.contract_id || ['READY', 'REQUIRES_ATTENTION', 'REGISTERED', 'CANCELLED'].includes(intake.status)) {
      return { intake_id: intake.id, status: intake.status, skipped: true };
    }
    try {
      const { extractContractOnboarding } = await import('@/lib/ai/contract-onboarding-extractor');
      return await extractContractOnboarding(intake.id) as Record<string, unknown>;
    } catch (cause) {
      const { classifyJobError } = await import('./errors');
      const classified = classifyJobError(cause);
      const exhausted = classified.retryable && job.attempt_count >= job.max_attempts;
      await supabase.from('contract_onboarding_intakes').update({
        status: classified.retryable && !exhausted ? 'QUEUED' : 'FAILED',
        completed_at: classified.retryable && !exhausted ? null : new Date().toISOString(),
        error_code: classified.code, error_safe: classified.safe,
      }).eq('id', intake.id).eq('organization_id', job.organization_id);
      if (classified.retryable) throw new RetryableJobError(classified.code, classified.safe);
      throw new TerminalJobError(classified.code, classified.safe);
    }
  },
};

/*
  Expiração de aprovação.

  Vale registrar o que este handler NÃO faz: ele não decide nada, não rejeita
  nada e não pode transformar a ausência de parecer em parecer. Expirado e
  rejeitado são estados distintos desde a migration 126, com eventos distintos,
  justamente para que um relatório não possa apresentar um como o outro.

  A EXATIDÃO do prazo também não depende dele. `approval_decide` recusa por
  conta própria qualquer decisão depois do vencimento, sem consultar fila
  nenhuma; o que roda aqui é a materialização da projeção. Um atraso de
  agendador atrasa o rótulo, nunca concede autoridade.
*/
const approvalExpiration: JobHandler<'platform.approvals.expire'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'A função só toca pedido PENDING cujo prazo já passou, e um pedido já '
    + 'EXPIRED devolve false. Rodar duas vezes expira zero na segunda.',
  async run(_payload, { job, supabase }) {
    const { data, error } = await supabase.rpc('approval_requests_expire_due_for_org', {
      p_organization_id: job.organization_id,
      p_limit: 500,
    });
    if (error) throw rpcError(error);
    return { expired: Number(data ?? 0) };
  },
};

/*
  Materialização de candidatos de medição.

  Vale registrar o que este handler NÃO faz, porque é a fronteira inteira da
  Fase 6: ele não mede nada, não conclui execução e não aceita coisa alguma.
  Ele cria medição PLANEJADA para a ocorrência que a regra contratual, o
  vínculo Projeto↔Contrato e o mapeamento de cronograma GOVERNADO já tornam
  determinística. Cadência desconhecida ou por evento não produz candidato —
  a chave de ocorrência volta nula e a linha é contada como não resolvida, que
  é informação, não falha.
*/
const measurementCandidates: JobHandler<'projects.measurements.reconcile_candidates'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'A chave de ocorrência é derivada da cadência e da etapa mapeada, e a unicidade '
    + 'mora num índice parcial do banco. A segunda execução do mesmo dia cria zero.',
  async run(payload, { job, supabase }) {
    const { data, error } = await supabase.rpc('project_measurements_materialize', {
      p_organization_id: job.organization_id,
      p_as_of: payload.as_of,
      p_horizon_days: payload.horizon_days,
    });
    if (error) throw rpcError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
};

/*
  Recomputo de prontidão.

  Prontidão é DERIVADA: o que este handler atualiza é cache, e o cache carrega
  `computed_at` justamente para que uma leitura velha seja reconhecível como
  velha. Rodar de menos atrasa um rótulo; não corrompe verdade nenhuma, porque
  o resolvedor canônico segue disponível para quem precisar do estado de agora.
*/
const measurementReadiness: JobHandler<'projects.measurements.recompute_readiness'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'Recomputar prontidão é função pura das entradas atuais: a segunda execução '
    + 'grava o mesmo resultado por cima do mesmo resultado.',
  async run(payload, { job, supabase }) {
    const { data, error } = await supabase.rpc('projects_recompute_measurement_readiness', {
      p_organization_id: job.organization_id,
      p_changed_since: payload.changed_since ?? null,
      p_limit: payload.limit,
    });
    if (error) throw rpcError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
};


/* ==========================================================================
   FASE 7 — a cadeia contrato-a-caixa
   ==========================================================================

   Cinco handlers, uma disciplina só: cada um confere que o EVENTO pertence à
   organização do trabalho antes de agir, e cada um delega a mutação
   autoritativa a uma função do DOMÍNIO DONO. Nenhum deles escreve tabela de
   outro domínio a partir daqui — a fronteira da §3 é o que impede Contratos de
   virar sistema-sombra de Fiscal e de Finanças.

   Nenhum deles decide nada. Liberar faturamento, autorizar nota, confirmar
   pagamento e conciliar continuam sendo atos com dono e com permissão.
*/

/**
 * Confere que o evento citado no payload é do inquilino do trabalho.
 *
 * O vínculo já é FK composta no banco. Esta checagem existe para que uma
 * divergência apareça como falha TERMINAL e nomeada, e não como um handler
 * que roda sobre o evento de outra organização por um instante.
 */
async function assertEventTenant(
  supabase: HandlerContext['supabase'], job: ClaimedJob, eventId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('domain_events')
    .select('id')
    .eq('id', eventId)
    .eq('organization_id', job.organization_id)
    .maybeSingle<{ id: string }>();
  if (error) throw rpcError(error);
  if (!data) {
    throw new TerminalJobError('event_tenant_mismatch',
      'O evento de origem não pertence à organização do trabalho.');
  }
}

/*
  Medição aceita → CANDIDATO a faturar.

  Vale registrar o que este handler NÃO faz, porque é a fronteira inteira da
  §21: ele não libera nada. O candidato nasce com procedência de valor e com
  elegibilidade calculada; quem libera é uma pessoa, pela RPC governada.
*/
const billingCandidate: JobHandler<'contracts.billing.candidate_from_measurement'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'A chave de direito (organização, contrato, medição, revisão) tem unicidade em '
    + 'índice do banco. A segunda entrega do mesmo aceite devolve o candidato que existe.',
  async run(payload, { job, supabase }) {
    await assertEventTenant(supabase, job, payload.event_id);
    const { data, error } = await supabase.rpc('contract_billing_apply_measurement_accepted', {
      p_event_id: payload.event_id,
    });
    if (error) throw rpcError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
};

/*
  Decisão de aprovação aplicada à liberação.

  Só age quando existe política REAL — sem política, `contract_billing_release`
  nunca abriu pedido, e este handler responde `NOT_A_BILLING_APPROVAL` para
  toda aprovação de outro assunto. Aprovação aprovada cujo valor mudou depois
  NÃO libera: a impressão digital é conferida do outro lado.
*/
const billingApproval: JobHandler<'contracts.billing.apply_approval'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'Faturamento já em RELEASED, RELEASE_REJECTED, CANCELLED ou SUPERSEDED devolve '
    + 'idempotente. A segunda entrega da mesma decisão não produz segunda liberação.',
  async run(payload, { job, supabase }) {
    await assertEventTenant(supabase, job, payload.event_id);
    const { data: event, error: evError } = await supabase
      .from('domain_events')
      .select('aggregate_id, aggregate_type')
      .eq('id', payload.event_id)
      .eq('organization_id', job.organization_id)
      .maybeSingle<{ aggregate_id: string; aggregate_type: string }>();
    if (evError) throw rpcError(evError);
    if (!event || event.aggregate_type !== 'approval_request') {
      return { applied: false, reason: 'NOT_AN_APPROVAL_REQUEST_EVENT' };
    }
    const { data, error } = await supabase.rpc('contract_billing_apply_approval', {
      p_approval_request_id: event.aggregate_id,
    });
    if (error) throw rpcError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
};

/*
  Liberação → pedido de documento fiscal.

  O handler abre o pedido durável e, SE houver configuração fiscal completa,
  manda o SERVIÇO DO FISCAL criar o rascunho. Contratos não insere em
  `fiscal_documents` nem aqui nem em lugar nenhum (§29).

  `BLOCKED_BY_CONFIGURATION` é desfecho legítimo e final para esta execução —
  não é erro, não vai para retentativa e não vira carta morta. Em produção,
  onde não há estabelecimento, catálogo nem perfil de parte, é o desfecho
  esperado, e ele fica NOMEADO na linha do pedido.

  Transmitir ao provedor continua sendo ato do Fiscal, com `fiscal.transmit`,
  pela fila `fiscal_jobs` — a §66 congela essa fila e a §123 proíbe migrá-la.
*/
const fiscalRequest: JobHandler<'contracts.billing.request_fiscal_document'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'O pedido é único por (organização, faturamento, impressão da liberação), e o '
    + 'rascunho fiscal é único por (organização, chave de idempotência). Reentrega '
    + 'devolve o pedido e o rascunho que já existem.',
  async run(payload, { job, supabase }) {
    await assertEventTenant(supabase, job, payload.event_id);

    const { data: opened, error } = await supabase.rpc('contract_billing_open_fiscal_request', {
      p_event_id: payload.event_id,
    });
    if (error) throw rpcError(error);
    const result = (opened ?? {}) as Record<string, unknown>;
    const requestId = (result.request_id ?? null) as string | null;
    if (!requestId) return result;

    const { data: request, error: reqError } = await supabase
      .from('contract_billing_fiscal_requests')
      .select('id, organization_id, billing_event_id, state, requested_amount_cents, fiscal_document_id')
      .eq('id', requestId)
      .eq('organization_id', job.organization_id)
      .maybeSingle<{
        id: string; organization_id: string; billing_event_id: string;
        state: string; requested_amount_cents: number | null; fiscal_document_id: string | null;
      }>();
    if (reqError) throw rpcError(reqError);
    if (!request) throw new TerminalJobError('request_tenant_mismatch',
      'O pedido fiscal não pertence à organização do trabalho.');

    if (request.state !== 'REQUESTED') {
      // Bloqueado por configuração, já rascunhado ou cancelado. Nada a fazer,
      // e nada de errado: o estado já diz a verdade.
      return { request_id: request.id, state: request.state, skipped: true };
    }

    /*
      O serviço do Fiscal é carregado sob demanda. Ele arrasta o cliente de
      service role e o guarda de runtime de servidor; deixá-lo no topo faria
      todo caminho que apenas MENCIONA o registro de handlers puxar isso junto.
    */
    const { requestFiscalDraftForBilling } = await import('@/lib/fiscal/server/billing-intake');
    try {
      const outcome = await requestFiscalDraftForBilling({
        organizationId: job.organization_id,
        requestId: request.id,
        billingEventId: request.billing_event_id,
      });
      return outcome as unknown as Record<string, unknown>;
    } catch (error) {
      const { classifyJobError } = await import('./errors');
      const classified = classifyJobError(error);
      await supabase
        .from('contract_billing_fiscal_requests')
        .update({
          state: classified.retryable ? 'REQUESTED' : 'ERROR',
          last_error_safe: classified.safe,
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
        .eq('organization_id', job.organization_id);
      if (classified.retryable) throw new RetryableJobError(classified.code, classified.safe);
      throw new TerminalJobError(classified.code, classified.safe);
    }
  },
};

/*
  Nota autorizada → Contas a Receber.

  A criação é de FINANÇAS (§35) e a base do valor vem da política declarada
  (§40). Sem política, nada é criado e o documento fiscal passa a declarar
  `pending_configuration` — que é informação verdadeira, e não falha.
*/
const receivableFromFiscal: JobHandler<'finance.receivable.create_from_fiscal'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'Índice único parcial (organização, documento fiscal) entre títulos VIVOS. '
    + 'A reentrega da autorização devolve o título que existe (§38).',
  async run(payload, { job, supabase }) {
    await assertEventTenant(supabase, job, payload.event_id);
    const { data, error } = await supabase.rpc('finance_receivable_create_from_fiscal_document', {
      p_event_id: payload.event_id,
    });
    if (error) throw rpcError(error);
    const result = (data ?? {}) as Record<string, unknown>;

    /*
      Reconhecimento contábil é um SEGUNDO requisito, e não uma consequência de
      existir título (§130, §131). Ele roda aqui e falha por configuração sem
      derrubar o título: a verdade de Contas a Receber permanece, e o estado do
      razão diz separadamente que falta mapeamento (§116).
    */
    if (result.created === true && typeof result.receivable_id === 'string') {
      const { data: posting, error: postError } = await supabase
        .rpc('finance_ledger_post_receivable', { p_receivable_id: result.receivable_id });
      if (postError) throw rpcError(postError);
      return { ...result, ledger: posting ?? null };
    }
    return result;
  },
};

/*
  Nota cancelada ou substituída → título derrubado, história preservada.

  Não há DELETE em lugar nenhum deste caminho. A alocação antiga vira
  CANCELLED/REPLACED e permanece; o título vira CANCELLED e permanece; as
  liquidações que já existiam permanecem, porque o dinheiro entrou de verdade
  e estornar caixa é outro ato (§34, §57, §113).
*/
const fiscalCancellation: JobHandler<'finance.receivable.apply_fiscal_cancellation'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'Alocação já fechada e título já não-ACTIVE respondem idempotente. A segunda '
    + 'entrega do cancelamento não cancela duas vezes.',
  async run(payload, { job, supabase }) {
    await assertEventTenant(supabase, job, payload.event_id);
    const { data, error } = await supabase.rpc('finance_apply_fiscal_cancellation', {
      p_event_id: payload.event_id,
    });
    if (error) throw rpcError(error);
    return (data ?? {}) as Record<string, unknown>;
  },
};

export const JOB_HANDLERS: HandlerRegistry = {
  'contracts.obligations.materialize': materialize,
  'contracts.obligation.external_activation.apply': externalActivation,
  'contracts.obligation.schedule_anchor.apply': scheduleAnchor,
  'contracts.clause_extraction.execute': clauseExtraction,
  'contracts.contract_operationalization.execute': contractOperationalization,
  'contracts.onboarding_extraction.execute': onboardingExtraction,
  'contracts.amendment_extraction.execute': amendmentExtraction,
  'platform.approvals.expire': approvalExpiration,
  'platform.followups.execute': followupExecution,
  'projects.measurements.reconcile_candidates': measurementCandidates,
  'projects.measurements.recompute_readiness': measurementReadiness,
  'contracts.billing.candidate_from_measurement': billingCandidate,
  'contracts.billing.apply_approval': billingApproval,
  'contracts.billing.request_fiscal_document': fiscalRequest,
  'finance.receivable.create_from_fiscal': receivableFromFiscal,
  'finance.receivable.apply_fiscal_cancellation': fiscalCancellation,
};

export function handlerFor(jobType: JobType): JobHandler<JobType> {
  return JOB_HANDLERS[jobType] as JobHandler<JobType>;
}

/**
 * Erro vindo do PostgREST. Falha de esquema/permissão é determinística; falha
 * de conexão não é. Preservar `code` é o que deixa `classifyJobError` decidir
 * em vez de adivinhar.
 */
function rpcError(error: { code?: string; message?: string; details?: string }): Error {
  const err = new Error(error.message ?? 'Erro no banco de dados.') as Error & { code?: string };
  err.code = error.code;
  return err;
}

export type { HandlerContext };
