/**
 * A ENTREGA DOS ALERTAS de marco de faturamento — server-only.
 *
 * Numa biblioteca, e não dentro de uma rota, porque tem dois chamadores com
 * autorizações completamente diferentes:
 *
 *   · a rota de produto, disparada por alguém com `contracts.edit`
 *   · o cron da plataforma, que não tem usuário e autentica por segredo
 *
 * O que os dois compartilham é o COMPORTAMENTO, e ele precisa ser o mesmo:
 * duplicar a lógica faria o alerta do cron divergir do alerta do botão — e a
 * divergência apareceria como um e-mail que o usuário não consegue reproduzir.
 *
 * ─── As duas idempotências, e por que são duas ────────────────────────────
 *
 *   1. MATERIALIZAÇÃO — `cbma_idempotent` (marco, data prevista,
 *      antecedência). Rodar dez vezes no mesmo dia cria na primeira e zero nas
 *      outras nove.
 *
 *   2. ENTREGA — `cbad_idempotent` (alerta, destinatário, canal). Se a rotina
 *      cair no meio e for repetida, quem já recebeu não recebe de novo.
 *
 * Separadas porque falham em momentos diferentes: um alerta pode nascer hoje e
 * só sair por e-mail amanhã, quando a chave do provedor voltar. Uma
 * idempotência só forçaria a escolha entre reenviar tudo ou nada.
 *
 * ─── WhatsApp ────────────────────────────────────────────────────────────
 *
 * Não há provedor de WhatsApp integrado neste produto. O canal, quando pedido
 * na política, é registrado como NOT_CONFIGURED — nem 'FAILED' (que insinuaria
 * tentativa de entrega), nem 'SIMULATED' (que insinuaria um ensaio). O
 * resultado devolve `whatsapp: 'not_configured'` para que a tela diga a mesma
 * coisa, em vez de exibir um ícone de enviado.
 */
import { platformServiceClient } from '@/lib/platform/server-client';
import { getPublicAppOrigin } from '@/lib/config/app-url';
import {
  buildAlertContent, buildAlertEmailHtml, type BillingMilestoneAlert,
} from './alert-content';

const DEFAULT_FROM = 'INSIGHT APEX <no-reply@insightapex.co>';

export interface AlertDispatchSummary {
  readonly organizationId: string;
  readonly asOf: string;
  readonly alertsCreated: number;
  readonly alertsConsidered: number;
  readonly inApp: number;
  readonly email: 'sent' | 'simulated' | 'disabled';
  readonly emailsSent: number;
  readonly emailsSimulated: number;
  readonly whatsapp: 'not_configured' | 'disabled';
  readonly whatsappSkipped: number;
  readonly failures: number;
}

export async function dispatchBillingAlertsForOrganization(
  organizationId: string,
  options: { asOf?: string; test?: boolean } = {},
): Promise<AlertDispatchSummary> {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const service = platformServiceClient();

  // ── 1) Materializar ────────────────────────────────────────────────────
  const { data: created, error: materializeError } = await service.rpc(
    'contract_billing_alerts_materialize',
    { p_organization_id: organizationId, p_as_of: asOf, p_limit: 500 },
  );
  if (materializeError) {
    throw new Error(`Falha ao materializar alertas: ${materializeError.message}`);
  }

  // ── 2) Entregar ────────────────────────────────────────────────────────
  /*
    Recorte por `as_of_date`. Um alerta de três meses atrás que nunca saiu não
    deve sair agora: avisar hoje sobre uma antecedência de 30 dias que já virou
    atraso é pior que não avisar — chega como notícia velha e ensina a ignorar
    o canal.
  */
  const { data: alertRows, error: listError } = await service
    .from('contract_billing_milestone_alerts')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('as_of_date', asOf)
    .order('planned_date', { ascending: true });
  if (listError) throw new Error(`Falha ao ler alertas: ${listError.message}`);

  const channels = await resolveChannels();
  const appOrigin = getPublicAppOrigin();
  const apiKey = process.env.RESEND_API_KEY;
  const emailEnabled = channels.includes('email');
  const emailLive = Boolean(apiKey) && !options.test;

  let inApp = 0;
  let emailsSent = 0;
  let emailsSimulated = 0;
  let whatsappSkipped = 0;
  let failures = 0;

  for (const raw of (alertRows ?? []) as AlertRaw[]) {
    const alert = toAlert(raw);
    const content = buildAlertContent(alert);

    const { data: recipients, error: recipientError } = await service.rpc(
      'contract_billing_alert_recipients',
      { p_organization_id: organizationId, p_alert_id: alert.id },
    );
    if (recipientError) { failures += 1; continue; }

    for (const r of (recipients ?? []) as Recipient[]) {
      // ── in-app ─────────────────────────────────────────────────────────
      /*
        A porta de SERVIDOR (`create_notification_for`, 195): a organização vem
        do alerta. A porta do navegador (`create_notification`) resolve a
        organização por auth.uid() — que não existe no service role — e fazia
        TODO alerta in-app terminar FAILED ("Usuário sem organização ativa").
      */
      if (channels.includes('in_app') && !(await alreadyDispatched(alert.id, r.recipient_user_id, 'in_app'))) {
        const { data: notificationId, error } = await service.rpc('create_notification_for', {
          p_organization_id: organizationId,
          p_recipient: r.recipient_user_id,
          p_type: 'contracts.billing.milestone_due',
          p_title: content.headline,
          p_body: content.bodyText,
          p_link: content.deepLink,
        });
        await record(alert.id, r, 'in_app', error ? 'FAILED' : 'DELIVERED', {
          notificationId: error ? null : (notificationId as string | null),
          error: error?.message ?? null,
        });
        if (error) failures += 1; else inApp += 1;
      }

      // ── e-mail ─────────────────────────────────────────────────────────
      if (emailEnabled && !(await alreadyDispatched(alert.id, r.recipient_user_id, 'email'))) {
        const email = await emailOf(r.recipient_user_id);
        if (!email) {
          // Registrar como FAILED diria que a entrega foi tentada e falhou.
          // NOT_CONFIGURED diz o que é: o canal não existe para esta pessoa.
          await record(alert.id, r, 'email', 'NOT_CONFIGURED', {
            error: 'Destinatário sem e-mail cadastrado.',
          });
        } else if (!emailLive) {
          await record(alert.id, r, 'email', 'SIMULATED', { email, provider: 'resend' });
          await logEmailDispatch(email, content.subject, 'simulated', alert.id);
          emailsSimulated += 1;
        } else {
          const sent = await sendEmail(email, content.subject, buildAlertEmailHtml(alert, appOrigin));
          await record(alert.id, r, 'email', sent.ok ? 'DELIVERED' : 'FAILED',
            { email, provider: 'resend', error: sent.error ?? null });
          await logEmailDispatch(email, content.subject, sent.ok ? 'sent' : 'failed', alert.id, sent.error);
          if (sent.ok) emailsSent += 1; else failures += 1;
        }
      }

      // ── WhatsApp ───────────────────────────────────────────────────────
      if (channels.includes('whatsapp') && !(await alreadyDispatched(alert.id, r.recipient_user_id, 'whatsapp'))) {
        await record(alert.id, r, 'whatsapp', 'NOT_CONFIGURED', {
          error: 'Nenhum provedor de WhatsApp integrado nesta instalação.',
        });
        whatsappSkipped += 1;
      }
    }
  }

  return {
    organizationId,
    asOf,
    alertsCreated: Number(created ?? 0),
    alertsConsidered: (alertRows ?? []).length,
    inApp,
    email: emailLive ? 'sent' : emailEnabled ? 'simulated' : 'disabled',
    emailsSent,
    emailsSimulated,
    whatsapp: channels.includes('whatsapp') ? 'not_configured' : 'disabled',
    whatsappSkipped,
    failures,
  };

  // ── auxiliares ─────────────────────────────────────────────────────────

  async function alreadyDispatched(alertId: string, userId: string, channel: string): Promise<boolean> {
    const { count } = await service
      .from('contract_billing_alert_dispatches')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('alert_id', alertId)
      .eq('recipient_user_id', userId)
      .eq('channel', channel);
    return (count ?? 0) > 0;
  }

  async function record(
    alertId: string, r: Recipient, channel: string, state: string,
    extra: { email?: string; provider?: string; notificationId?: string | null; error?: string | null } = {},
  ): Promise<void> {
    await service.rpc('contract_billing_alert_record_dispatch', {
      p_organization_id: organizationId,
      p_alert_id: alertId,
      p_recipient_user_id: r.recipient_user_id,
      p_recipient_role: r.recipient_role,
      p_channel: channel,
      p_state: state,
      p_recipient_email: extra.email ?? null,
      p_provider: extra.provider ?? null,
      p_notification_id: extra.notificationId ?? null,
      p_error_message: extra.error ?? null,
    });
  }

  /**
   * O e-mail do destinatário.
   *
   * `profiles` NÃO tem coluna de e-mail neste schema — ele mora em
   * `auth.users`, e é por isso que `list_organization_members` faz o JOIN para
   * expô-lo. A rotina já está no service role, então lê a origem direto em vez
   * de depender de uma cópia que envelheceria.
   *
   * A pertinência ao inquilino já foi conferida: `contract_billing_alert_
   * recipients` só devolve membro ATIVO da organização do alerta.
   */
  async function emailOf(userId: string): Promise<string | null> {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (error) return null;
    const email = data.user?.email ?? null;
    return email && /.+@.+\..+/.test(email) ? email : null;
  }

  /**
   * O log de saída de e-mail do PRODUTO, além do registro por alerta.
   *
   * São duas perguntas distintas: `contract_billing_alert_dispatches` responde
   * "quem foi avisado sobre este marco e por quê"; `email_dispatches` responde
   * "o que este produto mandou para fora, de todos os módulos". Os módulos de
   * Agenda e Folha já escrevem no segundo, e um canal de saída que não aparece
   * na auditoria comum é um canal que ninguém audita.
   */
  async function logEmailDispatch(
    email: string, subject: string, status: 'sent' | 'failed' | 'simulated',
    alertId: string, error?: string,
  ): Promise<void> {
    try {
      await service.from('email_dispatches').insert({
        organization_id: organizationId,
        target_email: email,
        subject,
        status,
        provider: 'resend',
        related_entity_type: 'contract_billing_milestone_alert',
        related_entity_id: alertId,
        error_message: error ?? null,
      });
    } catch (e) {
      // Falha de auditoria não derruba a entrega que já aconteceu.
      console.error('[billing/alerts] log de e-mail falhou:', e instanceof Error ? e.message : e);
    }
  }

  async function resolveChannels(): Promise<string[]> {
    const { data } = await service
      .from('contract_billing_alert_policies')
      .select('channels')
      .eq('organization_id', organizationId)
      .is('contract_id', null)
      .eq('active', true)
      .maybeSingle();
    // Sem política declarada: in-app e e-mail. WhatsApp exige pedido explícito
    // — e continuaria sem provedor de qualquer forma.
    return (data?.channels as string[] | undefined) ?? ['in_app', 'email'];
  }

  async function sendEmail(
    to: string, subject: string, html: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(apiKey!);
      const { error } = await resend.emails.send({
        from: process.env.APP_EMAIL_FROM || DEFAULT_FROM,
        to: [to], subject, html,
      });
      return error ? { ok: false, error: error.message } : { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Erro inesperado' };
    }
  }
}

interface Recipient { recipient_user_id: string; recipient_role: string }

interface AlertRaw {
  id: string;
  organization_id: string;
  contract_id: string;
  milestone_id: string;
  project_id: string | null;
  planned_date: string;
  planned_date_basis: BillingMilestoneAlert['plannedDateBasis'];
  offset_days: number;
  kind: BillingMilestoneAlert['kind'];
  facts_snapshot: Record<string, unknown>;
  amount: number | string | null;
  currency: string | null;
  policy_source: BillingMilestoneAlert['policySource'];
  generated_at: string;
  as_of_date: string;
}

const toAlert = (raw: AlertRaw): BillingMilestoneAlert => ({
  id: raw.id,
  organizationId: raw.organization_id,
  contractId: raw.contract_id,
  milestoneId: raw.milestone_id,
  projectId: raw.project_id,
  plannedDate: raw.planned_date,
  plannedDateBasis: raw.planned_date_basis,
  offsetDays: raw.offset_days,
  kind: raw.kind,
  amount: raw.amount === null ? null : Number(raw.amount),
  currency: raw.currency,
  policySource: raw.policy_source,
  generatedAt: raw.generated_at,
  asOfDate: raw.as_of_date,
  factsSnapshot: raw.facts_snapshot ?? {},
});
