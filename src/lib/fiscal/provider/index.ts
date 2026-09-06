/**
 * Registro de provedores fiscais.
 *
 * A abstração existe para que o Apex não fique casado com um município nem com
 * um fornecedor. Acrescentar um provedor é acrescentar uma entrada aqui e uma
 * classe que implemente `FiscalProvider` — nada no motor, nas rotas ou no banco
 * precisa saber qual está ativo.
 *
 * O sandbox não recebe dependências porque não fala com ninguém. O provedor
 * real recebe, porque sem certificado e endereço ele não pode fazer nada — e a
 * forma de dizer isso é falhar na construção, não descobrir no meio da
 * transmissão.
 */
import type { FiscalProvider } from './types';
import { SandboxFiscalProvider } from './sandbox';
import { NFSE_NACIONAL_PROVIDER_KEY, NfseNacionalProvider, type NfseNacionalDeps } from './nfse-nacional';

export * from './types';
export * from './errors';
export { NFSE_NACIONAL_PROVIDER_KEY } from './nfse-nacional';

export const SANDBOX_PROVIDER_KEY = 'sandbox';

/** Provedores conhecidos, com o que cada um exige antes de transmitir. */
export const FISCAL_PROVIDERS = {
  [SANDBOX_PROVIDER_KEY]: {
    label: 'Sandbox de homologação (Apex)',
    real: false,
    environments: ['homologation'] as const,
    requirements: [] as const,
  },
  [NFSE_NACIONAL_PROVIDER_KEY]: {
    label: 'NFS-e — Sistema Nacional',
    real: true,
    environments: ['homologation', 'production'] as const,
    requirements: [
      'certificado digital ICP-Brasil A1 (.pfx) da organização emitente',
      'senha do certificado A1',
      'inscrição municipal ativa do estabelecimento',
      'adesão/credenciamento no ambiente nacional da NFS-e',
      'endereço (base_url) do ambiente de homologação',
    ] as const,
  },
} as const;

export type FiscalProviderKey = keyof typeof FISCAL_PROVIDERS;

export function isKnownProvider(key: string): key is FiscalProviderKey {
  return key in FISCAL_PROVIDERS;
}

export function isRealProvider(key: string): boolean {
  return isKnownProvider(key) && FISCAL_PROVIDERS[key].real;
}

export interface FiscalProviderFactoryInput {
  providerKey: string;
  /** Só o provedor real usa; o sandbox ignora. */
  deps?: NfseNacionalDeps;
}

export function getFiscalProvider({ providerKey, deps }: FiscalProviderFactoryInput): FiscalProvider {
  if (providerKey === SANDBOX_PROVIDER_KEY) return new SandboxFiscalProvider();
  if (providerKey === NFSE_NACIONAL_PROVIDER_KEY) {
    if (!deps) throw new Error('O provedor nacional exige credenciais e cadastro resolvidos antes da construção.');
    return new NfseNacionalProvider(deps);
  }
  throw new Error(`Provedor fiscal "${providerKey}" ainda não possui adaptador instalado.`);
}
