/**
 * ENVIAR A COTAÇÃO — `POST /api/supply/procurement/rfqs/[id]/send`, corpo `{ supplierIds?: string[] }`.
 *
 * Só com `procurement.source` (a mesma alçada de abrir e decidir a cotação) E
 * a leitura de cotações (procurement.view OU supply.view — a RLS de
 * `procurement_rfqs`): a resposta traz os convidados e quando cada um já
 * recebeu, e isso não sai para quem a tela de Compras mostraria "Restrito".
 * Nome do fornecedor só com a leitura de partes (a mesma regra do Dashboard);
 * sem ela, "Restrito". Só cotação ABERTA da organização ativa, só fornecedor
 * CONVIDADO, e só quando uma pessoa pede. 200 `{ ok: true, results }` com o
 * desfecho de cada fornecedor; 400 corpo/id inválido; 403 sem alçada (em
 * português, nunca a chave da permissão); 404 cotação de outra organização;
 * 422 cotação não aberta ou fornecedor não convidado.
 */
import { NextResponse } from 'next/server';
import { hasOptionalPermission, isSessionError, requireOperationsSession } from '@/lib/operations/session';
import { isRfqId, rfqSendSchema, sendRfqInvitations } from '@/lib/supply/rfq-send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const forbidden = (error: string) => NextResponse.json({ ok: false, error }, { status: 403, headers: NO_STORE });

/** `parties_select_suppliers` OU `parties_select_scoped` — o mesmo portão do nome no Dashboard. */
const NAME_KEYS = ['suppliers.view', 'procurement.view', 'parties.view', 'contracts.view', 'finance.view'];

async function anyOf(session: Parameters<typeof hasOptionalPermission>[0], keys: readonly string[]): Promise<boolean> {
  for (const key of keys) if (await hasOptionalPermission(session, key)) return true;
  return false;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession([]);
  if (isSessionError(session)) return session.error;
  if (!(await hasOptionalPermission(session, 'procurement.source'))) {
    return forbidden('Seu perfil não pode enviar pedidos de cotação: isso cabe a quem conduz as cotações em Compras.');
  }
  if (!(await anyOf(session, ['procurement.view', 'supply.view']))) {
    return forbidden('Seu perfil não lê as cotações de Compras — o envio fica com quem as acompanha.');
  }
  const { id } = await context.params;
  if (!isRfqId(id)) return NextResponse.json({ ok: false, error: 'Cotação inválida.' }, { status: 400 });
  const raw = await request.text().catch(() => '');
  let body: unknown = {};
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }
  }
  const parsed = rfqSendSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Campos inválidos.' }, { status: 400 });
  }
  try {
    const out = await sendRfqInvitations({
      organizationId: session.organizationId,
      actor: { id: session.user.id, email: session.user.email ?? null },
      rfqId: id,
      supplierIds: parsed.data.supplierIds,
      names: await anyOf(session, NAME_KEYS),
      headers: request.headers,
    });
    return NextResponse.json(out.body, { status: out.status, headers: NO_STORE });
  } catch (error) {
    console.error('[supply/rfq-send] envio falhou', (error as Error)?.message);
    return NextResponse.json({ ok: false, error: 'Não foi possível enviar a cotação agora. Tente de novo em instantes.' },
      { status: 500, headers: NO_STORE });
  }
}
