import { NextResponse } from 'next/server';
import { getActiveOrganizationRow } from '@/lib/auth/active-organization';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { dispatchBillingAlertsForOrganization } from '@/lib/contracts/billing/planning/alert-dispatch-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/contracts/billing/alerts/dispatch
 *
 * Materializa e entrega os alertas de marco de faturamento da organização do
 * chamador. O comportamento mora em `alert-dispatch-server.ts`, compartilhado
 * com o cron — para que o alerta do botão e o alerta agendado sejam,
 * literalmente, o mesmo alerta.
 */
export async function POST(req: Request) {
  const guard = await requireApiPermission('contracts.edit', { allowAdmin: true });
  if (!guard.ok) return guard.response;

  let body: { asOf?: string; test?: boolean } = {};
  try { body = (await req.json()) as typeof body; } catch { /* corpo vazio é válido */ }

  const supabase = await createClient();
  const profile = await getActiveOrganizationRow(supabase);
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) return NextResponse.json({ ok: false, error: 'Usuário sem organização.' }, { status: 403 });

  try {
    const s = await dispatchBillingAlertsForOrganization(orgId, {
      asOf: body.asOf, test: body.test,
    });
    return NextResponse.json({
      ok: true,
      as_of: s.asOf,
      alerts_created: s.alertsCreated,
      alerts_considered: s.alertsConsidered,
      in_app: s.inApp,
      email: s.email,
      emails_sent: s.emailsSent,
      emails_simulated: s.emailsSimulated,
      // O contrato de resposta DIZ que não houve entrega por WhatsApp.
      whatsapp: s.whatsapp,
      whatsapp_skipped: s.whatsappSkipped,
      failures: s.failures,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erro inesperado.' },
      { status: 500 },
    );
  }
}
