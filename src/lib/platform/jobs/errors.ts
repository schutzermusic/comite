/**
 * Classificação de falha e higiene de mensagem.
 *
 * ─── Repetir o que é determinístico é desperdício com cara de resiliência ──
 *
 * Um tempo esgotado, um 429 e um 503 melhoram por serem repetidos: a causa é
 * externa e passageira. Um payload inválido, um tipo desconhecido, um inquilino
 * cruzado e um invariante de negócio violado não melhoram nunca — repetir
 * cinco vezes só adia em cinco tentativas a hora em que alguém vai olhar.
 *
 * ─── Por que a mensagem é reescrita ────────────────────────────────────────
 *
 * Objeto de exceção de cliente HTTP costuma carregar a URL chamada, os
 * cabeçalhos enviados e o corpo do pedido. Serializá-lo numa coluna que fica
 * legível para sempre é como um segredo vaza sem que ninguém tenha escrito uma
 * linha para vazá-lo.
 */

export class TerminalJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TerminalJobError';
    this.code = code;
  }
}

export class RetryableJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RetryableJobError';
    this.code = code;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

const RETRYABLE_HINTS = [
  'etimedout', 'econnreset', 'econnrefused', 'enotfound', 'eai_again', 'epipe',
  'socket hang up', 'network', 'timeout', 'timed out', 'temporarily unavailable',
  'too many requests', 'rate limit', 'overloaded', 'connection terminated',
  'could not connect', 'server is starting up', 'deadlock detected',
];

/** Códigos de erro do Postgres que são transitórios de verdade. */
const RETRYABLE_PG_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '55P03', // lock_not_available
  '57P03', // cannot_connect_now
  '08006', '08003', '08000', // falhas de conexão
]);

export interface Classified {
  readonly retryable: boolean;
  readonly code: string;
  /** Mensagem segura, já truncada, sem cabeçalho, corpo, URL nem credencial. */
  readonly safe: string;
}

/** Remove o que nunca deveria ser persistido, ainda que a origem tenha incluído. */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redigido]')
    .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9._-]{8,}/gi, '[redigido]')
    .replace(/\beyJ[A-Za-z0-9._-]{16,}/g, '[redigido]')
    .replace(/\b(postgres(?:ql)?|https?):\/\/[^\s"']*/gi, '[url redigida]')
    .replace(/("?(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)"?\s*[:=]\s*)("?)[^\s,;"'}]+\2/gi,
      '$1[redigido]')
    .slice(0, 1000);
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as { status?: unknown; statusCode?: unknown };
  const raw = typeof e.status === 'number' ? e.status
    : typeof e.statusCode === 'number' ? e.statusCode : null;
  return raw;
}

export function classifyJobError(error: unknown): Classified {
  if (error instanceof TerminalJobError) {
    return { retryable: false, code: error.code, safe: sanitizeErrorMessage(error.message) };
  }
  if (error instanceof RetryableJobError) {
    return { retryable: true, code: error.code, safe: sanitizeErrorMessage(error.message) };
  }

  const message = error instanceof Error ? error.message : String(error);
  const safe = sanitizeErrorMessage(message);

  const status = statusOf(error);
  if (status !== null) {
    if (RETRYABLE_STATUS.has(status)) return { retryable: true, code: `http_${status}`, safe };
    // 4xx que não está na lista é pedido errado: repetir produz o mesmo 4xx.
    return { retryable: false, code: `http_${status}`, safe };
  }

  const pgCode = (error as { code?: unknown })?.code;
  if (typeof pgCode === 'string' && pgCode.length > 0) {
    if (RETRYABLE_PG_CODES.has(pgCode)) return { retryable: true, code: `pg_${pgCode}`, safe };
    return { retryable: false, code: `pg_${pgCode}`, safe };
  }

  const lowered = message.toLowerCase();
  if (RETRYABLE_HINTS.some((hint) => lowered.includes(hint))) {
    return { retryable: true, code: 'transient', safe };
  }

  /*
    O padrão é NÃO repetir. Repetir por omissão transformaria todo defeito novo
    e desconhecido em cinco execuções silenciosas antes de aparecer; não repetir
    o mostra na primeira.
  */
  return { retryable: false, code: 'unclassified', safe };
}
