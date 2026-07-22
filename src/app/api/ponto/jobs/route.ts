import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { isAutomationEnabled } from '@/lib/ponto/access-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Schedules declarados em vercel.json (para exibição do "próximo agendado").
const SCHEDULES = { cron: '0 * * * * (horário)', retention: '0 3 * * * (diário 03h)' };

/**
 * Observabilidade dos jobs do Ponto para gestores. Lê ponto_job_runs sob
 * RLS (sessão do usuário) e devolve o estado da automação (boolean, NUNCA o
 * segredo). Gated por people.attendance_manage.
 */
export async function GET() {
  const guard = await requireApiPermission('people.attendance_manage');
  if (!guard.ok) return guard.response;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('ponto_job_runs')
      .select('id, run_id, job_type, organization_id, started_at, completed_at, status, dry_run, automation_enabled, scanned, succeeded, skipped, failed, error_summary, continuation_cursor, triggered_by')
      .order('started_at', { ascending: false })
      .limit(20);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      automationEnabled: isAutomationEnabled(),
      schedules: SCHEDULES,
      runs: data ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Erro interno: ${message}` }, { status: 500 });
  }
}
