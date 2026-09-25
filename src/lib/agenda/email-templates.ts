/**
 * Professional e-mail templates for the Agenda module (pt-BR).
 *
 * SERVER-OWNED CONTENT. These builders run only in the Agenda e-mail route
 * (src/app/api/agenda/email/send): the browser names WHAT happened (a typed
 * notice + entity id) and never supplies subject, HTML or recipients. Every
 * value that came from a user (titles, descriptions, names, links) is escaped
 * here; a link only becomes clickable when it is a plain http(s) URL.
 *
 * Email bodies use a light background with dark text (email clients do
 * not honor the app's dark/light theme) and inline styles. Each template
 * returns the HTML and a plain-text alternative built from the same rows.
 */

import type { TaskPriority, TaskStatus } from '@/lib/types/agenda';
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/types/agenda';

const BRAND = '#00B488';
const BG = '#0B1512';
const CARD = '#FFFFFF';
const TEXT = '#1C2421';
const MUTED = '#5B6B65';
const BORDER = '#E3E9E6';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A clickable link only for absolute http(s) URLs; anything else (javascript:, data:, relative) is not a link. */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Subject lines are one line: no header folding from a title with line breaks. */
function subjectLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 250);
}

interface Row {
  label: string;
  value: string;
  /** Present only when `value` is itself a safe http(s) URL to link. */
  href?: string | null;
}

function compose(subject: string, title: string, rows: Array<Row | null>, cta?: { label: string; url: string | null | undefined }): EmailContent {
  const present = rows.filter((r): r is Row => r !== null && r.value.trim() !== '');
  const ctaUrl = cta ? safeHref(cta.url) : null;

  const htmlRows = present
    .map((r) => {
      const value = r.href
        ? `<a href="${escapeHtml(r.href)}" style="color:${BRAND};">${escapeHtml(r.value)}</a>`
        : escapeHtml(r.value);
      return `<tr>
    <td style="padding:6px 0;color:${MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.04em;width:130px;vertical-align:top;">${escapeHtml(r.label)}</td>
    <td style="padding:6px 0;color:${TEXT};font-size:14px;">${value}</td>
  </tr>`;
    })
    .join('');
  const htmlCta = cta && ctaUrl
    ? `<tr><td style="padding:24px 0 4px;">
           <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND};color:#062019;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px;">${escapeHtml(cta.label)}</a>
         </td></tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${CARD};border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">
        <tr><td style="background:${BG};padding:18px 28px;border-bottom:3px solid ${BRAND};">
          <span style="color:#FFFFFF;font-size:15px;font-weight:700;letter-spacing:.06em;">INSIGHT APEX</span>
          <span style="color:${BRAND};font-size:13px;font-weight:600;margin-left:8px;">Agenda &amp; Tarefas</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;color:${TEXT};font-size:19px;font-weight:700;">${escapeHtml(title)}</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="color:${TEXT};font-size:14px;line-height:1.55;">
            ${htmlRows}
            ${htmlCta}
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
          Esta é uma mensagem automática do INSIGHT APEX. Por favor, não responda a este e-mail.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    title,
    '',
    ...present.map((r) => `${r.label}: ${r.value}`),
    ...(cta && ctaUrl ? ['', `${cta.label}: ${ctaUrl}`] : []),
    '',
    'Esta é uma mensagem automática do INSIGHT APEX. Por favor, não responda a este e-mail.',
  ].join('\n');

  return { subject: subjectLine(subject), html, text };
}

const opt = (label: string, value: string | null | undefined): Row | null => (value ? { label, value } : null);

/* ───────────── Meeting invitation ───────────── */

export interface MeetingInviteParams {
  title: string;
  dateLabel: string; // e.g. "qui., 12 de jun. de 2026, 14:00"
  organizerName?: string | null;
  location?: string | null;
  meetingLink?: string | null;
  description?: string | null;
  detailUrl?: string | null;
}

export function meetingInviteEmail(p: MeetingInviteParams): EmailContent {
  return compose(
    `Convite: ${p.title} — ${p.dateLabel}`,
    `Você foi convidado para "${p.title}"`,
    [
      { label: 'Quando', value: p.dateLabel },
      opt('Organizador', p.organizerName),
      opt('Local', p.location),
      p.meetingLink ? { label: 'Link', value: p.meetingLink, href: safeHref(p.meetingLink) } : null,
      opt('Pauta', p.description),
    ],
    { label: 'Ver reunião', url: p.detailUrl },
  );
}

/* ───────────── Task assignment ───────────── */

export interface TaskAssignedParams {
  title: string;
  assignerName?: string | null;
  dueLabel?: string | null;
  priority: TaskPriority;
  description?: string | null;
  detailUrl?: string | null;
}

export function taskAssignedEmail(p: TaskAssignedParams): EmailContent {
  return compose(
    `Nova tarefa atribuída: ${p.title}`,
    `Nova tarefa: "${p.title}"`,
    [
      opt('Atribuída por', p.assignerName),
      opt('Prazo', p.dueLabel),
      { label: 'Prioridade', value: TASK_PRIORITY_LABELS[p.priority] ?? String(p.priority) },
      opt('Descrição', p.description),
    ],
    { label: 'Abrir tarefa', url: p.detailUrl },
  );
}

/* ───────────── Task status update ───────────── */

export interface TaskStatusParams {
  title: string;
  newStatus: TaskStatus;
  changedByName?: string | null;
  detailUrl?: string | null;
}

export function taskStatusEmail(p: TaskStatusParams): EmailContent {
  return compose(
    `Atualização da tarefa: ${p.title}`,
    `Tarefa atualizada: "${p.title}"`,
    [
      { label: 'Novo status', value: TASK_STATUS_LABELS[p.newStatus] ?? String(p.newStatus) },
      opt('Atualizada por', p.changedByName),
    ],
    { label: 'Ver tarefa', url: p.detailUrl },
  );
}

/* ───────────── Project timeline: assignment ───────────── */

export interface TimelineAssignedParams {
  projectName: string;
  taskTitle: string;
  wbsCode?: string | null;
  roleLabel: string; // "Responsável" | "Equipe de execução"
  assignerName?: string | null;
  dueLabel?: string | null;
  statusLabel?: string | null;
  detailUrl?: string | null;
}

export function timelineAssignedEmail(p: TimelineAssignedParams): EmailContent {
  return compose(
    `Atividade do cronograma atribuída: ${p.taskTitle} — ${p.projectName}`,
    `Atividade atribuída: "${p.taskTitle}"`,
    [
      { label: 'Projeto', value: p.projectName },
      opt('EDT', p.wbsCode),
      { label: 'Papel', value: p.roleLabel },
      opt('Atribuída por', p.assignerName),
      opt('Término planejado', p.dueLabel),
      opt('Status', p.statusLabel),
      { label: 'Ação requerida', value: 'Revise a atividade e mantenha status e progresso atualizados.' },
    ],
    { label: 'Abrir atividade', url: p.detailUrl },
  );
}

/* ───────────── Project timeline: delay report ───────────── */

export interface TimelineDelayParams {
  projectName: string;
  taskTitle: string;
  wbsCode?: string | null;
  statusLabel: string;
  reasonLabel?: string | null;
  newForecastLabel?: string | null;
  reportedByName?: string | null;
  /** true = pedindo justificativa; false = informando atraso reportado. */
  actionRequired: boolean;
  detailUrl?: string | null;
}

export function timelineDelayEmail(p: TimelineDelayParams): EmailContent {
  return compose(
    `Atraso no cronograma: ${p.taskTitle} — ${p.projectName}`,
    `Atividade em atraso: "${p.taskTitle}"`,
    [
      { label: 'Projeto', value: p.projectName },
      opt('EDT', p.wbsCode),
      { label: 'Status', value: p.statusLabel },
      opt('Motivo', p.reasonLabel),
      opt('Novo término previsto', p.newForecastLabel),
      opt('Reportado por', p.reportedByName),
      {
        label: 'Ação requerida',
        value: p.actionRequired
          ? 'Informe o motivo do atraso, o impacto e o plano de recuperação.'
          : 'Avalie o impacto no cronograma e o plano de recuperação proposto.',
      },
    ],
    { label: 'Abrir atividade', url: p.detailUrl },
  );
}
