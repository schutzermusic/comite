/**
 * Workforce intelligence engine (Fase 8, diferencial D2) — DETERMINÍSTICO.
 * Simulador de nova demanda (§17), forecast de capacidade e detecção
 * forward-looking de ociosidade/sobrecarga. Não usa LLM: é cálculo
 * reproduzível sobre alocações, capacidade e custo. A narrativa/
 * recomendação de IA é uma camada opcional por cima (workforce-advisor).
 */
import type {
  CapacityForecastPoint,
  DemandCandidate,
  DemandSimulationInput,
  Person,
  PersonProjectAllocation,
  WorkforceIntelligenceSummary,
} from '@/lib/types/people';
import { listPeople } from './people';
import { listLiveAllocationsInPeriod, LIVE_ALLOCATION_STATUSES } from './allocations';
import { listSnapshots } from './cost';
import { monthBounds } from './capacity';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function allocCoversMonth(a: PersonProjectAllocation, month: string): boolean {
  const [start, end] = monthBounds(month);
  return (
    LIVE_ALLOCATION_STATUSES.includes(a.status) &&
    a.startDate <= end &&
    (a.endDate == null || a.endDate >= start)
  );
}

/** Σ live % of a person in a month. */
function committedPct(allocations: PersonProjectAllocation[], personId: string, month: string): number {
  return allocations
    .filter((a) => a.personId === personId && allocCoversMonth(a, month))
    .reduce((s, a) => s + a.plannedPercentage, 0);
}

/* ───────────────────── competency matching ───────────────────── */

const STOPWORDS = new Set([
  'de', 'da', 'do', 'e', 'em', 'para', 'com', 'a', 'o', 'os', 'as', 'nr',
]);

function tokenize(text: string | null | undefined): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/** 0–100 token-overlap of requested competencies against the person profile. */
function competencyScore(person: Person, requested: string | undefined): number {
  const req = tokenize(requested);
  if (req.size === 0) return 100; // no requirement → neutral full score
  const profile = tokenize(
    [person.jobTitle, person.department, person.notes].filter(Boolean).join(' '),
  );
  if (profile.size === 0) return 0;
  let hits = 0;
  for (const t of req) if (profile.has(t)) hits += 1;
  return Math.round((hits / req.size) * 100);
}

/* ───────────────────── new-demand simulator ──────────────────── */

/**
 * Ranks candidates for a new demand by availability, cost fit, competency
 * and conflict (spec §17). Pure computation over live data.
 */
export async function simulateDemand(input: DemandSimulationInput): Promise<DemandCandidate[]> {
  const [start] = monthBounds(input.startMonth);
  const [, end] = monthBounds(input.endMonth);

  const [people, allocations, snapshots] = await Promise.all([
    listPeople({ status: 'active' }),
    listLiveAllocationsInPeriod(start, end),
    listSnapshots(input.startMonth).catch(() => []),
  ]);

  const snapshotByPerson = new Map(snapshots.map((s) => [s.personId, s]));

  // months in the requested window
  const months: string[] = [];
  for (let m = input.startMonth; m <= input.endMonth; m = addMonths(m, 1)) {
    months.push(m);
    if (months.length > 36) break; // guard
  }

  const candidates: DemandCandidate[] = [];
  for (const person of people) {
    if (input.department && person.department !== input.department) continue;

    // minimum availability across the window
    let minAvailable = 100;
    for (const month of months) {
      const committed = committedPct(allocations, person.id, month);
      minAvailable = Math.min(minAvailable, 100 - committed);
    }

    const fits = minAvailable >= input.neededPercentage;
    const conflict = minAvailable < 0 ? 'overloaded' : fits ? 'none' : 'partial';

    const snap = snapshotByPerson.get(person.id);
    const estimatedMonthlyCostCents = snap
      ? Math.round(snap.loadedMonthlyCostCents * (input.neededPercentage / 100))
      : null;

    const comp = competencyScore(person, input.competencies);

    // cost fit factor (0..1): 1 if within budget or no budget/known cost
    let costFactor = 1;
    if (input.maxMonthlyCostCents && estimatedMonthlyCostCents) {
      costFactor = estimatedMonthlyCostCents <= input.maxMonthlyCostCents
        ? 1
        : Math.max(0, input.maxMonthlyCostCents / estimatedMonthlyCostCents);
    }

    // availability factor (0..1)
    const availFactor = Math.max(0, Math.min(1, minAvailable / Math.max(input.neededPercentage, 1)));

    const compatibility = Math.round(
      (0.45 * availFactor + 0.35 * (comp / 100) + 0.2 * costFactor) * 100,
    );

    const reasons: string[] = [];
    reasons.push(fits ? `${minAvailable.toFixed(0)}% disponível no período` : `Apenas ${minAvailable.toFixed(0)}% livre (necessário ${input.neededPercentage}%)`);
    if (input.competencies) reasons.push(`Aderência de competência ${comp}%`);
    if (input.maxMonthlyCostCents && estimatedMonthlyCostCents && estimatedMonthlyCostCents > input.maxMonthlyCostCents) {
      reasons.push('Custo acima do teto');
    }
    if (conflict === 'overloaded') reasons.push('Já sobrealocado no período');

    candidates.push({
      person,
      availablePct: minAvailable,
      estimatedMonthlyCostCents,
      competencyScore: comp,
      conflict,
      compatibility,
      reasons,
    });
  }

  return candidates.sort((a, b) => b.compatibility - a.compatibility).slice(0, 20);
}

/* ───────────────────── capacity forecast ─────────────────────── */

/** Forecast of committed FTE vs capacity for the next `months` months. */
export async function forecastCapacity(monthsAhead = 6): Promise<CapacityForecastPoint[]> {
  const base = currentMonth();
  const [start] = monthBounds(base);
  const [, end] = monthBounds(addMonths(base, monthsAhead - 1));

  const [people, allocations] = await Promise.all([
    listPeople({ status: 'active' }),
    listLiveAllocationsInPeriod(start, end),
  ]);

  const points: CapacityForecastPoint[] = [];
  for (let i = 0; i < monthsAhead; i++) {
    const month = addMonths(base, i);
    let demandPct = 0;
    let overloaded = 0;
    let idle = 0;
    for (const person of people) {
      const pct = committedPct(allocations, person.id, month);
      demandPct += pct;
      if (pct > 100) overloaded += 1;
      if (pct === 0) idle += 1;
    }
    points.push({
      month,
      demandFte: demandPct / 100,
      capacityFte: people.length,
      overloadedCount: overloaded,
      idleCount: idle,
    });
  }
  return points;
}

/* ───────────────────── summary (for AI) ──────────────────────── */

export async function buildIntelligenceSummary(): Promise<WorkforceIntelligenceSummary> {
  const month = currentMonth();
  const [start, end] = monthBounds(month);
  const [people, allocations, forecast] = await Promise.all([
    listPeople({ status: 'active' }),
    listLiveAllocationsInPeriod(start, end),
    forecastCapacity(6),
  ]);

  const rows = people.map((p) => ({
    personId: p.id,
    name: p.fullName,
    totalPct: committedPct(allocations, p.id, month),
  }));

  return {
    month,
    headcount: people.length,
    fteDemand: rows.reduce((s, r) => s + r.totalPct, 0) / 100,
    overloaded: rows.filter((r) => r.totalPct > 100).sort((a, b) => b.totalPct - a.totalPct),
    idle: rows.filter((r) => r.totalPct === 0),
    forecast,
  };
}
