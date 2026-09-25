/**
 * WHATSAPP — registro de provedores e resolução do canal.
 *
 * Só o simulado está implementado. Os oficiais estão RESERVADOS pelo nome
 * (para que uma linha governada que os cite seja lida como "ainda não
 * implementado", e não como provedor desconhecido), sem uma linha de código de
 * rede. Implementar um é o roteiro do README ao lado.
 */
import { fakeWhatsAppAvailable, fakeWhatsAppProvider } from './fake';
import type { WhatsAppChannel, WhatsAppContentLevel, WhatsAppEnv, WhatsAppIntegrationRow, WhatsAppProvider } from './types';

/** Provedores oficiais previstos. Nome reservado ≠ provedor disponível. */
export const RESERVED_WHATSAPP_PROVIDERS = ['meta_cloud', 'twilio', 'zenvia', 'gupshup'] as const;

interface Registration {
  provider: WhatsAppProvider;
  /** Em que ambiente o provedor pode rodar (o simulado: só teste e QA). */
  available(env: WhatsAppEnv): boolean;
}

const REGISTRY: Readonly<Record<string, Registration>> = {
  fake: { provider: fakeWhatsAppProvider, available: fakeWhatsAppAvailable },
};

export function registeredWhatsAppProviders(): string[] {
  return Object.keys(REGISTRY);
}

export type WhatsAppProviderAvailability =
  | { status: 'AVAILABLE'; provider: WhatsAppProvider }
  | { status: 'PROVIDER_NOT_IMPLEMENTED'; reserved: boolean }
  | { status: 'PROVIDER_UNAVAILABLE' };

export function whatsAppProviderAvailability(id: string, env: WhatsAppEnv = process.env): WhatsAppProviderAvailability {
  const reg = Object.prototype.hasOwnProperty.call(REGISTRY, id) ? REGISTRY[id] : undefined;
  if (!reg) {
    return { status: 'PROVIDER_NOT_IMPLEMENTED', reserved: (RESERVED_WHATSAPP_PROVIDERS as readonly string[]).includes(id) };
  }
  return reg.available(env) ? { status: 'AVAILABLE', provider: reg.provider } : { status: 'PROVIDER_UNAVAILABLE' };
}

/**
 * O estado do canal numa organização. A ORDEM importa: a linha governada vem
 * antes de tudo — sem ela, nem o simulado em ambiente de teste liga o canal.
 */
export function resolveWhatsAppChannel(row: WhatsAppIntegrationRow | null, env: WhatsAppEnv = process.env): WhatsAppChannel {
  const contentLevel: WhatsAppContentLevel = row?.content_level === 'STANDARD' ? 'STANDARD' : 'MINIMAL';
  const base = { provider: row?.provider ?? null, contentLevel, missing: [] as string[], adapter: null };
  if (!row) return { ...base, state: 'NOT_CONFIGURED' };
  if (row.status !== 'ENABLED') return { ...base, state: 'DISABLED' };
  const availability = whatsAppProviderAvailability(row.provider, env);
  if (availability.status !== 'AVAILABLE') return { ...base, state: availability.status };
  const creds = availability.provider.configured(env);
  if (!creds.ok) return { ...base, state: 'CREDENTIALS_MISSING', missing: [...creds.missing] };
  return { ...base, state: 'READY', adapter: availability.provider };
}
