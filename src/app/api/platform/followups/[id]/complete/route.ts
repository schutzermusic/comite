import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFollowupActor, followupApiError } from '@/lib/platform/followups/server/actor';
import { confirmFollowupCompletion } from '@/lib/platform/followups/session';

export const runtime = 'nodejs';

// O navegador só pode assumir autoridade humana. A conclusão determinística
// não é um modo deste endpoint: o verificador de serviço chama um RPC sem grant
// para authenticated e precisa provar documento + regra.
const schema = z.object({
  basis: z.literal('human_confirmation'),
  note: z.string().trim().max(1000).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFollowupActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const input = schema.parse(await req.json());
    const followup = await confirmFollowupCompletion(id, input.note);
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return followupApiError(error, 'Falha ao concluir o acompanhamento.');
  }
}
