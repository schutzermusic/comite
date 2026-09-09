import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFollowupActor, followupApiError } from '@/lib/platform/followups/server/actor';
import { assignFollowupResponsible } from '@/lib/platform/followups/session';

export const runtime = 'nodejs';

// Designar é ato humano: a escrita vai pela função da 157, com o cliente da
// SESSÃO, e o carimbo sai de `auth.uid()` — nunca do corpo do pedido.
const schema = z.object({
  responsibleUserId: z.string().uuid().nullish(),
  responsiblePartyId: z.string().uuid().nullish(),
  responsibleText: z.string().trim().max(200).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  cadenceDays: z.number().int().positive().max(365).nullish(),
  expectedEvidence: z.string().trim().max(1000).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFollowupActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const input = schema.parse(await req.json());
    const followup = await assignFollowupResponsible(id, input);
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return followupApiError(error, 'Falha ao designar responsável.');
  }
}
