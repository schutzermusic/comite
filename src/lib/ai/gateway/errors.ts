import type { ApexAIProvider, ApexAITask } from './types';

export type ApexAIErrorCode =
  | 'AI_DISABLED'
  | 'INVALID_TENANT_CONTEXT'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'CAPABILITY_UNSUPPORTED'
  | 'AUTHENTICATION'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR';

export class ApexAIError extends Error {
  constructor(
    public readonly code: ApexAIErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly context: { task?: ApexAITask; provider?: ApexAIProvider; status?: number } = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApexAIError';
  }
}

export function asApexAIError(error: unknown): ApexAIError {
  if (error instanceof ApexAIError) return error;
  return new ApexAIError(
    'PROVIDER_ERROR',
    error instanceof Error ? error.message : 'Falha inesperada no provedor de IA.',
    false,
    {},
    error instanceof Error ? { cause: error } : undefined,
  );
}
