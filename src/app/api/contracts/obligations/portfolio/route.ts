import { NextResponse } from 'next/server';
import { resolveObligationActor, obligationApiError } from '@/lib/contracts/obligations/server/actor';
import { loadContractObligationsAsOf, obligationServiceClient } from '@/lib/contracts/obligations/server/store';
import { buildObligationPortfolio } from '@/lib/contracts/obligations/portfolio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A carteira de obrigações resolvida NA DATA pedida.
 *
 * Um pedido só para a carteira inteira, em vez de um por contrato: a tela
 * precisa ordenar por urgência ENTRE contratos, e ordenar o que chega em N
 * respostas separadas faria a primeira renderização mostrar uma ordem que muda
 * sozinha depois.
 *
 * Contratos apagados ficam de fora; contratos `demo` entram porque a carteira
 * de demonstração é uma carteira — o que não pode acontecer é dado demo cruzar
 * para relatório oficial, e este endpoint não é relatório oficial.
 */
export async function GET(req: Request) {
  const auth = await resolveObligationActor('contracts.view');
  if (!auth.ok) return auth.response;
  try {
    const asOf = new URL(req.url).searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json({ ok: false, error: 'asOf deve ser uma data YYYY-MM-DD.' }, { status: 400 });
    }

    const { data, error } = await obligationServiceClient()
      .from('contracts').select('id,title')
      .eq('organization_id', auth.actor.organizationId)
      .is('deleted_at', null)
      .order('title');
    if (error) throw new Error(`Falha ao listar contratos: ${error.message}`);

    const resolved = [];
    for (const contract of data ?? []) {
      const result = await loadContractObligationsAsOf(auth.actor.organizationId, String(contract.id), asOf);
      resolved.push({ ...result, contractTitle: String(contract.title) });
    }

    return NextResponse.json({ ok: true, portfolio: buildObligationPortfolio(resolved, asOf) });
  } catch (error) {
    return obligationApiError(error, 'Falha ao resolver a carteira de obrigações.');
  }
}
