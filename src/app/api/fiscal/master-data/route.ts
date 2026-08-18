import { NextResponse } from 'next/server';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { listFiscalMasterData } from '@/lib/fiscal/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await resolveFiscalActor('fiscal.view');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, ...(await listFiscalMasterData(auth.actor.organizationId)) });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao carregar cadastros fiscais.');
  }
}

