import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { getFiscalServiceClient } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await resolveFiscalActor('finance.view');
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await getFiscalServiceClient()
      .from('tax_obligation')
      .select('*')
      .eq('organization_id', auth.actor.organizationId)
      .order('due_date');
    if (error) throw new Error(`Falha ao consultar obrigações tributárias: ${error.message}`);
    return NextResponse.json({ ok: true, obligations: data ?? [] });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao consultar obrigações tributárias.');
  }
}

const paymentSchema = z.object({
  id: z.string().uuid(),
  amountCents: z.number().int().positive().optional(),
  paidDate: z.iso.date(),
});

export async function POST(req: Request) {
  const auth = await resolveFiscalActor('finance.edit');
  if (!auth.ok) return auth.response;
  try {
    const input = paymentSchema.parse(await req.json());
    const client = getFiscalServiceClient();
    const { data: obligation, error } = await client.from('tax_obligation').select('*').eq('organization_id', auth.actor.organizationId).eq('id', input.id).single();
    if (error || !obligation) return NextResponse.json({ ok: false, error: 'Obrigação tributária não encontrada.' }, { status: 404 });
    if (['paid', 'cancelled'].includes(obligation.status)) return NextResponse.json({ ok: false, error: 'Obrigação já encerrada.' }, { status: 400 });
    const remaining = Number(obligation.amount_cents) - Number(obligation.paid_amount_cents);
    const paidNow = input.amountCents ?? remaining;
    if (paidNow > remaining) return NextResponse.json({ ok: false, error: 'Pagamento maior que o saldo da obrigação.' }, { status: 400 });
    const totalPaid = Number(obligation.paid_amount_cents) + paidNow;
    const { data, error: updateError } = await client.from('tax_obligation').update({
      paid_amount_cents: totalPaid,
      paid_date: input.paidDate,
      status: totalPaid >= Number(obligation.amount_cents) ? 'paid' : 'partial',
    }).eq('organization_id', auth.actor.organizationId).eq('id', input.id).select('*').single();
    if (updateError) throw new Error(`Falha ao liquidar obrigação tributária: ${updateError.message}`);
    return NextResponse.json({ ok: true, obligation: data });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao liquidar obrigação tributária.');
  }
}

