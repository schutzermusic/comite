import { NextResponse } from 'next/server';
import { fiscalDocumentActionSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { getFiscalDocument, transitionFiscalDocument } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFiscalActor('fiscal.approve');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    fiscalDocumentActionSchema.parse(await req.json());
    const bundle = await getFiscalDocument(auth.actor.organizationId, id);
    if (!bundle) throw new Error('Documento fiscal não encontrado.');
    const service = bundle.document.service_snapshot as { approved_by_accountant?: boolean };
    if (!service.approved_by_accountant) throw new Error('O serviço e suas alíquotas ainda não foram aprovados pelo contador.');
    const document = await transitionFiscalDocument(
      auth.actor, id, 'pending_approval', 'approved', 'approved', 'Documento fiscal aprovado.',
      { approved_by: auth.actor.userId, approved_at: new Date().toISOString() },
    );
    return NextResponse.json({ ok: true, document });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao aprovar documento fiscal.');
  }
}

