import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveObligationActor, obligationApiError } from '@/lib/contracts/obligations/server/actor';
import { recordObligationEvidence } from '@/lib/contracts/obligations/server/store';

export const runtime = 'nodejs';

// `[id]` aqui é a OCORRÊNCIA, não a definição.

const schema = z.object({
  contractId: z.string().uuid(),
  requirementId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  referenceText: z.string().trim().min(2).max(1000).optional(),
  note: z.string().trim().max(1000).optional(),
}).refine((v) => v.documentId || v.referenceText, 'Informe o documento ou a referência da evidência.');

/**
 * Registra evidência APRESENTADA.
 *
 * Registrar não aceita: quando a exigência pede aceite formal, a evidência
 * nasce pendente, e a obrigação continua em aberto até que o aceite exista.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveObligationActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { id: instanceId } = await params;
  try {
    const input = schema.parse(await req.json());
    const evidence = await recordObligationEvidence(auth.actor, { ...input, instanceId });
    return NextResponse.json({ ok: true, evidence }, { status: 201 });
  } catch (error) {
    return obligationApiError(error, 'Falha ao registrar evidência.');
  }
}
