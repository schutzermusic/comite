import { NextResponse } from 'next/server';
import { authorizePlatformCron } from '@/lib/platform/cron-auth';
import { platformServiceClient } from '@/lib/platform/server-client';
import { dispatchBillingAlertsForOrganization } from '@/lib/contracts/billing/planning/alert-dispatch-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Cron de ALERTAS DE MARCO DE FATURAMENTO.
 *
 * ─── Por que o alerta precisa de um agendador ─────────────────────────────
 *
 * "Avise 30 dias antes" é uma promessa sobre uma data que chega sozinha. Um
 * botão na tela só cumpre essa promessa se alguém abrir a tela naquele dia —
 * e o dia em que ninguém abre é exatamente o dia em que o aviso importava.
 *
 * ─── Autenticação ────────────────────────────────────────────────────────
 *
 * Somente `Authorization: Bearer` com um dos segredos da plataforma, em
 * comparação de tempo constante, pelo mesmo módulo que governa a drenagem da
 * fila. Sem sessão de navegador: nenhum humano, por mais permissões de produto
 * que tenha, dispara a rotina de todas as organizações — RBAC responde "o que
 * esta pessoa pode fazer no produto", e varrer inquilinos não é ação de
 * produto. Quem quer disparar para a PRÓPRIA organização usa a rota de
 * produto, que passa por `contracts.edit`.
 *
 * ─── Por que uma organização que falha não derruba as outras ─────────────
 *
 * Cada inquilino é processado isoladamente e o erro é COLECIONADO, não
 * propagado. Um contrato malformado numa organização não pode calar o aviso
 * de vencimento de todas as demais — e o relatório final nomeia quem falhou,
 * para que a falha não vire silêncio.
 */
export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const auth = authorizePlatformCron(req, 'api/contracts/billing/alerts/cron');
  if (!auth.ok) return auth.response;

  const service = platformServiceClient();
  const asOf = new Date().toISOString().slice(0, 10);

  // Só organizações com contrato vivo. Varrer inquilino sem contrato gastaria
  // uma materialização para descobrir que não há nada a materializar.
  const { data: orgs, error } = await service
    .from('contracts')
    .select('organization_id')
    .is('deleted_at', null);
  if (error) {
    return NextResponse.json(
      { ok: false, error: `Falha ao listar organizações: ${error.message}` },
      { status: 500 },
    );
  }

  const organizationIds = [...new Set((orgs ?? []).map((o) => o.organization_id as string))];

  const summaries = [];
  const failures: { organizationId: string; error: string }[] = [];
  for (const organizationId of organizationIds) {
    try {
      summaries.push(await dispatchBillingAlertsForOrganization(organizationId, { asOf }));
    } catch (e) {
      failures.push({
        organizationId,
        error: e instanceof Error ? e.message : 'Erro inesperado',
      });
    }
  }

  return NextResponse.json({
    ok: true,
    caller: auth.caller,
    as_of: asOf,
    organizations: organizationIds.length,
    alerts_created: summaries.reduce((s, x) => s + x.alertsCreated, 0),
    in_app: summaries.reduce((s, x) => s + x.inApp, 0),
    emails_sent: summaries.reduce((s, x) => s + x.emailsSent, 0),
    emails_simulated: summaries.reduce((s, x) => s + x.emailsSimulated, 0),
    // Estado do canal, não contagem de entrega: não há provedor integrado.
    whatsapp: summaries.some((x) => x.whatsapp === 'not_configured')
      ? 'not_configured' : 'disabled',
    dispatch_failures: summaries.reduce((s, x) => s + x.failures, 0),
    organization_failures: failures,
  });
}
