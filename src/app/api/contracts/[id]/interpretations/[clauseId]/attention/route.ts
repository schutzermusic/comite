import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFollowupActor, followupApiError } from '@/lib/platform/followups/server/actor';
import { resolveClauseAttention } from '@/lib/contracts/intelligence/session';

export const runtime = 'nodejs';

const schema = z.object({
  decision: z.enum(['confirm', 'dismiss', 'acknowledge']),
  note: z.string().trim().max(1000).nullish(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; clauseId: string }> },
) {
  const auth = await resolveFollowupActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { clauseId } = await params;
  try {
    const input = schema.parse(await req.json());
    const clause = await resolveClauseAttention(clauseId, input.decision, input.note);
    return NextResponse.json({ ok: true, clause });
  } catch (error) {
    return followupApiError(error, 'Falha ao registrar a decisão sobre a interpretação.');
  }
}
