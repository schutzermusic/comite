import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveObligationActor, obligationApiError } from '@/lib/contracts/obligations/server/actor';
import { materializeObligation } from '@/lib/contracts/obligations/server/store';

export const runtime = 'nodejs';

const schema = z.object({ through: z.iso.date() });

/**
 * Cria as ocorrências até o horizonte pedido.
 *
 * Chamar duas vezes é inofensivo: a chave de ocorrência é derivada do período,
 * então a segunda chamada devolve `created: 0`. Nenhum agendador é necessário;
 * a Fase 4 poderá invocá-la sozinha.
 */
// `[id]` aqui é a DEFINIÇÃO. O segmento é compartilhado com transition e
// evidence, que recebem a OCORRÊNCIA — o Next exige um nome só por segmento, e
// inventar `[definitionId]` ao lado de `[instanceId]` quebra o roteador.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveObligationActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { id: definitionId } = await params;
  try {
    const { through } = schema.parse(await req.json());
    const created = await materializeObligation(auth.actor, definitionId, through);
    return NextResponse.json({ ok: true, created });
  } catch (error) {
    return obligationApiError(error, 'Falha ao materializar ocorrências.');
  }
}
