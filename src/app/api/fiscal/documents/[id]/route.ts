import { NextResponse } from 'next/server';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { getFiscalDocument } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveFiscalActor('fiscal.view');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const bundle = await getFiscalDocument(auth.actor.organizationId, id);
    if (!bundle) return NextResponse.json({ ok: false, error: 'Documento fiscal não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, ...bundle });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao consultar documento fiscal.');
  }
}

