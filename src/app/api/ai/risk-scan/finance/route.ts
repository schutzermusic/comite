import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { scanFinanceForRisks } from '@/lib/ai/finance/finance-risk-scanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScanBody {
  periodFrom?: string;
  periodTo?: string;
}

export async function POST(req: Request) {
  try {
    let body: ScanBody = {};
    try {
      body = (await req.json()) as ScanBody;
    } catch {
      // empty body is fine — defaults to last 90 days
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

    const result = await scanFinanceForRisks(user.id, {
      periodFrom: body.periodFrom,
      periodTo: body.periodTo,
    });

    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      period: result.periodLabel,
      findings_count: result.findings.length,
      inserted: result.persistence.inserted.length,
      skipped_duplicates: result.persistence.skippedDuplicates,
      risks: result.persistence.inserted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[api/ai/risk-scan/finance] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
