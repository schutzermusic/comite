import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { bindProject } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OS emitida → Projeto: criar novo, ou vincular um que já existe.
 *
 * O payload do projeto vem da REVISÃO mostrada ao usuário — cliente, título,
 * datas e escopo já herdados da proposta, do contrato e da OS. Esta rota não
 * inventa cronograma: não há geração de Gantt aqui, e nenhuma etapa é criada.
 * O projeto nasce com o que se SABE, e o cronograma é trabalho de quem
 * planeja.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(
    ['commercial.service_orders.bind_project', 'projects.create']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const mode = body.mode === 'link' ? 'link' : 'create';
  const existingId = body.projectId ? String(body.projectId).trim() : '';
  if (mode === 'link' && !existingId) {
    return NextResponse.json({ ok: false, error: 'Informe o projeto a vincular.' }, { status: 400 });
  }

  const projectId = mode === 'link' ? existingId : `proj-${randomUUID()}`;
  const payload = mode === 'link' ? null : {
    nome: String(body.nome ?? '').trim(),
    cliente: String(body.cliente ?? '').trim(),
    codigo: body.codigo ? String(body.codigo) : undefined,
    descricao: body.descricao ? String(body.descricao) : undefined,
    tipo: body.tipo ? String(body.tipo) : undefined,
    status: 'em_andamento',
    data_inicio: body.dataInicio ? String(body.dataInicio) : undefined,
    data_fim_prevista: body.dataFimPrevista ? String(body.dataFimPrevista) : undefined,
  };
  if (payload && (!payload.nome || !payload.cliente)) {
    return NextResponse.json({ ok: false,
      error: 'Projeto novo exige nome e cliente — ambos vêm da revisão, sem redigitação.' }, { status: 400 });
  }

  try {
    const result = await bindProject(
      session.organizationId, session.user.id, id, projectId, payload);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: result.created ? 'commercial.service_order.project_created'
                             : 'commercial.service_order.project_linked',
      entityType: 'internal_service_order', entityId: id,
      metadata: { projectId: result.project_id, contractLinked: result.contract_linked },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
