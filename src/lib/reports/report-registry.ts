/**
 * Module report registry — one place that maps each module to its report
 * builder, title, filename context and the RBAC permission required to export.
 *
 * Pages can import the builder directly (typed payloads) — the registry exists
 * for discoverability, RBAC lookup and any future global "Exportar PDF" surface.
 * Each `permission` falls back to the module's view permission when no dedicated
 * `*.export` key exists (see src/lib/auth/permissions.ts).
 */

import type { ReportModuleKey } from './report-types';

export interface ReportRegistryEntry {
  /** Human title shown in any report picker. */
  title: string;
  subtitle: string;
  /** Filename context segment (module + this → {module}-report-{context}-{date}). */
  fileContext?: string;
  /** RBAC permission required to export (export key, else view key). */
  permission: string;
  /** Dotted import path of the builder (documentation / lazy loading). */
  builder: string;
  /** Phase 2 placeholder — builder wired but module content pending. */
  pending?: boolean;
  /**
   * Additional reports belonging to the same module.
   *
   * A module is not one report. Pessoas & Custos alone answers to the board
   * (cockpit), to the accountant (folha e encargos), to an audit (cobertura do
   * eSocial) and to occupational-safety compliance (SST) — four documents with
   * different readers and different permissions. Modelling them as variants
   * keeps `ReportModuleKey` about MODULES and stops the key list from turning
   * into a report list.
   */
  variants?: ReportVariant[];
}

export interface ReportVariant {
  /** Filename context segment — must be unique within the module. */
  fileContext: string;
  title: string;
  subtitle: string;
  permission: string;
  builder: string;
}

export const reportRegistry: Record<ReportModuleKey, ReportRegistryEntry> = {
  financeiro: {
    title: 'Financeiro',
    subtitle: 'Sala Financeira Executiva, DRE e Análise de Custos',
    permission: 'finance.export',
    builder: '@/lib/reports/modules/finance-control-room-report#openFinanceControlRoomReport',
  },
  projeto: {
    title: 'Projeto — Financeiro / Investidor',
    subtitle: 'Relatório financeiro do projeto (Curva S, eventograma, resultado)',
    permission: 'projects.export',
    builder: '@/lib/projects/export-project-finance-report#openProjectFinanceReport',
  },
  agenda: {
    title: 'Agenda & Tarefas',
    subtitle: 'Reuniões, tarefas, prazos e pendências por responsável',
    permission: 'meetings.view',
    builder: '@/lib/reports/modules/agenda-report#openAgendaReport',
  },
  deliberacoes: {
    title: 'Deliberações',
    subtitle: 'Governança de decisões, comitês e follow-ups',
    permission: 'deliberations.export',
    builder: '@/lib/reports/modules/deliberation-report#openDeliberationReport',
  },
  riscos: {
    title: 'Riscos',
    subtitle: 'Matriz 5×5, severidade, exposição e pipeline de mitigação',
    permission: 'risks.export',
    builder: '@/lib/reports/modules/risk-report#openRiskReport',
  },
  contratos: {
    title: 'Contratos',
    subtitle: 'Carteira, renovações, obrigações e exposição',
    permission: 'contracts.export',
    builder: '@/lib/reports/modules/contract-report#openContractReport',
  },
  'pessoas-custos': {
    title: 'Pessoas & Custos',
    subtitle: 'Headcount, folha, concentração de custos e risco de folha',
    permission: 'people.view_costs',
    builder: '@/lib/workforce/export-report#openWorkforceReport',
    variants: [
      {
        fileContext: 'folha-encargos',
        title: 'Folha & Encargos',
        subtitle: 'Massa salarial, INSS/FGTS/IRRF, custo por lotação e variação salarial',
        permission: 'people.cost_view',
        builder: '@/lib/reports/modules/payroll-cost-report#openPayrollCostReport',
      },
      {
        fileContext: 'esocial',
        title: 'Controle eSocial',
        subtitle: 'Cobertura do acervo, competências faltantes, mapeamentos pendentes e divergências',
        permission: 'people.view',
        builder: '@/lib/reports/modules/esocial-coverage-report#openEsocialCoverageReport',
      },
      {
        fileContext: 'sst',
        title: 'SST / ASO & CAT',
        subtitle: 'Acidentes (S-2210), saúde ocupacional (S-2220) e agentes nocivos (S-2240)',
        permission: 'people.view',
        builder: '@/lib/reports/modules/sst-report#openSstReport',
      },
    ],
  },
  organograma: {
    title: 'Organograma',
    subtitle: 'Estrutura organizacional, liderança e distribuição por área',
    permission: 'org_chart.export',
    builder: '@/lib/reports/modules/orgchart-report#openOrgChartReport',
  },
};
