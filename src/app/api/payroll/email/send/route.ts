import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';
import { parsePayrollEmailIntent } from '@/lib/payroll/email-intent';
import { executePayrollSend } from '@/lib/payroll/email-send-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/payroll/email/send — envia o fechamento da folha por e-mail.
 *
 * O corpo é uma INTENÇÃO tipada, nunca conteúdo:
 *
 *   { kind: 'payroll_closing_package', batch_id, audience,
 *     to: [{ type: 'member' | 'contact', id }], cc: [...],
 *     attachment_ids: [...], confirm_sensitive, request_id, test }
 *
 * Remetente, destinatários (endereços), assunto, corpo e bytes de anexo são do
 * servidor — ver `src/lib/payroll/email-send-server.ts`. Um corpo com `from`,
 * `subject`, `html`, `recipients`, `bcc` ou `attachments` é recusado (400), e
 * multipart (bytes do navegador) não é mais aceito (415).
 *
 * Permissão: `people.payroll_send` na organização ativa (admins passam, como
 * nas demais rotas da folha); anexos pedem ainda as permissões do tipo de
 * arquivo e, se não forem agregados, `people.payroll_send_sensitive`.
 */
export async function POST(req: Request) {
  const actorRes = await resolvePayrollActor('people.payroll_send');
  if (!actorRes.ok) return actorRes.response;

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'Envio aceita só JSON com a intenção tipada — anexos saem do armazenamento seguro, não do navegador.' },
      { status: 415 },
    );
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  const parsed = parsePayrollEmailIntent(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    const result = await executePayrollSend(getServerRepository(), actorRes.actor, parsed.intent);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error('[api/payroll/email/send] erro:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, delivery_status: 'failed', error: 'Falha inesperada no envio.' }, { status: 500 });
  }
}
