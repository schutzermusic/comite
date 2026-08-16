/**
 * Dev-only headless preview harness for the PDF report builders.
 *
 * The builders are pure `build*Html(payload) → string` functions, so this
 * script renders them in node with synthetic payloads, writes the HTML to an
 * output dir and (when Chrome is available) prints each to PDF for visual QA:
 *
 *   npx tsx scripts/preview-reports.ts [outDir]
 *
 * Not wired into CI — quality inspection only. Fonts/logo are rewritten to
 * local file:// URLs so the headless render matches the in-app print window.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Contract, Project } from '@/lib/types';
import { enrichContractsForGovernance } from '@/components/contracts/contract-governance-data';
import { buildContractReportHtml } from '@/lib/reports/modules/contract-report';
import { DEMO_RISKS } from '@/components/risks/risk-demo-data';
import { buildRiskReportHtml } from '@/lib/reports/modules/risk-report';
import { buildWorkforceOverviewPdfHtml } from '@/lib/reports/modules/workforce-overview-report';
import { buildWorkforceOverviewModel } from '@/lib/workforce/overview/model';
import { EMPTY_ESOCIAL_LINK } from '@/lib/workforce/compliance';
import {
  WORKFORCE_DEMO_SERIES,
  WORKFORCE_SPARSE_SERIES,
} from './fixtures/workforce-demo-series';
import { buildProjectOverviewReportHtml, type ProjectOverviewPayload } from '@/lib/reports/modules/project-overview-report';
import { buildFinanceControlRoomReportHtml } from '@/lib/reports/modules/finance-control-room-report';
import { buildDeliberationReportHtml } from '@/lib/reports/modules/deliberation-report';
import { buildOrgChartReportHtml } from '@/lib/reports/modules/orgchart-report';
import { buildProjectPortfolioReport } from '@/components/portfolio/ProjectPdfExportTemplate';
import type { DeliberationItem, OrgMember } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';

const ROOT = resolve(__dirname, '..');
const outDir = resolve(process.argv[2] ?? resolve(ROOT, '.report-previews'));
mkdirSync(outDir, { recursive: true });

/* ── Synthetic payloads ── */

const COMPANIES = [
  'Construtora Andrade Ltda', 'Energia Vale Verde S.A.', 'TechServ Manutenção',
  'Logística Horizonte', 'Engenharia Prisma', 'Grupo Sertão Solar',
];

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

const projects: Project[] = Array.from({ length: 4 }, (_, i) => ({
  id: `prj-${i + 1}`,
  codigo: `PRJ-20${26 + (i % 2)}-${String(i + 1).padStart(3, '0')}`,
  nome: `Projeto ${['Alfa', 'Beta', 'Gama', 'Delta'][i]}`,
  status: 'em_andamento',
} as unknown as Project));

const contracts: Contract[] = Array.from({ length: 18 }, (_, i) => {
  const value = 250_000 + ((i * 7919) % 13) * 480_000;
  const expDays = [-20, 12, 25, 45, 80, 120, 200, 340, 500][i % 9];
  return {
    id: `ctr-${i + 1}`,
    name: `Contrato ${String(i + 1).padStart(2, '0')} — ${['Serviços', 'Fornecimento', 'O&M', 'EPC'][i % 4]}`,
    vendorOrParty: COMPANIES[i % COMPANIES.length],
    value,
    currency: 'BRL',
    signingDate: daysFromNow(-300 - i * 10),
    expirationDate: i % 7 === 6 ? undefined : daysFromNow(expDays),
    fileUrl: '',
    riskClassification: (['low', 'medium', 'high'] as const)[(i * 5) % 3],
    status: i % 5 === 4 ? 'legal_review' : 'active',
    uploadedAt: daysFromNow(-200),
    projectId: i % 4 === 3 ? undefined : projects[i % projects.length].id,
  } as Contract;
});

/* ── Reports to render ── */

/**
 * O documento de Pessoas & Custos é montado a partir do MESMO modelo que
 * alimenta a tela — é isso que garante que o preview mostre o que o usuário
 * veria, e não uma segunda montagem só do harness.
 */
function workforceModel(series: Parameters<typeof buildWorkforceOverviewModel>[0]['rawSeries']) {
  return buildWorkforceOverviewModel({
    period: { key: 'current-year' },
    comparison: 'previous-period',
    rawSeries: series,
    approvedBatches: [],
    esocialLink: EMPTY_ESOCIAL_LINK,
    generatedAt: '2026-07-01T12:00:00.000Z',
  });
}

const reports: { name: string; html: () => string }[] = [
  {
    name: 'contratos-portfolio',
    html: () => buildContractReportHtml({
      records: enrichContractsForGovernance(contracts, projects),
      periodLabel: 'Carteira ativa',
      filtersLabel: 'Todos os contratos',
      source: 'Preview sintético (harness)',
      generatedBy: 'preview-reports.ts',
    }),
  },
  {
    name: 'riscos',
    html: () => buildRiskReportHtml({
      risks: DEMO_RISKS,
      periodLabel: 'Carteira ativa',
      source: 'Demonstração (harness)',
      generatedBy: 'preview-reports.ts',
    }),
  },
  // Três entradas de propósito: os dois temas do documento, mais o caso de
  // série incompleta — que é onde se revisa se a ausência está desenhada como
  // ausência e não como zero.
  {
    name: 'pessoas-custos',
    html: () => buildWorkforceOverviewPdfHtml(workforceModel(WORKFORCE_DEMO_SERIES), { theme: 'dark' }),
  },
  {
    name: 'pessoas-custos-claro',
    html: () => buildWorkforceOverviewPdfHtml(workforceModel(WORKFORCE_DEMO_SERIES), { theme: 'light' }),
  },
  {
    name: 'pessoas-custos-sem-apuracao',
    html: () => buildWorkforceOverviewPdfHtml(workforceModel(WORKFORCE_SPARSE_SERIES), { theme: 'light' }),
  },
  {
    name: 'projeto-overview',
    html: () => {
      const money = (n: number) => ({ amountCents: n * 100, currency: 'BRL' });
      const payload: ProjectOverviewPayload = {
        name: 'UFV Sertão Solar 42MWp',
        code: 'PRJ-2026-001',
        client: 'Grupo Sertão Solar',
        status: 'em_andamento',
        statusLabel: 'Em andamento',
        responsible: 'PMO Corporativo',
        startDate: '2026-01-15',
        endDate: '2027-03-30',
        progressPercent: 58,
        healthScore: 64,
        healthReasons: ['2 marcos atrasados no trimestre', 'Custo projetado 4,2% acima do BAC', 'Equipe principal 95% alocada'],
        revenue: { totalContracted: money(18_400_000), billed: money(9_700_000), toBill: money(8_700_000) },
        finance: { bac: money(14_100_000), ac: money(8_900_000), eac: money(14_690_000), variancePercent: 4.2 },
        milestones: Array.from({ length: 8 }, (_, i) => ({
          id: `ms-${i}`,
          name: ['Mobilização', 'Fundações', 'Montagem trackers', 'Módulos 50%', 'SE unitária', 'Comissionamento', 'TAC', 'COD'][i],
          date: daysFromNow(-60 + i * 55).toISOString().slice(0, 10),
          status: (i < 2 ? 'completed' : i === 2 ? 'overdue' : 'pending') as 'completed' | 'overdue' | 'pending',
        })),
        risks: Array.from({ length: 6 }, (_, i) => ({
          id: `rk-${i}`,
          title: ['Atraso de módulos importados', 'Chuvas acima da média', 'Reajuste cambial', 'Licença de operação', 'Interface com concessionária', 'Turnover da montadora'][i],
          severity: (['critical', 'high', 'high', 'medium', 'medium', 'low'] as const)[i],
          level: 20 - i * 3,
          status: (i === 5 ? 'resolved' : i % 2 ? 'mitigating' : 'open') as 'open' | 'mitigating' | 'resolved',
          ownerName: ['Suprimentos', 'Engenharia', 'Financeiro', 'Jurídico', 'Engenharia', 'PMO'][i],
          exposure: money(1_800_000 - i * 250_000),
        })) as ProjectOverviewPayload['risks'],
        tasks: [],
        documents: [],
        allocations: [
          { memberName: 'A. Ribeiro', role: 'Gerente de projeto', allocationPercent: 100 },
          { memberName: 'C. Nunes', role: 'Eng. eletricista', allocationPercent: 110 },
          { memberName: 'M. Duarte', role: 'Planejamento', allocationPercent: 80 },
        ],
        source: 'Preview sintético (harness)',
        generatedBy: 'preview-reports.ts',
      };
      return buildProjectOverviewReportHtml(payload);
    },
  },
  {
    name: 'financeiro-control-room',
    html: () => buildFinanceControlRoomReportHtml({
      periodLabel: 'Julho/2026',
      scenarioLabel: 'Base',
      source: 'demonstração',
      generatedBy: 'preview-reports.ts',
      healthScore: 72,
      netRevenue: 4_820_000_00,
      ebitda: 1_260_000_00,
      ebitdaMargin: 26.1,
      operatingResult: 940_000_00,
      forecastGap: -180_000_00,
      cashRisk: 320_000_00,
      pendingActions: 3,
      dreRows: [
        { label: 'Receita líquida', actual: 4_820_000_00, budget: 5_000_000_00, forecast: 4_950_000_00 },
        { label: 'Custos diretos', actual: -2_610_000_00, budget: -2_700_000_00, forecast: -2_680_000_00 },
        { label: 'OPEX', actual: -950_000_00, budget: -900_000_00, forecast: -940_000_00 },
        { label: 'EBITDA', actual: 1_260_000_00, budget: 1_400_000_00, forecast: 1_330_000_00 },
        { label: 'Resultado operacional', actual: 940_000_00, budget: 1_050_000_00, forecast: 990_000_00 },
      ],
      drivers: Array.from({ length: 8 }, (_, i) => ({
        categoryName: ['Mão de obra', 'Fretes', 'Materiais', 'Serviços terceiros', 'Energia', 'Seguros', 'TI', 'Viagens'][i],
        groupLabel: i < 4 ? 'Custos diretos' : 'OPEX',
        projectName: i % 3 === 0 ? 'PRJ-2026-001' : undefined,
        actual: (300_000 - i * 20_000) * 100,
        budget: (280_000 - i * 22_000) * 100,
        varianceAbs: ((i % 2 ? 1 : -1) * (90_000 - i * 9_000)) * 100,
        variancePct: (i % 2 ? 1 : -1) * (12 - i),
      })),
    }),
  },
  {
    name: 'deliberacoes',
    html: () => {
      const statuses = ['in_voting', 'resolved', 'in_execution', 'submitted', 'in_review', 'awaiting_minutes', 'closed', 'returned_for_revision'] as const;
      const committees = ['Comitê Executivo', 'Comitê de Investimentos', 'Comitê de Riscos', 'Comitê de Auditoria'];
      const items: DeliberationItem[] = Array.from({ length: 14 }, (_, i) => ({
        id: `del-${i + 1}`,
        title: `Deliberação ${String(i + 1).padStart(2, '0')} — ${['Aprovação de CAPEX', 'Renovação contratual', 'Política de crédito', 'Expansão regional'][i % 4]}`,
        description: 'Preview sintético.',
        status: 'approved',
        type: 'Financial',
        createdBy: 'u1',
        createdByName: 'Conselho',
        createdAt: daysFromNow(-30 - i * 12),
        updatedAt: daysFromNow(-5),
        priority: (['low', 'medium', 'high', 'critical'] as const)[i % 4],
        deliberationStatus: statuses[i % statuses.length],
        ownerCommitteeName: committees[i % committees.length],
        financialImpact: 250_000 + ((i * 7451) % 9) * 380_000,
        dueDate: daysFromNow(-10 + i * 9),
        resolvedAt: i % 3 === 0 ? daysFromNow(-8 - i * 4) : undefined,
        executionItems: i % 2 === 0 ? [
          {
            id: `act-${i}-1`,
            title: `Follow-up ${i + 1}.1 — formalizar decisão`,
            ownerName: ['Jurídico', 'Financeiro', 'PMO'][i % 3],
            dueDate: daysFromNow(-4 + i * 6),
            status: (i % 4 === 0 ? 'completed' : 'in_progress') as 'completed' | 'in_progress',
            linkedEntityType: i % 3 === 0 ? 'contract' : undefined,
          },
        ] : [],
      } as unknown as DeliberationItem));
      return buildDeliberationReportHtml({
        deliberations: items,
        periodLabel: 'Carteira ativa',
        source: 'Preview sintético (harness)',
        generatedBy: 'preview-reports.ts',
      });
    },
  },
  {
    name: 'organograma',
    html: () => {
      const depts = ['Diretoria', 'Engenharia', 'Operações', 'Financeiro', 'Jurídico', 'Pessoas'];
      const members: OrgMember[] = [
        { id: 'm1', name: 'C. Almeida', role: 'CEO', department: 'Diretoria', email: 'ceo@x.com' },
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `d${i + 1}`,
          name: `Diretor(a) ${['Eng.', 'Ops.', 'Fin.', 'Jur.', 'Pessoas'][i]}`,
          role: `Diretor ${depts[i + 1]}`,
          department: depts[i + 1],
          email: `d${i}@x.com`,
          managerId: 'm1',
        })),
        ...Array.from({ length: 18 }, (_, i) => ({
          id: `p${i + 1}`,
          name: i === 7 ? 'VAGA — Analista Sênior' : `Colaborador ${String(i + 1).padStart(2, '0')}`,
          role: ['Engenheiro', 'Analista', 'Coordenador', 'Especialista'][i % 4],
          department: depts[1 + (i % 5)],
          email: `p${i}@x.com`,
          managerId: `d${(i % 5) + 1}`,
        })),
      ];
      return buildOrgChartReportHtml({
        members,
        source: 'Preview sintético (harness)',
        generatedBy: 'preview-reports.ts',
      });
    },
  },
  {
    name: 'projetos-portfolio',
    html: () => {
      const statuses = ['em_andamento', 'em_andamento', 'concluido', 'planejamento', 'pausado'];
      const impacts = ['critico', 'alto', 'medio', 'baixo'];
      const legacyProjects = Array.from({ length: 12 }, (_, i) => ({
        id: `lp-${i + 1}`,
        codigo: `PRJ-2026-${String(i + 1).padStart(3, '0')}`,
        nome: `Projeto ${['Alfa', 'Beta', 'Gama', 'Delta', 'Épsilon', 'Zeta'][i % 6]} ${i + 1}`,
        cliente: COMPANIES[i % COMPANIES.length],
        status: statuses[i % statuses.length],
        valor_total: 900_000 + ((i * 6997) % 11) * 1_400_000,
        progresso_percentual: (i * 17) % 100,
        impacto_financeiro: impacts[i % impacts.length],
        comite_nome: ['Comitê Executivo', 'Comitê de Investimentos'][i % 2],
        responsavel: { nome: `Gestor ${i + 1}` },
      }));
      const v2Map = new Map<string, ProjectV2>(legacyProjects.map((p, i) => [p.id, {
        id: p.id,
        health_score: 35 + ((i * 13) % 60),
        risks: i % 3 === 0 ? [{ id: `r${i}`, title: 'Risco', severity: 'high', status: 'open', level: 12 }] : [],
        tasks: [],
      } as unknown as ProjectV2]));
      return buildProjectPortfolioReport({
        projects: legacyProjects as unknown as Parameters<typeof buildProjectPortfolioReport>[0]['projects'],
        v2Map,
        mode: 'executive',
        generatedBy: 'preview-reports.ts',
      });
    },
  },
];

/* ── Local asset rewiring (node has no window.origin) ── */

function localizeAssets(html: string): string {
  const fontFace = [400, 600, 700, 800]
    .map((w) => {
      const file = { 400: 'Gilroy-Regular', 600: 'Gilroy-SemiBold', 700: 'Gilroy-Bold', 800: 'Gilroy-ExtraBold' }[w];
      return `@font-face { font-family: 'Gilroy'; font-weight: ${w}; src: url('file://${ROOT}/public/fonts/gilroy/${file}.ttf') format('truetype'); }`;
    })
    .join('\n');
  return html
    .replace('<style>', `<style>\n${fontFace}`)
    .replaceAll('src="/LOGO%20INSIGHT.png"', `src="file://${ROOT}/public/LOGO INSIGHT.png"`);
}

/* ── Render + print ── */

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];
const chrome = CHROME_PATHS.find((p) => existsSync(p));

for (const r of reports) {
  const htmlPath = resolve(outDir, `${r.name}.html`);
  writeFileSync(htmlPath, localizeAssets(r.html()), 'utf8');
  console.log(`HTML  → ${htmlPath}`);
  if (chrome) {
    const pdfPath = resolve(outDir, `${r.name}.pdf`);
    execFileSync(chrome, [
      '--headless', '--disable-gpu', '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
    ], { stdio: 'pipe' });
    console.log(`PDF   → ${pdfPath}`);
  }
}
if (!chrome) console.log('Chrome não encontrado — apenas HTML gerado.');
