/**
 * Diárias de Campo — inteligência (PURO, sem I/O).
 *
 * Deriva ALERTAS DE INCONSISTÊNCIA (spec §19) e o custo por projeto a
 * partir das diárias da semana e do contexto (afastamentos, alocações,
 * projetos, semana anterior). Regra de ouro (ADR-006): o sistema
 * SINALIZA "inconsistência de diária — requer análise", nunca acusa
 * fraude nem desconta automaticamente. A coleta de dados vive em
 * allowances.ts; aqui só há regra, para ser testável em node.
 */

export type AlertCode =
  | 'leave_overlap' // diária durante férias/afastamento
  | 'paid_after_demobilization' // diária após desmobilização
  | 'worksite_count_mismatch' // mais diárias que alocados na obra
  | 'closed_project' // projeto encerrado com diárias
  | 'journey_missing' // diária sem jornada válida (conciliação)
  | 'geofence_mismatch' // execução fora da geolocalização prevista
  | 'duplicate_blocked' // duplicidade barrada (sinal positivo)
  | 'spend_spike'; // gasto subiu sem aumento de pessoas

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AllowanceAlert {
  code: AlertCode;
  severity: AlertSeverity;
  title: string;
  detail: string;
  projectId?: string;
  count?: number;
}

/** Status que contam como "diária prevista/paga" (fazem parte do lote). */
export const COUNTED_STATUSES = [
  'planned',
  'approved',
  'included_in_batch',
  'paid',
  'confirmed',
  'divergent',
] as const;

export interface IntelligenceDaily {
  personId: string;
  projectId: string;
  allowanceDate: string;
  status: string;
  eligibilityReason: string | null;
  amountCents: number;
  /** motivos da conciliação, quando já conciliada */
  reconciliationReasons?: string[];
}

export interface IntelligenceInput {
  dailies: IntelligenceDaily[];
  /** afastamentos vivos no período */
  leaves: Array<{ personId: string; start: string; end: string }>;
  /** por pessoa+projeto: última data de encerramento e se há alocação viva */
  allocationState: Array<{
    personId: string;
    projectId: string;
    hasLive: boolean;
    lastEndDate: string | null;
  }>;
  /** nº de pessoas com alocação viva por projeto no período */
  allocatedPeopleByProject: Record<string, number>;
  /** projetos encerrados (concluido/cancelado) */
  closedProjectIds: string[];
  /** totais da semana anterior para comparação (opcional) */
  previous?: { totalCents: number; people: number };
  /** limiar de alta de gasto (fração). Default 0.25 (27% no exemplo) */
  spikeThreshold?: number;
}

const INCONSISTENCY_TAG = 'Inconsistência de diária — requer análise';

function isCounted(status: string): boolean {
  return (COUNTED_STATUSES as readonly string[]).includes(status);
}

/** Custo por projeto (centavos) das diárias que contam para o lote. */
export function costByProject(dailies: IntelligenceDaily[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dailies) {
    if (!isCounted(d.status)) continue;
    out[d.projectId] = (out[d.projectId] ?? 0) + d.amountCents;
  }
  return out;
}

/**
 * Calcula os alertas de inconsistência da semana. Cada alerta é uma
 * observação para análise — nunca uma acusação. Função total.
 */
export function computeAlerts(input: IntelligenceInput): AllowanceAlert[] {
  const alerts: AllowanceAlert[] = [];
  const counted = input.dailies.filter((d) => isCounted(d.status));

  // índices de apoio
  const allocKey = (p: string, j: string) => `${p}|${j}`;
  const allocMap = new Map(input.allocationState.map((a) => [allocKey(a.personId, a.projectId), a]));

  // 1) diária durante férias/afastamento
  const leavePeople = new Set<string>();
  for (const d of counted) {
    const onLeave = input.leaves.some(
      (l) => l.personId === d.personId && l.start <= d.allowanceDate && l.end >= d.allowanceDate,
    );
    if (onLeave) leavePeople.add(d.personId);
  }
  if (leavePeople.size > 0) {
    alerts.push({
      code: 'leave_overlap',
      severity: 'critical',
      title: `${leavePeople.size} colaborador(es) com diária durante afastamento`,
      detail: `${INCONSISTENCY_TAG}: há diárias previstas em datas cobertas por férias/afastamento.`,
      count: leavePeople.size,
    });
  }

  // 2) diária após desmobilização
  const demobPeople = new Set<string>();
  for (const d of counted) {
    const a = allocMap.get(allocKey(d.personId, d.projectId));
    if (a && !a.hasLive && a.lastEndDate != null && a.lastEndDate < d.allowanceDate) {
      demobPeople.add(d.personId);
    }
  }
  if (demobPeople.size > 0) {
    alerts.push({
      code: 'paid_after_demobilization',
      severity: 'critical',
      title: `${demobPeople.size} colaborador(es) com diária após desmobilização`,
      detail: `${INCONSISTENCY_TAG}: diárias em datas posteriores ao fim da alocação.`,
      count: demobPeople.size,
    });
  }

  // 3) mais diárias que alocados na obra (por projeto)
  const peopleByProject = new Map<string, Set<string>>();
  for (const d of counted) {
    const s = peopleByProject.get(d.projectId) ?? new Set<string>();
    s.add(d.personId);
    peopleByProject.set(d.projectId, s);
  }
  for (const [projectId, people] of peopleByProject) {
    const allocated = input.allocatedPeopleByProject[projectId] ?? 0;
    if (people.size > allocated) {
      alerts.push({
        code: 'worksite_count_mismatch',
        severity: 'warning',
        title: `Obra com mais diárias que alocados`,
        detail: `${INCONSISTENCY_TAG}: ${allocated} alocado(s), mas ${people.size} com diária.`,
        projectId,
        count: people.size - allocated,
      });
    }
  }

  // 4) projeto encerrado com diárias
  const closed = new Set(input.closedProjectIds);
  const closedHit = new Set<string>();
  for (const d of counted) if (closed.has(d.projectId)) closedHit.add(d.projectId);
  for (const projectId of closedHit) {
    alerts.push({
      code: 'closed_project',
      severity: 'critical',
      title: 'Projeto encerrado recebeu diárias',
      detail: `${INCONSISTENCY_TAG}: projeto concluído/cancelado com diárias na semana.`,
      projectId,
    });
  }

  // 5) sem jornada válida / 6) fora da geofence (a partir da conciliação)
  const noJourney = counted.filter((d) => (d.reconciliationReasons ?? []).includes('no_attendance'));
  if (noJourney.length > 0) {
    alerts.push({
      code: 'journey_missing',
      severity: 'warning',
      title: `${noJourney.length} diária(s) sem jornada válida`,
      detail: `${INCONSISTENCY_TAG}: pago/previsto sem registro de entrada no dia.`,
      count: noJourney.length,
    });
  }
  const geoMismatch = counted.filter((d) =>
    (d.reconciliationReasons ?? []).includes('outside_geofence'),
  );
  if (geoMismatch.length > 0) {
    alerts.push({
      code: 'geofence_mismatch',
      severity: 'warning',
      title: `${geoMismatch.length} diária(s) fora da geolocalização prevista`,
      detail: `${INCONSISTENCY_TAG}: execução fora da geofence da obra.`,
      count: geoMismatch.length,
    });
  }

  // 7) duplicidade barrada (sinal positivo)
  const dup = input.dailies.filter((d) => d.eligibilityReason === 'blocked_duplicate').length;
  if (dup > 0) {
    alerts.push({
      code: 'duplicate_blocked',
      severity: 'info',
      title: `${dup} diária(s) duplicada(s) bloqueada(s)`,
      detail: 'Duplicidade barrada pelo banco — nenhuma ação necessária.',
      count: dup,
    });
  }

  // 8) gasto subiu sem aumento de pessoas
  if (input.previous && input.previous.totalCents > 0) {
    const currentTotal = counted.reduce((s, d) => s + d.amountCents, 0);
    const currentPeople = new Set(counted.map((d) => d.personId)).size;
    const threshold = input.spikeThreshold ?? 0.25;
    const growth = (currentTotal - input.previous.totalCents) / input.previous.totalCents;
    if (growth > threshold && currentPeople <= input.previous.people) {
      alerts.push({
        code: 'spend_spike',
        severity: 'warning',
        title: `Diárias subiram ${(growth * 100).toFixed(0)}% sem aumento de pessoas`,
        detail: `${INCONSISTENCY_TAG}: variação de custo acima do esperado para o mesmo headcount.`,
      });
    }
  }

  return alerts;
}

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  info: 'Informativo',
  warning: 'Atenção',
  critical: 'Crítico',
};
