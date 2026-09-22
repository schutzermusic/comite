import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { createFollowupAsHuman, transitionFollowupAsHuman } from '@/lib/platform/followups/session';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Os papéis comerciais dentro do motor de follow-up que já existe. */
const COMMERCIAL_SOURCES = [
  'commercial_opportunity', 'commercial_proposal',
  'commercial_engagement', 'internal_service_order',
] as const;

export async function GET() {
  const session = await requireCommercialSession(['commercial.view']);
  if (isSessionError(session)) return session.error;

  const { data, error } = await session.supabase.from('apex_followups')
    .select('id,source_kind,source_id,goal,expected_evidence,due_date,state,state_note,'
      + 'next_expected_event,next_expected_event_at,responsible_text,responsible_user_id,'
      + 'cadence_days,closed_at,closure_basis,created_at')
    .eq('organization_id', session.organizationId)
    .in('source_kind', COMMERCIAL_SOURCES as unknown as string[])
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) {
    return NextResponse.json({ ok: false,
      error: 'Não foi possível consultar os follow-ups.' }, { status: 500 });
  }

  /*
    O cliente tipado do Supabase devolve uma união com `GenericStringError` para
    tabelas que ele não conhece. O estreitamento é local e explícito — a mesma
    saída já usada na rota de sinais — e não silencia erro nenhum: `error` acima
    continua sendo o que decide se a resposta é 500.
  */
  const rows = (data ?? []) as unknown as Array<{
    id: string; source_kind: string; source_id: string; goal: string;
    responsible_user_id: string | null;
  }>;

  /*
    Os ASSUNTOS dos acompanhamentos, para a fila dizer "Proposta PC-2026-004"
    em vez de repetir um uuid. Duas consultas rasas, e só dos ids que aparecem:
    guardar o título dentro do follow-up seria uma cópia que envelhece no
    primeiro renome.
  */
  const idsOf = (kind: string) => Array.from(new Set(
    rows.filter((row) => row.source_kind === kind).map((row) => row.source_id)));
  const opportunityIds = idsOf('commercial_opportunity');
  const proposalIds = idsOf('commercial_proposal');

  const [opportunities, proposals] = await Promise.all([
    opportunityIds.length
      ? session.supabase.from('commercial_opportunities')
          .select('id,title,counterparty_name,stage')
          .eq('organization_id', session.organizationId).in('id', opportunityIds)
      : Promise.resolve({ data: [] }),
    proposalIds.length
      ? session.supabase.from('commercial_proposals')
          .select('id,proposal_number,title,counterparty_name')
          .eq('organization_id', session.organizationId).in('id', proposalIds)
      : Promise.resolve({ data: [] }),
  ]);

  const subjects: Record<string, { label: string; counterparty: string | null }> = {};
  for (const row of (opportunities.data ?? []) as Array<Record<string, string>>) {
    subjects[`commercial_opportunity:${row.id}`] =
      { label: row.title, counterparty: row.counterparty_name };
  }
  for (const row of (proposals.data ?? []) as Array<Record<string, string>>) {
    subjects[`commercial_proposal:${row.id}`] =
      { label: `${row.proposal_number} · ${row.title}`, counterparty: row.counterparty_name };
  }

  const owners = await resolveOwnerNames(session.organizationId,
    rows.map((row) => row.responsible_user_id as string | null));

  return NextResponse.json({ ok: true, followups: rows, subjects, owners });
}

const createSchema = z.object({
  sourceKind: z.enum(COMMERCIAL_SOURCES),
  sourceId: z.string().uuid(),
  goal: z.string().trim().min(1).max(500),
  expectedEvidence: z.string().trim().max(1000).nullish(),
  responsibleUserId: z.string().uuid().nullish(),
  responsibleText: z.string().trim().max(200).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  cadenceDays: z.number().int().positive().max(365).nullish(),
});

/**
 * ABRIR um acompanhamento comercial — no motor de sempre.
 *
 * ─── O que esta rota deliberadamente NÃO é ───────────────────────────────
 *
 * Não é uma tabela de tarefas do Comercial. A linha vai para `apex_followups`,
 * a mesma do pós-venda, com a mesma máquina de estados, o mesmo histórico
 * append-only e a mesma regra de conclusão verificada. O que a migration 212
 * mudou foi só a pergunta da alçada: acompanhamento de objeto comercial exige
 * `commercial.manage`, e não mais `contracts.edit`.
 *
 * `contract_id` vai NULO: o objeto é uma oportunidade ou uma proposta, e
 * pendurá-lo num contrato que ainda não existe inventaria um vínculo.
 *
 * A idempotência é do chamador (cabeçalho `Idempotency-Key`), porque o retry de
 * rede não pode virar dois compromissos com o mesmo cliente.
 */
export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.manage']);
  if (isSessionError(session)) return session.error;

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim();
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return NextResponse.json({ ok: false,
      error: 'Idempotency-Key válido é obrigatório.' }, { status: 400 });
  }

  let parsed: z.infer<typeof createSchema>;
  try { parsed = createSchema.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false,
    error: 'Informe o objeto, o objetivo e um responsável válido.' }, { status: 400 }); }

  if (!parsed.responsibleUserId && !String(parsed.responsibleText ?? '').trim()) {
    return NextResponse.json({ ok: false,
      error: 'Um acompanhamento governado exige responsável.' }, { status: 400 });
  }

  // O objeto tem de existir NESTA organização e ser visível para quem pede. A
  // conferência usa o cliente autenticado de propósito: se a RLS não mostra o
  // objeto, não há acompanhamento a abrir sobre ele.
  const table = parsed.sourceKind === 'commercial_opportunity' ? 'commercial_opportunities'
    : parsed.sourceKind === 'commercial_proposal' ? 'commercial_proposals'
    : parsed.sourceKind === 'commercial_engagement' ? 'commercial_engagements'
    : 'internal_service_orders';
  const { data: subject } = await session.supabase.from(table).select('id')
    .eq('organization_id', session.organizationId).eq('id', parsed.sourceId).maybeSingle();
  if (!subject) {
    return NextResponse.json({ ok: false,
      error: 'O objeto do acompanhamento não foi encontrado.' }, { status: 404 });
  }

  try {
    const followup = await createFollowupAsHuman(idempotencyKey, {
      sourceKind: parsed.sourceKind,
      sourceId: parsed.sourceId,
      contractId: null,
      goal: parsed.goal,
      expectedEvidence: parsed.expectedEvidence ?? null,
      responsibleUserId: parsed.responsibleUserId ?? null,
      responsibleText: parsed.responsibleText ?? null,
      dueDate: parsed.dueDate ?? null,
      cadenceDays: parsed.cadenceDays ?? null,
      verificationMode: 'human_confirmation',
    });
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.followup.opened', entityType: 'apex_followup',
      entityId: followup.id, metadata: { sourceKind: parsed.sourceKind },
    }, request.headers);
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}

const transitionSchema = z.object({
  followupId: z.string().uuid(),
  next: z.enum(['ACTIVE', 'WAITING_EXTERNAL_PARTY', 'BLOCKED', 'ESCALATED', 'CANCELLED']),
  note: z.string().trim().max(1000).nullish(),
  nextExpectedEvent: z.string().trim().max(500).nullish(),
  nextExpectedEventAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/**
 * Mudar o estado do acompanhamento.
 *
 * `COMPLETED` não está na lista, e a ausência é a regra: concluir exige o
 * caminho verificado (`apex_followup_confirm_completion`), e uma transição
 * solta para "concluído" seria o clique substituindo a evidência. Cancelar
 * continua sendo outro resultado — não é conclusão, e a fila mostra os dois
 * separados.
 */
export async function PATCH(request: Request) {
  const session = await requireCommercialSession(['commercial.manage']);
  if (isSessionError(session)) return session.error;

  let parsed: z.infer<typeof transitionSchema>;
  try { parsed = transitionSchema.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false,
    error: 'Informe o acompanhamento e o próximo estado.' }, { status: 400 }); }

  if (parsed.next === 'WAITING_EXTERNAL_PARTY' && !parsed.nextExpectedEventAt) {
    return NextResponse.json({ ok: false,
      error: 'Aguardar a contraparte exige a data do retorno esperado.' }, { status: 400 });
  }

  try {
    const followup = await transitionFollowupAsHuman(parsed.followupId, {
      next: parsed.next,
      note: parsed.note ?? null,
      nextExpectedEvent: parsed.nextExpectedEvent ?? null,
      nextExpectedEventAt: parsed.nextExpectedEventAt ?? null,
    });
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
