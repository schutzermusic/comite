import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { AccessError, listAccess, runAccessAction } from '@/lib/ponto/access-server';
import type { PontoAccessAction } from '@/lib/ponto/access-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MANAGE_PERMISSION = 'people.manage';
const VALID_ACTIONS: PontoAccessAction[] = ['invite', 'resend', 'copy_link', 'block', 'reactivate', 'revoke'];

async function actorOrg(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('organization_id').eq('user_id', userId).maybeSingle();
  return (data?.organization_id as string | undefined) ?? null;
}

function fail(err: unknown): NextResponse {
  if (err instanceof AccessError) {
    return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  const serviceRoleMissing = /SUPABASE_SERVICE_ROLE_KEY/i.test(message);
  console.error('[api/ponto/access] failed', { message });
  return NextResponse.json(
    {
      ok: false,
      code: serviceRoleMissing ? 'service_role_missing' : 'unhandled',
      error: serviceRoleMissing
        ? 'Backend mal configurado: SUPABASE_SERVICE_ROLE_KEY ausente.'
        : `Erro interno: ${message}`,
    },
    { status: 500 },
  );
}

/** Lista o status de acesso ao Ponto de todas as pessoas da organização. */
export async function GET() {
  const guard = await requireApiPermission(MANAGE_PERMISSION);
  if (!guard.ok) return guard.response;
  try {
    const orgId = await actorOrg(guard.userId);
    if (!orgId) return NextResponse.json({ ok: false, error: 'Admin sem organização.' }, { status: 403 });
    const items = await listAccess(orgId);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return fail(err);
  }
}

/** Executa uma ação de acesso: invite | resend | copy_link | block | reactivate | revoke. */
export async function POST(req: Request) {
  const guard = await requireApiPermission(MANAGE_PERMISSION);
  if (!guard.ok) return guard.response;
  try {
    const orgId = await actorOrg(guard.userId);
    if (!orgId) return NextResponse.json({ ok: false, error: 'Admin sem organização.' }, { status: 403 });

    let body: { personId?: string; action?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 });
    }
    const personId = (body.personId ?? '').trim();
    const action = body.action as PontoAccessAction | undefined;
    if (!personId) return NextResponse.json({ ok: false, error: 'personId é obrigatório.' }, { status: 400 });
    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ ok: false, error: 'Ação inválida.' }, { status: 400 });
    }

    const origin = new URL(req.url).origin;
    const result = await runAccessAction(guard.userId, orgId, personId, action, origin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return fail(err);
  }
}
