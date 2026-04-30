import type { Project } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { STATE_CENTROIDS } from '@/data/geo/brazil-operational-data';

export type GlobeHealthStatus = 'healthy' | 'attention' | 'critical';

export interface GlobeProjectRecord {
  id: string;
  name: string;
  stateUF: string;
  lat: number;
  lon: number;
  status: Project['status'];
  contractTotal: number;
  invoiced: number;
  toInvoice: number;
  riskCount: number;
  decisionCount: number;
  estimatedHeadcount: number;
  hasOperationalSignal: boolean;
  updatedAt: string;
  client?: string;
  code?: string;
  progressPercent?: number;
  type?: string;
}

export interface StateAggregate {
  uf: string;
  stateName: string;
  lat: number;
  lon: number;
  projectCount: number;
  contractTotal: number;
  invoiced: number;
  toInvoice: number;
  riskCount: number;
  decisionCount: number;
  liveEventCount: number;
  headcount: number;
  intensity: number;
  status: GlobeHealthStatus;
  lastUpdate: string;
  projects: GlobeProjectRecord[];
  monthlyInvoicing: Array<{ month: string; planned: number; actual: number }>;
  riskTrend: {
    sevenDays: number[];
    thirtyDays: number[];
  };
}

export interface HeatIntensityWeights {
  projectCount: number;
  contractTotal: number;
  riskCount: number;
}

export const HEAT_INTENSITY_WEIGHTS: HeatIntensityWeights = {
  projectCount: 0.35,
  contractTotal: 0.4,
  riskCount: 0.25,
};

const CLIENT_STATE_HINTS: Record<string, string> = {
  CEMIG: 'MG',
  PETROBRAS: 'RJ',
  ENEL: 'PE',
  EQUATORIAL: 'PA',
  CHESF: 'PE',
  CPFL: 'SP',
  EDP: 'ES',
  NEOENERGIA: 'BA',
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function hashString(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function fallbackUF(project: Project): string {
  const clientName = (project.cliente || '').toUpperCase();
  for (const [hint, uf] of Object.entries(CLIENT_STATE_HINTS)) {
    if (clientName.includes(hint)) return uf;
  }
  return 'SP';
}

function normalizeDate(input?: string): string {
  if (!input) return new Date().toISOString();
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function buildRiskCount(project: Project, v2?: ProjectV2): number {
  if (v2?.risks?.length) {
    return v2.risks.filter((risk) => risk.status !== 'resolved').length;
  }
  if (project.impacto_financeiro === 'critico') return 4;
  if (project.impacto_financeiro === 'alto') return 3;
  if (project.impacto_financeiro === 'medio') return 2;
  return 1;
}

function buildDecisionCount(v2?: ProjectV2): number {
  if (!v2?.governance) return 0;
  return (v2.governance.deliberation_ids?.length || 0) + (v2.governance.meeting_ids?.length || 0);
}

function estimateProjectHeadcount(contractTotal: number, riskCount: number, v2?: ProjectV2): number {
  const tasksSignal = v2?.tasks?.length ? Math.min(v2.tasks.length * 2.4, 42) : 0;
  const revenueSignal = Math.max(6, Math.min(58, contractTotal / 1_850_000));
  const riskSignal = riskCount * 1.2;
  return Math.max(4, Math.round(4 + tasksSignal + revenueSignal + riskSignal));
}

function buildStateUF(project: Project, v2?: ProjectV2): string {
  if (v2?.uf && STATE_CENTROIDS[v2.uf]) return v2.uf;
  const fallback = fallbackUF(project);
  return STATE_CENTROIDS[fallback] ? fallback : 'SP';
}

function buildCoordinates(projectId: string, uf: string, v2?: ProjectV2): { lat: number; lon: number } {
  if (typeof v2?.location?.lat === 'number' && typeof v2?.location?.lng === 'number') {
    return { lat: v2.location.lat, lon: v2.location.lng };
  }

  const centroid = STATE_CENTROIDS[uf] || STATE_CENTROIDS.SP;
  const hash = hashString(projectId);
  const latJitter = ((hash % 200) - 100) / 250;
  const lonJitter = (((hash / 3) % 200) - 100) / 250;
  return {
    lat: centroid.lat + latJitter,
    lon: centroid.lng + lonJitter,
  };
}

export function buildGlobeProjectRecords(projects: Project[], projectsV2: ProjectV2[]): GlobeProjectRecord[] {
  const v2ById = new Map<string, ProjectV2>();
  projectsV2.forEach((project) => {
    v2ById.set(project.id, project);
  });

  return projects.map((project) => {
    const v2 = v2ById.get(project.id);
    const stateUF = buildStateUF(project, v2);
    const coordinates = buildCoordinates(project.id, stateUF, v2);
    const contractTotal = Math.max(0, project.valor_total || 0);
    const invoiced = Math.max(0, project.valor_executado || 0);
    const riskCount = buildRiskCount(project, v2);
    const decisionCount = buildDecisionCount(v2);

    return {
      id: project.id,
      name: project.nome,
      stateUF,
      lat: coordinates.lat,
      lon: coordinates.lon,
      status: project.status,
      contractTotal,
      invoiced,
      toInvoice: Math.max(contractTotal - invoiced, 0),
      riskCount,
      decisionCount,
      estimatedHeadcount: estimateProjectHeadcount(contractTotal, riskCount, v2),
      hasOperationalSignal: Boolean(v2?.billing_eventogram?.length),
      updatedAt: normalizeDate(v2?.last_activity_at || project.created_date),
      client: project.cliente,
      code: project.codigo || project.codigoInterno,
      progressPercent: typeof project.progresso_percentual === 'number' ? project.progresso_percentual : undefined,
      type: project.tipo,
    };
  });
}

export function computeHeatIntensity(
  state: Pick<StateAggregate, 'projectCount' | 'contractTotal' | 'riskCount'>,
  baseline: {
    maxProjects: number;
    maxContractTotal: number;
    maxRiskCount: number;
  },
  weights: HeatIntensityWeights = HEAT_INTENSITY_WEIGHTS,
): number {
  const projectNorm = baseline.maxProjects > 0 ? state.projectCount / baseline.maxProjects : 0;
  const contractNorm = baseline.maxContractTotal > 0 ? state.contractTotal / baseline.maxContractTotal : 0;
  const riskNorm = baseline.maxRiskCount > 0 ? state.riskCount / baseline.maxRiskCount : 0;

  return clamp01(
    projectNorm * weights.projectCount
      + contractNorm * weights.contractTotal
      + riskNorm * weights.riskCount,
  );
}

function buildStatus(riskCount: number, projectCount: number, intensity: number): GlobeHealthStatus {
  if (riskCount >= Math.max(3, Math.ceil(projectCount * 0.8)) || intensity > 0.72) return 'critical';
  if (riskCount >= Math.max(1, Math.ceil(projectCount * 0.45)) || intensity > 0.42) return 'attention';
  return 'healthy';
}

function buildMonthlySeries(uf: string, total: number, invoiced: number): Array<{ month: string; planned: number; actual: number }> {
  const months = ['Set', 'Out', 'Nov', 'Dez', 'Jan', 'Fev'];
  const hash = hashString(uf);
  return months.map((month, index) => {
    const planFactor = 0.09 + index * 0.02;
    const jitter = ((hash + index * 17) % 12) / 100;
    const planned = total * (planFactor + jitter);
    const actualBase = invoiced * (0.08 + index * 0.018);
    const actual = actualBase * (0.92 + ((hash + index * 13) % 10) / 100);
    return {
      month,
      planned: Math.round(Math.max(planned, 0)),
      actual: Math.round(Math.max(actual, 0)),
    };
  });
}

function buildRiskTrend(uf: string, riskCount: number): { sevenDays: number[]; thirtyDays: number[] } {
  const seed = hashString(uf);
  const sevenDays = Array.from({ length: 7 }, (_, index) => {
    const wobble = ((seed + index * 7) % 3) - 1;
    return Math.max(riskCount + wobble, 0);
  });
  const thirtyDays = Array.from({ length: 6 }, (_, index) => {
    const wobble = ((seed + index * 11) % 5) - 2;
    return Math.max(riskCount + wobble, 0);
  });

  return { sevenDays, thirtyDays };
}

export function aggregateStateKpis(projects: GlobeProjectRecord[]): Record<string, StateAggregate> {
  const grouped = new Map<string, GlobeProjectRecord[]>();

  projects.forEach((project) => {
    const stateProjects = grouped.get(project.stateUF) || [];
    stateProjects.push(project);
    grouped.set(project.stateUF, stateProjects);
  });

  const preAggregates = Array.from(grouped.entries()).map(([uf, stateProjects]) => {
    const centroid = STATE_CENTROIDS[uf] || STATE_CENTROIDS.SP;
    const contractTotal = stateProjects.reduce((sum, project) => sum + project.contractTotal, 0);
    const invoiced = stateProjects.reduce((sum, project) => sum + project.invoiced, 0);
    const toInvoice = stateProjects.reduce((sum, project) => sum + project.toInvoice, 0);
    const riskCount = stateProjects.reduce((sum, project) => sum + project.riskCount, 0);
    const decisionCount = stateProjects.reduce((sum, project) => sum + project.decisionCount, 0);
    const liveEventCount = stateProjects.reduce(
      (sum, project) => sum + (project.hasOperationalSignal ? 1 : 0),
      0,
    );
    const headcount = stateProjects.reduce((sum, project) => sum + project.estimatedHeadcount, 0);
    const lastUpdate = stateProjects.reduce((latest, project) => {
      return latest > project.updatedAt ? latest : project.updatedAt;
    }, '1970-01-01T00:00:00.000Z');

    return {
      uf,
      stateName: centroid.name,
      lat: centroid.lat,
      lon: centroid.lng,
      projectCount: stateProjects.length,
      contractTotal,
      invoiced,
      toInvoice,
      riskCount,
      decisionCount,
      liveEventCount,
      headcount,
      intensity: 0,
      status: 'healthy' as GlobeHealthStatus,
      lastUpdate,
      projects: stateProjects.sort((a, b) => b.contractTotal - a.contractTotal),
      monthlyInvoicing: [],
      riskTrend: { sevenDays: [], thirtyDays: [] },
    };
  });

  const baseline = {
    maxProjects: Math.max(...preAggregates.map((state) => state.projectCount), 1),
    maxContractTotal: Math.max(...preAggregates.map((state) => state.contractTotal), 1),
    maxRiskCount: Math.max(...preAggregates.map((state) => state.riskCount), 1),
  };

  const output: Record<string, StateAggregate> = {};
  preAggregates.forEach((state) => {
    const intensity = computeHeatIntensity(state, baseline);
    output[state.uf] = {
      ...state,
      intensity,
      status: buildStatus(state.riskCount, state.projectCount, intensity),
      monthlyInvoicing: buildMonthlySeries(state.uf, state.contractTotal, state.invoiced),
      riskTrend: buildRiskTrend(state.uf, state.riskCount),
    };
  });

  return output;
}

export function getGlobalTotals(states: Record<string, StateAggregate>) {
  const entries = Object.values(states);
  return entries.reduce(
    (acc, state) => {
      acc.projectCount += state.projectCount;
      acc.contractTotal += state.contractTotal;
      acc.invoiced += state.invoiced;
      acc.toInvoice += state.toInvoice;
      acc.riskCount += state.riskCount;
      acc.decisionCount += state.decisionCount;
      return acc;
    },
    {
      projectCount: 0,
      contractTotal: 0,
      invoiced: 0,
      toInvoice: 0,
      riskCount: 0,
      decisionCount: 0,
    },
  );
}
