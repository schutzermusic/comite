import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFollowupActor, followupApiError } from '@/lib/platform/followups/server/actor';
import { transitionFollowupAsHuman } from '@/lib/platform/followups/session';

export const runtime = 'nodejs';

/*
  `COMPLETED` não é aceito aqui. Concluir exige verificação — por evidência
  determinística (caminho do Apex) ou por confirmação humana (caminho de
  sessão). Deixar a conclusão numa rota genérica de transição faria "concluído"
  virar mais um valor de enum em vez de um ato com base registrada.
*/
const schema = z.object({
  next: z.enum(['ACTIVE', 'WAITING_EXTERNAL_PARTY', 'BLOCKED', 'ESCALATED', 'CANCELLED']),
  note: z.string().trim().max(1000).nullish(),
  nextExpectedEvent: z.string().trim().max(300).nullish(),
  nextExpectedEventAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFollowupActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const input = schema.parse(await req.json());
    const followup = await transitionFollowupAsHuman(id, input);
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return followupApiError(error, 'Falha ao mudar o estado do acompanhamento.');
  }
}
