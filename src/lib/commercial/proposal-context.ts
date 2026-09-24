/**
 * O CONTEXTO DE PROPOSTA — PT e PC são UMA proposta comercial.
 *
 * A proposta técnica e a comercial do mesmo cliente/obra são dois documentos
 * com número, PDF, revisões, fatos e proveniência próprios — e UM só negócio.
 * Contá-las como duas propostas inflava o funil, a conversão, a conta 360 e o
 * forecast. Aqui mora a única regra de agrupamento que toda tela consome:
 *
 *   • com a 217 aplicada, `commercial_proposals.context_id` é a verdade;
 *   • sem ela (ou em linha antiga não pareada), o par é DERIVADO pela mesma
 *     regra do backfill da 217: mesmo cliente, mesmo número-base (sem o
 *     prefixo PT/PC), exatamente uma TÉCNICA e uma COMERCIAL, sem
 *     oportunidade ou conta divergente. COMBINADA é sempre sozinha.
 *
 * A PT governa escopo, entregáveis, requisitos, exclusões, ensaios e
 * dependências; a PC governa valor, moeda, pagamento, validade e medição.
 *
 * Puro: nada de rede, nada de banco — o mesmo resultado na lista, no dossiê,
 * na conta, na oportunidade e nas métricas.
 */
import type { ProposalKind, ProposalRevisionStatus } from './types';

export interface ContextProposal {
  id: string;
  proposal_number: string;
  kind: ProposalKind;
  title: string;
  counterparty_name: string;
  currency?: string | null;
  opportunity_id?: string | null;
  party_id?: string | null;
  context_id?: string | null;
  created_at?: string | null;
}

export interface ContextRevision {
  id: string;
  proposal_id: string;
  revision: number;
  status: ProposalRevisionStatus;
  total_value?: string | number | null;
  currency?: string | null;
  validity_until?: string | null;
  document_id?: string | null;
  accepted_at?: string | null;
}

/** O ciclo de vida do PACOTE, na linguagem do negócio. */
export type ContextStage =
  | 'DRAFT' | 'INTERNAL_APPROVAL' | 'APPROVED_FOR_SEND' | 'WITH_CUSTOMER'
  | 'NEGOTIATION' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';

export const CONTEXT_STAGE_LABEL: Record<ContextStage, string> = {
  DRAFT: 'Rascunho',
  INTERNAL_APPROVAL: 'Em aprovação interna',
  APPROVED_FOR_SEND: 'Aprovada para envio',
  WITH_CUSTOMER: 'Com o cliente',
  NEGOTIATION: 'Em negociação',
  ACCEPTED: 'Aceita pelo cliente',
  REJECTED: 'Recusada',
  CLOSED: 'Encerrada',
};

/** Aprovação interna: "este pacote exato PT/PC pode ir ao cliente?" */
export type InternalApprovalState = 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REAPPROVAL' | 'NOT_APPLICABLE';
export const INTERNAL_APPROVAL_LABEL: Record<InternalApprovalState, string> = {
  NOT_REQUESTED: 'Não enviada para aprovação',
  PENDING: 'Em aprovação interna',
  APPROVED: 'Aprovada para envio',
  REAPPROVAL: 'Parte do pacote sem aprovação interna',
  NOT_APPLICABLE: 'Encerrada',
};

export type CustomerState = 'NOT_SENT' | 'WITH_CUSTOMER' | 'NEGOTIATION' | 'PARTIALLY_ACCEPTED' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';
export const CUSTOMER_STATE_LABEL: Record<CustomerState, string> = {
  NOT_SENT: 'Ainda não enviada',
  WITH_CUSTOMER: 'Com o cliente',
  NEGOTIATION: 'Em negociação',
  PARTIALLY_ACCEPTED: 'Aceite parcial — pacote incompleto',
  ACCEPTED: 'Aceita',
  REJECTED: 'Recusada',
  CLOSED: 'Encerrada',
};

const STAGE_OF: Record<ProposalRevisionStatus, ContextStage> = {
  DRAFT: 'DRAFT',
  INTERNAL_REVIEW: 'INTERNAL_APPROVAL',
  INTERNALLY_APPROVED: 'APPROVED_FOR_SEND',
  SENT: 'WITH_CUSTOMER',
  NEGOTIATION: 'NEGOTIATION',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  EXPIRED: 'CLOSED',
  WITHDRAWN: 'CLOSED',
  SUPERSEDED: 'CLOSED',
};
const ORDER: ContextStage[] = ['DRAFT', 'INTERNAL_APPROVAL', 'APPROVED_FOR_SEND', 'WITH_CUSTOMER', 'NEGOTIATION', 'ACCEPTED'];
const rank = (s: ContextStage) => ORDER.indexOf(s);

export function revisionStage(status: ProposalRevisionStatus): ContextStage {
  return STAGE_OF[status] ?? 'DRAFT';
}

/**
 * "PT-2899.02/2026" → "2899.02/2026". Mesma expressão da função SQL
 * `commercial_proposal_base_number` (217): o prefixo só cai quando é seguido
 * de separador ou dígito — "PCH-12" continua "PCH-12".
 */
export function baseProposalNumber(n: string): string {
  return n.trim().replace(/^(PT|PC)([\s._/-]+|(?=\d))/i, '').replace(/\s+/g, '').toUpperCase();
}
const normCounterparty = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export const revisionLabel = (n: number | null | undefined) => (n ? `R${String(n).padStart(2, '0')}` : '—');

/** Regente: a aceita, mesmo com rascunho mais novo; senão a mais recente. */
export function governingOf<T extends { revision: number; status: string }>(revisions: T[]): T | null {
  let current: T | null = null;
  for (const r of revisions) {
    if (r.status === 'ACCEPTED') { if (current?.status !== 'ACCEPTED' || r.revision > current.revision) current = r; continue; }
    if (current?.status === 'ACCEPTED') continue;
    if (!current || r.revision > current.revision) current = r;
  }
  return current;
}
export function latestOf<T extends { revision: number }>(revisions: T[]): T | null {
  return revisions.reduce<T | null>((a, r) => (!a || r.revision > a.revision ? r : a), null);
}

/**
 * A chave de contexto de cada proposta. Explícita quando a 217 gravou um
 * contexto compartilhado; derivada, pela regra do backfill, quando não.
 */
export function contextKeys(proposals: ContextProposal[]): Map<string, string> {
  const keys = new Map<string, string>();
  const shared = new Map<string, number>();
  for (const p of proposals) if (p.context_id) shared.set(p.context_id, (shared.get(p.context_id) ?? 0) + 1);

  // Quem já está num contexto compartilhado (mais de um membro) não é re-derivado.
  const loose: ContextProposal[] = [];
  for (const p of proposals) {
    if (p.context_id && (shared.get(p.context_id) ?? 0) > 1) keys.set(p.id, `ctx:${p.context_id}`);
    else loose.push(p);
  }
  const groups = new Map<string, ContextProposal[]>();
  for (const p of loose) {
    if (p.kind === 'COMBINED') continue;
    const k = `${normCounterparty(p.counterparty_name)}|${baseProposalNumber(p.proposal_number)}`;
    const g = groups.get(k);
    if (g) g.push(p); else groups.set(k, [p]);
  }
  for (const g of groups.values()) {
    const t = g.filter((p) => p.kind === 'TECHNICAL');
    const c = g.filter((p) => p.kind === 'COMMERCIAL');
    if (t.length !== 1 || c.length !== 1) continue;
    const [pt, pc] = [t[0], c[0]];
    if (pt.opportunity_id && pc.opportunity_id && pt.opportunity_id !== pc.opportunity_id) continue;
    if (pt.party_id && pc.party_id && pt.party_id !== pc.party_id) continue;
    keys.set(pt.id, `ctx:${pt.context_id ?? pt.id}`);
    keys.set(pc.id, `ctx:${pt.context_id ?? pt.id}`);
  }
  for (const p of loose) if (!keys.has(p.id)) keys.set(p.id, `ctx:${p.context_id ?? p.id}`);
  return keys;
}

export interface ContextMember<P extends ContextProposal = ContextProposal, R extends ContextRevision = ContextRevision> {
  proposal: P;
  revisions: R[];
  governing: R | null;
  latest: R | null;
}

export interface ProposalContext<P extends ContextProposal = ContextProposal, R extends ContextRevision = ContextRevision> {
  key: string;
  /** A proposta que abre o dossiê do contexto: PC quando existe (rege valor). */
  primaryId: string;
  memberIds: string[];
  technical: ContextMember<P, R> | null;
  commercial: ContextMember<P, R> | null;
  combined: ContextMember<P, R> | null;
  members: ContextMember<P, R>[];
  title: string;
  counterparty: string;
  opportunityId: string | null;
  partyId: string | null;
  currency: string;
  /** Valor: da PC (ou combinada). A PT não carrega valor. */
  value: number | null;
  validityUntil: string | null;
  stage: ContextStage;
  internalApproval: InternalApprovalState;
  customerState: CustomerState;
  /** O PACOTE está aceito: a revisão regente de TODO documento está aceita. */
  accepted: boolean;
  /** Algum documento aceito, outro não — nunca conta como aceito. */
  partiallyAccepted: boolean;
  missingPdf: number;
  createdAt: string | null;
}

const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));

export function buildContext<P extends ContextProposal, R extends ContextRevision>(
  key: string, proposals: P[], revisions: R[],
): ProposalContext<P, R> {
  const KIND_ORDER: Record<ProposalKind, number> = { TECHNICAL: 0, COMMERCIAL: 1, COMBINED: 2 };
  // PT antes de PC, sempre — a ordem em que o negócio lê o pacote.
  const members: ContextMember<P, R>[] = [...proposals].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]).map((proposal) => {
    const own = revisions.filter((r) => r.proposal_id === proposal.id);
    return { proposal, revisions: own.sort((a, b) => b.revision - a.revision), governing: governingOf(own), latest: latestOf(own) };
  });
  const by = (k: ProposalKind) => members.find((m) => m.proposal.kind === k) ?? null;
  const technical = by('TECHNICAL');
  const commercial = by('COMMERCIAL');
  const combined = by('COMBINED');
  const valueMember = commercial ?? combined ?? technical;
  const primary = commercial ?? combined ?? technical ?? members[0];

  const stages = members.map((m) => (m.governing ? revisionStage(m.governing.status) : 'DRAFT' as ContextStage));
  const latestStages = members.map((m) => (m.latest ? revisionStage(m.latest.status) : 'DRAFT' as ContextStage));
  /*
    Aceite é do PACOTE: todo documento com a regente aceita. Um documento
    aceito ao lado de outro que não foi (ou que ganhou revisão nova, ou que
    entrou depois) NÃO faz o pacote aceito — nada herda aceite.
  */
  const accepted = members.length > 0 && !stages.some((s) => s !== 'ACCEPTED');
  const partiallyAccepted = !accepted && stages.includes('ACCEPTED');
  const active = stages.filter((s) => s !== 'REJECTED' && s !== 'CLOSED');

  let stage: ContextStage;
  if (accepted) stage = 'ACCEPTED';
  else if (!active.length) stage = stages.includes('REJECTED') ? 'REJECTED' : 'CLOSED';
  // O pacote só está "com o cliente" quando o pacote inteiro foi.
  else stage = active.reduce((min, s) => (rank(s) < rank(min) ? s : min), active[0]);

  const activeLatest = latestStages.filter((s) => s !== 'REJECTED' && s !== 'CLOSED');
  const anyWithCustomer = stages.some((s) => s === 'WITH_CUSTOMER' || s === 'NEGOTIATION' || s === 'ACCEPTED');
  let internalApproval: InternalApprovalState;
  // Aceita rege: um rascunho por cima dela não reabre a aprovação do pacote.
  if (accepted) internalApproval = 'APPROVED';
  else if (!activeLatest.length) internalApproval = 'NOT_APPLICABLE';
  else if (activeLatest.some((s) => s === 'DRAFT' || s === 'INTERNAL_APPROVAL') && anyWithCustomer) internalApproval = 'REAPPROVAL';
  else if (activeLatest.some((s) => s === 'DRAFT')) internalApproval = 'NOT_REQUESTED';
  else if (activeLatest.some((s) => s === 'INTERNAL_APPROVAL')) internalApproval = 'PENDING';
  else internalApproval = 'APPROVED';

  const customerState: CustomerState = accepted ? 'ACCEPTED'
    : partiallyAccepted ? 'PARTIALLY_ACCEPTED'
    : stages.includes('NEGOTIATION') ? 'NEGOTIATION'
    : stages.includes('WITH_CUSTOMER') ? 'WITH_CUSTOMER'
    : !active.length ? (stages.includes('REJECTED') ? 'REJECTED' : 'CLOSED')
    : 'NOT_SENT';

  const vg = valueMember?.governing ?? null;
  const validities = [commercial ?? combined, technical]
    .map((m) => m?.governing?.validity_until).filter((v): v is string => Boolean(v));

  return {
    key,
    primaryId: primary.proposal.id,
    memberIds: members.map((m) => m.proposal.id),
    technical, commercial, combined, members,
    title: (primary.proposal.title || members[0].proposal.title),
    counterparty: primary.proposal.counterparty_name,
    opportunityId: members.map((m) => m.proposal.opportunity_id).find(Boolean) ?? null,
    partyId: members.map((m) => m.proposal.party_id).find(Boolean) ?? null,
    currency: vg?.currency ?? primary.proposal.currency ?? 'BRL',
    value: (commercial ?? combined) ? num(vg?.total_value) : null,
    // PC governa validade; a PT só completa quando a PC não declara.
    validityUntil: validities[0] ?? null,
    stage, internalApproval, customerState, accepted, partiallyAccepted,
    missingPdf: members.filter((m) => m.governing && !m.governing.document_id).length,
    createdAt: members.map((m) => m.proposal.created_at ?? null).filter(Boolean).sort()[0] ?? null,
  };
}

export function groupProposalContexts<P extends ContextProposal, R extends ContextRevision>(
  proposals: P[], revisions: R[],
): ProposalContext<P, R>[] {
  const keys = contextKeys(proposals);
  const groups = new Map<string, P[]>();
  for (const p of proposals) {
    const k = keys.get(p.id)!;
    const g = groups.get(k);
    if (g) g.push(p); else groups.set(k, [p]);
  }
  return [...groups.entries()]
    .map(([k, members]) => buildContext(k, members, revisions))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Os contadores do funil, SEM dupla contagem de PT e PC. */
export function contextMetrics(contexts: ProposalContext[]) {
  const count = (...stages: ContextStage[]) => contexts.filter((c) => stages.includes(c.stage)).length;
  return {
    total: contexts.length,
    preparing: count('DRAFT', 'INTERNAL_APPROVAL', 'APPROVED_FOR_SEND'),
    internalApproval: count('INTERNAL_APPROVAL'),
    withCustomer: count('WITH_CUSTOMER', 'NEGOTIATION'),
    accepted: count('ACCEPTED'),
    rejected: count('REJECTED'),
    missingPdf: contexts.filter((c) => c.missingPdf > 0).length,
    count,
  };
}

/** Rótulo curto de um pacote: "PT-2899 R01 · PC-2899 R02". */
export function contextDocumentsLabel(ctx: ProposalContext): string {
  return ctx.members
    .map((m) => `${m.proposal.proposal_number} ${revisionLabel(m.governing?.revision)}`)
    .join(' · ');
}

/** O próximo passo do pacote — o que uma pessoa faz agora. */
export function contextNextAction(ctx: ProposalContext): string {
  if (ctx.missingPdf) return 'Anexar o PDF da revisão regente';
  switch (ctx.internalApproval) {
    case 'REAPPROVAL': return 'Aprovar internamente a parte pendente do pacote';
    case 'NOT_REQUESTED': return 'Enviar para aprovação interna';
    case 'PENDING': return 'Decidir a aprovação interna';
    default: break;
  }
  switch (ctx.stage) {
    case 'APPROVED_FOR_SEND': return 'Enviar ao cliente';
    case 'WITH_CUSTOMER':
    case 'NEGOTIATION': return 'Registrar a resposta do cliente';
    case 'ACCEPTED': return ctx.opportunityId ? 'Fechar negócio e iniciar execução' : 'Vincular ou criar a oportunidade';
    case 'REJECTED':
    case 'CLOSED': return 'Criar nova revisão ou encerrar';
    default: return 'Revisar o pacote';
  }
}

/* ------------------------------------------------------------------------ */
/* Aceite do PACOTE — o livro da 217                                         */
/* ------------------------------------------------------------------------ */

export interface AcceptanceRecord {
  id: string;
  technical_revision_id: string | null;
  technical_status: string | null;
  commercial_revision_id: string | null;
  commercial_status: string | null;
  combined_revision_id: string | null;
  combined_status: string | null;
  complete: boolean;
  acceptance_source: string | null;
  acceptance_document_id?: string | null;
  acceptance_external_ref: string | null;
  acceptance_note?: string | null;
  recorded_by: string | null;
  accepted_at: string;
  origin: string;
}

export type PackageAcceptanceState = 'ACCEPTED' | 'PARTIAL' | 'CHANGED' | 'NONE';

export interface PackageAcceptance {
  state: PackageAcceptanceState;
  /** A linha do livro que responde "qual pacote foi aceito" (a mais recente). */
  record: AcceptanceRecord | null;
  /** O pacote aceito, documento a documento: "PT R01", "PC R02". */
  accepted: Array<{ kind: ProposalKind; revisionId: string; revision: number | null; status: string | null }>;
  /** Por que o pacote atual não é o aceito. Vazio quando coincide. */
  differences: string[];
}

const ROLE_SHORT: Record<ProposalKind, string> = { TECHNICAL: 'PT', COMMERCIAL: 'PC', COMBINED: 'PT+PC' };

/**
 * "Qual pacote exato PT + PC o cliente aceitou?" — determinístico.
 *
 * Com o livro (217): a linha mais recente do contexto. O pacote ATUAL só é
 * aceito se ela é completa E cada documento ainda é regido exatamente pela
 * revisão registrada nela (e nenhum documento entrou depois). Qualquer
 * diferença é dita — e o pacote volta a precisar de evidência do cliente.
 * Sem o livro (banco sem a 217): a regra derivada do contexto.
 */
export function packageAcceptance<P extends ContextProposal, R extends ContextRevision>(
  ctx: ProposalContext<P, R>, ledger: AcceptanceRecord[] | null | undefined,
): PackageAcceptance {
  const derived: PackageAcceptanceState = ctx.accepted ? 'ACCEPTED' : ctx.partiallyAccepted ? 'PARTIAL' : 'NONE';
  const record = ledger?.length
    ? [...ledger].sort((a, b) => (b.accepted_at ?? '').localeCompare(a.accepted_at ?? ''))[0] : null;
  if (!record) return { state: derived, record: null, accepted: [], differences: [] };

  const numberOf = (id: string) => {
    for (const m of ctx.members) {
      const r = m.revisions.find((x) => x.id === id);
      if (r) return r.revision;
    }
    return null;
  };
  const snap: PackageAcceptance['accepted'] = [];
  const slots: Array<[ProposalKind, string | null, string | null]> = [
    ['TECHNICAL', record.technical_revision_id, record.technical_status],
    ['COMMERCIAL', record.commercial_revision_id, record.commercial_status],
    ['COMBINED', record.combined_revision_id, record.combined_status],
  ];
  for (const [kind, id, status] of slots) if (id) snap.push({ kind, revisionId: id, revision: numberOf(id), status });

  const differences: string[] = [];
  for (const m of ctx.members) {
    const role = ROLE_SHORT[m.proposal.kind];
    const inSnap = snap.find((x) => x.kind === m.proposal.kind);
    if (!inSnap) { differences.push(`${role} entrou no pacote depois do aceite`); continue; }
    if (m.governing && m.governing.id !== inSnap.revisionId) {
      differences.push(`${role} hoje é regida pela ${revisionLabel(m.governing.revision)}; o aceite foi da ${revisionLabel(inSnap.revision)}`);
    }
  }
  for (const x of snap) {
    if (x.status !== 'ACCEPTED' && !differences.some((d) => d.startsWith(ROLE_SHORT[x.kind]))) {
      differences.push(`${ROLE_SHORT[x.kind]} ${revisionLabel(x.revision)} não foi aceita pelo cliente`);
    }
  }
  const state: PackageAcceptanceState = !record.complete ? 'PARTIAL'
    : differences.length ? 'CHANGED'
    : ctx.accepted ? 'ACCEPTED' : 'CHANGED';
  return { state, record, accepted: snap, differences };
}
