import { NextResponse } from 'next/server';
import { fiscalServiceSchema } from '@/lib/fiscal/schemas';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { createService } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await resolveFiscalActor('fiscal.configure');
  if (!auth.ok) return auth.response;
  try {
    const input = fiscalServiceSchema.parse(await req.json());
    return NextResponse.json({ ok: true, service: await createService(auth.actor, input) }, { status: 201 });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao cadastrar serviço fiscal.');
  }
}

