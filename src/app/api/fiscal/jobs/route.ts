import { NextResponse } from 'next/server';
import { resolveFiscalActor } from '@/lib/fiscal/server/actor';
import { processDueFiscalJobs } from '@/lib/fiscal/server/engine';
import { fiscalApiError } from '@/lib/fiscal/server/http';
import { authorizeCron } from '@/lib/ponto/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  const denied = authorizeCron(req, 'fiscal-jobs');
  if (denied) return denied;
  try {
    const results = await processDueFiscalJobs(20);
    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao processar fila fiscal.');
  }
}

export async function POST() {
  const auth = await resolveFiscalActor('fiscal.transmit');
  if (!auth.ok) return auth.response;
  try {
    const results = await processDueFiscalJobs(10);
    return NextResponse.json({ ok: true, processed: results.length, results });
  } catch (error) {
    return fiscalApiError(error, 'Falha ao processar fila fiscal.');
  }
}

