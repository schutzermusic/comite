import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { getFiscalServiceClient } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

const schema = z.object({
  establishmentId: z.string().uuid(),
  providerKey: z.string().trim().min(2).max(50),
  environment: z.enum(['homologation','production']),
  enabled: z.boolean(),
});

export async function POST(req: Request) {
  const auth = await resolveFiscalActor('fiscal.configure');
  if (!auth.ok) return auth.response;
  try {
    const input = schema.parse(await req.json());
    if (input.environment === 'production' && input.providerKey === 'sandbox') {
      return NextResponse.json({ ok: false, error: 'O adaptador sandbox não pode ser habilitado em produção.' }, { status: 400 });
    }
    const client = getFiscalServiceClient();
    const establishment = await client.from('fiscal_establishments').select('id,environment').eq('organization_id', auth.actor.organizationId).eq('id', input.establishmentId).single();
    if (establishment.error || !establishment.data) return NextResponse.json({ ok: false, error: 'Estabelecimento não encontrado.' }, { status: 404 });
    if (establishment.data.environment !== input.environment) return NextResponse.json({ ok: false, error: 'O ambiente da integração deve coincidir com o estabelecimento.' }, { status: 400 });
    const { data, error } = await client.from('fiscal_provider_configs').upsert({
      organization_id: auth.actor.organizationId,
      establishment_id: input.establishmentId,
      provider_key: input.providerKey,
      environment: input.environment,
      enabled: input.enabled,
      last_health_at: new Date().toISOString(),
      last_health_status: input.providerKey === 'sandbox' ? 'homologation_ready' : 'credentials_required',
      created_by: auth.actor.userId,
      updated_by: auth.actor.userId,
    }, { onConflict: 'establishment_id,provider_key,environment' }).select('id,establishment_id,provider_key,environment,enabled,last_health_status').single();
    if (error) throw new Error(`Falha ao salvar integração: ${error.message}`);
    return NextResponse.json({ ok: true, config: data });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao configurar provedor fiscal.');
  }
}

