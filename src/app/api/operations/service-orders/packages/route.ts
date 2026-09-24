import { NextResponse } from 'next/server';
import { requireOperationsSession, isSessionError } from '@/lib/operations/session';
import { listEligiblePackages, listImportTargets } from '@/lib/operations/service-orders/read-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * As duas portas de entrada: pacotes PT+PC aceitos (para "Gerar a partir de
 * proposta") e trabalhos autorizados (para "Importar OS"). Cada pacote vem
 * com o motivo pelo qual ainda não dá para gerar — a tela não oferece botão
 * que o banco recusaria.
 */
export async function GET() {
  const session = await requireOperationsSession(['operations.view']);
  if (isSessionError(session)) return session.error;
  const [packages, targets] = await Promise.all([
    listEligiblePackages(session.organizationId),
    listImportTargets(session.organizationId),
  ]);
  return NextResponse.json({ ok: true, packages, importTargets: targets });
}
