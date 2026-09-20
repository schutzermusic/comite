/**
 * Payload do dashboard para organização AO VIVO.
 *
 * Só afirma o que dá para ler de projetos + valor contratual vinculado +
 * riscos/deliberações reais. Sem mock de stream, votação ou fila demo.
 */

import type { Project } from '@/lib/types';
import type { DeliberationItem } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';
import type {
  DashboardLiveEvent,
  DashboardLiveEventSeverity,
  DashboardPayload,
} from '@/lib/dashboard-data';
import { resolveProjectContractValue } from '@/lib/projects/contract/project-contract-service';
import type { ExtendedRisk } from '@/components/risks/risk-types';

const OPEN_RISK = new Set(['open', 'mitigating']);
const LIVE_DELIBERATION = new Set([
  'submitted',
  'in_review',
  'in_voting',
  'awaiting_minutes',
  'in_execution',
  'returned_for_revision',
]);

const MAX_EVENTS = 24;

function formatClock(isoOrDate: string | Date | undefined | null): { clock: string; occurredAt: number } {
  const d = isoOrDate instanceof Date
    ? isoOrDate
    : isoOrDate
      ? new Date(isoOrDate)
      : new Date(NaN);
  if (Number.isNaN(d.getTime())) {
    return { clock: '—', occurredAt: 0 };
  }
  return {
    clock: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    occurredAt: d.getTime(),
  };
}

function riskSeverity(sev: string | undefined): DashboardLiveEventSeverity {
  if (sev === 'critical') return 'critical';
  if (sev === 'high') return 'warning';
  if (sev === 'low') return 'info';
  return 'info';
}

function deliberationSeverity(
  status: DeliberationItem['deliberationStatus'],
  priority: DeliberationItem['priority'] | null | undefined,
): DashboardLiveEventSeverity {
  if (status === 'in_voting' || priority === 'critical' || priority === 'high') return 'warning';
  if (status === 'returned_for_revision') return 'critical';
  return 'info';
}

export function buildLiveEventStream(input: {
  risks?: readonly ExtendedRisk[];
  deliberations?: readonly DeliberationItem[];
  projects?: readonly Project[];
  projectsV2?: readonly ProjectV2[];
}): DashboardLiveEvent[] {
  const events: DashboardLiveEvent[] = [];
  const seen = new Set<string>();

  for (const risk of input.risks ?? []) {
    if (!OPEN_RISK.has(risk.status)) continue;
    const id = `risk:${risk.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const { clock, occurredAt } = formatClock(risk.updatedAt ?? risk.createdAt);
    events.push({
      id,
      type: 'riscos',
      severity: riskSeverity(risk.severity),
      label: risk.title,
      timestamp: clock,
      href: `/riscos?id=${encodeURIComponent(risk.id)}`,
      occurredAt,
    });
  }

  // Riscos embutidos no project_v2 — só se ainda não vieram da tabela governada.
  for (const project of input.projectsV2 ?? []) {
    for (const risk of project.risks ?? []) {
      if (!OPEN_RISK.has(risk.status)) continue;
      const id = `risk:${risk.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const { clock, occurredAt } = formatClock(risk.updatedAt ?? risk.createdAt);
      events.push({
        id,
        type: 'riscos',
        severity: riskSeverity(risk.severity),
        label: `${risk.title} · ${project.nome || project.codigo || 'Projeto'}`,
        timestamp: clock,
        href: `/projetos/${encodeURIComponent(project.id)}?tab=riscos`,
        occurredAt,
      });
    }
  }

  for (const d of input.deliberations ?? []) {
    if (!LIVE_DELIBERATION.has(d.deliberationStatus)) continue;
    const id = `delib:${d.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const { clock, occurredAt } = formatClock(d.updatedAt ?? d.createdAt);
    events.push({
      id,
      type: 'decisoes',
      severity: deliberationSeverity(d.deliberationStatus, d.priority),
      label: d.title,
      timestamp: clock,
      href: `/deliberacoes/${encodeURIComponent(d.id)}`,
      occurredAt,
    });
  }

  // Marcos atrasados — sinal operacional real, não inventado.
  for (const project of input.projectsV2 ?? []) {
    for (const ms of project.milestones ?? []) {
      if (ms.status !== 'overdue') continue;
      const id = `ms:${project.id}:${ms.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const { clock, occurredAt } = formatClock(ms.date);
      events.push({
        id,
        type: 'projetos',
        severity: 'warning',
        label: `Marco atrasado: ${ms.name} · ${project.nome || project.codigo || 'Projeto'}`,
        timestamp: clock,
        href: `/projetos/${encodeURIComponent(project.id)}`,
        occurredAt: occurredAt || Date.now(),
      });
    }
  }

  return events
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .slice(0, MAX_EVENTS);
}

export function buildLiveDashboardPayload(
  projects: readonly Project[],
  projectsV2: readonly ProjectV2[],
  contractValues: ReadonlyMap<string, number>,
  extras: {
    risks?: readonly ExtendedRisk[];
    deliberations?: readonly DeliberationItem[];
  } = {},
): DashboardPayload {
  const v2ById = new Map(projectsV2.map((p) => [p.id, p]));

  let activeValue = 0;
  let realizedValue = 0;
  let active = 0;
  let atRisk = 0;
  let completed = 0;
  let openHighRisks = 0;
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const p of projects) {
    const value = resolveProjectContractValue(p.id, p.valor_total, contractValues);
    activeValue += value;
    realizedValue += Math.max(0, p.valor_executado || 0);

    if (p.status === 'concluido') completed += 1;
    else if (p.status !== 'cancelado') active += 1;

    const v2 = v2ById.get(p.id);
    const risks = (v2?.risks ?? []).filter((r) => r.status !== 'resolved');
    const highRisks = risks.filter((r) => r.severity === 'high' || r.severity === 'critical');
    openHighRisks += highRisks.length;
    critical += risks.filter((r) => r.severity === 'critical').length;
    high += risks.filter((r) => r.severity === 'high').length;
    medium += risks.filter((r) => r.severity === 'medium').length;
    low += risks.filter((r) => r.severity === 'low').length;

    if (
      highRisks.length > 0
      || p.impacto_financeiro === 'alto'
      || p.impacto_financeiro === 'critico'
    ) {
      atRisk += 1;
    }
  }

  // Preferir contagem da tabela governada de riscos quando disponível.
  if (extras.risks && extras.risks.length > 0) {
    const open = extras.risks.filter((r) => OPEN_RISK.has(r.status));
    critical = open.filter((r) => r.severity === 'critical').length;
    high = open.filter((r) => r.severity === 'high').length;
    medium = open.filter((r) => r.severity === 'medium').length;
    low = open.filter((r) => r.severity === 'low').length;
    openHighRisks = critical + high;
  }

  const liveDeliberations = (extras.deliberations ?? []).filter((d) => LIVE_DELIBERATION.has(d.deliberationStatus));
  const pendingVotes = liveDeliberations.filter((d) => d.deliberationStatus === 'in_voting').length;
  const endingIn72h = liveDeliberations.filter((d) => {
    const endRaw = d.votingClosedAt ?? d.dueDate;
    if (!endRaw) return false;
    const end = endRaw instanceof Date ? endRaw : new Date(endRaw);
    if (Number.isNaN(end.getTime())) return false;
    const ms = end.getTime() - Date.now();
    return ms >= 0 && ms <= 72 * 60 * 60 * 1000;
  }).length;

  const projectCount = projects.length;
  const healthFromRisks = projectCount === 0
    ? 0
    : Math.max(22, Math.min(96, Math.round(100 - (openHighRisks / Math.max(1, projectCount * 3)) * 100)));

  const budgetUtilization = activeValue > 0
    ? Math.round((realizedValue / activeValue) * 100)
    : 0;

  return {
    healthMetrics: {
      overallHealth: healthFromRisks,
      boardCycleHealth: 0,
      packageReadiness: 0,
      complianceScore: 0,
      decisionVelocity: 0,
      trend: 'stable',
    },
    decisionQueue: [],
    votingStatus: {
      approved: 0,
      rejected: 0,
      pending: pendingVotes,
      endingIn72h,
      averageParticipation: 0,
    },
    riskSummary: {
      total: openHighRisks,
      critical,
      high,
      medium,
      low,
      newThisCycle: 0,
      resolvedThisCycle: 0,
      categories: [],
      riskDimensions: [],
    },
    cycleSummary: {
      currentCycle: '—',
      startDate: new Date(),
      endDate: new Date(),
      daysRemaining: 0,
      completionRate: 0,
      meetingsHeld: 0,
      meetingsScheduled: 0,
      decisionsRequired: 0,
      decisionsCompleted: 0,
    },
    strategicInitiatives: [],
    performanceMetrics: {
      decisionsThisCycle: 0,
      decisionsLastCycle: 0,
      avgDecisionTime: 0,
      avgDecisionTimeTrend: 0,
      memberEngagement: 0,
      documentCompleteness: 0,
      auditReadiness: 0,
      sparklineData: {
        decisions: [],
        engagement: [],
        compliance: [],
      },
    },
    financialOverview: {
      portfolioValue: activeValue,
      currency: 'BRL',
      monthlyChange: 0,
      ytdChange: 0,
      projectsUnderGovernance: projectCount,
      budgetUtilization,
      portfolioTrend: [activeValue],
    },
    portfolioMetrics: {
      activeValue,
      activeValueTrend: [activeValue],
      activeValueDelta: 0,
      realizedValue,
      realizedValueTrend: 0,
      currency: 'BRL',
    },
    brazilProjectsMap: {
      nodes: [],
      summary: { active, atRisk, completed },
    },
    eventStream: buildLiveEventStream({
      risks: extras.risks,
      deliberations: extras.deliberations,
      projects,
      projectsV2,
    }),
    lastUpdated: new Date(),
  };
}
