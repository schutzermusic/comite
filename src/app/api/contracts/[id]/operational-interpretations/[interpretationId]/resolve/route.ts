import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFollowupActor, followupApiError } from '@/lib/platform/followups/server/actor';
import { resolveOperationalInterpretation } from '@/lib/contracts/intelligence/session';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';

const schema = z.object({
  decision: z.enum(['confirm', 'dismiss']),
  note: z.string().trim().max(1000).nullish(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; interpretationId: string }> },
) {
  const auth = await resolveFollowupActor('contracts.edit');
  if (!auth.ok) return auth.response;

  const { id: contractId, interpretationId } = await params;
  try {
    const input = schema.parse(await req.json());
    const supabase = await createClient();

    const { data: interp, error: loadError } = await supabase
      .from('contract_operational_interpretations')
      .select('id, contract_id, source_document_id')
      .eq('id', interpretationId)
      .maybeSingle();

    if (loadError) throw new Error(loadError.message);
    if (!interp || interp.contract_id !== contractId) {
      return NextResponse.json(
        { ok: false, error: 'Interpretação não encontrada neste contrato.' },
        { status: 404 },
      );
    }

    let documentTitle: string | null = null;
    if (interp.source_document_id) {
      const { data: doc } = await supabase
        .from('contract_documents')
        .select('title')
        .eq('id', interp.source_document_id)
        .maybeSingle();
      documentTitle = doc?.title ?? null;
    }

    const result = await resolveOperationalInterpretation(
      interpretationId,
      input.decision,
      input.note,
      { actorUserId: auth.actor.userId, documentTitle },
    );

    return NextResponse.json({
      ok: true,
      interpretation: result.interpretation,
      materialization: result.materialization,
    });
  } catch (error) {
    return followupApiError(error, 'Falha ao registrar a decisão sobre a interpretação operacional.');
  }
}
