import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_FROM = 'INSIGHT APEX <no-reply@insightapex.co>';

interface SendBody {
  subject: string;
  html: string;
  recipients: string[];
  /** Optional iCalendar (.ics) body to attach as text/calendar. */
  ics?: string;
  icsFilename?: string;
  related_entity_type?: string;
  related_entity_id?: string;
  /** Force a dry-run even when RESEND_API_KEY is set. */
  test?: boolean;
}

function isEmailList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && /.+@.+\..+/.test(x));
}

/**
 * Sends Agenda module e-mails (meeting invitations, task assignments,
 * task status updates) via Resend, and logs one email_dispatches row per
 * recipient.
 *
 * Auth: caller must hold meetings.create OR tasks.create (admins bypass,
 * matching the RLS gate). Without RESEND_API_KEY (or with test=true) the
 * send is a dry-run — every dispatch is recorded with status 'simulated',
 * exactly like the payroll route. RESEND_API_KEY never reaches the client.
 */
export async function POST(req: Request) {
  // Either meetings.create or tasks.create is sufficient.
  let guard = await requireApiPermission('meetings.create', { allowAdmin: true });
  if (!guard.ok) {
    const taskGuard = await requireApiPermission('tasks.create', { allowAdmin: true });
    if (!taskGuard.ok) return guard.response;
    guard = taskGuard;
  }

  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  if (!body.subject || !body.html) {
    return NextResponse.json({ ok: false, error: 'subject e html são obrigatórios.' }, { status: 400 });
  }
  // De-duplicate (case-insensitive) so a guest typed twice isn't mailed twice.
  const recipients = Array.from(
    new Map((body.recipients ?? []).map((r) => [String(r).toLowerCase().trim(), String(r).trim()])).values(),
  );
  if (!isEmailList(recipients)) {
    return NextResponse.json({ ok: false, error: 'Lista de destinatários inválida.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();
  const organizationId = profile?.organization_id as string | undefined;
  if (!organizationId) {
    return NextResponse.json({ ok: false, error: 'Usuário sem organização.' }, { status: 403 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.APP_EMAIL_FROM || DEFAULT_FROM;
  const provider = 'resend';

  const attachments = body.ics
    ? [
        {
          filename: body.icsFilename || 'convite.ics',
          content: Buffer.from(body.ics, 'utf-8').toString('base64'),
          contentType: 'text/calendar',
        },
      ]
    : undefined;

  // Records a dispatch row per recipient (best-effort — never throws).
  const logDispatches = async (
    status: 'sent' | 'failed' | 'simulated',
    providerMessageId?: string,
    errorMessage?: string,
  ) => {
    try {
      await supabase.from('email_dispatches').insert(
        recipients.map((email) => ({
          organization_id: organizationId,
          target_email: email,
          subject: body.subject,
          status,
          provider,
          provider_message_id: providerMessageId ?? null,
          related_entity_type: body.related_entity_type ?? null,
          related_entity_id: body.related_entity_id ?? null,
          error_message: errorMessage ?? null,
        })),
      );
    } catch (e) {
      console.error('[agenda/email/send] dispatch log failed:', e instanceof Error ? e.message : e);
    }
  };

  // Dry-run: no key configured, or explicit test send.
  if (!apiKey || body.test) {
    await logDispatches('simulated');
    return NextResponse.json({
      ok: true,
      delivery_status: 'simulated',
      reason: !apiKey ? 'RESEND_API_KEY ausente — envio simulado.' : 'Envio de teste (dry-run).',
      recipients,
    });
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: recipients,
      subject: body.subject,
      html: body.html,
      attachments,
    });

    if (error) {
      await logDispatches('failed', undefined, error.message);
      return NextResponse.json(
        { ok: false, delivery_status: 'failed', error: error.message },
        { status: 502 },
      );
    }

    await logDispatches('sent', data?.id);
    return NextResponse.json({
      ok: true,
      delivery_status: 'sent',
      provider_message_id: data?.id,
      recipients,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[agenda/email/send] error:', message);
    await logDispatches('failed', undefined, message);
    return NextResponse.json({ ok: false, delivery_status: 'failed', error: message }, { status: 500 });
  }
}
