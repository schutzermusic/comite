import { NextResponse } from 'next/server';
import { getActiveOrganizationRow } from '@/lib/auth/active-organization';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { parseAgendaEmailRequest } from '@/lib/agenda/email-notice';
import { resolveAgendaNotice } from '@/lib/agenda/email-notice-server';
import { EmailPermanentError, sendAppEmail } from '@/lib/notifications/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sends Agenda / project-timeline notices by e-mail.
 *
 * The body is a TYPED notice — `{ kind, <entity>_id }` — never content:
 *
 *   meeting_invite     { event_id }       who manages the meeting → recorded guests (+ .ics)
 *   task_assigned      { task_id }        the task's creator → assignee + recorded "notificar também"
 *   task_status        { task_id }        creator/assignee → the other party (done | blocked only)
 *   timeline_assigned  { assignment_id }  who assigned → the assigned member
 *   timeline_delay     { delay_log_id }   who reported → activity responsible + project manager
 *
 * Subject, HTML, sender and recipients are the server's: the record is re-read
 * through the caller's RLS session in the ACTIVE organization, recipients come
 * from the record, content from the server templates, the sender from the
 * environment. A body carrying `subject`/`html`/`recipients` is refused.
 *
 * Delivery goes through the platform transport (`sendAppEmail`): one message
 * per recipient, a stable idempotency key per notice, one `email_dispatches`
 * row per attempt (the drawer's delivery history).
 *
 * Auth floor (unchanged): meetings.create OR tasks.create OR
 * projects.timeline.assign; on top of it, the caller must be the author of the
 * fact being announced.
 */
export async function POST(req: Request) {
  let guard = await requireApiPermission('meetings.create', { allowAdmin: true });
  if (!guard.ok) {
    const taskGuard = await requireApiPermission('tasks.create', { allowAdmin: true });
    if (taskGuard.ok) {
      guard = taskGuard;
    } else {
      const timelineGuard = await requireApiPermission('projects.timeline.assign', { allowAdmin: true });
      if (!timelineGuard.ok) return guard.response;
      guard = timelineGuard;
    }
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  const parsed = parseAgendaEmailRequest(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const supabase = await createClient();
  const [{ data: auth }, profile] = await Promise.all([supabase.auth.getUser(), getActiveOrganizationRow(supabase)]);
  const organizationId = profile?.organization_id;
  if (!auth.user || !organizationId) {
    return NextResponse.json({ ok: false, error: 'Usuário sem organização ativa.' }, { status: 403 });
  }

  const resolved = await resolveAgendaNotice(
    supabase, organizationId, { id: auth.user.id, email: auth.user.email ?? null }, parsed.request,
  );
  if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status });
  const { notice } = resolved;

  const counts = { sent: 0, simulated: 0, failed: 0 };
  for (const to of notice.recipients) {
    try {
      const result = await sendAppEmail(
        { to, subject: notice.content.subject, html: notice.content.html, text: notice.content.text, attachments: notice.attachments },
        { idempotencyKey: notice.idempotencyKey(to), organizationId, related: notice.related },
      );
      if (result.outcome === 'SENT') counts.sent += 1; else counts.simulated += 1;
    } catch (error) {
      counts.failed += 1;
      // Endereço e conteúdo não vão para log; o motivo fica em email_dispatches.
      console.error('[agenda/email/send] envio falhou', {
        kind: notice.kind, permanent: error instanceof EmailPermanentError,
      });
    }
  }

  const delivery_status = counts.failed > 0 ? (counts.sent + counts.simulated > 0 ? 'partial' : 'failed')
    : counts.sent > 0 ? 'sent' : counts.simulated > 0 ? 'simulated' : 'no_recipients';
  return NextResponse.json(
    { ok: counts.failed === 0, kind: notice.kind, delivery_status, recipients: notice.recipients.length, ...counts },
    { status: counts.failed > 0 && counts.sent + counts.simulated === 0 ? 502 : 200 },
  );
}
