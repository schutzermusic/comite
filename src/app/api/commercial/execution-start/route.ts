import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import {
  requireCommercialSession, isSessionError, safeGovernedError, hasOptionalPermission,
} from '@/lib/commercial/server-session';
import { closeAndStartExecution } from '@/lib/commercial/engagement-service';
import { createFollowupAsHuman } from '@/lib/platform/followups/session';
import { notifyMember } from '@/lib/commercial/notify';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const schema = z.object({
  mode: z.enum(['STANDARD', 'EXCEPTIONAL']),
  opportunity_id: z.string().uuid().nullish(),
  technical_revision_id: z.string().uuid().nullish(),
  commercial_revision_id: z.string().uuid().nullish(),
  authorization: z.object({
    type: z.enum(['accepted_proposal', 'customer_email', 'customer_po', 'customer_os', 'formal_contract', 'declared']),
    date,
    reference: z.string().trim().max(1000).nullish(),
    document_id: z.string().uuid().nullish(),
    context: z.string().trim().max(2000).nullish(),
    acceptance_source: z.enum(['signed_document', 'customer_email', 'customer_portal', 'purchase_order',
      'meeting_minutes']).nullish(),
    customer_authorizer_name: z.string().trim().max(300).nullish(),
    contract_id: z.string().uuid().nullish(),
  }),
  exception: z.object({
    reason: z.string().trim().min(5).max(2000),
    internal_authorizer_user_id: z.string().uuid(),
    regularization_owner_user_id: z.string().uuid(),
    regularization_due_date: date,
  }).optional(),
  service_order: z.object({
    mode: z.enum(['generate', 'link', 'upload', 'skip']),
    service_order_id: z.string().uuid().nullish(),
    os_number: z.string().trim().max(80).nullish(),
    title: z.string().trim().max(300).nullish(),
    planned_start: date.nullish(),
    planned_finish: date.nullish(),
    authorized_value: z.string().regex(/^\d+(\.\d{1,2})?$/).nullish(),
    file_path: z.string().max(500).nullish(),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
    file_title: z.string().max(300).nullish(),
  }),
  project: z.object({
    mode: z.enum(['create', 'link', 'skip']),
    project_id: z.string().max(200).nullish(),
    payload: z.object({
      nome: z.string().trim().min(1).max(300),
      cliente: z.string().trim().min(1).max(300),
      descricao: z.string().max(4000).optional(),
      status: z.literal('em_andamento'),
      data_inicio: date.optional(),
      data_fim_prevista: date.optional(),
    }).optional(),
  }),
});

/**
 * "Fechar negócio e iniciar execução" — e o início excepcional.
 *
 * A rota decide a ALÇADA; a função governada decide a REGRA. Cada pedaço do
 * fechamento exige a permissão que já exigia fora dele — registrar aceite,
 * operar OS, criar projeto — e o fechamento não vira atalho para nenhuma.
 *
 * `action: "authorize_os_upload"` devolve um token de envio assinado para o
 * PDF da OS interna existente, num caminho que o SERVIDOR gera.
 */
export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.execution.start']);
  if (isSessionError(session)) return session.error;
  const body = await request.json().catch(() => null);

  if (body?.action === 'authorize_os_upload') {
    const name = String(body.fileName ?? '').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
    if (!name.toLowerCase().endsWith('.pdf') || String(body.mimeType) !== 'application/pdf') {
      return NextResponse.json({ ok: false, error: 'A OS interna deve ser enviada em PDF.' }, { status: 415 });
    }
    if (!(Number(body.fileSize) > 0 && Number(body.fileSize) <= 30 * 1024 * 1024)) {
      return NextResponse.json({ ok: false, error: 'O PDF deve ter no máximo 30 MB.' }, { status: 413 });
    }
    const path = `${session.organizationId}/service-orders/${randomUUID()}-${name}`;
    const { data, error } = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio.' }, { status: 500 });
    return NextResponse.json({ ok: true, path, token: data.token, bucket: ONBOARDING_STORAGE_BUCKET });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Revise o fechamento: há campo obrigatório ausente ou inválido.',
      issues: parsed.error.issues.map((i) => i.path.join('.')) }, { status: 400 });
  }
  const payload = parsed.data;

  const missing: string[] = [];
  if (payload.mode === 'EXCEPTIONAL') {
    if (!payload.exception) {
      return NextResponse.json({ ok: false, error: 'O início excepcional exige motivo, autorizador, responsável e prazo.' }, { status: 400 });
    }
    if (!await hasOptionalPermission(session, 'commercial.execution.start_exceptional')) {
      missing.push('commercial.execution.start_exceptional');
    }
  }
  if (payload.service_order.mode !== 'skip'
      && !await hasOptionalPermission(session, 'commercial.service_orders.manage')) {
    missing.push('commercial.service_orders.manage');
  }
  if (payload.project.mode !== 'skip') {
    for (const key of ['commercial.service_orders.bind_project', 'projects.create']) {
      if (!await hasOptionalPermission(session, key)) missing.push(key);
    }
  }
  if (payload.service_order.mode === 'upload'
      && !payload.service_order.file_path?.startsWith(`${session.organizationId}/service-orders/`)) {
    return NextResponse.json({ ok: false, error: 'Caminho do PDF da OS fora deste inquilino.' }, { status: 403 });
  }

  // Aceite registrado agora exige a alçada de registrar aceite.
  if (payload.mode === 'STANDARD') {
    const ids = [payload.technical_revision_id, payload.commercial_revision_id].filter(Boolean) as string[];
    if (ids.length) {
      const { data } = await session.supabase.from('commercial_proposal_revisions').select('id,status')
        .eq('organization_id', session.organizationId).in('id', ids);
      const pendingAcceptance = ((data ?? []) as Array<{ status: string }>)
        .some((r) => r.status === 'SENT' || r.status === 'NEGOTIATION');
      if (pendingAcceptance && !await hasOptionalPermission(session, 'commercial.proposals.record_acceptance')) {
        missing.push('commercial.proposals.record_acceptance');
      }
    }
  }
  if (missing.length) {
    return NextResponse.json({ ok: false, error: `Esta ação exige: ${Array.from(new Set(missing)).join(', ')}.` }, { status: 403 });
  }

  const projectId = payload.project.mode === 'create' ? `proj-${randomUUID()}` : payload.project.project_id ?? null;
  try {
    const result = await closeAndStartExecution(session.organizationId, session.user.id, {
      ...payload,
      project: { ...payload.project, project_id: projectId },
    });

    let followupId: string | null = null;
    let followupError: string | null = null;
    let notified = false;
    if (payload.mode === 'EXCEPTIONAL' && payload.exception && result.documentation_state === 'PENDING') {
      /*
        A regularização vira um COMPROMISSO no motor canônico: dono, prazo e
        evidência esperada. A chave de idempotência é o próprio início — repetir
        o fechamento não abre um segundo acompanhamento.
      */
      try {
        const followup = await createFollowupAsHuman(`execution-start:${result.execution_start_id}`, {
          sourceKind: 'commercial_engagement',
          sourceId: result.engagement_id,
          contractId: null,
          goal: 'Regularizar a documentação comercial do início excepcional',
          expectedEvidence: 'PO, contrato assinado ou aceite formal da proposta',
          responsibleUserId: payload.exception.regularization_owner_user_id,
          responsibleText: null,
          dueDate: payload.exception.regularization_due_date,
          cadenceDays: null,
          verificationMode: 'human_confirmation',
        });
        followupId = followup.id;
      } catch (error) {
        followupError = (error as Error).message;
      }
      const notice = await notifyMember({
        organizationId: session.organizationId,
        recipientUserId: payload.exception.regularization_owner_user_id,
        type: 'commercial_documentation_pending',
        title: 'Execução iniciada com documentação pendente — regularização sua',
        body: `Prazo: ${payload.exception.regularization_due_date}. O faturamento fica bloqueado até lá.`,
        link: payload.opportunity_id ? `/comercial?view=opportunities&opportunity=${payload.opportunity_id}` : '/comercial',
      });
      notified = notice.delivered;
    }

    await logAuditEventServer({
      organizationId: session.organizationId,
      action: payload.mode === 'EXCEPTIONAL' ? 'commercial.execution.started_exceptionally' : 'commercial.execution.started',
      entityType: 'commercial_engagement', entityId: result.engagement_id,
      metadata: {
        executionStartId: result.execution_start_id, basis: payload.authorization.type,
        serviceOrderId: result.service_order_id, projectId: result.project_id,
        blocked: result.blocked.map((b) => b.code), followupId, followupError, notified,
      },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result, followupId, followupError });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
