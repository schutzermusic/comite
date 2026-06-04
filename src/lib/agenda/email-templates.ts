/**
 * Professional e-mail templates for the Agenda module (pt-BR).
 *
 * Standalone string builders (no React) usable from both the client
 * service (to assemble the payload) and the server API route. Subjects
 * follow the product spec exactly.
 *
 * Email bodies use a light background with dark text (email clients do
 * not honor the app's dark/light theme) and inline styles.
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
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(title: string, bodyRows: string, ctaLabel?: string, ctaUrl?: string): string {
  const cta =
    ctaLabel && ctaUrl
      ? `<tr><td style="padding:24px 0 4px;">
           <a href="${ctaUrl}" style="display:inline-block;background:${BRAND};color:#062019;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
         </td></tr>`
      : '';

  return `<!DOCTYPE html>
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
            ${bodyRows}
            ${cta}
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
          Esta é uma mensagem automática do INSIGHT APEX. Por favor, não responda a este e-mail.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:${MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.04em;width:130px;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 0;color:${TEXT};font-size:14px;">${value}</td>
  </tr>`;
}

/* ───────────── Meeting invitation ───────────── */

export interface MeetingInviteParams {
  title: string;
  dateLabel: string; // e.g. "qui., 12 de jun. de 2026 14:00"
  organizerName?: string | null;
  location?: string | null;
  meetingLink?: string | null;
  description?: string | null;
  detailUrl?: string | null;
}

export function meetingInviteEmail(p: MeetingInviteParams): EmailContent {
  const rows = [
    row('Quando', escapeHtml(p.dateLabel)),
    p.organizerName ? row('Organizador', escapeHtml(p.organizerName)) : '',
    p.location ? row('Local', escapeHtml(p.location)) : '',
    p.meetingLink
      ? row('Link', `<a href="${p.meetingLink}" style="color:${BRAND};">${escapeHtml(p.meetingLink)}</a>`)
      : '',
    p.description ? row('Pauta', escapeHtml(p.description)) : '',
  ]
    .filter(Boolean)
    .join('');

  return {
    subject: `Convite: ${p.title} — ${p.dateLabel}`,
    html: shell(
      `Você foi convidado para "${p.title}"`,
      rows,
      p.detailUrl ? 'Ver reunião' : undefined,
      p.detailUrl ?? undefined,
    ),
  };
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
  const rows = [
    p.assignerName ? row('Atribuída por', escapeHtml(p.assignerName)) : '',
    p.dueLabel ? row('Prazo', escapeHtml(p.dueLabel)) : '',
    row('Prioridade', escapeHtml(TASK_PRIORITY_LABELS[p.priority])),
    p.description ? row('Descrição', escapeHtml(p.description)) : '',
  ]
    .filter(Boolean)
    .join('');

  return {
    subject: `Nova tarefa atribuída: ${p.title}`,
    html: shell(
      `Nova tarefa: "${p.title}"`,
      rows,
      p.detailUrl ? 'Abrir tarefa' : undefined,
      p.detailUrl ?? undefined,
    ),
  };
}

/* ───────────── Task status update ───────────── */

export interface TaskStatusParams {
  title: string;
  newStatus: TaskStatus;
  changedByName?: string | null;
  detailUrl?: string | null;
}

export function taskStatusEmail(p: TaskStatusParams): EmailContent {
  const rows = [
    row('Novo status', escapeHtml(TASK_STATUS_LABELS[p.newStatus])),
    p.changedByName ? row('Atualizada por', escapeHtml(p.changedByName)) : '',
  ]
    .filter(Boolean)
    .join('');

  return {
    subject: `Atualização da tarefa: ${p.title}`,
    html: shell(
      `Tarefa atualizada: "${p.title}"`,
      rows,
      p.detailUrl ? 'Ver tarefa' : undefined,
      p.detailUrl ?? undefined,
    ),
  };
}
