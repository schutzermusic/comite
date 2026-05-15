import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { scanContractForRisks } from '@/lib/ai/risk-scanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: contractId } = await params;
    if (!contractId) {
      return NextResponse.json({ ok: false, error: 'contractId ausente' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
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

    const keys = new Set<string>();
    type PermShape = { roles?: { role_permissions?: Array<{ permissions?: { key?: string } }> } };
    for (const row of (perms ?? []) as unknown as PermShape[]) {
      const rps = row?.roles?.role_permissions ?? [];
      for (const rp of rps) {
        const k = rp?.permissions?.key;
        if (k) keys.add(k);
      }
    }
    if (!keys.has('risks.ai_scan')) {
      return NextResponse.json(
        { ok: false, error: 'Sem permissão risks.ai_scan' },
        { status: 403 },
      );
    }

    const { findings, rows } = await scanContractForRisks(contractId, user.id);

    return NextResponse.json({
      ok: true,
      inserted: rows.length,
      findings_count: findings.length,
      risks: rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[api/ai/risk-scan/contracts] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
