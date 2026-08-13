import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { listRecentRuns } from '@/lib/esocial/connector/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Histórico de execuções da ingestão — observabilidade do conector. */
export async function GET() {
  const r = await resolvePayrollActor('admin.manage_integrations');
  if (!r.ok) return r.response;
  const runs = await listRecentRuns(r.actor.organizationId, 20);
  return NextResponse.json({ ok: true, runs });
}
