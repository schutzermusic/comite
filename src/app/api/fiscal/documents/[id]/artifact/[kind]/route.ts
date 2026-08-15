import { NextResponse } from 'next/server';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { FISCAL_DOCUMENT_BUCKET, getFiscalDocument, getFiscalServiceClient } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const auth = await resolveFiscalActor('fiscal.export');
  if (!auth.ok) return auth.response;
  const { id, kind } = await params;
  if (!['xml', 'danfse'].includes(kind)) return NextResponse.json({ ok: false, error: 'Artefato inválido.' }, { status: 400 });
  try {
    const bundle = await getFiscalDocument(auth.actor.organizationId, id);
    if (!bundle) return NextResponse.json({ ok: false, error: 'Documento não encontrado.' }, { status: 404 });
    const path = kind === 'xml' ? bundle.document.xml_storage_path : bundle.document.danfse_storage_path;
    if (!path) return NextResponse.json({ ok: false, error: `${kind === 'xml' ? 'XML' : 'DANFSe'} ainda não disponível.` }, { status: 404 });
    const { data, error } = await getFiscalServiceClient().storage.from(FISCAL_DOCUMENT_BUCKET).download(path);
    if (error || !data) throw new Error(`Falha ao ler artefato fiscal: ${error?.message ?? 'arquivo ausente'}`);
    return new Response(await data.arrayBuffer(), {
      headers: {
        'content-type': kind === 'xml' ? 'application/xml; charset=utf-8' : 'application/pdf',
        'content-disposition': `attachment; filename="nfse-${bundle.document.document_number ?? id}.${kind === 'xml' ? 'xml' : 'pdf'}"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao baixar artefato fiscal.');
  }
}

