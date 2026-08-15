import { NextResponse } from 'next/server';
import { fiscalPartySchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { createParty } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await resolveFiscalActor('fiscal.create');
  if (!auth.ok) return auth.response;
  try {
    const input = fiscalPartySchema.parse(await req.json());
    return NextResponse.json({ ok: true, party: await createParty(auth.actor, input) }, { status: 201 });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao cadastrar tomador.');
  }
}

