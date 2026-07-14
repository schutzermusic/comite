import type {
  DeliberationItem,
  DeliberationStatus,
  ReviewStatus,
  AuditTrailEntry,
} from '@/lib/types';
import type {
  Deliberacao,
  DeliberacaoStatus,
  DeliberacaoPrioridade,
  DeliberacaoRisco,
  SlaStatus,
  Parecer,
  ParecerStatus,
  Evidencia,
  AcaoExecucao,
  AcaoExecucaoStatus,
  AuditEvent,
  ItemRelacionado,
  ItemRelacionadoTipo,
} from '@/components/deliberacoes/types';

/**
 * Maps the live Supabase model (`DeliberationItem`, used by the shared service
 * + /pautas) into the `Deliberacao` view shape the refactored Decision Control
 * Room renders. This keeps the visual refactor untouched while swapping the
 * data source from DELIBERACOES_MOCK to Supabase.
 *
 * The live model stores stage detail as JSONB (reviews, attachments,
 * executionItems, auditTrail, linkedEntities); we surface it 1:1 here.
 */

// Live DeliberationStatus (10 states) → the 6-stage workflow the pipeline shows.
const STATUS_MAP: Record<DeliberationStatus, DeliberacaoStatus> = {
  draft: 'rascunho',
  submitted: 'em_revisao',
  in_review: 'em_revisao',
  returned_for_revision: 'em_revisao',
  in_voting: 'em_votacao',
  awaiting_minutes: 'aguardando_ata',
  in_execution: 'em_execucao',
  resolved: 'concluida',
  closed: 'concluida',
  withdrawn: 'concluida',
};

const PRIORIDADE_MAP: Record<string, DeliberacaoPrioridade> = {
  critical: 'critica',
  high: 'alta',
  medium: 'media',
  low: 'baixa',
};

const RISCO_MAP: Record<string, DeliberacaoRisco> = {
  critical: 'critico',
  high: 'alto',
  medium: 'medio',
  low: 'baixo',
};

// Deterministic committee color from name (matches the CommitteeBadge palette
// range) so the same committee always reads the same tint without a lookup.
const COMMITTEE_PALETTE = ['#17C3B2', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#10B981', '#EC4899'];
function committeeColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COMMITTEE_PALETTE[hash % COMMITTEE_PALETTE.length];
}

const AT_RISK_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Derive SLA state from the due date (live model has no explicit sla_status). */
function deriveSla(status: DeliberacaoStatus, due?: Date, now: number = Date.now()): SlaStatus {
  if (status === 'concluida' || !due) return 'on_track';
  const delta = due.getTime() - now;
  if (delta < 0) return 'overdue';
  if (delta <= AT_RISK_WINDOW_MS) return 'at_risk';
  return 'on_track';
}

const REVIEW_TIPO: Record<ReviewStatus['type'], Parecer['tipo']> = {
  Legal: 'juridico',
  Finance: 'financeiro',
  Compliance: 'tecnico',
};

function reviewStatusToParecer(status: ReviewStatus['status']): ParecerStatus {
  if (status === 'approved') return 'favoravel';
  if (status === 'rejected') return 'contrario';
  return 'com_ressalvas';
}

const EXEC_STATUS_MAP: Record<'pending' | 'in_progress' | 'completed', AcaoExecucaoStatus> = {
  pending: 'pendente',
  in_progress: 'em_andamento',
  completed: 'concluida',
};

const LINKED_TIPO_MAP: Record<string, ItemRelacionadoTipo> = {
  project: 'projeto',
  contract: 'contrato',
  risk: 'risco',
  meeting: 'reuniao',
};

function nextActionForStatus(status: DeliberacaoStatus): string {
  switch (status) {
    case 'rascunho':
      return 'Completar dados';
    case 'em_revisao':
      return 'Solicitar parecer / Concluir revisão';
    case 'em_votacao':
      return 'Registrar voto / Aguardando votos';
    case 'aguardando_ata':
      return 'Lavrar ata';
    case 'em_execucao':
      return 'Atualizar execução / Anexar evidência';
    case 'concluida':
      return 'Ver auditoria / Exportar relatório';
  }
}

export function mapLiveToDeliberacao(item: DeliberationItem, now: number = Date.now()): Deliberacao {
  const status = STATUS_MAP[item.deliberationStatus] ?? 'rascunho';
  const comiteNome = item.ownerCommitteeName ?? 'Comitê';
  const votes = item.votes ?? [];
  const votosFavor = votes.filter((v) => v.vote === 'yes').length;
  const votosContra = votes.filter((v) => v.vote === 'no').length;
  const votosAbstencao = votes.filter((v) => v.vote === 'abstain').length;
  const due = item.dueDate ? new Date(item.dueDate) : undefined;

  const pareceres: Parecer[] = (item.reviews ?? [])
    .filter((r) => r.status !== 'not_required')
    .map((r, i) => ({
      id: `${item.id}-review-${i}`,
      autor_nome: r.reviewerName ?? 'Revisor',
      tipo: REVIEW_TIPO[r.type],
      conteudo: r.notes ?? `Parecer ${r.type.toLowerCase()} — ${r.status}.`,
      status: reviewStatusToParecer(r.status),
      created_at: (r.reviewedAt ? new Date(r.reviewedAt) : new Date(item.updatedAt)).toISOString(),
    }));

  const evidencias: Evidencia[] = (item.attachments ?? []).map((a) => ({
    id: a.id,
    nome: a.name,
    url: a.url,
    tipo: a.type === 'link' ? 'link' : a.type === 'document' ? 'documento' : 'relatorio',
    uploaded_by: item.ownerName ?? 'Sistema',
    created_at: new Date(item.updatedAt).toISOString(),
  }));

  const acoesExecucao: AcaoExecucao[] = (item.executionItems ?? []).map((e) => ({
    id: e.id,
    titulo: e.title,
    responsavel_nome: e.ownerName,
    prazo: new Date(e.dueDate).toISOString(),
    status: EXEC_STATUS_MAP[e.status] ?? 'pendente',
    linked_entity_id: e.linkedEntityId,
    linked_entity_tipo: e.linkedEntityType,
  }));

  const auditTrail: AuditEvent[] = (item.auditTrail ?? []).map((a: AuditTrailEntry) => ({
    id: a.id,
    acao: a.action,
    descricao: a.description,
    usuario_nome: a.userName,
    timestamp: new Date(a.timestamp).toISOString(),
  }));

  // Revisão FORMAL ≠ parecer opcional. Sinais confiáveis, nesta ordem:
  // 1. status atual é de revisão (submitted/in_review/returned_for_revision);
  // 2. rota de criação persistida = review, ou enteredReviewAt gravado;
  // 3. o histórico registra entrada em revisão ('entered_review' na criação
  //    por rota de revisão; closeVoting no_quorum/returned escrevem newValue
  //    in_review/returned_for_revision). 'submitted' era escrito na criação
  //    de TODA rota em registros legados — não é sinal;
  // 4. parecer emitido ANTES da abertura da votação. Rota de votação direta
  //    tem votingStartedAt = criação, então nada a antecede; pareceres
  //    solicitados durante a votação não contam.
  const votingStartMs = item.votingStartedAt ? new Date(item.votingStartedAt).getTime() : null;
  const revisaoFormal =
    status === 'em_revisao' ||
    item.creationRoute === 'review' ||
    Boolean(item.enteredReviewAt) ||
    (item.auditTrail ?? []).some(
      (a) =>
        a.action === 'entered_review' ||
        ['in_review', 'returned_for_revision'].includes(a.newValue ?? ''),
    ) ||
    (votingStartMs !== null &&
      (item.reviews ?? []).some(
        (r) =>
          r.status !== 'not_required' &&
          r.reviewedAt !== undefined &&
          new Date(r.reviewedAt).getTime() <= votingStartMs,
      ));

  const itensRelacionados: ItemRelacionado[] = (item.linkedEntities ?? [])
    .filter((l) => LINKED_TIPO_MAP[l.type])
    .map((l) => ({
      id: l.id,
      label: l.label,
      tipo: LINKED_TIPO_MAP[l.type],
      href: l.href,
    }));

  return {
    id: item.id,
    titulo: item.title,
    descricao: item.description ?? '',
    contexto: item.requestedDecision ?? item.description ?? '',
    decisao_solicitada: item.requestedDecision ?? '',
    comite_id: item.ownerCommitteeId ?? '',
    comite_nome: comiteNome,
    comite_cor: committeeColor(comiteNome),
    responsavel_nome: item.ownerName ?? item.createdByName ?? 'Responsável',
    responsavel_email: '',
    status,
    prioridade: PRIORIDADE_MAP[item.priority ?? 'medium'] ?? 'media',
    risco: RISCO_MAP[item.riskLevel ?? 'medium'] ?? 'medio',
    sla_status: deriveSla(status, due, now),
    sla_deadline: (due ?? new Date(item.updatedAt)).toISOString(),
    quorum_necessario: item.quorumRequired ?? 0,
    quorum_atual: item.quorumPresent ?? votes.length,
    votos_favor: votosFavor,
    votos_contra: votosContra,
    votos_abstencao: votosAbstencao,
    proxima_acao: nextActionForStatus(status),
    tem_ata: Boolean(item.minutes),
    revisao_formal: revisaoFormal,
    pareceres,
    evidencias,
    acoes_execucao: acoesExecucao,
    audit_trail: auditTrail,
    itens_relacionados: itensRelacionados,
    created_at: new Date(item.createdAt).toISOString(),
    updated_at: new Date(item.updatedAt).toISOString(),
  };
}

/** Vote option expected by the live service, from the UI's cast intent. */
export type UiVoteChoice = 'favor' | 'contra' | 'abstencao';
export const VOTE_CHOICE_MAP: Record<UiVoteChoice, 'yes' | 'no' | 'abstain'> = {
  favor: 'yes',
  contra: 'no',
  abstencao: 'abstain',
};
