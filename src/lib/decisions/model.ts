/**
 * DECISÕES — regras de leitura em código puro.
 *
 * O banco decide quem pode decidir o quê (240). Aqui se NORMALIZA, se
 * ORDENA e se EXPLICA — sempre a partir de fatos que vieram do banco:
 * nenhum escore de risco inventado, nenhum impacto sem evidência.
 */
import type {
  DecisionAction, DecisionAssignment, DecisionAuthority, DecisionInboxRow, DecisionItem, DecisionOpenState,
  DecisionOutcome, DecisionSourceKind, DecisionStatus, DecisionTone, Fact, ImpactFact, PersonRef, PriorityReason,
  QuoteOption,
} from './types';

// ---------------------------------------------------------------------------
// Chave
// ---------------------------------------------------------------------------

export type ParsedDecisionKey =
  | { kind: 'purchase_order'; subjectId: string; submission: number }
  | { kind: 'approval_request'; requestId: string; stageNo: number };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PO_KEY = new RegExp(`^purchase_order:(${UUID}):s([1-9][0-9]{0,5})$`);
const ENGINE_KEY = new RegExp(`^approval_request:(${UUID}):e([1-9][0-9]{0,3})$`);

/** A mesma gramática do CHECK de `decision_deliveries.decision_key`. Qualquer outra coisa não é chave. */
export function parseDecisionKey(key: string | null | undefined): ParsedDecisionKey | null {
  if (!key || key.length > 120) return null;
  const po = PO_KEY.exec(key);
  if (po) return { kind: 'purchase_order', subjectId: po[1], submission: Number(po[2]) };
  const en = ENGINE_KEY.exec(key);
  if (en) return { kind: 'approval_request', requestId: en[1], stageNo: Number(en[2]) };
  return null;
}

/** Link RELATIVO para a decisão dentro do Apex (notificação, e-mail, WhatsApp). */
export function decisionHref(key: string): string {
  return `/decisoes?d=${encodeURIComponent(key)}`;
}

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

export const ACTION_LABEL: Record<DecisionAction, string> = {
  APPROVE: 'Aprovar', REJECT: 'Rejeitar', REQUEST_ADJUSTMENT: 'Solicitar ajuste',
};

/** O que o ato FAZ no domínio de origem — dito antes da confirmação. */
export function actionConsequence(action: DecisionAction, subjectType: string): string {
  if (subjectType === 'purchase_order') {
    if (action === 'APPROVE') return 'O pedido de compra fica aprovado e Compras pode emiti-lo ao fornecedor.';
    if (action === 'REQUEST_ADJUSTMENT') return 'O pedido volta ao rascunho de Compras com a sua justificativa, para ajuste e nova submissão.';
    return 'A aprovação é rejeitada. O pedido volta ao rascunho de Compras; só Compras pode cancelá-lo.';
  }
  if (subjectType === 'contract_billing_event') {
    if (action === 'APPROVE') return 'O faturamento fica liberado para emissão do documento fiscal.';
    return 'A liberação é rejeitada e o evento de faturamento não segue para emissão.';
  }
  return action === 'APPROVE' ? 'A aprovação é registrada no motor de aprovação.' : 'O desfecho é registrado no motor de aprovação.';
}

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  PENDENTE: 'Aguardando sua decisão', EM_ANALISE: 'Em análise', ESCALADA: 'Escalada', SEM_DECISOR: 'Sem decisor elegível',
  AJUSTE_SOLICITADO: 'Ajuste solicitado', APROVADA: 'Aprovada', REJEITADA: 'Rejeitada', CANCELADA: 'Cancelada', EXPIRADA: 'Expirada',
};

export const STATUS_TONE: Record<DecisionStatus, DecisionTone> = {
  PENDENTE: 'warning', EM_ANALISE: 'info', ESCALADA: 'danger', SEM_DECISOR: 'danger',
  AJUSTE_SOLICITADO: 'accent', APROVADA: 'success', REJEITADA: 'danger', CANCELADA: 'neutral', EXPIRADA: 'neutral',
};

export const OUTCOME_STATUS: Record<DecisionOutcome, DecisionStatus> = {
  APPROVED: 'APROVADA', REJECTED: 'REJEITADA', ADJUSTMENT_REQUESTED: 'AJUSTE_SOLICITADO', CANCELLED: 'CANCELADA', EXPIRED: 'EXPIRADA',
};

export const ASSIGNMENT_LABEL: Record<DecisionAssignment, string> = {
  PRIMARY: 'Sua decisão', ESCALATED: 'Escalada para você', ELIGIBLE: 'Sob sua alçada',
};

/** Filtros da caixa. A fonte nova traz a própria categoria; aqui só o rótulo. */
export const CATEGORY_LABEL: Record<string, string> = {
  compras: 'Compras', financeiro: 'Financeiro', comercial: 'Comercial', contratos: 'Contratos', operacoes: 'Operações',
  pessoas: 'Pessoas', projetos: 'Projetos', excecoes: 'Exceções', outros: 'Outros',
};
export const categoryLabel = (id: string) => CATEGORY_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

/** O nome curto do tipo de decisão — a primeira palavra do cartão. */
export function kindLabel(subjectType: string): string {
  switch (subjectType) {
    case 'purchase_order': return 'Compra';
    case 'contract_billing_event': return 'Liberação de faturamento';
    default: return 'Aprovação';
  }
}

export const AUTHORITY_SOURCE_LABEL: Record<string, string> = {
  BOARD_RESOLUTION: 'Ata de diretoria/conselho', POWER_OF_ATTORNEY: 'Procuração', DELEGATION_LETTER: 'Carta de delegação',
  CONTRACT_CLAUSE: 'Cláusula contratual', INTERNAL_POLICY_DOCUMENT: 'Política interna', BYLAWS: 'Estatuto/contrato social',
};

export const ROLE_LABEL: Record<string, string> = {
  owner_admin: 'Titular', ceo_diretoria: 'CEO / Diretoria', financeiro: 'Financeiro', engenharia_pcp: 'Engenharia / PCP',
  gestor_projetos: 'Gestor de projetos', juridico_contratos: 'Jurídico / Contratos', rh: 'RH', compras: 'Compras',
  almoxarifado: 'Almoxarifado',
};
export const roleLabel = (key: string | null | undefined) => (key ? ROLE_LABEL[key] ?? key : null);

export function statusOf(state: DecisionOpenState | null, outcome: DecisionOutcome | null): DecisionStatus {
  if (outcome) return OUTCOME_STATUS[outcome];
  return state ?? 'PENDENTE';
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export function authorityFromRow(raw: Record<string, unknown>, names: {
  person?: (id: string | null) => PersonRef | null; role?: (id: string | null) => string | null;
} = {}): DecisionAuthority {
  if (raw.kind === 'APPROVAL_POLICY') {
    return {
      kind: 'APPROVAL_POLICY',
      policyKey: String(raw.policy_key ?? ''),
      policyVersionNo: Number(raw.policy_version_no ?? 0),
      stageNo: Number(raw.stage_no ?? 1),
      stageName: String(raw.stage_name ?? ''),
      stageCount: Number(raw.stage_count ?? 1),
      quorumRequired: num(raw.quorum_required),
      stepKey: String(raw.step_key ?? ''),
      stepName: String(raw.step_name ?? ''),
      eligibilityMode: (raw.eligibility_mode as 'PERMISSION' | 'ROLE' | 'NAMED') ?? 'PERMISSION',
      roleKey: str(raw.role_key),
      roleLabel: roleLabel(str(raw.role_key)),
      permissionKey: str(raw.permission_key),
      authoritySource: str(raw.authority_source),
      authorityBasis: str(raw.authority_basis),
      authorityLimit: num(raw.authority_limit),
      authorityCurrency: str(raw.authority_currency),
    };
  }
  const granteeKind = (raw.grantee_kind === 'USER' ? 'USER' : 'ROLE') as 'ROLE' | 'USER';
  const grantee = granteeKind === 'USER'
    ? names.person?.(str(raw.grantee_user_id))?.name ?? null
    : names.role?.(str(raw.grantee_role_id)) ?? null;
  const sourceKind = String(raw.source_kind ?? '');
  return {
    kind: 'PROCUREMENT_AUTHORITY',
    authorityId: String(raw.authority_id ?? ''),
    ceiling: num(raw.ceiling),
    currency: String(raw.currency ?? 'BRL'),
    tier: raw.tier === 'ELIGIBLE' ? 'ELIGIBLE' : 'PRIMARY',
    granteeKind,
    granteeLabel: grantee,
    scopeProjectId: str(raw.scope_project_id),
    scopeCategory: str(raw.scope_category),
    sourceKind,
    sourceKindLabel: AUTHORITY_SOURCE_LABEL[sourceKind] ?? sourceKind,
    sourceReference: String(raw.source_reference ?? ''),
    sourceDocumentId: str(raw.source_document_id),
    justification: str(raw.justification),
    effectiveFrom: str(raw.effective_from),
    effectiveUntil: str(raw.effective_until),
    declaredBy: names.person?.(str(raw.declared_by)) ?? null,
    leadDays: num(raw.lead_days),
  };
}

/** Link de origem — o registro no módulo dono da verdade. */
export function sourceLink(subjectType: string, subjectId: string, open: boolean): { href: string; label: string } {
  if (subjectType === 'purchase_order') {
    return { href: `/supply/compras?stage=${open ? 'aprovacao' : 'pedidos'}&po=${encodeURIComponent(subjectId)}`, label: 'Ver em Compras' };
  }
  if (subjectType === 'contract_billing_event') {
    return { href: `/contratos?aba=faturamento&evento=${encodeURIComponent(subjectId)}`, label: 'Ver em Contratos' };
  }
  return { href: '/decisoes', label: 'Ver origem' };
}

export interface EnrichInput {
  row: DecisionInboxRow;
  today: string;
  person: (id: string | null) => PersonRef | null;
  role?: (id: string | null) => string | null;
  projectName?: (id: string | null) => string | null;
  context?: DecisionItem['context'];
  critical?: { reason: string } | null;
}

export function toDecisionItem({ row, today, person, role, projectName, context = [], critical = null }: EnrichInput): DecisionItem {
  const authority = authorityFromRow(row.authority ?? {}, { person, role });
  const link = sourceLink(row.subject_type, row.subject_id, true);
  const item: DecisionItem = {
    key: row.decision_key,
    source: row.source_kind,
    category: row.category,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    actionType: row.action_type,
    requestId: row.request_id,
    stepId: row.step_id,
    stageNo: row.stage_no,
    submission: row.submission,
    kindLabel: kindLabel(row.subject_type),
    title: row.title,
    amount: num(row.amount),
    currency: row.currency,
    projectId: row.project_id,
    projectName: projectName?.(row.project_id) ?? null,
    requestedBy: person(row.requested_by),
    requestedAt: row.requested_at,
    dueAt: row.due_at,
    needBy: row.need_by ? String(row.need_by).slice(0, 10) : null,
    decideBy: row.decide_by ? String(row.decide_by).slice(0, 10) : null,
    overdue: Boolean(row.overdue),
    critical: Boolean(critical),
    criticalReason: critical?.reason ?? null,
    assignment: row.assignment,
    state: row.state,
    status: statusOf(row.state, null),
    actions: [...(row.actions ?? [])],
    reasonRequired: [...(row.reason_required ?? [])],
    fingerprint: row.fingerprint,
    authority,
    context,
    priority: { code: 'NORMAL', label: 'Pendente', tone: 'neutral' },
    sourceHref: link.href,
    sourceLabel: link.label,
  };
  item.priority = priorityReason(item, today);
  return item;
}

// ---------------------------------------------------------------------------
// Ordem da fila
// ---------------------------------------------------------------------------

const daysUntil = (today: string, iso: string | null) =>
  iso ? Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : null;

/** O prazo que manda: o do motor (expiração) ou o operacional (decidir até). */
export function effectiveDeadline(item: Pick<DecisionItem, 'dueAt' | 'decideBy'>): string | null {
  const a = item.dueAt ? item.dueAt.slice(0, 10) : null;
  const b = item.decideBy;
  if (a && b) return a < b ? a : b;
  return a ?? b ?? null;
}

/** Limiar de materialidade: o que decide a posição entre itens sem prazo. Não é alçada; é ordenação. */
export const MATERIALITY_THRESHOLD = 100_000;

export function priorityReason(item: Pick<DecisionItem, 'overdue' | 'critical' | 'criticalReason' | 'dueAt' | 'decideBy' | 'amount'>, today: string): PriorityReason {
  if (item.overdue) return { code: 'OVERDUE', label: 'Vencida', tone: 'danger' };
  if (item.critical) return { code: 'CRITICAL', label: item.criticalReason ?? 'Impacto crítico', tone: 'danger' };
  const d = daysUntil(today, effectiveDeadline(item));
  if (d !== null && d <= 7) {
    return { code: 'DEADLINE', label: d <= 0 ? 'Decidir hoje' : d === 1 ? 'Decidir até amanhã' : `Decidir em ${d} dias`, tone: 'warning' };
  }
  if (item.amount !== null && item.amount >= MATERIALITY_THRESHOLD) return { code: 'MATERIAL', label: 'Alto valor', tone: 'info' };
  return { code: 'NORMAL', label: d !== null ? `Decidir em ${d} dias` : 'Pendente', tone: 'neutral' };
}

const RANK: Record<PriorityReason['code'], number> = { OVERDUE: 0, CRITICAL: 1, DEADLINE: 2, MATERIAL: 3, NORMAL: 4 };

/**
 * 1. vencidas; 2. impacto operacional crítico (com evidência); 3. prazo mais
 * próximo; 4. materialidade financeira; 5. pendentes normais, mais antigas
 * primeiro. Nenhum escore opaco: a razão da posição é mostrada.
 */
export function prioritize<T extends Pick<DecisionItem, 'priority' | 'dueAt' | 'decideBy' | 'amount' | 'requestedAt' | 'key'>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const r = RANK[a.priority.code] - RANK[b.priority.code];
    if (r) return r;
    const da = effectiveDeadline(a); const db = effectiveDeadline(b);
    if (da !== db) { if (!da) return 1; if (!db) return -1; return da < db ? -1 : 1; }
    const ma = a.amount ?? -1; const mb = b.amount ?? -1;
    if (ma !== mb) return mb - ma;
    const ra = a.requestedAt ?? ''; const rb = b.requestedAt ?? '';
    if (ra !== rb) return ra < rb ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });
}

// ---------------------------------------------------------------------------
// "Por que chegou até mim?"
// ---------------------------------------------------------------------------

export function whyFacts(item: Pick<DecisionItem, 'authority' | 'assignment' | 'amount' | 'currency' | 'overdue' | 'decideBy'>,
  fmt: { money: (v: number | null, c?: string | null) => string; date: (v: string | null) => string },
  insufficient: Array<{ label: string; ceiling: number | null; currency: string }> = []): Fact[] {
  const a = item.authority;
  const out: Fact[] = [];
  if (a.kind === 'PROCUREMENT_AUTHORITY') {
    const lower = insufficient.filter((x) => x.ceiling !== null && item.amount !== null && x.ceiling < item.amount);
    out.push({
      label: 'Motivo',
      value: lower.length
        ? `Valor acima da alçada de ${lower.map((x) => `${x.label} (até ${fmt.money(x.ceiling, x.currency)})`).join(', ')}.`
        : 'A compra exige aprovação por alçada declarada, e o valor está dentro da sua.',
    });
    out.push({ label: 'Sua autoridade', value: a.granteeLabel ? `${a.granteeKind === 'ROLE' ? 'Papel' : 'Pessoa'}: ${a.granteeLabel}` : 'Alçada declarada' });
    out.push({ label: 'Limite', value: a.ceiling === null ? 'Sem teto declarado' : `Até ${fmt.money(a.ceiling, a.currency)}` });
    out.push({ label: 'Origem', value: `${a.sourceKindLabel} — ${a.sourceReference}`, source: 'procurement_approval_authorities' });
    if (a.scopeCategory || a.scopeProjectId) {
      out.push({ label: 'Escopo', value: [a.scopeCategory && `categoria ${a.scopeCategory}`, a.scopeProjectId && `projeto ${a.scopeProjectId}`].filter(Boolean).join(' · ') });
    }
    if (item.assignment === 'ESCALATED') {
      out.push({ label: 'Escalonamento', value: `Venceu na faixa de alçada primária${item.decideBy ? ` (decidir até ${fmt.date(item.decideBy)})` : ''} e chegou à sua faixa.` });
    } else if (item.assignment === 'ELIGIBLE') {
      out.push({ label: 'Faixa', value: 'A decisão é de uma faixa de alçada menor; você também pode decidir.' });
    }
  } else {
    out.push({ label: 'Motivo', value: `A política ${a.policyKey} v${a.policyVersionNo} exige aprovação no estágio “${a.stageName}”${a.stageCount > 1 ? ` (${a.stageNo} de ${a.stageCount})` : ''}.` });
    const who = a.eligibilityMode === 'ROLE' ? `Papel: ${a.roleLabel ?? a.roleKey}`
      : a.eligibilityMode === 'NAMED' ? 'Aprovador nomeado na política' : `Permissão: ${a.permissionKey}`;
    out.push({ label: 'Sua autoridade', value: `${who} — etapa “${a.stepName}”` });
    out.push({ label: 'Limite', value: a.authorityLimit === null ? 'Sem teto na etapa' : `Até ${fmt.money(a.authorityLimit, a.authorityCurrency)}` });
    out.push({ label: 'Origem', value: `Motor de aprovação — política ${a.policyKey}, versão ${a.policyVersionNo}`, source: 'approval_request_steps' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inteligência com evidência (compras)
// ---------------------------------------------------------------------------

/**
 * Fatos sobre a escolha de fornecedor — SÓ a partir das propostas avaliadas
 * (a mesma `evaluateQuotes` de Compras). Sem proposta alternativa ou sem
 * necessidade, não há frase: nada é estimado.
 */
export function procurementImpact(options: QuoteOption[], needBy: string | null,
  fmt: { money: (v: number | null, c?: string | null) => string; date: (v: string | null) => string }): ImpactFact[] {
  const chosen = options.find((o) => o.chosen);
  if (!chosen) return [];
  const out: ImpactFact[] = [];
  const alternatives = options.filter((o) => !o.chosen);
  const cheapest = [...options].sort((a, b) => a.landed - b.landed)[0];
  if (cheapest && !cheapest.chosen && cheapest.currency === chosen.currency) {
    const delta = chosen.landed - cheapest.landed;
    const evidence: Fact[] = [
      { label: `${chosen.supplier} (escolhido)`, value: `${fmt.money(chosen.landed, chosen.currency)} · ${chosen.leadDays ?? '—'} dias · chegada ${fmt.date(chosen.eta)}` },
      { label: `${cheapest.supplier} (menor custo)`, value: `${fmt.money(cheapest.landed, cheapest.currency)} · ${cheapest.leadDays ?? '—'} dias · chegada ${fmt.date(cheapest.eta)}` },
    ];
    if (needBy) evidence.push({ label: 'Necessário até', value: fmt.date(needBy), source: 'project_requirements' });
    if (cheapest.lateDays !== null && cheapest.lateDays > 0 && chosen.lateDays === 0) {
      out.push({ tone: 'info', evidence,
        statement: `Esta opção custa ${fmt.money(delta, chosen.currency)} a mais, mas atende o cronograma. O fornecedor mais barato entregaria ${cheapest.lateDays} ${cheapest.lateDays === 1 ? 'dia' : 'dias'} após a necessidade.` });
    } else if (delta > 0) {
      out.push({ tone: 'warning', evidence,
        statement: `Esta opção custa ${fmt.money(delta, chosen.currency)} a mais que a de menor custo, que também ${cheapest.lateDays === 0 ? 'atende o cronograma' : 'foi avaliada'}.` });
    }
  }
  if (chosen.lateDays !== null && chosen.lateDays > 0 && needBy) {
    out.push({ tone: 'danger', statement: `Mesmo aprovado hoje, o fornecedor escolhido chega ${chosen.lateDays} ${chosen.lateDays === 1 ? 'dia' : 'dias'} após a necessidade.`,
      evidence: [{ label: 'Chegada estimada', value: fmt.date(chosen.eta), source: 'supplier_quotes.lead_time_days' },
        { label: 'Necessário até', value: fmt.date(needBy), source: 'project_requirements' }] });
  }
  if (!alternatives.length && options.length === 1) {
    out.push({ tone: 'neutral', statement: 'A decisão de compra teve uma única proposta; não há comparação de fornecedores.', evidence: [] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Erros do motor → resposta de tela velha
// ---------------------------------------------------------------------------

/**
 * As recusas de estado do motor vêm como texto em 23514 (127). Estas querem
 * dizer "a decisão já não é a da sua tela" — a resposta é 409 + recarregar,
 * nunca "erro".
 */
export function isStaleEngineMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /Pedido já está em|já está em .* e não decide|expirad|expirou em|SUBJECT_CHANGED|Ordem de aprovação|Etapa inexistente|objeto do pedido não existe/i.test(message);
}

export function staleMessage(resolved: { status: DecisionStatus; closedBy: PersonRef | null } | null): string {
  if (!resolved) return 'Esta decisão mudou desde que a tela foi aberta. Atualizamos o que está valendo agora.';
  const who = resolved.closedBy?.name ? ` por ${resolved.closedBy.name}` : '';
  switch (resolved.status) {
    case 'APROVADA': return `Esta decisão já foi aprovada${who}. Nada foi alterado.`;
    case 'REJEITADA': return `Esta decisão já foi rejeitada${who}. Nada foi alterado.`;
    case 'AJUSTE_SOLICITADO': return `Um ajuste já foi solicitado${who}. Nada foi alterado.`;
    case 'CANCELADA': return 'A decisão foi cancelada na origem. Nada foi alterado.';
    case 'EXPIRADA': return 'O prazo desta decisão expirou. Nada foi alterado.';
    default: return 'O conteúdo em decisão mudou desde que a tela foi aberta (nova submissão ou valor diferente). Revise a versão atual.';
  }
}

/** Normaliza a justificativa como o motor grava (trim; vazio → nulo) — a retentativa precisa bater. */
export function normalizeReason(reason: string | null | undefined): string | null {
  const t = (reason ?? '').trim();
  return t ? t : null;
}

/** Chave de idempotência do motor: ator + etapa + ato + intenção. Nunca a mesma entre pessoas. */
export function engineIdempotencyKey(stepId: string, actorId: string, action: DecisionAction, intentId: string): string {
  return `dec:${stepId}:${actorId}:${action}:${intentId}`.slice(0, 200);
}

export const ENGINE_DECISION: Record<DecisionAction, 'APPROVED' | 'REJECTED' | 'RETURNED_FOR_CORRECTION'> = {
  APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_ADJUSTMENT: 'RETURNED_FOR_CORRECTION',
};
export const AUTHORITY_DECISION: Partial<Record<DecisionAction, 'APPROVE' | 'REJECT'>> = {
  APPROVE: 'APPROVE', REQUEST_ADJUSTMENT: 'REJECT',
};

export function isSource(v: unknown): v is DecisionSourceKind {
  return v === 'APPROVAL_ENGINE' || v === 'PROCUREMENT_AUTHORITY';
}
