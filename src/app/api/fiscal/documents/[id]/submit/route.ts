import { NextResponse } from 'next/server';
import { fiscalDocumentActionSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { transitionFiscalDocument } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFiscalActor('fiscal.create');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    fiscalDocumentActionSchema.parse(await req.json());
    const document = await transitionFiscalDocument(
      auth.actor, id, 'draft', 'pending_approval', 'submitted_for_approval', 'Documento enviado para aprovação.',
      { submitted_by: auth.actor.userId },
    );
    return NextResponse.json({ ok: true, document });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao enviar documento para aprovação.');
  }
}

