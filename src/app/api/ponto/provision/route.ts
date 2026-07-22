import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { AccessError, provisionPerson } from '@/lib/ponto/access-server';
import type { PontoProvisionSource } from '@/lib/ponto/access-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERMISSION = 'people.manage';
const SOURCES: PontoProvisionSource[] = ['manual', 'allocation', 'batch'];

async function actorOrg(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('organization_id').eq('user_id', userId).maybeSingle();
  return (data?.organization_id as string | undefined) ?? null;
}

/**
 * Provisionamento imediato/manual do acesso de UMA pessoa (idempotente).
 * Útil como gatilho na tela de alocação/pessoas. A reconciliação por cron
 * cobre o caso automático; este é o atalho síncrono.
 */
export async function POST(req: Request) {
  const guard = await requireApiPermission(PERMISSION);
  if (!guard.ok) return guard.response;
  try {
    const orgId = await actorOrg(guard.userId);
    if (!orgId) return NextResponse.json({ ok: false, error: 'Admin sem organização.' }, { status: 403 });

    let body: { personId?: string; source?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 });
    }
    const personId = (body.personId ?? '').trim();
    if (!personId) return NextResponse.json({ ok: false, error: 'personId é obrigatório.' }, { status: 400 });
    const source = (SOURCES.includes(body.source as PontoProvisionSource) ? body.source : 'manual') as PontoProvisionSource;

    const origin = new URL(req.url).origin;
    const result = await provisionPerson(guard.userId, orgId, personId, origin, source);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/ponto/provision] failed', { message });
    return NextResponse.json({ ok: false, error: `Erro interno: ${message}` }, { status: 500 });
  }
}
