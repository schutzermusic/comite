/**
 * A ENTREGA DOS HANDOFFS DE MEDIÇÃO — server-only.
 *
 * ─── Por que uma biblioteca, e não uma rota ────────────────────────────────
 *
 * Dois chamadores com autorizações diferentes: a rota de produto (pessoa com
 * permissão) e o cron de SLA (sem usuário, autenticado por segredo). O que os
 * dois compartilham é o COMPORTAMENTO — e duplicá-lo faria o lembrete do cron
 * divergir do aviso do botão, divergência que aparece como um e-mail que
 * ninguém consegue reproduzir.
 *
 * ─── Nenhum motor de notificação novo ──────────────────────────────────────
 *
 * In-app pela RPC `create_notification`, que é a mesma de Agenda, Deliberações,
 * Folha e alertas de faturamento. E-mail pelo Resend, com registro em
 * `email_dispatches`, que é o log de saída comum do produto. A única tabela
 * nova é o REGISTRO POR HANDOFF (194), e ela responde outra pergunta: "quem foi
 * avisado sobre esta medição, e por quê".
 *
 * ─── A deduplicação ───────────────────────────────────────────────────────
 *
 * Índice único em (medição, chave de handoff, destinatário, canal). A chave
 * carrega a revisão e a rodada, então o segundo pedido de correção avisa de
 * novo — e a segunda execução da MESMA rotina, não.
 *
 * ─── O que este módulo NUNCA faz ──────────────────────────────────────────
 *
 * Não muda estado de medição, não valida evidência, não torna nada elegível e
 * não cria fato financeiro. Ele lê estado e manda texto.
 */

import { platformServiceClient } from '@/lib/platform/server-client';
import { getPublicAppOrigin } from '@/lib/config/app-url';
import {
  HANDOFFS, buildHandoffContent, buildHandoffEmailHtml, handoffKey, slaReminderRoles,
  type HandoffEvent, type HandoffSubject,
} from './handoff';
import {
  MEASUREMENT_STATUS_LABEL, READINESS_REASON_LABEL, RESPONSIBLE_UNDEFINED_LABEL,
  STAKEHOLDER_ROLE_LABEL, parseSla,
  type MeasurementStatus, type StakeholderRole,
} from './types';

const DEFAULT_FROM = 'INSIGHT APEX <no-reply@insightapex.co>';

export interface HandoffDispatchSummary {
  readonly measurementId: string;
  readonly event: HandoffEvent;
  readonly handoffKey: string;
  readonly inApp: number;
  readonly emailsSent: number;
  readonly emailsSimulated: number;
  readonly skippedAlreadyNotified: number;
  readonly failures: number;
  /**
   * Papéis que NÃO resolveram para uma pessoa. A lista viaja na resposta para
   * que a tela diga "Responsável não definido" com o papel ao lado — em vez de
   * relatar sucesso sobre um aviso que não teve destinatário.
   */
  readonly undefinedRoles: readonly string[];
  /** A fila configurada que recebe o trabalho órfão, quando declarada. */
  readonly fallbackQueue: string | null;
}

interface StakeholderRow {
  role: StakeholderRole;
  user_id: string | null;
  resolution: 'RESOLVED' | 'RESPONSIBLE_UNDEFINED';
  source: string;
}

/**
 * Entrega um handoff sobre UMA medição.
 *
 * `roles` sobrescreve os papéis do catálogo — usado pelo lembrete de SLA, que
 * escolhe o dono da etapa em curso. Nos demais eventos, o catálogo manda.
 */
export async function dispatchMeasurementHandoff(
  measurementId: string,
  event: HandoffEvent,
  options: {
    readonly roles?: readonly StakeholderRole[];
    readonly reason?: string | null;
    readonly round?: number | string | null;
    readonly test?: boolean;
  } = {},
): Promise<HandoffDispatchSummary> {
  const service = platformServiceClient();
  const appOrigin = getPublicAppOrigin();

  // ── 1) O sujeito, lido da fonte canônica ────────────────────────────────
  const { data: mRow, error: mErr } = await service
    .from('project_measurements')
    .select('id, organization_id, project_id, contract_id, milestone_id, status, revision')
    .eq('id', measurementId)
    .maybeSingle();
  if (mErr) throw new Error(`Falha ao ler a medição: ${mErr.message}`);
  if (!mRow) throw new Error('MEASUREMENT_NOT_FOUND');

  const organizationId = mRow.organization_id as string;
  const status = mRow.status as MeasurementStatus;

  const [contract, project, milestone, readiness, sla, policy] = await Promise.all([
    service.from('contracts').select('contract_number')
      .eq('id', mRow.contract_id).maybeSingle(),
    service.from('projects').select('project').eq('id', mRow.project_id).maybeSingle(),
    mRow.milestone_id
      ? service.from('contract_milestones').select('title').eq('id', mRow.milestone_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    service.rpc('project_measurement_readiness', { p_measurement_id: measurementId, p_as_of: null }),
    service.rpc('project_measurement_sla', { p_measurement_id: measurementId, p_as_of: null }),
    service.from('project_measurement_notification_policies')
      .select('channels, fallback_queue, extra_recipient_user_ids')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .order('contract_id', { ascending: false, nullsFirst: false })
      .limit(1).maybeSingle(),
  ]);

  const reasons = ((readiness.data as Record<string, unknown> | null)?.reasons ?? []) as string[];
  const slaParsed = parseSla(sla.data);
  const projectJson = (project.data?.project ?? {}) as Record<string, unknown>;

  const subject: HandoffSubject = {
    measurementId,
    projectId: mRow.project_id as string,
    projectCode: (projectJson.codigo as string | undefined) ?? null,
    contractId: mRow.contract_id as string,
    contractNumber: (contract.data?.contract_number as string | undefined) ?? null,
    milestoneId: (mRow.milestone_id as string | null) ?? null,
    milestoneTitle: (milestone.data?.title as string | undefined) ?? null,
    status,
    // As pendências viajam TRADUZIDAS. Um código como
    // `MISSING_REQUIRED_DOCUMENT` num e-mail obriga o leitor a abrir o produto
    // só para descobrir o que ele quer dizer.
    pending: reasons.map((c) => READINESS_REASON_LABEL[c as keyof typeof READINESS_REASON_LABEL] ?? c),
    reason: options.reason ?? null,
    dueAt: slaParsed.dueAt,
  };

  const content = buildHandoffContent(event, subject);
  const key = handoffKey(event, Number(mRow.revision ?? 1), options.round ?? null);

  // ── 2) Os destinatários, por vínculo autoritativo ───────────────────────
  const { data: stakeholders, error: sErr } = await service.rpc(
    'project_measurement_stakeholders', { p_measurement_id: measurementId });
  if (sErr) throw new Error(`Falha ao resolver responsáveis: ${sErr.message}`);

  const wanted = options.roles
    ?? (event === 'sla.reminder' ? slaReminderRoles(status) : HANDOFFS[event].roles);

  const rows = (stakeholders ?? []) as StakeholderRow[];
  const picked = rows.filter((r) => wanted.includes(r.role));

  const resolved = new Map<string, StakeholderRole>();
  const undefinedRoles: string[] = [];
  for (const r of picked) {
    if (r.resolution === 'RESOLVED' && r.user_id) {
      // A mesma pessoa em dois papéis recebe UMA vez, no primeiro papel em que
      // apareceu. Dois e-mails idênticos ensinam a ignorar o aviso.
      if (!resolved.has(r.user_id)) resolved.set(r.user_id, r.role);
    } else {
      undefinedRoles.push(`${STAKEHOLDER_ROLE_LABEL[r.role]}: ${RESPONSIBLE_UNDEFINED_LABEL}`);
    }
  }

  // Destinatários extras da política: escolhidos por alguém, explicitamente.
  for (const uid of ((policy.data?.extra_recipient_user_ids ?? []) as string[])) {
    if (!resolved.has(uid)) resolved.set(uid, 'contract_manager');
  }

  const channels = (policy.data?.channels as string[] | undefined) ?? ['in_app', 'email'];
  const apiKey = process.env.RESEND_API_KEY;
  const emailLive = Boolean(apiKey) && !options.test;

  let inApp = 0; let emailsSent = 0; let emailsSimulated = 0;
  let skipped = 0; let failures = 0;

  for (const [userId, role] of resolved) {
    // ── in-app ───────────────────────────────────────────────────────────
    if (channels.includes('in_app')) {
      if (await alreadyDispatched(userId, 'in_app')) { skipped += 1; } else {
        const { data: notificationId, error } = await service.rpc('create_notification_for', {
          p_organization_id: organizationId,
          p_recipient: userId,
          p_type: HANDOFFS[event].notificationType,
          p_title: content.headline,
          p_body: content.bodyText,
          p_link: content.deepLink,
        });
        await record(userId, role, 'in_app', error ? 'FAILED' : 'DELIVERED', {
          notificationId: error ? null : (notificationId as string | null),
          error: error?.message ?? null,
        });
        if (error) failures += 1; else inApp += 1;
      }
    }

    // ── e-mail ───────────────────────────────────────────────────────────
    if (channels.includes('email')) {
      if (await alreadyDispatched(userId, 'email')) { skipped += 1; continue; }
      const email = await emailOf(userId);
      if (!email) {
        // NOT_CONFIGURED, e não FAILED: o canal não existe para esta pessoa, e
        // dizer "falhou" insinuaria uma tentativa de entrega que não houve.
        await record(userId, role, 'email', 'NOT_CONFIGURED',
          { error: 'Destinatário sem e-mail cadastrado.' });
      } else if (!emailLive) {
        await record(userId, role, 'email', 'SIMULATED', { email, provider: 'resend' });
        await logEmail(email, 'simulated');
        emailsSimulated += 1;
      } else {
        const sent = await sendEmail(email, content.subject,
          buildHandoffEmailHtml(content, appOrigin));
        await record(userId, role, 'email', sent.ok ? 'DELIVERED' : 'FAILED',
          { email, provider: 'resend', error: sent.error ?? null });
        await logEmail(email, sent.ok ? 'sent' : 'failed', sent.error);
        if (sent.ok) emailsSent += 1; else failures += 1;
      }
    }
  }

  return {
    measurementId,
    event,
    handoffKey: key,
    inApp,
    emailsSent,
    emailsSimulated,
    skippedAlreadyNotified: skipped,
    failures,
    undefinedRoles,
    fallbackQueue: (policy.data?.fallback_queue as string | undefined) ?? null,
  };

  // ── auxiliares ──────────────────────────────────────────────────────────

  async function alreadyDispatched(userId: string, channel: string): Promise<boolean> {
    const { count } = await service
      .from('project_measurement_handoff_dispatches')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('measurement_id', measurementId)
      .eq('handoff_key', key)
      .eq('recipient_user_id', userId)
      .eq('channel', channel);
    return (count ?? 0) > 0;
  }

  async function record(
    userId: string, role: StakeholderRole, channel: string, state: string,
    extra: { email?: string; provider?: string; notificationId?: string | null; error?: string | null } = {},
  ): Promise<void> {
    await service.rpc('project_measurement_handoff_record', {
      p_measurement_id: measurementId,
      p_handoff_key: key,
      p_handoff_event: event,
      p_recipient_user_id: userId,
      p_recipient_role: role,
      p_channel: channel,
      p_state: state,
      p_recipient_email: extra.email ?? null,
      p_provider: extra.provider ?? null,
      p_notification_id: extra.notificationId ?? null,
      p_error_message: extra.error ?? null,
    });
  }

  /**
   * O e-mail mora em `auth.users`, e não em `profiles` — mesmo fato que a 180
   * documentou. A rotina está no service role, então lê a origem em vez de uma
   * cópia que envelheceria.
   */
  async function emailOf(userId: string): Promise<string | null> {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (error) return null;
    const email = data.user?.email ?? null;
    return email && /.+@.+\..+/.test(email) ? email : null;
  }

  async function logEmail(
    email: string, status: 'sent' | 'failed' | 'simulated', error?: string,
  ): Promise<void> {
    try {
      await service.from('email_dispatches').insert({
        organization_id: organizationId,
        target_email: email,
        subject: content.subject,
        status,
        provider: 'resend',
        related_entity_type: 'project_measurement',
        related_entity_id: measurementId,
        error_message: error ?? null,
      });
    } catch (e) {
      // Falha de auditoria não derruba a entrega que já aconteceu.
      console.error('[measurements/handoff] log de e-mail falhou:',
        e instanceof Error ? e.message : e);
    }
  }

  async function sendEmail(
    to: string, subjectLine: string, html: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(apiKey!);
      const { error } = await resend.emails.send({
        from: process.env.APP_EMAIL_FROM || DEFAULT_FROM,
        to: [to], subject: subjectLine, html,
      });
      return error ? { ok: false, error: error.message } : { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Erro inesperado' };
    }
  }
}

/**
 * OS LEMBRETES DE SLA de uma organização.
 *
 * A função de banco (`project_measurement_sla_nudges`) já aplica o intervalo
 * declarado entre lembretes, então o que sobra aqui é entregar. Uma pendência
 * sem prazo declarado NÃO aparece — e é isso que impede o produto de cobrar um
 * prazo que ninguém combinou.
 */
export async function dispatchMeasurementSlaReminders(
  organizationId: string,
  options: { asOf?: string; test?: boolean; limit?: number } = {},
): Promise<{
  readonly organizationId: string;
  readonly asOf: string;
  readonly considered: number;
  readonly inApp: number;
  readonly emailsSent: number;
  readonly emailsSimulated: number;
  readonly failures: number;
  readonly undefinedResponsible: number;
}> {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const service = platformServiceClient();

  const { data, error } = await service.rpc('project_measurement_sla_nudges', {
    p_organization_id: organizationId,
    p_as_of: asOf,
    p_limit: options.limit ?? 200,
  });
  if (error) throw new Error(`Falha ao listar pendências de SLA: ${error.message}`);

  const rows = (data ?? []) as { measurement_id: string; status: MeasurementStatus }[];
  let inApp = 0; let emailsSent = 0; let emailsSimulated = 0;
  let failures = 0; let undefinedResponsible = 0;

  for (const row of rows) {
    try {
      const s = await dispatchMeasurementHandoff(row.measurement_id, 'sla.reminder', {
        test: options.test,
        // A rodada da chave é a DATA: o lembrete de hoje é um aviso novo, e o de
        // hoje repetido não é. Sem isto, o segundo lembrete nunca sairia.
        round: asOf,
        reason: `Etapa ${MEASUREMENT_STATUS_LABEL[row.status]} fora do prazo declarado.`,
      });
      inApp += s.inApp;
      emailsSent += s.emailsSent;
      emailsSimulated += s.emailsSimulated;
      failures += s.failures;
      if (s.undefinedRoles.length > 0) undefinedResponsible += 1;
    } catch (e) {
      failures += 1;
      console.error('[measurements/sla] lembrete falhou:',
        row.measurement_id, e instanceof Error ? e.message : e);
    }
  }

  return {
    organizationId, asOf, considered: rows.length,
    inApp, emailsSent, emailsSimulated, failures, undefinedResponsible,
  };
}

/**
 * A VARREDURA DOS HANDOFFS A JUSANTE — elegibilidade e NF a emitir.
 *
 * ─── Por que uma varredura, e não um gatilho ───────────────────────────────
 *
 * Porque nenhum dos dois estados é produzido por um ato humano que possa
 * chamar uma rota. `ELIGIBLE` é DERIVADO pelo resolvedor de elegibilidade da
 * Fase 7, e `RELEASED sem nota` é o intervalo entre a liberação e a emissão —
 * um estado que ninguém "faz", e no qual o trabalho simplesmente passa a
 * existir. Um gatilho de banco resolveria a detecção e não teria como falar com
 * o provedor de e-mail; a varredura diária lê o modelo de leitura canônico e
 * avisa quem responde.
 *
 * ─── O que ela NÃO faz ────────────────────────────────────────────────────
 *
 * Não libera faturamento, não cria nota, não cria recebível e não muda estado
 * nenhum. Ela LÊ `contract_to_cash_read_model` — a mesma visão do dossiê — e
 * manda texto. Contratos e Projetos continuam sem poder fabricar recebimento.
 *
 * ─── A deduplicação ───────────────────────────────────────────────────────
 *
 * A chave carrega o id do EVENTO DE FATURAMENTO, e não a data: "elegível para
 * faturar" é um aviso que se dá UMA vez por evento, e repeti-lo todo dia é a
 * forma mais rápida de ensinar o financeiro a filtrar a caixa de entrada.
 */
export async function dispatchDownstreamHandoffs(
  organizationId: string,
  options: { test?: boolean; limit?: number } = {},
): Promise<{
  readonly organizationId: string;
  readonly eligibleNotified: number;
  readonly invoiceDueNotified: number;
  readonly inApp: number;
  readonly emailsSent: number;
  readonly emailsSimulated: number;
  readonly failures: number;
  readonly undefinedResponsible: number;
}> {
  const service = platformServiceClient();

  const { data, error } = await service
    .from('contract_to_cash_read_model')
    .select('billing_event_id, source_measurement_id, eligibility_state, release_state, '
      + 'fiscal_document_id, cancelled_at')
    .eq('organization_id', organizationId)
    // Só o que nasceu de MEDIÇÃO: um evento legado ou manual não tem medição
    // para resolver responsável, e avisar sobre ele daqui mandaria o aviso para
    // ninguém.
    .not('source_measurement_id', 'is', null)
    .is('cancelled_at', null)
    .limit(options.limit ?? 500);
  if (error) throw new Error(`Falha ao ler a cadeia contrato-a-caixa: ${error.message}`);

  let eligibleNotified = 0; let invoiceDueNotified = 0;
  let inApp = 0; let emailsSent = 0; let emailsSimulated = 0;
  let failures = 0; let undefinedResponsible = 0;

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const measurementId = row.source_measurement_id as string;
    const billingEventId = String(row.billing_event_id);
    const release = row.release_state as string | null;
    const eligibility = row.eligibility_state as string | null;

    /*
      Dois avisos, dois momentos, e nunca os dois de uma vez:

        ELEGÍVEL        direito apurado, liberação pendente → Faturamento
        NF A EMITIR     liberado por gente, nota ausente    → Financeiro

      `RELEASED` já passou do primeiro, e repetir "elegível" sobre o que já foi
      liberado seria avisar de um trabalho que alguém fez.
    */
    const event: HandoffEvent | null =
      (release === 'RELEASED' && row.fiscal_document_id == null) ? 'measurement.invoice_due'
      : (eligibility === 'ELIGIBLE' && release !== 'RELEASED') ? 'measurement.billing_eligible'
      : null;
    if (!event) continue;

    try {
      const s = await dispatchMeasurementHandoff(measurementId, event, {
        test: options.test,
        round: billingEventId,
        reason: event === 'measurement.invoice_due'
          ? 'Faturamento liberado por decisão humana e sem documento fiscal emitido.'
          : 'Direito de faturar apurado pelo resolvedor de elegibilidade.',
      });
      inApp += s.inApp;
      emailsSent += s.emailsSent;
      emailsSimulated += s.emailsSimulated;
      failures += s.failures;
      if (s.undefinedRoles.length > 0) undefinedResponsible += 1;
      if (event === 'measurement.invoice_due') invoiceDueNotified += 1;
      else eligibleNotified += 1;
    } catch (e) {
      failures += 1;
      console.error('[measurements/downstream] aviso falhou:',
        measurementId, event, e instanceof Error ? e.message : e);
    }
  }

  return {
    organizationId, eligibleNotified, invoiceDueNotified,
    inApp, emailsSent, emailsSimulated, failures, undefinedResponsible,
  };
}
