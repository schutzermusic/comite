import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError } from '@/lib/operations/session';
import { portfolioPlanning } from '@/lib/operations/planning/read-model';
import { supplyCoverageLoader } from '@/lib/operations/planning/coverage';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Planejamento do portfólio: necessidades por data, matriz de prontidão e exceções de plano. */
export async function GET() {
  const session = await requireAnyOperationsPermission(['operations.planning.view', 'projects.view']);
  if (isSessionError(session)) return session.error;
  try {
    return NextResponse.json({ ok: true, ...(await portfolioPlanning(session, todayInSaoPaulo(), supplyCoverageLoader)) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
