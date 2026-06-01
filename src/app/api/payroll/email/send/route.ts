import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';
import type { PayrollEmailAudience } from '@/lib/types/payroll-closing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Maximum combined attachment size accepted by this route.
 *
 * Default raised to 100MB so large holerite/spreadsheet batches don't trip the
 * limit in dev/simulated sends. Override with PAYROLL_EMAIL_MAX_MB if needed.
 *
 * NOTE: real delivery via Resend still caps the whole message at ~40MB — beyond
 * that a live send will be rejected by the provider even though this route
 * accepts it (the dry-run / simulated path has no such cap).
 */
const MAX_TOTAL_MB = Number(process.env.PAYROLL_EMAIL_MAX_MB) || 100;
const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;

interface AttachmentPayload {
  file_name: string;
  /** base64-encoded content (no data: prefix). */
  content_base64: string;
  mime_type?: string;
  file_size: number;
}

interface SendBody {
  subject: string;
  html: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  /** Inline attachments (mock/client mode — bytes provided by the browser). */
  attachments?: AttachmentPayload[];
  /** Storage-backed attachments (supabase mode — server loads bytes by id). */
  attachment_ids?: string[];
  /** When provided with attachment_ids, the dispatch is persisted + audited. */
  batch_id?: string;
  audience?: PayrollEmailAudience;
  /** Required when sending sensitive attachments by id. */
  confirm_sensitive?: boolean;
  /** When true, never actually sends — returns a simulated dispatch (test send). */
  test?: boolean;
}

function isEmailList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && /.+@.+\..+/.test(x));
}

function tooLargeResponse(totalBytes: number) {
  return NextResponse.json(
    {
      ok: false,
      error: 'attachments_too_large',
      message: `Anexos somam ${(totalBytes / 1024 / 1024).toFixed(1)} MB, acima do limite de ${MAX_TOTAL_BYTES / 1024 / 1024} MB. Divida em vários e-mails, compacte em ZIP ou remova anexos.`,
      total_bytes: totalBytes,
      limit_bytes: MAX_TOTAL_BYTES,
    },
    { status: 413 },
  );
}

/**
 * Sends the payroll closing e-mail with DIRECT attachments (no secure links).
 *
 * Two sources of attachment bytes:
 *  - `attachments`: inline base64 from the browser (mock/client mode).
 *  - `attachment_ids`: loaded server-side from secure Storage via the repository
 *    (supabase mode). Sensitive files (non-aggregate) require both the
 *    people.payroll_send_sensitive permission and confirm_sensitive=true.
 *
 * Size is enforced (<= 40MB). Without RESEND_API_KEY or with test=true the send
 * is a dry-run (delivery_status 'simulated'). When batch_id is provided with
 * attachment_ids, the package + dispatch are persisted and audited.
 */
export async function POST(req: Request) {
  const actorRes = await resolvePayrollActor('people.payroll_send');
  if (!actorRes.ok) return actorRes.response;
  const { actor } = actorRes;

  const contentType = req.headers.get('content-type') ?? '';

  let body: SendBody;
  try {
    if (contentType.includes('multipart/form-data')) {
      // Preferred path for inline attachments: files stream as multipart parts,
      // avoiding the JSON body parser's size cap (which truncated large base64
      // payloads → "Unterminated string in JSON"). Metadata rides in `meta`.
      const form = await req.formData();
      const metaRaw = form.get('meta');
      body = JSON.parse(typeof metaRaw === 'string' ? metaRaw : '{}') as SendBody;

      const files: AttachmentPayload[] = [];
      for (const [key, value] of form.entries()) {
        if (key === 'meta' || typeof value === 'string') continue;
        const file = value as File;
        const buf = Buffer.from(await file.arrayBuffer());
        files.push({
          file_name: file.name,
          content_base64: buf.toString('base64'),
          mime_type: file.type || undefined,
          file_size: buf.byteLength,
        });
      }
      body.attachments = files;
    } else {
      // Reject oversized JSON payloads before parsing — base64 inflates the body
      // ~33%, so surface the friendly "too large" message (factor base64→bytes is 3/4).
      const contentLength = Number(req.headers.get('content-length') ?? 0);
      if (contentLength > 0 && contentLength * 0.75 > MAX_TOTAL_BYTES) {
        return tooLargeResponse(Math.round(contentLength * 0.75));
      }
      body = (await req.json()) as SendBody;
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'corpo da requisição inválido';
    console.error('[email/send] body parse failed:', detail);
    return NextResponse.json(
      { ok: false, error: 'JSON inválido.', message: `Falha ao ler o envio: ${detail}` },
      { status: 400 },
    );
  }

  if (!body.subject || !body.html) {
    return NextResponse.json({ ok: false, error: 'subject e html são obrigatórios.' }, { status: 400 });
  }
  if (!isEmailList(body.recipients) || body.recipients.length === 0) {
    return NextResponse.json({ ok: false, error: 'Lista de destinatários inválida.' }, { status: 400 });
  }

  const repo = getServerRepository();

  // Build the attachment set (Resend shape) + sizes for the audit.
  let resendAttachments: Array<{ filename: string; content: string; contentType?: string }> = [];
  let attachmentsSent: Array<{ file_name: string; file_size: number }> = [];
  let totalBytes = 0;

  if (body.attachment_ids && body.attachment_ids.length > 0) {
    // Storage-backed: load bytes server-side, enforce sensitivity gate.
    const loaded = await Promise.all(body.attachment_ids.map((id) => repo.getAttachmentBytes(actor, id)));
    const found = loaded.filter((x): x is NonNullable<typeof x> => x != null);
    const hasSensitive = found.some((a) => a.security_level !== 'aggregate');
    if (hasSensitive && !body.confirm_sensitive) {
      return NextResponse.json({ ok: false, error: 'Confirmação de anexos sensíveis necessária.' }, { status: 400 });
    }
    resendAttachments = found.map((a) => ({ filename: a.file_name, content: a.bytes.toString('base64'), contentType: a.mime_type }));
    attachmentsSent = found.map((a) => ({ file_name: a.file_name, file_size: a.file_size }));
    totalBytes = found.reduce((s, a) => s + a.file_size, 0);
  } else {
    const inline = body.attachments ?? [];
    resendAttachments = inline.map((a) => ({ filename: a.file_name, content: a.content_base64, contentType: a.mime_type }));
    attachmentsSent = inline.map((a) => ({ file_name: a.file_name, file_size: a.file_size || 0 }));
    totalBytes = inline.reduce((s, a) => s + (a.file_size || 0), 0);
  }

  if (totalBytes > MAX_TOTAL_BYTES) return tooLargeResponse(totalBytes);

  const apiKey = process.env.RESEND_API_KEY;
  const from = body.from || process.env.PAYROLL_EMAIL_FROM || 'Folha <folha@example.com>';

  // Persists package + dispatch when this is a storage-backed final send.
  const persist = async (status: 'sent' | 'failed' | 'simulated', providerId?: string, errorMessage?: string) => {
    if (!body.batch_id || !body.attachment_ids) return;
    try {
      const pkg = await repo.createEmailPackage(actor, body.batch_id, {
        audience: body.audience ?? 'custom', subject: body.subject, html_body: body.html, attachment_ids: body.attachment_ids,
      });
      await repo.recordDispatch(actor, {
        package_id: pkg.id, recipients: body.recipients, cc: body.cc, bcc: body.bcc,
        delivery_status: status, provider_message_id: providerId, error_message: errorMessage, attachments_sent: attachmentsSent,
      });
    } catch (e) {
      console.error('[email/send] persist dispatch failed:', e instanceof Error ? e.message : e);
    }
  };

  // Dry-run: no key configured, or explicit test send.
  if (!apiKey || body.test) {
    if (!body.test) await persist('simulated');
    return NextResponse.json({
      ok: true, delivery_status: 'simulated',
      reason: !apiKey ? 'RESEND_API_KEY ausente — envio simulado.' : 'Envio de teste (dry-run).',
      recipients: body.recipients, cc: body.cc ?? [], bcc: body.bcc ?? [],
      attachments_sent: attachmentsSent, total_bytes: totalBytes,
    });
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from, to: body.recipients, cc: body.cc, bcc: body.bcc, subject: body.subject, html: body.html,
      attachments: resendAttachments,
    });

    if (error) {
      await persist('failed', undefined, error.message);
      return NextResponse.json({ ok: false, delivery_status: 'failed', error: error.message, attachments_sent: attachmentsSent }, { status: 502 });
    }

    await persist('sent', data?.id);
    return NextResponse.json({
      ok: true, delivery_status: 'sent', provider_message_id: data?.id,
      recipients: body.recipients, attachments_sent: attachmentsSent, total_bytes: totalBytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[api/payroll/email/send] error:', message);
    await persist('failed', undefined, message);
    return NextResponse.json({ ok: false, delivery_status: 'failed', error: message, attachments_sent: attachmentsSent }, { status: 500 });
  }
}
