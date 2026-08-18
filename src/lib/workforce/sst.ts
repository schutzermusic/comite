/**
 * Indicadores de SST a partir dos eventos do eSocial.
 *
 * Camada pura: recebe os eventos já lidos e devolve os números da seção. Nada
 * de I/O, para que a rota e a tela concordem por construção em vez de por
 * coincidência — foi o que evitou, no resto do módulo, um KPI dizer uma coisa
 * no topo e a tabela abaixo dizer outra.
 *
 * A REGRA QUE MANDA AQUI (a mesma de `esocial-coverage.ts`): onde não há fonte,
 * o indicador é AUSENTE. Concretamente, o ASO tem quatro estados e não dois —
 * em dia, vencido, a vencer e **sem vencimento apurável**. Espremer o quarto
 * estado nos outros três é o erro que transforma "não sei" em "está tudo bem".
 */

export type SstEventType = 'S-2210' | 'S-2220' | 'S-2240';

/** Forma que atravessa a rota — sem CPF, sem XML. */
export interface SstEvent {
  eventId: string;
  eventType: SstEventType;
  competence: string | null;
  eventDate: string | null;
  /** Identificador pseudônimo do trabalhador; nunca o CPF. */
  workerKey: string | null;
  /** Presentes apenas para quem tem `people.view_sensitive_data`. */
  workerName: string | null;
  workerMask: string | null;
  matricula: string | null;
  areaCode: string | null;
  areaLabel: string | null;

  cat?: {
    catType: string | null;
    accidentKind: string | null;
    localKind: string | null;
    situationCode: string | null;
    initiator: string | null;
    /** `null` = o evento não declarou. Distinto de `false`. */
    causedLeave: boolean | null;
    deathDate: string | null;
    bodyPartCode: string | null;
    causingAgentCode: string | null;
  };

  aso?: {
    examKind: string | null;
    result: string | null;
    /** `null` = periodicidade não apurável para este tipo de exame. */
    validUntil: string | null;
    periodMonths: number | null;
    /** `code` é o `procRealizado`; `result` é o `indResult` (1 normal, 2 alterado). */
    exams: { code?: string; date?: string; result?: string }[];
  };

  exposure?: {
    start: string | null;
    end: string | null;
    environmentCode: string | null;
    agents: {
      code?: string;
      description?: string;
      assessment?: string;
      intensity?: string;
      toleranceLimit?: string;
      unit?: string;
      epcEfficient?: boolean;
      epiEfficient?: boolean;
    }[];
  };
}

/** Vínculo ativo, o denominador de "quem está sem ASO". */
export interface SstWorker {
  workerKey: string;
  name: string | null;
  matricula: string | null;
  areaLabel: string | null;
}

/** Situação do ASO de UM trabalhador — quatro estados, nunca dois. */
export type AsoStatus = 'valid' | 'expiring' | 'expired' | 'undetermined' | 'absent';

export interface WorkerAsoStatus {
  worker: SstWorker;
  status: AsoStatus;
  /** Exame mais recente encontrado, se houver. */
  lastExamDate: string | null;
  lastExamKind: string | null;
  validUntil: string | null;
  daysToExpiry: number | null;
}

export interface SstSummary {
  /** `null` quando não há nenhum evento de SST no acervo — indicador ausente. */
  catsInPeriod: number | null;
  catsWithLeave: number | null;
  catsWithLeaveUndeclared: number | null;
  asosInPeriod: number | null;
  asoExpired: number | null;
  asoExpiring: number | null;
  asoUndetermined: number | null;
  workersWithoutAso: number | null;
  exposedWorkers: number | null;
  distinctAgents: number | null;
  /** Total de vínculos ativos considerados no denominador. */
  activeWorkers: number;
}

/** Janela padrão de "a vencer", em dias. */
export const ASO_EXPIRING_WINDOW_DAYS = 60;

function isoToday(reference: Date): string {
  return reference.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Filtra por competência quando um recorte foi pedido. */
export function filterByCompetence(events: SstEvent[], competence?: string): SstEvent[] {
  if (!competence) return events;
  return events.filter((e) => e.competence === competence);
}

/**
 * Situação do ASO por trabalhador ativo.
 *
 * Percorre os vínculos ATIVOS, e não os exames: quem nunca fez exame não tem
 * evento nenhum e, contado a partir dos eventos, simplesmente não existiria —
 * que é exatamente o caso mais grave da lista.
 */
export function asoStatusByWorker(
  events: SstEvent[],
  workers: SstWorker[],
  reference: Date = new Date(),
  windowDays: number = ASO_EXPIRING_WINDOW_DAYS,
): WorkerAsoStatus[] {
  const today = isoToday(reference);

  /** Exame mais recente de cada trabalhador. */
  const latest = new Map<string, SstEvent>();
  for (const ev of events) {
    if (ev.eventType !== 'S-2220' || !ev.workerKey) continue;
    const current = latest.get(ev.workerKey);
    const date = ev.eventDate ?? '';
    if (!current || date > (current.eventDate ?? '')) latest.set(ev.workerKey, ev);
  }

  return workers.map((worker) => {
    const ev = latest.get(worker.workerKey);
    if (!ev) {
      return {
        worker,
        status: 'absent' as const,
        lastExamDate: null,
        lastExamKind: null,
        validUntil: null,
        daysToExpiry: null,
      };
    }

    const validUntil = ev.aso?.validUntil ?? null;
    if (!validUntil) {
      // Tem exame, mas o tipo não estabelece periodicidade. Não é "em dia" e
      // não é "vencido" — é desconhecido, e vai para o balde próprio.
      return {
        worker,
        status: 'undetermined' as const,
        lastExamDate: ev.eventDate,
        lastExamKind: ev.aso?.examKind ?? null,
        validUntil: null,
        daysToExpiry: null,
      };
    }

    const daysToExpiry = daysBetween(today, validUntil);
    const status: AsoStatus =
      daysToExpiry < 0 ? 'expired' : daysToExpiry <= windowDays ? 'expiring' : 'valid';

    return {
      worker,
      status,
      lastExamDate: ev.eventDate,
      lastExamKind: ev.aso?.examKind ?? null,
      validUntil,
      daysToExpiry,
    };
  });
}

/**
 * KPIs da seção.
 *
 * `events` já vem recortado pelo período escolhido; `workers` é o quadro ativo
 * inteiro, porque "sem ASO válido" é uma pergunta sobre hoje e não sobre o mês.
 */
export function summarizeSst(
  events: SstEvent[],
  allEvents: SstEvent[],
  workers: SstWorker[],
  reference: Date = new Date(),
): SstSummary {
  const hasArchive = allEvents.length > 0;

  const cats = events.filter((e) => e.eventType === 'S-2210');
  const asos = events.filter((e) => e.eventType === 'S-2220');
  const exposures = events.filter((e) => e.eventType === 'S-2240');

  // O ASO vigente é sempre lido do acervo inteiro: o exame que vale hoje pode
  // ter sido feito há dez meses, fora do recorte de competência da tela.
  const statuses = hasArchive ? asoStatusByWorker(allEvents, workers, reference) : [];

  const agents = new Set<string>();
  for (const ev of exposures) {
    for (const agent of ev.exposure?.agents ?? []) {
      if (agent.code) agents.add(agent.code);
    }
  }

  const exposedWorkers = new Set(
    exposures.map((e) => e.workerKey).filter((k): k is string => Boolean(k)),
  );

  return {
    catsInPeriod: hasArchive ? cats.length : null,
    catsWithLeave: hasArchive ? cats.filter((c) => c.cat?.causedLeave === true).length : null,
    // Declarar quantas CATs não disseram se houve afastamento é o que impede
    // que a contagem acima seja lida como "as demais não afastaram".
    catsWithLeaveUndeclared: hasArchive
      ? cats.filter((c) => c.cat?.causedLeave === null || c.cat?.causedLeave === undefined).length
      : null,
    asosInPeriod: hasArchive ? asos.length : null,
    asoExpired: hasArchive ? statuses.filter((s) => s.status === 'expired').length : null,
    asoExpiring: hasArchive ? statuses.filter((s) => s.status === 'expiring').length : null,
    asoUndetermined: hasArchive ? statuses.filter((s) => s.status === 'undetermined').length : null,
    workersWithoutAso: hasArchive ? statuses.filter((s) => s.status === 'absent').length : null,
    exposedWorkers: hasArchive ? exposedWorkers.size : null,
    distinctAgents: hasArchive ? agents.size : null,
    activeWorkers: workers.length,
  };
}

/** Contagem de CATs por área, para o recorte por projeto/lotação. */
export function catsByArea(events: SstEvent[]): { areaLabel: string; total: number; withLeave: number }[] {
  const map = new Map<string, { total: number; withLeave: number }>();
  for (const ev of events) {
    if (ev.eventType !== 'S-2210') continue;
    const label = ev.areaLabel ?? 'Sem lotação informada';
    const current = map.get(label) ?? { total: 0, withLeave: 0 };
    current.total += 1;
    if (ev.cat?.causedLeave === true) current.withLeave += 1;
    map.set(label, current);
  }
  return [...map.entries()]
    .map(([areaLabel, v]) => ({ areaLabel, ...v }))
    .sort((a, b) => b.total - a.total);
}

/** Agentes nocivos distintos e a quantos trabalhadores cada um alcança. */
export function agentExposure(
  events: SstEvent[],
): { code: string; description: string | null; workers: number; assessment: string | null }[] {
  const map = new Map<string, { description: string | null; assessment: string | null; workers: Set<string> }>();
  for (const ev of events) {
    if (ev.eventType !== 'S-2240') continue;
    for (const agent of ev.exposure?.agents ?? []) {
      if (!agent.code) continue;
      const current =
        map.get(agent.code) ??
        { description: agent.description ?? null, assessment: agent.assessment ?? null, workers: new Set<string>() };
      if (ev.workerKey) current.workers.add(ev.workerKey);
      if (!current.description && agent.description) current.description = agent.description;
      map.set(agent.code, current);
    }
  }
  return [...map.entries()]
    .map(([code, v]) => ({
      code,
      description: v.description,
      assessment: v.assessment,
      workers: v.workers.size,
    }))
    .sort((a, b) => b.workers - a.workers);
}

/** Competências presentes no acervo de SST, mais recente primeiro. */
export function sstCompetences(events: SstEvent[]): string[] {
  return [...new Set(events.map((e) => e.competence).filter((c): c is string => Boolean(c)))].sort(
    (a, b) => b.localeCompare(a),
  );
}
