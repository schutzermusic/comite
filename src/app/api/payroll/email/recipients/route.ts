import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';
import { payrollRecipientDirectory } from '@/lib/payroll/email-send-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/email/recipients — quem PODE receber o fechamento: membros
 * ativos da organização ativa e contatos externos autorizados. É daqui que a
 * tela escolhe; o envio aceita só referências a esta lista.
 */
export async function GET() {
  const actorRes = await resolvePayrollActor('people.payroll_send');
  if (!actorRes.ok) return actorRes.response;
  try {
    const dir = await payrollRecipientDirectory(getServerRepository(), actorRes.actor);
    const canManage = (await requireApiPermission('people.payroll_admin', { allowAdmin: true })).ok;
    return NextResponse.json({ ok: true, ...dir, can_manage_contacts: canManage });
  } catch (err) {
    console.error('[api/payroll/email/recipients] erro:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'Falha ao carregar destinatários.' }, { status: 500 });
  }
}
