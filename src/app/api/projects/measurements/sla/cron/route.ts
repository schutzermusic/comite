import { NextResponse } from 'next/server';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';
import { platformServiceClient } from '@/lib/platform/server-client';
import {
  dispatchDownstreamHandoffs, dispatchMeasurementSlaReminders,
} from '@/lib/projects/measurements/handoff-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cron de LEMBRETES DE SLA DE MEDIÇÃO.
 *
 * ─── Por que o lembrete precisa de um agendador ───────────────────────────
 *
 * "Cobre quando passar do prazo" é uma promessa sobre uma data que chega
 * sozinha. Um botão na tela só a cumpre se alguém abrir a tela naquele dia — e
 * o dia em que ninguém abre é exatamente o dia em que a cobrança importava.
 *
 * ─── Autenticação ────────────────────────────────────────────────────────
 *
 * Só `Authorization: Bearer` com segredo de plataforma, em comparação de tempo
 * constante, pelo mesmo módulo que governa a drenagem da fila. Sem sessão de
 * navegador: varrer inquilinos não é ação de produto, e RBAC responde o que
 * uma pessoa pode fazer NO produto.
 *
 * ─── O que ele não faz ───────────────────────────────────────────────────
 *
 * Não escala sozinho para ninguém que a política não nomeou, não muda estado de
 * medição nenhuma e não cobra prazo que ninguém declarou: a função de banco só
 * devolve pendência com prazo DECLARADO e vencido, e o intervalo entre dois
 * lembretes é o da política.
 */
export async function GET(req: Request) { return handle(req); }
export async function POST(req: Request) { return handle(req); }

async function handle(req: Request) {
  const auth = authorizePlatformCron(req, 'api/projects/measurements/sla/cron');
  if (!auth.ok) return auth.response;

  const service = platformServiceClient();
  const asOf = new Date().toISOString().slice(0, 10);

  /*
    Só organizações com medição VIVA num estado da fila. Varrer inquilino sem
    medição gastaria uma consulta para descobrir que não há nada a cobrar.
  */
  const { data: rows, error } = await service
    .from('project_measurements')
    .select('organization_id')
    .in('status', ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED_FOR_CUSTOMER',
      'AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_CORRECTION_REQUESTED',
      'RETURNED_FOR_CORRECTION']);
  if (error) {
    return NextResponse.json(
      { ok: false, error: `Falha ao listar organizações: ${error.message}` }, { status: 500 });
  }

  const organizationIds = [...new Set((rows ?? []).map((r) => r.organization_id as string))];

  const summaries = [];
  const downstream = [];
  const failures: { organizationId: string; error: string }[] = [];
  for (const organizationId of organizationIds) {
    try {
      summaries.push(await dispatchMeasurementSlaReminders(organizationId, { asOf }));
    } catch (e) {
      // Erro COLECIONADO, nunca propagado: um inquilino malformado não pode
      // calar a cobrança de todos os demais.
      failures.push({ organizationId, error: e instanceof Error ? e.message : 'Erro inesperado' });
    }
  }

  /*
    A cadeia A JUSANTE varre TODAS as organizações com evento de faturamento
    vindo de medição — e não só as que têm medição em voo. Um marco aceito no
    mês passado pode ter virado elegível hoje, e a medição dele já saiu da fila
    de análise: recortar por medição viva perderia exatamente esse caso.
  */
  const { data: c2cOrgs } = await service
    .from('contract_to_cash_read_model')
    .select('organization_id')
    .not('source_measurement_id', 'is', null);
  for (const organizationId of [...new Set((c2cOrgs ?? []).map((r) => r.organization_id as string))]) {
    try {
      downstream.push(await dispatchDownstreamHandoffs(organizationId));
    } catch (e) {
      failures.push({ organizationId, error: e instanceof Error ? e.message : 'Erro inesperado' });
    }
  }

  return NextResponse.json({
    ok: true,
    caller: auth.caller,
    as_of: asOf,
    organizations: organizationIds.length,
    considered: summaries.reduce((s, x) => s + x.considered, 0),
    in_app: summaries.reduce((s, x) => s + x.inApp, 0)
      + downstream.reduce((s, x) => s + x.inApp, 0),
    emails_sent: summaries.reduce((s, x) => s + x.emailsSent, 0)
      + downstream.reduce((s, x) => s + x.emailsSent, 0),
    emails_simulated: summaries.reduce((s, x) => s + x.emailsSimulated, 0)
      + downstream.reduce((s, x) => s + x.emailsSimulated, 0),
    dispatch_failures: summaries.reduce((s, x) => s + x.failures, 0)
      + downstream.reduce((s, x) => s + x.failures, 0),
    // Pendência sem responsável resolvido é RELATADA, não silenciada.
    undefined_responsible: summaries.reduce((s, x) => s + x.undefinedResponsible, 0)
      + downstream.reduce((s, x) => s + x.undefinedResponsible, 0),
    billing_eligible_notified: downstream.reduce((s, x) => s + x.eligibleNotified, 0),
    invoice_due_notified: downstream.reduce((s, x) => s + x.invoiceDueNotified, 0),
    organization_failures: failures,
  });
}
