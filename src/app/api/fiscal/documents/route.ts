import { NextResponse } from 'next/server';
import { createFiscalDocumentSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { createFiscalDocument, listFiscalDocuments } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await resolveFiscalActor('fiscal.view');
  if (!auth.ok) return auth.response;
  const params = new URL(req.url).searchParams;
  try {
    const result = await listFiscalDocuments(auth.actor.organizationId, {
      status: params.get('status') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      limit: Number(params.get('limit') ?? 100),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao listar notas fiscais.');
  }
}

export async function POST(req: Request) {
  const auth = await resolveFiscalActor('fiscal.create');
  if (!auth.ok) return auth.response;
  try {
    const input = createFiscalDocumentSchema.parse(await req.json());
    const document = await createFiscalDocument(auth.actor, input);
    return NextResponse.json({ ok: true, document }, { status: 201 });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao criar rascunho fiscal.');
  }
}

