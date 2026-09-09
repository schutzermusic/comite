import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFollowupActor, followupApiError } from '@/lib/platform/followups/server/actor';
import { confirmFollowupCompletion } from '@/lib/platform/followups/session';
import { completeByVerifiedEvidence } from '@/lib/platform/followups/server/store';

export const runtime = 'nodejs';

/*
  Dois caminhos, e eles não se confundem:

  · `verified_evidence` — o Apex conferiu a evidência contra uma regra
    determinística. Só existe quando a regra existe.
  · `human_confirmation` — não havia regra conferível, e uma pessoa respondeu
    por isso. Vai pela função da 157, com o carimbo de `auth.uid()`.
*/
const schema = z.discriminatedUnion('basis', [
  z.object({
    basis: z.literal('verified_evidence'),
    evidenceId: z.string().uuid(),
    note: z.string().trim().max(500),
  }),
  z.object({
    basis: z.literal('human_confirmation'),
    note: z.string().trim().max(1000).nullish(),
  }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFollowupActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const input = schema.parse(await req.json());
    const followup = input.basis === 'verified_evidence'
      ? await completeByVerifiedEvidence(auth.actor, id, input.evidenceId, input.note)
      : await confirmFollowupCompletion(id, input.note);
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return followupApiError(error, 'Falha ao concluir o acompanhamento.');
  }
}
