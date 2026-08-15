import { NextResponse } from 'next/server';
import { fiscalDocumentActionSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { cloneFiscalDocumentForReplacement } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFiscalActor('fiscal.cancel');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const action = fiscalDocumentActionSchema.parse(await req.json());
    const document = await cloneFiscalDocumentForReplacement(auth.actor, id, `replace:${id}:${action.idempotencyKey}`);
    return NextResponse.json({ ok: true, document }, { status: 201 });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao preparar substituição.');
  }
}
