import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getServiceClient } from '@/lib/ai/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DismissBody {
  reason?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: riskId } = await params;
    if (!riskId) {
      return NextResponse.json({ ok: false, error: 'riskId ausente' }, { status: 400 });
    }
    let body: DismissBody = {};
    try {
      body = (await req.json()) as DismissBody;
    } catch {
      // optional body
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 });
    }

    const { data: perms, error: permErr } = await supabase
      .from('user_roles')
      .select('roles!inner(role_permissions!inner(permissions!inner(key)))')
      .eq('user_id', user.id);
    if (permErr) {
      return NextResponse.json(
        { ok: false, error: `Erro ao verificar permissões: ${permErr.message}` },
        { status: 500 },
      );
    }
    type PermShape = { roles?: { role_permissions?: Array<{ permissions?: { key?: string } }> } };
    const keys = new Set<string>();
    for (const row of (perms ?? []) as unknown as PermShape[]) {
      for (const rp of row?.roles?.role_permissions ?? []) {
        const k = rp?.permissions?.key;
        if (k) keys.add(k);
      }
    }
    if (!keys.has('risks.ai_dismiss')) {
      return NextResponse.json(
        { ok: false, error: 'Sem permissão risks.ai_dismiss' },
        { status: 403 },
      );
    }

    const service = getServiceClient();
    // Verify org match server-side before mutating with service-role.
    const [{ data: profile }, { data: risk }] = await Promise.all([
      service
        .from('profiles')
        .select('organization_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      service
        .from('risks')
        .select('id,organization_id,origin,ai_dismissed')
        .eq('id', riskId)
        .maybeSingle(),
    ]);
    if (!risk) {
      return NextResponse.json({ ok: false, error: 'Risco não encontrado' }, { status: 404 });
    }
    if (!profile?.organization_id || profile.organization_id !== risk.organization_id) {
      return NextResponse.json({ ok: false, error: 'Risco fora da sua organização' }, { status: 403 });
    }
    if (risk.origin !== 'ai') {
      return NextResponse.json(
        { ok: false, error: 'Somente riscos com origin=ai podem ser descartados.' },
        { status: 400 },
      );
    }
    if (risk.ai_dismissed) {
      return NextResponse.json({ ok: true, already: true });
    }

    const { data, error } = await service
      .from('risks')
      .update({
        ai_dismissed: true,
        ai_dismissed_at: new Date().toISOString(),
        ai_dismissed_by: user.id,
        ai_dismissal_reason: body.reason?.trim() || null,
      })
      .eq('id', riskId)
      .select('*')
      .single();
    if (error) {
      return NextResponse.json(
        { ok: false, error: `Erro ao descartar: ${error.message}` },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, risk: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[api/ai/risks/[id]/dismiss] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
