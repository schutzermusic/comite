import { NextResponse } from 'next/server';
import { fiscalEstablishmentSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { createEstablishment } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await resolveFiscalActor('fiscal.configure');
  if (!auth.ok) return auth.response;
  try {
    const input = fiscalEstablishmentSchema.parse(await req.json());
    return NextResponse.json({ ok: true, establishment: await createEstablishment(auth.actor, input) }, { status: 201 });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao cadastrar estabelecimento.');
  }
}

