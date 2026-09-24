import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { projectPlanning } from '@/lib/operations/planning/read-model';
import { supplyCoverageLoader } from '@/lib/operations/planning/coverage';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Requisitos do projeto, prontidão por atividade e OS emitidas que alimentam o plano. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireAnyOperationsPermission(['operations.planning.view', 'projects.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  try {
    const [model, manage] = await Promise.all([
      projectPlanning(session, id, todayInSaoPaulo(), supplyCoverageLoader),
      hasOptionalPermission(session, 'operations.planning.manage'),
    ]);
    return NextResponse.json({ ok: true, capabilities: { manage }, ...model });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
