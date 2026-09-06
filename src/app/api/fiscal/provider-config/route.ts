import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { getFiscalServiceClient } from '@/lib/fiscal/server/store';
import { encryptFiscalSecret, hasFiscalSecretKey } from '@/lib/fiscal/server/secrets';
import { loadA1Certificate } from '@/lib/fiscal/provider/nfse-nacional/signature';
import { FISCAL_PROVIDERS, SANDBOX_PROVIDER_KEY, isKnownProvider, isRealProvider } from '@/lib/fiscal/provider';

export const runtime = 'nodejs';

const schema = z.object({
  establishmentId: z.string().uuid(),
  providerKey: z.string().trim().min(2).max(50),
  environment: z.enum(['homologation', 'production']),
  enabled: z.boolean(),
  /** Endereço do ambiente do provedor. Nunca embutido no código. */
  baseUrl: z.url().optional(),
  /** Certificado A1 em base64 (.pfx/.p12) e sua senha. Nunca persistidos em claro. */
  certificateBase64: z.string().min(64).optional(),
  certificatePassword: z.string().min(1).max(200).optional(),
  webhookSecret: z.string().min(8).max(200).optional(),
});

export async function POST(req: Request) {
  const auth = await resolveFiscalActor('fiscal.configure');
  if (!auth.ok) return auth.response;
  try {
    const input = schema.parse(await req.json());

    if (!isKnownProvider(input.providerKey)) {
      return NextResponse.json({ ok: false, error: `Provedor "${input.providerKey}" não possui adaptador instalado.` }, { status: 400 });
    }
    if (!FISCAL_PROVIDERS[input.providerKey].environments.includes(input.environment as never)) {
      return NextResponse.json({ ok: false, error: `O provedor "${input.providerKey}" não opera em ${input.environment}.` }, { status: 400 });
    }
    if (input.environment === 'production' && input.providerKey === SANDBOX_PROVIDER_KEY) {
      return NextResponse.json({ ok: false, error: 'O adaptador sandbox não pode ser habilitado em produção.' }, { status: 400 });
    }

    const client = getFiscalServiceClient();
    const establishment = await client.from('fiscal_establishments')
      .select('id,environment,production_enabled')
      .eq('organization_id', auth.actor.organizationId).eq('id', input.establishmentId).maybeSingle();
    if (establishment.error || !establishment.data) {
      return NextResponse.json({ ok: false, error: 'Estabelecimento não encontrado.' }, { status: 404 });
    }
    if (establishment.data.environment !== input.environment) {
      return NextResponse.json({ ok: false, error: 'O ambiente da integração deve coincidir com o estabelecimento.' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      organization_id: auth.actor.organizationId,
      establishment_id: input.establishmentId,
      provider_key: input.providerKey,
      environment: input.environment,
      enabled: input.enabled,
      created_by: auth.actor.userId,
      updated_by: auth.actor.userId,
    };
    if (input.baseUrl) patch.base_url = input.baseUrl;

    // ---- provedor real: o que dá para provar agora, é provado agora ----
    let health = { status: 'homologation_ready', message: 'Adaptador de homologação disponível.' };
    if (isRealProvider(input.providerKey)) {
      const missing: string[] = [];
      if (!hasFiscalSecretKey()) missing.push('FISCAL_CERT_KEY no ambiente do servidor');
      if (missing.length) {
        return NextResponse.json({ ok: false, error: `Configuração incompleta: falta ${missing.join(', ')}.`, code: 'FISCAL_CREDENTIALS_REQUIRED', missing }, { status: 400 });
      }
      if (input.certificateBase64) {
        if (!input.certificatePassword) {
          return NextResponse.json({ ok: false, error: 'A senha do certificado é obrigatória ao enviar o arquivo.' }, { status: 400 });
        }
        // Abrir o .pfx AGORA é o que impede descobrir que a senha estava errada
        // no meio de uma transmissão, seis tentativas depois.
        const pfx = Buffer.from(input.certificateBase64, 'base64');
        const certificate = loadA1Certificate(pfx, input.certificatePassword);
        patch.certificate_cipher = encryptFiscalSecret(pfx);
        patch.certificate_password_cipher = encryptFiscalSecret(input.certificatePassword);
        patch.certificate_subject = certificate.subject.slice(0, 500);
        patch.certificate_expires_at = certificate.notAfter.toISOString();
        patch.certificate_fingerprint = certificate.fingerprint;
        const expired = certificate.notAfter.getTime() <= Date.now();
        health = expired
          ? { status: 'certificate_expired', message: `Certificado vencido em ${certificate.notAfter.toISOString().slice(0, 10)}.` }
          : { status: 'certificate_valid', message: `Certificado válido até ${certificate.notAfter.toISOString().slice(0, 10)}.` };
      } else {
        health = { status: 'credentials_required', message: 'Envie o certificado A1 e a senha para concluir a integração.' };
      }
      if (input.webhookSecret) patch.webhook_secret_cipher = encryptFiscalSecret(input.webhookSecret);
      if (!input.baseUrl) health = { status: 'credentials_required', message: 'Informe o endereço (base_url) do ambiente antes de transmitir.' };
    }

    patch.last_health_at = new Date().toISOString();
    patch.last_health_status = health.status;
    patch.last_health_message = health.message;

    const { data, error } = await client.from('fiscal_provider_configs')
      .upsert(patch, { onConflict: 'organization_id,establishment_id,provider_key,environment' })
      // A projeção NUNCA inclui coluna `*_cipher`: o segredo entra e não volta.
      .select('id,establishment_id,provider_key,environment,enabled,base_url,certificate_subject,certificate_expires_at,certificate_fingerprint,last_health_at,last_health_status,last_health_message')
      .single();
    if (error) throw new Error(`Falha ao salvar integração: ${error.message}`);
    return NextResponse.json({ ok: true, config: data, requirements: FISCAL_PROVIDERS[input.providerKey].requirements });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao configurar provedor fiscal.');
  }
}
