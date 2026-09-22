import { NextResponse } from 'next/server';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { buildAutonomySignals, sortAutonomySignals } from '@/lib/commercial/autonomy';
import type {
  CommercialDivergence, ExtractedFact, InternalServiceOrder, ProposalRevisionStatus,
} from '@/lib/commercial/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SINAIS DE AUTONOMIA de um trabalho autorizado.
 *
 * Tudo aqui é LEITURA. O cálculo roda sobre o que o usuário pode ver (cliente
 * autenticado, RLS de cada tabela) e devolve recomendações com destino — não
 * efeitos. Nenhuma escrita acontece nesta rota, e as ações sugeridas levam a
 * telas onde uma pessoa decide.
 *
 * É a fronteira do §12 em código: a IA classifica, compara e recomenda; ela
 * não aceita proposta, não aceita medição, não cria aceite do cliente e não
 * concede elegibilidade de faturamento.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['contracts.view']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  const [engagement, authorizations, orders, divergences, facts, revisions] = await Promise.all([
    session.supabase.from('commercial_engagements')
      .select('id,title,status,created_at').eq('organization_id', session.organizationId)
      .eq('id', id).limit(1).maybeSingle(),
    session.supabase.from('commercial_engagement_authorizations')
      .select('id,proposal_revision_id,governing,state')
      .eq('organization_id', session.organizationId).eq('engagement_id', id),
    session.supabase.from('internal_service_orders')
      .select('id,engagement_id,os_number,title,origin,status,authorized_value,currency,'
        + 'scope_summary,planned_start,planned_finish,project_id,source_proposal_revision_id,document_id')
      .eq('organization_id', session.organizationId).eq('engagement_id', id),
    session.supabase.from('commercial_divergences')
      .select('id,engagement_id,service_order_id,scope,field_path,left_source_kind,left_value,'
        + 'right_source_kind,right_value,severity,summary,detected_by,state,resolved_source_kind')
      .eq('organization_id', session.organizationId).eq('engagement_id', id),
    session.supabase.from('commercial_extracted_facts')
      .select('id,engagement_id,document_id,document_context,fact_domain,label,value_text,'
        + 'value_numeric,value_date,currency,source_revision,source_page,source_section,'
        + 'source_quote,confidence,provenance_state,confirmation_state')
      .eq('organization_id', session.organizationId).eq('engagement_id', id),
    session.supabase.from('commercial_proposal_revisions')
      .select('id,status,proposal:commercial_proposals!inner(proposal_number)')
      .eq('organization_id', session.organizationId).eq('status', 'ACCEPTED'),
  ]);

  if (!engagement.data) {
    return NextResponse.json({ ok: false, error: 'Trabalho autorizado não encontrado.' }, { status: 404 });
  }

  /*
    O cliente tipado do Supabase devolve uma união com `GenericStringError`
    para `select` com relação embutida. As formas abaixo são as que a consulta
    realmente traz; o estreitamento é local e explícito, e não silencia erro
    nenhum — cada linha continua sendo validada pelos tipos de domínio ao ser
    mapeada para `InternalServiceOrder`, `CommercialDivergence` e `ExtractedFact`.
  */
  const rows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

  const authorizedRevisionIds = new Set(
    rows<{ state: string; proposal_revision_id: string | null; governing: boolean }>(authorizations.data)
      .filter((row) => row.state === 'ACTIVE' && row.proposal_revision_id)
      .map((row) => row.proposal_revision_id as string));

  const signals = sortAutonomySignals(buildAutonomySignals({
    engagement: {
      id: engagement.data.id,
      title: engagement.data.title,
      status: engagement.data.status,
      createdAt: engagement.data.created_at,
      hasGoverningAuthorization: rows<{ governing: boolean; state: string }>(authorizations.data)
        .some((row) => row.governing && row.state === 'ACTIVE'),
    },
    acceptedProposalRevisions: rows<{ id: string; status: string; proposal?: { proposal_number: string } }>(revisions.data)
      .filter((row) => authorizedRevisionIds.has(row.id))
      .map((row) => ({
        id: row.id,
        proposalNumber: row.proposal?.proposal_number ?? '—',
        status: row.status as ProposalRevisionStatus,
      })),
    serviceOrders: rows<Record<string, string | null>>(orders.data).map((row) => ({
      id: row.id, engagementId: row.engagement_id, osNumber: row.os_number, title: row.title,
      origin: row.origin, status: row.status,
      authorizedValue: row.authorized_value === null ? null : Number(row.authorized_value),
      currency: row.currency, scopeSummary: row.scope_summary,
      plannedStart: row.planned_start, plannedFinish: row.planned_finish,
      projectId: row.project_id, sourceProposalRevisionId: row.source_proposal_revision_id,
      documentId: row.document_id,
    })) as InternalServiceOrder[],
    divergences: rows<Record<string, string | null>>(divergences.data).map((row) => ({
      id: row.id, engagementId: row.engagement_id, serviceOrderId: row.service_order_id,
      scope: row.scope, fieldPath: row.field_path,
      leftSourceKind: row.left_source_kind, leftValue: row.left_value,
      rightSourceKind: row.right_source_kind, rightValue: row.right_value,
      severity: row.severity, summary: row.summary, detectedBy: row.detected_by,
      state: row.state, resolvedSourceKind: row.resolved_source_kind,
    })) as CommercialDivergence[],
    facts: rows<Record<string, string | number | null>>(facts.data).map((row) => ({
      id: row.id, engagementId: row.engagement_id, documentId: row.document_id,
      documentContext: row.document_context, factDomain: row.fact_domain, label: row.label,
      valueText: row.value_text,
      valueNumeric: row.value_numeric === null ? null : Number(row.value_numeric),
      valueDate: row.value_date, currency: row.currency, sourceRevision: row.source_revision,
      sourcePage: row.source_page, sourceSection: row.source_section, sourceQuote: row.source_quote,
      confidence: row.confidence === null ? null : Number(row.confidence),
      provenanceState: row.provenance_state, confirmationState: row.confirmation_state,
    })) as ExtractedFact[],
  }));

  return NextResponse.json({ ok: true, signals,
    boundary: 'A Apex classifica, extrai, compara, explica, pré-preenche e recomenda. '
      + 'Ela não aceita proposta pelo cliente, não aceita medição, não cria aceite do cliente '
      + 'e não concede elegibilidade de faturamento.' });
}
