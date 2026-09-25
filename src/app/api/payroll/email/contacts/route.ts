import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILBOX = /^[^\s@<>"';:,\\]+@[^\s@<>"';:,\\]+\.[^\s@<>"';:,\\]+$/;

/**
 * Contatos externos autorizados a receber o fechamento da folha (243).
 *
 * Cadastrar e revogar é de quem ADMINISTRA a folha (`people.payroll_admin`),
 * não de quem envia: assim quem tem `people.payroll_send` escolhe entre
 * destinatários aprovados e não consegue mandar para um endereço qualquer.
 * Cada cadastro e revogação fica na auditoria da folha.
 */
export async function POST(req: Request) {
  const actorRes = await resolvePayrollActor('people.payroll_admin');
  if (!actorRes.ok) return actorRes.response;
  let body: { email?: unknown; display_name?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 }); }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const displayName = typeof body.display_name === 'string' ? body.display_name.replace(/[\r\n\t]+/g, ' ').trim() : '';
  if (!email || email.length > 254 || !MAILBOX.test(email)) {
    return NextResponse.json({ ok: false, error: 'E-mail inválido.' }, { status: 400 });
  }
  if (!displayName || displayName.length > 120) {
    return NextResponse.json({ ok: false, error: 'Nome obrigatório (até 120 caracteres).' }, { status: 400 });
  }
  try {
    const contact = await getServerRepository().addEmailContact(actorRes.actor, { email, display_name: displayName });
    return NextResponse.json({ ok: true, contact }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.startsWith('CONTACT_EXISTS')) return NextResponse.json({ ok: false, error: 'Este endereço já está autorizado.' }, { status: 409 });
    if (message.startsWith('CONTACT_INVALID')) return NextResponse.json({ ok: false, error: 'Endereço ou nome fora do formato.' }, { status: 400 });
    console.error('[api/payroll/email/contacts] erro:', message);
    return NextResponse.json({ ok: false, error: 'Falha ao autorizar contato.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const actorRes = await resolvePayrollActor('people.payroll_admin');
  if (!actorRes.ok) return actorRes.response;
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: 'id inválido.' }, { status: 400 });
  const reason = (url.searchParams.get('reason') ?? '').slice(0, 500) || undefined;
  try {
    const ok = await getServerRepository().revokeEmailContact(actorRes.actor, id, reason);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'Contato não encontrado.' }, { status: 404 });
  } catch (err) {
    console.error('[api/payroll/email/contacts] erro:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'Falha ao revogar contato.' }, { status: 500 });
  }
}
