/**
 * Monta o provedor de um documento: qual adaptador, com quais credenciais e
 * com qual cadastro.
 *
 * Isto vive separado do motor de propósito. Decidir COM QUEM falar e reunir o
 * que a conversa exige é responsabilidade distinta de conduzir a conversa — e
 * é aqui que mora a única leitura de segredo do módulo.
 */
import {
  FISCAL_PROVIDERS,
  SANDBOX_PROVIDER_KEY,
  getFiscalProvider,
  isKnownProvider,
  isRealProvider,
  FiscalCredentialsRequiredError,
  type FiscalProvider,
} from '../provider';
import { NFSE_NACIONAL_PROVIDER_KEY } from '../provider';
import type { DpsIssuer, DpsRecipient, DpsService } from '../provider/nfse-nacional/dps';
import { decryptFiscalSecret, decryptFiscalSecretBytes, hasFiscalSecretKey } from './secrets';
import { getFiscalServiceClient, resolveFiscalRecipient, reserveDpsNumber } from './store';
import type { FiscalDocument, FiscalEnvironment, FiscalEstablishment, FiscalServiceCatalogEntry } from '../types';

export interface ResolvedProvider {
  provider: FiscalProvider;
  providerKey: string;
  environment: FiscalEnvironment;
  establishment: FiscalEstablishment;
  /** Número reservado quando a operação é emissão; ausente nas demais. */
  dpsNumber?: number;
}

interface ProviderConfigRow {
  provider_key: string;
  environment: FiscalEnvironment;
  enabled: boolean;
  base_url: string | null;
  credentials_cipher: string | null;
  certificate_cipher: string | null;
  certificate_password_cipher: string | null;
  webhook_secret_cipher: string | null;
}

function issuerFrom(establishment: FiscalEstablishment): DpsIssuer {
  return {
    cnpj: establishment.cnpj,
    municipal_registration: establishment.municipal_registration,
    legal_name: establishment.legal_name,
    trade_name: establishment.trade_name,
    tax_regime: establishment.tax_regime,
    special_tax_regime: establishment.special_tax_regime,
    municipality_ibge: establishment.municipality_ibge,
    postal_code: establishment.postal_code,
    street: establishment.street,
    street_number: establishment.street_number,
    complement: establishment.complement,
    district: establishment.district,
    uf: establishment.uf,
  };
}

export async function resolveDocumentProvider(
  document: FiscalDocument,
  options: { reserveDps?: boolean } = {},
): Promise<ResolvedProvider> {
  const client = getFiscalServiceClient();

  const { data: establishmentRow, error: establishmentError } = await client
    .from('fiscal_establishments').select('*')
    .eq('organization_id', document.organization_id).eq('id', document.establishment_id).single();
  if (establishmentError || !establishmentRow) throw new Error('Estabelecimento do documento fiscal não encontrado.');
  const establishment = establishmentRow as FiscalEstablishment;

  // O ambiente é o congelado no documento. Se o cadastro migrou para produção
  // depois que o rascunho nasceu, o rascunho continua sendo de homologação.
  const environment = document.environment;
  if (environment === 'production' && !establishment.production_enabled) {
    throw new FiscalCredentialsRequiredError('produção', [
      'produção fiscal não habilitada para o estabelecimento (portão de produção incompleto)',
    ]);
  }

  const { data: configRow, error: configError } = await client
    .from('fiscal_provider_configs').select('*')
    .eq('organization_id', document.organization_id)
    .eq('establishment_id', establishment.id)
    .eq('environment', environment)
    .eq('enabled', true)
    .maybeSingle();
  if (configError) throw new Error(`Falha ao ler a integração fiscal: ${configError.message}`);

  const config = (configRow as ProviderConfigRow | null) ?? null;
  const providerKey = config?.provider_key ?? SANDBOX_PROVIDER_KEY;

  if (!isKnownProvider(providerKey)) {
    throw new Error(`Provedor fiscal "${providerKey}" ainda não possui adaptador instalado.`);
  }
  if (!FISCAL_PROVIDERS[providerKey].environments.includes(environment as never)) {
    throw new Error(`O provedor "${providerKey}" não opera em ${environment}.`);
  }

  // A numeração é do ESTABELECIMENTO, não do provedor: o sandbox percorre o
  // mesmo caminho fiscal que o adaptador real, e é justamente isso que faz dele
  // um ensaio útil. Reaproveita o número já reservado; só reserva quando não há.
  const dpsNumber = options.reserveDps
    ? document.dps_number ?? (await reserveDpsNumber(document.organization_id, establishment.id))
    : document.dps_number ?? undefined;

  if (!isRealProvider(providerKey)) {
    return { provider: getFiscalProvider({ providerKey }), providerKey, environment, establishment, dpsNumber };
  }

  // ---- provedor real: reunir o que ele exige, ou parar dizendo o que falta ----
  const missing: string[] = [];
  if (!config) missing.push(`integração ${NFSE_NACIONAL_PROVIDER_KEY} habilitada para ${environment}`);
  if (!hasFiscalSecretKey()) missing.push('variável de ambiente FISCAL_CERT_KEY (mínimo 32 caracteres)');
  if (config && !config.base_url) missing.push('endereço (base_url) do ambiente nacional');
  if (config && !config.certificate_cipher) missing.push('certificado digital A1 (.pfx) carregado na integração');
  if (config && !config.certificate_password_cipher) missing.push('senha do certificado A1');
  if (!establishment.municipal_registration) missing.push('inscrição municipal do estabelecimento');
  if (missing.length) throw new FiscalCredentialsRequiredError(providerKey, missing);

  const recipient = await resolveFiscalRecipient(document.organization_id, document.party_id);
  const service = document.service_snapshot as unknown as FiscalServiceCatalogEntry;

  const dpsRecipient: DpsRecipient = {
    document_type: (recipient.document_type ?? 'cnpj') as DpsRecipient['document_type'],
    document_number: recipient.document_normalized ?? '',
    legal_name: recipient.legal_name,
    municipal_registration: recipient.profile?.municipal_registration ?? null,
    email: recipient.profile?.email ?? null,
    municipality_ibge: recipient.profile?.municipality_ibge ?? null,
    postal_code: recipient.profile?.postal_code ?? null,
    street: recipient.profile?.street ?? null,
    street_number: recipient.profile?.street_number ?? null,
    complement: recipient.profile?.complement ?? null,
    district: recipient.profile?.district ?? null,
    uf: recipient.profile?.uf ?? null,
    country_code: recipient.profile?.country_code ?? 'BR',
  };

  const dpsService: DpsService = {
    lc116_code: service.lc116_code,
    nbs_code: service.nbs_code,
    municipal_service_code: service.municipal_service_code,
    iss_rate: Number(service.iss_rate ?? 0),
    iss_withheld: Boolean(
      (document.tax_snapshot as { preview?: { lines?: Array<{ tax_code: string; withheld: boolean }> } })
        ?.preview?.lines?.find((line) => line.tax_code === 'ISS')?.withheld,
    ),
  };

  const provider = getFiscalProvider({
    providerKey,
    deps: {
      credentials: {
        baseUrl: config!.base_url,
        certificatePfx: decryptFiscalSecretBytes(config!.certificate_cipher!),
        certificatePassword: decryptFiscalSecret(config!.certificate_password_cipher!),
        webhookSecret: config!.webhook_secret_cipher ? decryptFiscalSecret(config!.webhook_secret_cipher) : null,
      },
      issuer: issuerFrom(establishment),
      recipient: dpsRecipient,
      service: dpsService,
      dpsNumber: dpsNumber ?? 0,
    },
  });

  return { provider, providerKey, environment, establishment, dpsNumber };
}
