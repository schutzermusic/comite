import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveObligationActor, obligationApiError } from '@/lib/contracts/obligations/server/actor';
import { transitionObligationInstance } from '@/lib/contracts/obligations/server/store';

export const runtime = 'nodejs';

const schema = z.object({
  next: z.enum(['OPEN', 'SATISFIED', 'WAIVED', 'CANCELLED', 'EXCEPTION']),
  // Cumprir exige dizer COM BASE EM QUÊ. Sem isso, "cumprida" viraria opinião.
  satisfactionBasis: z.enum(['explicit_completion', 'required_evidence_present', 'contractual_fact']).optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const auth = await resolveObligationActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { instanceId } = await params;
  try {
    const input = schema.parse(await req.json());
    const instance = await transitionObligationInstance(auth.actor, instanceId, input.next, input);
    return NextResponse.json({ ok: true, instance });
  } catch (error) {
    return obligationApiError(error, 'Falha ao registrar transição.');
  }
}
