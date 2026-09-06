import type { SupabaseClient } from '@supabase/supabase-js';
import type { JobType, JobPayloadByType } from './registry';

/** Linha reivindicada, como o banco a devolve. */
export interface ClaimedJob {
  readonly id: string;
  readonly organization_id: string;
  readonly event_id: string | null;
  readonly job_type: string;
  readonly payload_version: number;
  readonly idempotency_key: string;
  readonly payload: Record<string, unknown>;
  readonly attempt_count: number;
  readonly max_attempts: number;
  readonly lock_token: string;
  readonly correlation_id: string | null;
}

export interface HandlerContext {
  readonly job: ClaimedJob;
  readonly supabase: SupabaseClient;
  /** Orçamento restante do lote, em milissegundos. */
  readonly remainingMs: () => number;
}

export interface JobHandler<K extends JobType> {
  /** Versão de payload que este handler entende. Outra versão é terminal. */
  readonly payloadVersion: number;
  /** Como a repetição deixa de ter efeito. Documentado porque a entrega é at-least-once. */
  readonly idempotencyBasis: string;
  run(payload: JobPayloadByType[K], context: HandlerContext): Promise<Record<string, unknown>>;
}

export type HandlerRegistry = { readonly [K in JobType]: JobHandler<K> };
