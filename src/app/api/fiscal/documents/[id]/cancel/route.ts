import { NextResponse } from 'next/server';
import { fiscalDocumentActionSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { processFiscalJob } from '@/lib/fiscal/server/engine';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { enqueueFiscalJob, transitionFiscalDocument } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFiscalActor('fiscal.cancel');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const action = fiscalDocumentActionSchema.extend({ reason: fiscalDocumentActionSchema.shape.reason.unwrap().min(15) }).parse(await req.json());
    const document = await transitionFiscalDocument(auth.actor, id, 'authorized', 'cancellation_requested', 'cancellation_requested', 'Cancelamento solicitado.', { cancellation_reason: action.reason });
    const jobId = await enqueueFiscalJob(auth.actor, id, 'cancel', `cancel:${id}:${action.idempotencyKey}`, { reason: action.reason, actorUserId: auth.actor.userId });
    const processing = await processFiscalJob(jobId);
    return NextResponse.json({ ok: true, document, jobId, processing }, { status: 202 });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao solicitar cancelamento.');
  }
}

