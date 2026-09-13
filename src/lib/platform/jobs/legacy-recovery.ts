/**
 * Recuperação de um trabalho COMBINADO legado.
 *
 * ─── O caso ────────────────────────────────────────────────────────────────
 *
 * Existe em produção um `contracts.clause_extraction.execute` anterior à
 * divisão das fases: ele rodava extração E operacionalização em sequência. A
 * extração dele TERMINOU e persistiu cláusulas reais; a operacionalização foi
 * morta pela hospedagem no meio.
 *
 * A retentativa normal desse trabalho rodaria o extrator outra vez — uma
 * chamada longa e cara ao provedor para reproduzir um resultado que já está no
 * banco. Este módulo é o caminho DELIBERADO que evita isso.
 *
 * ─── Dry-run por padrão, e por quê ─────────────────────────────────────────
 *
 * `execute` é `false` por omissão, aqui e na função do banco. Uma recuperação
 * que repara produção por descuido de argumento é uma recuperação que VAI
 * reparar produção por descuido de argumento. Quem quer executar diz isso por
 * escrito, e o plano que a chamada devolve antes é o que torna essa decisão
 * informada: ele lista cada transição, com o motivo, sem escrever nada.
 *
 * ─── O que este módulo NÃO decide ──────────────────────────────────────────
 *
 * Se a extração concluiu. Isso é uma pergunta sobre EVIDÊNCIA DURÁVEL, e a
 * resposta mora na função do banco, numa transação que segura a linha do
 * trabalho enquanto responde. Decidir aqui, entre duas idas ao banco, deixaria
 * a ceifa devolver o trabalho para a fila no meio do raciocínio.
 */
import { OPERATIONALIZATION_JOB_MAX_ATTEMPTS } from './budget';
import type { platformServiceClient } from '../server-client';

/** Uma transição planejada, como o banco a descreve. Nunca conteúdo de documento. */
export interface PlannedMutation {
  readonly table: string;
  readonly id?: string;
  readonly action?: 'PRESERVE';
  readonly from?: Record<string, unknown>;
  readonly to?: Record<string, unknown>;
  readonly why: string;
}

export type LegacyRecoveryPlan =
  | {
      readonly recoverable: false;
      readonly reason:
        | 'job_not_found' | 'not_a_legacy_extraction_job' | 'lease_still_live'
        | 'job_already_completed' | 'payload_without_identity' | 'request_not_found'
        | 'extraction_not_proven';
      readonly dry_run: boolean;
      readonly [key: string]: unknown;
    }
  | {
      readonly recoverable: true;
      readonly dry_run: boolean;
      readonly executed: boolean;
      readonly job_id: string;
      readonly request_id: string;
      readonly contract_id: string;
      readonly document_id: string;
      readonly extraction_analysis_id: string;
      readonly orphan_operationalization_analysis_id: string | null;
      readonly operationalization_idempotency_key: string;
      readonly operationalization_job_id?: string;
      readonly mutations: readonly PlannedMutation[];
      readonly [key: string]: unknown;
    };

export interface LegacyRecoveryOptions {
  /** Falso por omissão: a chamada PLANEJA, e não escreve. */
  readonly execute?: boolean;
}

/**
 * Planeja — ou, quando explicitamente pedido, executa — a recuperação.
 *
 * A versão de operacionalização vem do módulo de IA, carregado sob demanda,
 * porque ela é metade da chave de idempotência: a chave que este caminho produz
 * tem de ser IDÊNTICA à que o handler de extração produz, ou a recuperação
 * criaria um segundo trabalho para o mesmo documento em vez de convergir para o
 * que já existe.
 */
export async function recoverLegacyExtractionJob(
  supabase: ReturnType<typeof platformServiceClient>,
  jobId: string,
  options: LegacyRecoveryOptions = {},
): Promise<LegacyRecoveryPlan> {
  const { OPERATIONALIZATION_VERSION } = await import('@/lib/ai/contract-operationalization');
  const { data, error } = await supabase.rpc('contracts_recover_legacy_extraction_job', {
    p_job_id: jobId,
    p_operationalization_version: OPERATIONALIZATION_VERSION,
    p_job_max_attempts: OPERATIONALIZATION_JOB_MAX_ATTEMPTS,
    p_dry_run: options.execute !== true,
  });
  if (error) throw new Error(`Recuperação legada falhou: ${error.message}`);
  return data as LegacyRecoveryPlan;
}
