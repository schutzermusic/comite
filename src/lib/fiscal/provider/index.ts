import type { FiscalProvider } from './types';
import { SandboxFiscalProvider } from './sandbox';

export * from './types';

export function getFiscalProvider(providerKey: string): FiscalProvider {
  if (providerKey === 'sandbox') return new SandboxFiscalProvider();
  throw new Error(`Provedor fiscal "${providerKey}" ainda não possui adaptador instalado.`);
}

