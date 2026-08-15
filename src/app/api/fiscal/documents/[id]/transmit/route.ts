import { NextResponse } from 'next/server';
import { fiscalDocumentActionSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { processFiscalJob } from '@/lib/fiscal/server/engine';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { enqueueFiscalJob, transitionFiscalDocument } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFiscalActor('fiscal.transmit');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const action = fiscalDocumentActionSchema.parse(await req.json());
    const document = await transitionFiscalDocument(auth.actor, id, 'approved', 'queued', 'queued', 'Documento colocado na fila de transmissão.');
    const jobId = await enqueueFiscalJob(auth.actor, id, 'issue', `issue:${id}:${action.idempotencyKey}`, { actorUserId: auth.actor.userId });
    // Fast-path for homologation. The persistent job remains the source of truth.
    const processing = await processFiscalJob(jobId);
    return NextResponse.json({ ok: true, document, jobId, processing }, { status: 202 });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao enfileirar transmissão fiscal.');
  }
}

