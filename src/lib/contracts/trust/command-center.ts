/**
 * Inteligência de carteira do Command Center.
 *
 * Agrega os sinais de contrato individual em uma leitura de portfólio, e mapeia
 * o estado de cada módulo do Insight ao qual o contrato se conecta.
 *
 * ─── Duas regras que este arquivo sustenta ─────────────────────────────────
 *
 * 1. Só contrato de origem validada compõe métrica de carteira. A fronteira já
 *    existe em `portfolio.ts`; aqui ela se repete para as listas.
 *
 * 2. Nenhuma conexão é decorativa. Cada módulo ligado responde três coisas:
 *    qual é o estado atual, se aquele estado é apurado, e para onde ir. Um
 *    "Financeiro ✓" que não diz nada e não leva a lugar nenhum é pior que a
 *    ausência do card — ocupa a atenção e devolve zero.
 *
 * Sem React, sem I/O.
 */

import { hasOfficialValue, isError, isOfficialOrigin, type Official } from './trusted';
import type { TrustedContract } from './read-model';
import { attentionItems, type AttentionItem } from './attention';
import { obligationBreakdown, missingDocuments, renewalState } from './signals';

// ═══════════════════════════════════════════════════════════════════════════
// Atenção no nível da carteira
// ═══════════════════════════════════════════════════════════════════════════

export type PortfolioAttentionItem = AttentionItem & {
  readonly contractId: string;
  readonly contractCode: string;
  readonly counterparty: string;
};

/**
 * Itens de atenção de toda a carteira oficial, do mais grave ao menos.
 *
 * Contratos de demonstração não geram sinal: um alerta operacional sobre um
 * fixture faria alguém agir sobre algo que não existe.
 */
export function portfolioAttention(
  contracts: readonly TrustedContract[],
  now: Date = new Date(),
): PortfolioAttentionItem[] {
  const order = { critical: 0, warning: 1, setup: 2, info: 3 } as const;

  return contracts
    .filter((c) => isOfficialOrigin(c.dataClass))
    .flatMap((c) =>
      attentionItems(c, now).map((item) => ({
        ...item,
        contractId: c.id,
        contractCode: c.code,
        counterparty: hasOfficialValue(c.counterparty) ? c.counterparty.value : c.title,
      })),
    )
    .sort((a, b) => order[a.severity] - order[b.severity] || a.rank - b.rank);
}

// ═══════════════════════════════════════════════════════════════════════════
// Operações conectadas no nível da carteira
// ═══════════════════════════════════════════════════════════════════════════

export type ModuleKey =
  | 'projetos' | 'financeiro' | 'faturamento' | 'obrigacoes'
  | 'documentos' | 'riscos' | 'aprovacoes' | 'tarefas' | 'auditoria';

export type ModuleLinkState = 'healthy' | 'attention' | 'critical' | 'unmeasured' | 'not-integrated';

export type ModuleConnection = {
  readonly key: ModuleKey;
  readonly label: string;
  /** Métrica principal, já formatada. `null` quando não apurada. */
  readonly headline: string | null;
  /** Contexto secundário. */
  readonly detail: string | null;
  readonly state: ModuleLinkState;
  /** Destino de navegação, quando existe. */
  readonly href: string | null;
  /**
   * Por que não há dado, quando é o caso. Distingue "não integrado" (o módulo
   * não conversa com contratos ainda) de "não apurado" (conversa, mas não há
   * linha) — a primeira é decisão de arquitetura, a segunda é operação.
   */
  readonly note: string | null;
};

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const sumOf = (
  contracts: readonly TrustedContract[],
  pick: (c: TrustedContract) => Official<number>,
): { total: number; counted: number; errored: boolean } => {
  let total = 0;
  let counted = 0;
  let errored = false;
  for (const c of contracts) {
    const v = pick(c);
    if (isError(v)) { errored = true; continue; }
    if (hasOfficialValue(v)) { total += v.value; counted += 1; }
  }
  return { total, counted, errored };
};

export type PortfolioConnectionsInput = {
  readonly contracts: readonly TrustedContract[];
  /** Tarefas de agenda vinculadas a contratos (`tasks.related_contract_id`). */
  readonly linkedTaskCount: number | null;
  /** Eventos em `audit_logs` para os contratos da carteira. */
  readonly auditEventCount: number | null;
};

/**
 * Estado de cada módulo do Insight visto pela carteira de contratos.
 *
 * O que NÃO acontece aqui: nenhuma linha recalcula dado de outro módulo. Os
 * números saem das relações do próprio contrato, e o clique entrega o assunto a
 * quem o governa. Duplicar a verdade do Financeiro dentro de Contratos criaria
 * duas respostas para a mesma pergunta.
 */
export function portfolioConnections(input: PortfolioConnectionsInput): ModuleConnection[] {
  const contracts = input.contracts.filter((c) => isOfficialOrigin(c.dataClass));
  const n = contracts.length;

  // ── Projetos ────────────────────────────────────────────────────────────
  const linked = contracts.filter((c) => hasOfficialValue(c.project));
  const projectErrored = contracts.some((c) => isError(c.project));

  // ── Faturamento ─────────────────────────────────────────────────────────
  const billed = sumOf(contracts, (c) => c.billedValue);
  const backlog = sumOf(contracts, (c) => c.remainingValue);
  const withEvents = contracts.filter(
    (c) => hasOfficialValue(c.billingEvents) && c.billingEvents.value.length > 0,
  ).length;
  const billingErrored = contracts.some((c) => isError(c.billingEvents));

  // ── Obrigações ──────────────────────────────────────────────────────────
  let overdue = 0;
  let openObl = 0;
  let totalObl = 0;
  let obligationsMeasured = 0;
  let obligationsErrored = false;
  for (const c of contracts) {
    const b = obligationBreakdown(c);
    if (isError(b)) { obligationsErrored = true; continue; }
    if (hasOfficialValue(b)) {
      overdue += b.value.overdue;
      openObl += b.value.open + b.value.dueSoon;
      totalObl += b.value.total;
      obligationsMeasured += 1;
    }
  }

  // ── Documentos ──────────────────────────────────────────────────────────
  let pendingDocs = 0;
  let totalDocs = 0;
  let docsMeasured = 0;
  let docsErrored = false;
  for (const c of contracts) {
    const d = missingDocuments(c);
    if (isError(d)) { docsErrored = true; continue; }
    if (hasOfficialValue(d)) { pendingDocs += d.value.length; docsMeasured += 1; }
    if (hasOfficialValue(c.documents)) totalDocs += c.documents.value.length;
  }

  // ── Riscos ──────────────────────────────────────────────────────────────
  const riskLinks = contracts.reduce(
    (sum, c) => sum + (hasOfficialValue(c.riskLinks) ? c.riskLinks.value.length : 0), 0,
  );
  const risksErrored = contracts.some((c) => isError(c.riskLinks));

  // ── Aprovações ──────────────────────────────────────────────────────────
  let pendingSteps = 0;
  let totalSteps = 0;
  let approvalsErrored = false;
  for (const c of contracts) {
    if (isError(c.approvals)) { approvalsErrored = true; continue; }
    if (hasOfficialValue(c.approvals)) {
      pendingSteps += c.approvals.value.filter((a) => a.status !== 'approved').length;
      totalSteps += c.approvals.value.length;
    }
  }

  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

  return [
    {
      key: 'projetos',
      label: 'Projetos',
      headline: projectErrored ? null : `${linked.length} de ${n}`,
      detail: projectErrored ? null : linked.length === n && n > 0
        ? 'toda a carteira vinculada'
        : `${n - linked.length} sem vínculo operacional`,
      state: projectErrored ? 'critical' : n === 0 ? 'unmeasured' : linked.length === n ? 'healthy' : 'attention',
      href: '/projetos',
      note: projectErrored ? 'Falha ao ler os vínculos de projeto.' : null,
    },
    {
      key: 'financeiro',
      label: 'Financeiro',
      headline: null,
      detail: null,
      /**
       * Declarado como não integrado, e não como "sem dado".
       *
       * `ledger_entry.contract_id` e `apar_title.contract_id` existem no schema
       * mas sem FK, e o módulo Financeiro é alimentado por dado de referência.
       * Não há como afirmar compromissos ou recebimentos por contrato hoje —
       * e desenhar um card com R$ 0 sugeriria que a integração existe e que
       * nada foi pago.
       */
      state: 'not-integrated',
      href: '/financeiro',
      note: 'A conciliação entre eventos de faturamento e o razão financeiro ainda não existe. Compromissos e recebimentos por contrato não podem ser afirmados.',
    },
    {
      key: 'faturamento',
      label: 'Faturamento',
      headline: billingErrored ? null : billed.counted > 0 ? BRL.format(billed.total) : null,
      detail: billingErrored
        ? null
        : billed.counted > 0
          ? `${BRL.format(backlog.total)} em backlog · ${withEvents} ${plural(withEvents, 'contrato com evento', 'contratos com eventos')}`
          : `${n} ${plural(n, 'contrato sem evento registrado', 'contratos sem evento registrado')}`,
      state: billingErrored ? 'critical' : billed.counted === 0 ? 'unmeasured' : 'healthy',
      href: null,
      note: billingErrored
        ? 'Falha ao ler os eventos de faturamento.'
        : billed.counted === 0
          ? 'Sem evento de faturamento registrado, a exposição faturada não pode ser apurada.'
          : null,
    },
    {
      key: 'obrigacoes',
      label: 'Obrigações',
      /**
       * Zero obrigações MAPEADAS não é "zero atrasadas".
       *
       * Um contrato sem obrigação cadastrada não está em dia — ninguém
       * verificou. Exibir "0 · nenhuma atrasada" transformaria a ausência de
       * controle em atestado de conformidade.
       */
      headline: obligationsErrored || totalObl === 0 ? null : `${overdue + openObl}`,
      detail: obligationsErrored
        ? null
        : totalObl === 0
          ? `nenhuma obrigação mapeada em ${n} ${plural(n, 'contrato', 'contratos')}`
          : overdue > 0
            ? `${overdue} ${plural(overdue, 'atrasada', 'atrasadas')} · ${openObl} em aberto`
            : `${openObl} em aberto · nenhuma atrasada`,
      state: obligationsErrored ? 'critical' : overdue > 0 ? 'critical' : totalObl === 0 ? 'unmeasured' : 'healthy',
      href: null,
      note: obligationsErrored ? 'Falha ao ler as obrigações.' : null,
    },
    {
      key: 'documentos',
      label: 'Documentos',
      /**
       * Zero documentos REGISTRADOS não é "documentação em conformidade" — é
       * ausência de documentação. O atestado exige documento para atestar.
       */
      headline: docsErrored || totalDocs === 0 ? null : `${pendingDocs}`,
      detail: docsErrored
        ? null
        : totalDocs === 0
          ? `nenhum documento registrado em ${n} ${plural(n, 'contrato', 'contratos')}`
          : pendingDocs > 0
            ? `${plural(pendingDocs, 'pendência', 'pendências')} de conformidade em ${totalDocs}`
            : `${totalDocs} ${plural(totalDocs, 'documento', 'documentos')} em conformidade`,
      state: docsErrored ? 'critical' : pendingDocs > 0 ? 'attention' : totalDocs === 0 ? 'unmeasured' : 'healthy',
      href: null,
      note: docsErrored ? 'Falha ao ler os documentos.' : null,
    },
    {
      key: 'riscos',
      label: 'Riscos',
      headline: risksErrored ? null : `${riskLinks}`,
      detail: risksErrored ? null : riskLinks === 0 ? 'nenhum risco vinculado' : `${plural(riskLinks, 'risco monitorado', 'riscos monitorados')}`,
      // Nenhum risco vinculado não significa contrato sem risco: significa que
      // ninguém mapeou. Estado neutro, não verde.
      state: risksErrored ? 'critical' : riskLinks > 0 ? 'attention' : 'unmeasured',
      href: '/riscos',
      note: risksErrored ? 'Falha ao ler os vínculos de risco.' : null,
    },
    {
      key: 'aprovacoes',
      label: 'Aprovações',
      /** Nenhuma etapa registrada ≠ alçadas concluídas. */
      headline: approvalsErrored || totalSteps === 0 ? null : `${pendingSteps}`,
      detail: approvalsErrored
        ? null
        : totalSteps === 0
          ? `nenhuma etapa de aprovação registrada`
          : pendingSteps > 0
            ? `${plural(pendingSteps, 'etapa em aberto', 'etapas em aberto')} de ${totalSteps}`
            : `${totalSteps} ${plural(totalSteps, 'alçada concluída', 'alçadas concluídas')}`,
      state: approvalsErrored ? 'critical' : pendingSteps > 0 ? 'attention' : totalSteps === 0 ? 'unmeasured' : 'healthy',
      href: null,
      note: approvalsErrored ? 'Falha ao ler as aprovações.' : null,
    },
    {
      key: 'tarefas',
      label: 'Tarefas',
      headline: input.linkedTaskCount === null ? null : `${input.linkedTaskCount}`,
      detail: input.linkedTaskCount === null
        ? null
        : input.linkedTaskCount === 0
          ? 'nenhuma tarefa gerada a partir de contrato'
          : `${plural(input.linkedTaskCount, 'tarefa vinculada', 'tarefas vinculadas')} na agenda`,
      state: input.linkedTaskCount === null ? 'unmeasured' : 'healthy',
      href: '/agenda',
      note: input.linkedTaskCount === null ? 'Não foi possível ler as tarefas vinculadas.' : null,
    },
    {
      key: 'auditoria',
      label: 'Auditoria',
      headline: input.auditEventCount === null ? null : `${input.auditEventCount}`,
      detail: input.auditEventCount === null
        ? null
        : `${plural(input.auditEventCount, 'evento registrado', 'eventos registrados')}`,
      state: input.auditEventCount === null ? 'unmeasured' : 'healthy',
      href: null,
      note: input.auditEventCount === null ? 'Não foi possível ler o histórico.' : null,
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Horizonte
// ═══════════════════════════════════════════════════════════════════════════

export type HorizonEvent = {
  readonly id: string;
  readonly contractId: string;
  readonly contractCode: string;
  readonly kind: 'billing' | 'obligation' | 'renewal';
  readonly title: string;
  readonly date: Date;
  readonly daysAway: number;
  readonly amount: number | null;
  readonly overdue: boolean;
};

const DAY = 86_400_000;
const PAID = ['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado'];

/**
 * O que acontece nos próximos N dias, a partir de linha real.
 *
 * Nenhum evento projetado: se não existe marco cadastrado, o horizonte fica
 * vazio e diz isso. Um "próximo marco estimado" seria a forma mais convincente
 * de ficção num painel de planejamento.
 */
export function portfolioHorizon(
  contracts: readonly TrustedContract[],
  days = 90,
  now: Date = new Date(),
): HorizonEvent[] {
  const limit = now.getTime() + days * DAY;
  const events: HorizonEvent[] = [];

  for (const c of contracts.filter((x) => isOfficialOrigin(x.dataClass))) {
    if (hasOfficialValue(c.billingEvents)) {
      for (const e of c.billingEvents.value) {
        const paid = Boolean(e.paid_at) || PAID.includes((e.status ?? '').toLowerCase());
        if (paid || !e.due_date) continue;
        const at = new Date(e.due_date);
        if (at.getTime() > limit) continue;
        events.push({
          id: `bil-${e.id}`, contractId: c.id, contractCode: c.code, kind: 'billing',
          title: e.title, date: at,
          daysAway: Math.round((at.getTime() - now.getTime()) / DAY),
          amount: e.amount === null || e.amount === undefined ? null : Number(e.amount),
          overdue: at.getTime() < now.getTime(),
        });
      }
    }

    if (hasOfficialValue(c.obligations)) {
      for (const o of c.obligations.value) {
        if (o.status === 'done' || !o.due_date) continue;
        const at = new Date(o.due_date);
        if (at.getTime() > limit) continue;
        events.push({
          id: `obl-${o.id}`, contractId: c.id, contractCode: c.code, kind: 'obligation',
          title: o.title, date: at,
          daysAway: Math.round((at.getTime() - now.getTime()) / DAY),
          amount: null,
          overdue: at.getTime() < now.getTime(),
        });
      }
    }

    const renewal = renewalState(c);
    if (hasOfficialValue(c.endDate) && hasOfficialValue(renewal)) {
      const at = c.endDate.value;
      if (at.getTime() <= limit) {
        events.push({
          id: `ren-${c.id}`, contractId: c.id, contractCode: c.code, kind: 'renewal',
          title: 'Término de vigência', date: at,
          daysAway: Math.round((at.getTime() - now.getTime()) / DAY),
          amount: hasOfficialValue(c.totalValue) ? c.totalValue.value : null,
          overdue: at.getTime() < now.getTime(),
        });
      }
    }
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime());
}
