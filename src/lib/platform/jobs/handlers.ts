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
import { TerminalJobError, RetryableJobError } from './errors';
import type { HandlerContext, HandlerRegistry, JobHandler } from './types';
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

const clauseExtraction: JobHandler<'contracts.clause_extraction.execute'> = {
  payloadVersion: 1,
  idempotencyBasis:
    'O pedido durável tem no máximo uma execução ABERTA por documento, e o extrator '
    + 'pula por impressão digital (documento, página, trecho) o que já foi proposto.',
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
      O extrator é carregado sob demanda. Ele importa o SDK da Anthropic e o
      guarda de runtime de servidor; deixá-lo no topo faria todo caminho que
      apenas MENCIONA o registro de handlers arrastar isso junto.
    */
    const { extractClausesFromDocument } = await import('@/lib/ai/contract-clause-extractor');

    try {
      const result = await extractClausesFromDocument(
        request.contract_id, request.document_id, request.requested_by ?? job.organization_id,
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
      return {
        request_id: request.id,
        analysis_id: result.analysisId,
        proposed: result.proposedCount,
        rejected_without_evidence: result.rejectedCount,
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

export const JOB_HANDLERS: HandlerRegistry = {
  'contracts.obligations.materialize': materialize,
  'contracts.obligation.external_activation.apply': externalActivation,
  'contracts.clause_extraction.execute': clauseExtraction,
  'platform.approvals.expire': approvalExpiration,
  'projects.measurements.reconcile_candidates': measurementCandidates,
  'projects.measurements.recompute_readiness': measurementReadiness,
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
