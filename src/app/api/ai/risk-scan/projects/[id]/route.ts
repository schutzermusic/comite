import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { scanProjectForRisks } from '@/lib/ai/projects/projects-risk-scanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    if (!projectId) {
      return NextResponse.json({ ok: false, error: 'projectId ausente' }, { status: 400 });
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
    if (!keys.has('risks.ai_scan')) {
      return NextResponse.json({ ok: false, error: 'Sem permissão risks.ai_scan' }, { status: 403 });
    }

    const { findings, persistence } = await scanProjectForRisks(projectId, user.id);

    return NextResponse.json({
      ok: true,
      findings_count: findings.length,
      inserted: persistence.inserted.length,
      skipped_duplicates: persistence.skippedDuplicates,
      risks: persistence.inserted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[api/ai/risk-scan/projects] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
