/**
 * WHATSAPP — a fronteira de provedor. Contratos puros.
 *
 * O canal só sai com as TRÊS coisas ao mesmo tempo: linha ENABLED em
 * `notification_channel_integrations` (decisão governada, com motivo e
 * autor), provedor registrado e disponível NESTE ambiente, e credenciais
 * presentes. Variável de ambiente sozinha nunca liga canal externo.
 */

/** O que pode ir no corpo. MINIMAL: sem valor, sem fornecedor, sem justificativa. */
export type WhatsAppContentLevel = 'MINIMAL' | 'STANDARD';

export type WhatsAppEnv = Record<string, string | undefined>;

export interface WhatsAppMessage {
  /** E.164 (+5511999999999), informado pela própria pessoa (opt-in). */
  to: string;
  body: string;
}

export interface WhatsAppSendOptions {
  /** Estável por aviso: a retentativa não pode virar segunda mensagem. */
  idempotencyKey: string;
}

export interface WhatsAppProvider {
  /** Mesmo vocabulário de `notification_channel_integrations.provider` (^[a-z][a-z0-9_]{1,40}$). */
  readonly id: string;
  readonly displayName: string;
  /** Credenciais por NOME de variável; `missing` nunca carrega valor. */
  configured(env: WhatsAppEnv): { ok: boolean; missing: string[] };
  send(message: WhatsAppMessage, options: WhatsAppSendOptions): Promise<{ messageId: string }>;
}

/**
 * NOT_CONFIGURED            sem linha do canal na organização
 * DISABLED                  linha existe, status DISABLED
 * PROVIDER_NOT_IMPLEMENTED  provedor reservado (oficial futuro) ou desconhecido — nenhum código de rede existe
 * PROVIDER_UNAVAILABLE      provedor registrado, mas não neste ambiente (o simulado fora de teste/QA)
 * CREDENTIALS_MISSING       provedor disponível sem as credenciais que declara
 * READY                     pode enviar
 */
export type WhatsAppChannelState =
  | 'NOT_CONFIGURED' | 'DISABLED' | 'PROVIDER_NOT_IMPLEMENTED' | 'PROVIDER_UNAVAILABLE' | 'CREDENTIALS_MISSING' | 'READY';

/** O que se lê de `notification_channel_integrations` (channel = 'whatsapp'). */
export interface WhatsAppIntegrationRow {
  status: string;
  provider: string;
  content_level?: string | null;
}

export interface WhatsAppChannel {
  state: WhatsAppChannelState;
  provider: string | null;
  contentLevel: WhatsAppContentLevel;
  /** Nomes de variáveis ausentes (CREDENTIALS_MISSING). */
  missing: string[];
  /** Presente só em READY. */
  adapter: WhatsAppProvider | null;
}

/** Falha de envio. `retryable: false` = repetir não conserta (número inválido, conta bloqueada). */
export class WhatsAppSendError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'WhatsAppSendError';
    this.code = code;
    this.retryable = retryable;
  }
}
