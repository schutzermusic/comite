/**
 * WHATSAPP — a fronteira de provedor. Server-only: o registro decide pelo
 * ambiente do servidor, e o simulado guarda números em memória.
 */
if (typeof window !== 'undefined') {
  throw new Error('notifications/whatsapp não pode ser importado no navegador');
}

export * from './types';
export {
  RESERVED_WHATSAPP_PROVIDERS, registeredWhatsAppProviders, resolveWhatsAppChannel, whatsAppProviderAvailability,
  type WhatsAppProviderAvailability,
} from './registry';
export { fakeWhatsAppAvailable, fakeWhatsAppLog, resetFakeWhatsAppLog, type FakeWhatsAppMessage } from './fake';
