import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { ReviewError, listReviewItems, resolvePunch } from '@/lib/ponto/review-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PERMISSION = 'people.attendance_manage';

async function actorOrg(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('organization_id').eq('user_id', userId).maybeSingle();
  return (data?.organization_id as string | undefined) ?? null;
}

function fail(err: unknown): NextResponse {
  if (err instanceof ReviewError) {
    return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('[api/ponto/review] failed', { message });
  return NextResponse.json({ ok: false, error: `Erro interno: ${message}` }, { status: 500 });
}

/** Lista as marcações em revisão da organização, com selfie + geofence. */
export async function GET() {
  const guard = await requireApiPermission(PERMISSION);
  if (!guard.ok) return guard.response;
  try {
    const orgId = await actorOrg(guard.userId);
    if (!orgId) return NextResponse.json({ ok: false, error: 'Admin sem organização.' }, { status: 403 });
    const items = await listReviewItems(orgId);
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return fail(err);
  }
}

/** Resolve uma marcação: { punchId, decision: 'accept'|'reject', note? }. */
export async function POST(req: Request) {
  const guard = await requireApiPermission(PERMISSION);
  if (!guard.ok) return guard.response;
  try {
    const orgId = await actorOrg(guard.userId);
    if (!orgId) return NextResponse.json({ ok: false, error: 'Admin sem organização.' }, { status: 403 });

    let body: { punchId?: string; decision?: string; note?: string } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 });
    }
    const punchId = (body.punchId ?? '').trim();
    const decision = body.decision;
    if (!punchId) return NextResponse.json({ ok: false, error: 'punchId é obrigatório.' }, { status: 400 });
    if (decision !== 'accept' && decision !== 'reject') {
      return NextResponse.json({ ok: false, error: 'decision deve ser accept ou reject.' }, { status: 400 });
    }
    await resolvePunch(guard.userId, orgId, punchId, decision, body.note ?? null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
