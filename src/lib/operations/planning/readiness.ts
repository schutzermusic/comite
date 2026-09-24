/**
 * PRONTIDÃO — derivada, por requisito e por atividade.
 *
 * Material e serviço externo leem a COBERTURA do Supply (reserva,
 * transferência, compra recebida/em trânsito alocadas ao requisito). O resto
 * lê o ato "atendido". Nada disso é gravado: é a mesma pergunta respondida
 * sempre dos mesmos fatos.
 */

import { isCriticalActivity, type ActivityLike } from '../overview-rules';

export type RequirementType =
  | 'MATERIAL' | 'EQUIPMENT' | 'VEHICLE' | 'WORKFORCE' | 'EXTERNAL_SERVICE'
  | 'DOCUMENT' | 'CUSTOMER_DEPENDENCY' | 'OTHER';
export type RequirementStatus = 'PLANNED' | 'CONFIRMED' | 'CANCELLED' | 'SUPERSEDED';

export type Readiness = 'READY' | 'PARTIAL' | 'SHORTAGE' | 'PENDING' | 'OVERDUE' | 'UNCONFIRMED';

export const READINESS_LABEL: Record<Readiness, string> = {
  READY: 'Pronto', PARTIAL: 'Parcial', SHORTAGE: 'Em falta', PENDING: 'Pendente',
  OVERDUE: 'Vencido', UNCONFIRMED: 'Não confirmado',
};

export const REQUIREMENT_TYPE_LABEL: Record<RequirementType, string> = {
  MATERIAL: 'Material', EQUIPMENT: 'Equipamento', VEHICLE: 'Veículo', WORKFORCE: 'Mão de obra',
  EXTERNAL_SERVICE: 'Serviço externo', DOCUMENT: 'Documento', CUSTOMER_DEPENDENCY: 'Dependência do cliente', OTHER: 'Outro',
};

/** Tipos cuja cobertura é do Supply — não se marcam "atendidos" à mão. */
export const SUPPLY_COVERED_TYPES: RequirementType[] = ['MATERIAL', 'EXTERNAL_SERVICE'];

/** Colunas da matriz de prontidão (o exemplo do plano: Equipe, Material, Documento, Cliente). */
export type ReadinessDimension = 'team' | 'material' | 'equipment' | 'document' | 'customer' | 'other';
export const DIMENSION_LABEL: Record<ReadinessDimension, string> = {
  team: 'Equipe', material: 'Material', equipment: 'Equipamento', document: 'Documento', customer: 'Cliente', other: 'Outros',
};
export function dimensionOf(type: RequirementType): ReadinessDimension {
  switch (type) {
    case 'WORKFORCE': return 'team';
    case 'MATERIAL': case 'EXTERNAL_SERVICE': return 'material';
    case 'EQUIPMENT': case 'VEHICLE': return 'equipment';
    case 'DOCUMENT': return 'document';
    case 'CUSTOMER_DEPENDENCY': return 'customer';
    case 'OTHER': return 'other';
  }
}

export interface RequirementLike {
  requirement_type: RequirementType;
  status: RequirementStatus;
  quantity: number | string | null;
  required_by: string | null;
  satisfied_at: string | null;
}

/** Quanto do requisito o Supply já cobre (na mesma unidade). Nulo = Supply ainda não sabe. */
export interface Coverage { covered: number; inbound: number }

export function requirementReadiness(r: RequirementLike, today: string, coverage?: Coverage | null): Readiness | null {
  if (r.status === 'CANCELLED' || r.status === 'SUPERSEDED') return null;
  if (r.status === 'PLANNED') return 'UNCONFIRMED';
  if (SUPPLY_COVERED_TYPES.includes(r.requirement_type)) {
    const need = Number(r.quantity ?? 0);
    const covered = coverage?.covered ?? 0;
    if (need > 0 && covered >= need) return 'READY';
    return covered > 0 ? 'PARTIAL' : 'SHORTAGE';
  }
  if (r.satisfied_at) return 'READY';
  if (r.required_by && r.required_by < today) return 'OVERDUE';
  return 'PENDING';
}

const RANK: Record<Readiness, number> = { OVERDUE: 5, SHORTAGE: 4, UNCONFIRMED: 3, PARTIAL: 2, PENDING: 1, READY: 0 };

/** O pior estado vence: uma atividade não está pronta se UM requisito não está. */
export function worstReadiness(values: Array<Readiness | null>): Readiness | null {
  const live = values.filter((v): v is Readiness => v !== null);
  if (!live.length) return null;
  return live.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}

export function isBlockingReadiness(r: Readiness | null): boolean {
  return r === 'OVERDUE' || r === 'SHORTAGE';
}

export interface PlanningConstraint {
  code: 'CUSTOMER_DEPENDENCY_OVERDUE' | 'NEED_AFTER_ACTIVITY_START' | 'UNCONFIRMED_NEAR_START' | 'MATERIAL_SHORT_NEAR_NEED'
    | 'REQUIREMENT_WITHOUT_ACTIVITY';
  severity: 'danger' | 'warning' | 'info';
  text: string;
}

/**
 * EXCEÇÕES DE PLANEJAMENTO — o que o plano mostra antes de a obra descobrir:
 * dependência do cliente vencida; necessidade DEPOIS do início da atividade;
 * requisito não confirmado com a atividade começando; material em falta
 * perto da data de necessidade.
 */
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * O texto de cada exceção fala da RELAÇÃO (data × frente × cobertura), não
 * repete o nome do requisito — quem mostra a exceção mostra o requisito junto.
 */
export function planningConstraints(
  r: RequirementLike & { title: string; activity_id: string | null },
  activity: { planned_start: string | null; title: string } | null,
  today: string,
  readiness: Readiness | null,
  daysUntil: (from: string, to: string) => number,
): PlanningConstraint[] {
  const out: PlanningConstraint[] = [];
  if (!readiness) return out;
  if (r.requirement_type === 'CUSTOMER_DEPENDENCY' && readiness === 'OVERDUE') {
    out.push({ code: 'CUSTOMER_DEPENDENCY_OVERDUE', severity: 'danger',
      text: `Dependência do cliente vencida em ${dm(r.required_by!)} — cobre o cliente` });
  }
  if (activity?.planned_start && r.required_by && r.required_by > activity.planned_start && readiness !== 'READY') {
    out.push({ code: 'NEED_AFTER_ACTIVITY_START', severity: 'warning',
      text: `Declarado para ${dm(r.required_by)}, mas "${activity.title}" começa em ${dm(activity.planned_start)} — vale a data da frente` });
  }
  if (readiness === 'UNCONFIRMED' && activity?.planned_start && daysUntil(today, activity.planned_start) <= 14) {
    out.push({ code: 'UNCONFIRMED_NEAR_START', severity: 'warning',
      text: `Não confirmado e "${activity.title}" começa em ${dm(activity.planned_start)}` });
  }
  if ((readiness === 'SHORTAGE' || readiness === 'PARTIAL') && r.required_by && daysUntil(today, r.required_by) <= 14) {
    const days = daysUntil(today, r.required_by);
    out.push({ code: 'MATERIAL_SHORT_NEAR_NEED', severity: r.required_by < today ? 'danger' : 'warning',
      text: `${readiness === 'SHORTAGE' ? 'Sem cobertura' : 'Cobertura parcial'} ${days < 0 ? `e a necessidade venceu em ${dm(r.required_by)}`
        : days === 0 ? 'e a necessidade é hoje' : `a ${days} dia${days === 1 ? '' : 's'} da necessidade`}` });
  }
  if (!r.activity_id && r.status === 'CONFIRMED') {
    out.push({ code: 'REQUIREMENT_WITHOUT_ACTIVITY', severity: 'info', text: 'Sem atividade vinculada — o plano não sabe quando a frente precisa' });
  }
  return out;
}

/** A regra de data de necessidade (a mesma da Apex e do Supply): min(necessário em, início da atividade). */
export function needByOf(requiredBy: string | null, activityStart: string | null): string | null {
  if (requiredBy && activityStart) return requiredBy < activityStart ? requiredBy : activityStart;
  return requiredBy ?? activityStart ?? null;
}

/** Por que a atividade é crítica — a mesma definição da Visão Geral ("Atividades críticas"), dita em palavras. */
export function criticalReasons(a: ActivityLike, today: string): string[] {
  if (!isCriticalActivity(a, today)) return [];
  return [a.priority === 'critical' ? 'prioridade crítica' : null, a.delay_status === 'blocked' ? 'bloqueada' : null,
    a.delay_status === 'delayed' ? 'atrasada' : null, a.planned_finish && a.planned_finish < today ? 'término vencido' : null]
    .filter((x): x is string => Boolean(x));
}
