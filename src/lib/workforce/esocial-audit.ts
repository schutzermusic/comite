/**
 * Auditoria técnica do acervo do eSocial.
 *
 * Responde a uma pergunta diferente da do cockpit. O cockpit pergunta "quanto
 * custou a folha"; aqui se pergunta "o que exatamente eu tenho, e o que está
 * faltando para eu poder confiar no que tenho". São perguntas sobre o acervo,
 * não sobre o negócio — e é por isso que este material não pertence a
 * Governança, cujo assunto é a exceção operacional classificada para análise.
 *
 * Camada pura, sem I/O: a rota busca as linhas, isto interpreta.
 */

export interface AuditCompetenceMetric {
  competence: string;
  headcount: number;
  overtime_hours?: number | null;
  rubric_total_cents?: number | null;
  rubric_mapped_cents?: number | null;
  source_event_count: number;
  totalizers?: Record<string, boolean> | null;
}

export interface AuditAreaMetric {
  competence: string;
  area_code: string;
  area_label: string;
  gross_cents: number;
  base_cents?: number | null;
}

export interface AuditEvent {
  esocial_event_id: string;
  event_type: string;
  competence: string | null;
  receipt_number: string | null;
  status: string;
  received_at: string;
  metadata: Record<string, unknown> | null;
}

// ── Competências: o que veio e o que falta ──────────────────────────────────

export interface CompetenceCoverageRow {
  competence: string;
  imported: boolean;
  eventCount: number;
  headcount: number;
  /** S-1299 encontrado para a competência. */
  closed: boolean;
  totalizers: string[];
}

/**
 * Sequência mensal completa entre a primeira e a última competência do acervo.
 *
 * Só faz sentido apontar "faltando" DENTRO do intervalo coberto: um mês
 * anterior ao primeiro pacote importado não está faltando, ele simplesmente
 * nunca foi pedido. Apontá-lo como lacuna encheria a tela de alarme falso e
 * ensinaria o operador a ignorar a lista.
 */
export function competenceRange(competences: string[]): string[] {
  const monthly = competences.filter((c) => /^\d{4}-\d{2}$/.test(c)).sort();
  if (monthly.length === 0) return [];

  const out: string[] = [];
  let current = monthly[0];
  const last = monthly[monthly.length - 1];
  // Guarda de segurança: 30 anos de meses. Uma competência corrompida no banco
  // não pode virar laço infinito.
  for (let i = 0; current <= last && i < 360; i += 1) {
    out.push(current);
    const [year, month] = current.split('-').map(Number);
    const next = new Date(Date.UTC(year, month, 1));
    current = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return out;
}

/**
 * Contagem de eventos por competência.
 *
 * Aceita o agregado já calculado no banco (migration 086). Quando ele não vier
 * — base sem a migration —, quem chama passa o mapa contado em memória, e o
 * painel funciona igual, só mais caro.
 */
export function buildCompetenceCoverage(
  metrics: AuditCompetenceMetric[],
  input: {
    eventCountByCompetence: Map<string, number>;
    closedCompetences: Set<string>;
  },
): { rows: CompetenceCoverageRow[]; missing: string[] } {
  const byCompetence = new Map(metrics.map((m) => [m.competence, m]));
  const { eventCountByCompetence, closedCompetences: closures } = input;

  const range = competenceRange([...byCompetence.keys()]);
  const missing: string[] = [];

  const rows = range.map((competence) => {
    const metric = byCompetence.get(competence);
    if (!metric) missing.push(competence);
    return {
      competence,
      imported: Boolean(metric),
      eventCount: eventCountByCompetence.get(competence) ?? 0,
      headcount: metric?.headcount ?? 0,
      closed: closures.has(competence),
      totalizers: Object.entries(metric?.totalizers ?? {})
        .filter(([, present]) => present)
        .map(([code]) => code)
        .sort(),
    };
  });

  return { rows, missing };
}

// ── Eventos: contagem, exclusões, origem ────────────────────────────────────

export interface EventTypeCount {
  eventType: string;
  count: number;
  /** Competências distintas em que o tipo aparece. */
  competences: number;
}

export function countEventsByType(events: AuditEvent[]): EventTypeCount[] {
  const map = new Map<string, { count: number; competences: Set<string> }>();
  for (const ev of events) {
    const current = map.get(ev.event_type) ?? { count: 0, competences: new Set<string>() };
    current.count += 1;
    if (ev.competence) current.competences.add(ev.competence);
    map.set(ev.event_type, current);
  }
  return [...map.entries()]
    .map(([eventType, v]) => ({ eventType, count: v.count, competences: v.competences.size }))
    .sort((a, b) => a.eventType.localeCompare(b.eventType));
}

/** Mesma forma, a partir do agregado que o banco devolveu. */
export function eventTypeCountsFromAggregate(
  rows: { event_type: string; total: number; competences: number }[],
): EventTypeCount[] {
  return rows
    .map((r) => ({ eventType: r.event_type, count: Number(r.total), competences: Number(r.competences) }))
    .sort((a, b) => a.eventType.localeCompare(b.eventType));
}

/** Mesma forma, a partir do agregado que o banco devolveu. */
export function originsFromAggregate(
  rows: { proc_emi: string | null; ver_proc: string | null; total: number; competences: number }[],
): OriginRow[] {
  return rows
    .map((r) => ({
      procEmi: r.proc_emi,
      verProc: r.ver_proc,
      count: Number(r.total),
      competences: Number(r.competences),
    }))
    .sort((a, b) => b.count - a.count);
}

export interface ExclusionRow {
  eventId: string;
  competence: string | null;
  targetEventType: string | null;
  targetReceipt: string | null;
  /**
   * O evento excluído ainda está no acervo?
   *
   * Quando está, a contagem por tipo acima inclui algo que o eSocial já
   * apagou — e é essa a informação acionável. Quando não está, a exclusão
   * chegou antes ou junto e nada precisa ser feito.
   */
  targetStillPresent: boolean;
}

/**
 * @param events   Apenas os S-3000 (o painel os mostra um a um).
 * @param receipts Recibos que EXISTEM no acervo — consultados pelo chamador a
 *   partir dos alvos citados, e não derivados do acervo inteiro em memória.
 */
export function buildExclusions(events: AuditEvent[], receipts: Set<string>): ExclusionRow[] {
  return events
    .filter((e) => e.event_type === 'S-3000')
    .map((e) => {
      const exclusion = (e.metadata?.exclusion ?? {}) as {
        targetEventType?: string;
        targetReceipt?: string;
      };
      return {
        eventId: e.esocial_event_id,
        competence: e.competence,
        targetEventType: exclusion.targetEventType ?? null,
        targetReceipt: exclusion.targetReceipt ?? null,
        targetStillPresent: Boolean(exclusion.targetReceipt && receipts.has(exclusion.targetReceipt)),
      };
    })
    .sort((a, b) => (b.competence ?? '').localeCompare(a.competence ?? ''));
}

export interface OriginRow {
  procEmi: string | null;
  verProc: string | null;
  count: number;
  competences: number;
}

/**
 * De onde vieram os eventos.
 *
 * Duas competências com números parecidos podem ter qualidade muito diferente
 * conforme tenham saído do sistema do escritório contábil ou de digitação no
 * portal. O número sozinho não conta essa diferença; esta tabela conta.
 */
export function buildOrigins(events: AuditEvent[]): OriginRow[] {
  const map = new Map<string, { procEmi: string | null; verProc: string | null; count: number; competences: Set<string> }>();
  for (const ev of events) {
    if (ev.event_type === 'RETORNO-LOTE') continue;
    const origin = (ev.metadata?.origin ?? {}) as { procEmi?: string; verProc?: string };
    const procEmi = origin.procEmi ?? null;
    const verProc = origin.verProc ?? null;
    const key = `${procEmi ?? '?'}|${verProc ?? '?'}`;
    const current = map.get(key) ?? { procEmi, verProc, count: 0, competences: new Set<string>() };
    current.count += 1;
    if (ev.competence) current.competences.add(ev.competence);
    map.set(key, current);
  }
  return [...map.values()]
    .map((v) => ({ procEmi: v.procEmi, verProc: v.verProc, count: v.count, competences: v.competences.size }))
    .sort((a, b) => b.count - a.count);
}

export const PROC_EMI_LABELS: Record<string, string> = {
  '1': 'Software do empregador',
  '2': 'Portal eSocial web',
  '3': 'Portal eSocial simplificado',
  '4': 'Aplicativo governamental',
  '22': 'Portal eSocial web (doméstico)',
  '23': 'Aplicativo doméstico',
};

export interface ClosureRow {
  competence: string;
  apuracaoKind: string | null;
  hasRemuneration: boolean | null;
  hasPayments: boolean | null;
}

export function buildClosures(events: AuditEvent[]): ClosureRow[] {
  const map = new Map<string, ClosureRow>();
  for (const ev of events) {
    if (ev.event_type !== 'S-1299' || !ev.competence) continue;
    const info = (ev.metadata?.periodClose ?? {}) as {
      apuracaoKind?: string;
      hasRemuneration?: boolean;
      hasPayments?: boolean;
    };
    map.set(ev.competence, {
      competence: ev.competence,
      apuracaoKind: info.apuracaoKind ?? null,
      hasRemuneration: info.hasRemuneration ?? null,
      hasPayments: info.hasPayments ?? null,
    });
  }
  return [...map.values()].sort((a, b) => b.competence.localeCompare(a.competence));
}

// ── Mapeamentos pendentes ───────────────────────────────────────────────────

export interface RubricGapRow {
  competence: string;
  totalCents: number;
  mappedCents: number;
  unmappedCents: number;
  coverage: number;
}

/**
 * Quanto da folha declarada ficou sem rubrica classificada.
 *
 * Competências sem nenhum detalhe declarado (`total = 0`) ficam FORA: elas não
 * têm rubrica por mapear, têm ausência de detalhe — problema diferente, com
 * causa diferente (janela de retenção), e que já é dito pela cobertura.
 */
export function buildRubricGaps(metrics: AuditCompetenceMetric[]): RubricGapRow[] {
  return metrics
    .map((m) => {
      const totalCents = m.rubric_total_cents ?? 0;
      const mappedCents = m.rubric_mapped_cents ?? 0;
      return {
        competence: m.competence,
        totalCents,
        mappedCents,
        unmappedCents: Math.max(0, totalCents - mappedCents),
        coverage: totalCents > 0 ? mappedCents / totalCents : 0,
      };
    })
    .filter((r) => r.totalCents > 0 && r.unmappedCents > 0)
    .sort((a, b) => b.unmappedCents - a.unmappedCents);
}

export interface CostCenterLike {
  id: string;
  code: string;
  name: string;
}

export interface UnmappedLotacaoRow {
  areaCode: string;
  areaLabel: string;
  competences: number;
  grossCents: number;
  baseCents: number;
}

/**
 * Lotações do eSocial sem centro de custo correspondente.
 *
 * A lotação tributária (`codLotacao`) e o centro de custo financeiro são eixos
 * diferentes que precisam se encontrar em algum ponto, senão o custo apurado
 * pelo governo nunca chega ao rateio por projeto. O casamento reusa
 * deliberadamente o que já existe: o código do centro de custo e a tabela de
 * apelidos de `payroll_cost_center_mappings`. Nenhum mapeamento novo é
 * inventado aqui — a tela oferece o link para criar o apelido no painel que já
 * sabe fazer isso.
 */
export function buildUnmappedLotacoes(
  areas: AuditAreaMetric[],
  costCenters: CostCenterLike[],
  aliasKeys: Set<string>,
): UnmappedLotacaoRow[] {
  const known = new Set<string>();
  for (const cc of costCenters) {
    if (cc.code) known.add(cc.code.trim().toLowerCase());
    if (cc.name) known.add(cc.name.trim().toLowerCase());
  }

  const map = new Map<string, UnmappedLotacaoRow>();
  for (const area of areas) {
    const code = area.area_code;
    // "sem-lotacao" não é uma lotação por mapear: é a ausência da informação
    // no evento, e mandá-la para esta lista pediria ao operador que mapeasse
    // algo que não existe.
    if (!code || code === 'sem-lotacao') continue;

    const key = code.trim().toLowerCase();
    if (known.has(key) || aliasKeys.has(key)) continue;

    const current =
      map.get(code) ?? { areaCode: code, areaLabel: area.area_label, competences: 0, grossCents: 0, baseCents: 0 };
    current.competences += 1;
    current.grossCents += area.gross_cents;
    current.baseCents += area.base_cents ?? 0;
    map.set(code, current);
  }

  return [...map.values()].sort((a, b) => b.baseCents + b.grossCents - (a.baseCents + a.grossCents));
}

// ── Divergências Apex × eSocial ─────────────────────────────────────────────

export interface DivergenceRow {
  competence: string;
  esocialHeadcount: number;
  /** `null` quando não há lote de folha aprovado para a competência. */
  payrollHeadcount: number | null;
  headcountDelta: number | null;
  esocialGrossCents: number | null;
  payrollGrossCents: number | null;
  grossDeltaPct: number | null;
}

export interface PayrollCompetenceFacts {
  competence: string;
  headcount: number | null;
  grossCents: number | null;
}

/**
 * Onde a folha importada e o eSocial discordam.
 *
 * Divergência não é erro por si: a folha do escritório e o que foi transmitido
 * ao governo podem legitimamente diferir por rescisão complementar, por
 * competência reaberta, por trabalhador sem vínculo. O que a tela faz é
 * MOSTRAR a diferença, não julgá-la — e por isso não há "status ok/erro" aqui,
 * só o delta e o par de números que o produziu.
 */
export function buildDivergences(
  metrics: AuditCompetenceMetric[],
  payroll: PayrollCompetenceFacts[],
  esocialGrossByCompetence: Map<string, number>,
): DivergenceRow[] {
  const byCompetence = new Map(payroll.map((p) => [p.competence, p]));

  return metrics
    .filter((m) => /^\d{4}-\d{2}$/.test(m.competence))
    .map((m) => {
      const p = byCompetence.get(m.competence);
      const esocialGrossCents = esocialGrossByCompetence.get(m.competence) ?? null;
      const payrollGrossCents = p?.grossCents ?? null;
      return {
        competence: m.competence,
        esocialHeadcount: m.headcount,
        payrollHeadcount: p?.headcount ?? null,
        headcountDelta: p?.headcount != null ? m.headcount - p.headcount : null,
        esocialGrossCents,
        payrollGrossCents,
        grossDeltaPct:
          esocialGrossCents && payrollGrossCents && payrollGrossCents > 0
            ? ((esocialGrossCents - payrollGrossCents) / payrollGrossCents) * 100
            : null,
      };
    })
    .sort((a, b) => b.competence.localeCompare(a.competence));
}
