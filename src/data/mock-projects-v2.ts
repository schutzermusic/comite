/**
 * V2 Mock Projects — rich governance-grade sample data
 * Used as fallback when no v2 data exists in localStorage
 */

import type { ProjectV2, ProjectTaskV2, ProjectMilestone, ProjectRiskItem, ProjectDocument, ProjectFinance, ProjectAuditEvent, ProjectAllocationV2, ProjectRevenue, CostCurvePoint, RevenueCurvePoint, CostBreakdownItem } from '@/lib/types/project-v2';
import { makeMoney, centsFromReais } from '@/lib/utils/project-utils';

// ─── S-Curve Generator ───────────────────────────────────────────
// Generates a realistic S-curve (sigmoid distribution) for cumulative spend/billing
function generateSCurve(
    totalCents: number,
    months: number,
    progressPct: number, // 0-100, how far along we are (for AC line)
    startMonth: string,  // "YYYY-MM"
): number[] {
    const points: number[] = [];
    for (let i = 0; i <= months; i++) {
        // Logistic S-curve: steeper in middle
        const t = i / months;
        const s = 1 / (1 + Math.exp(-10 * (t - 0.5)));
        points.push(Math.round(totalCents * s));
    }
    return points;
}

function monthsRange(start: string, count: number): string[] {
    const result: string[] = [];
    const [y, m] = start.split('-').map(Number);
    for (let i = 0; i <= count; i++) {
        const month = ((m - 1 + i) % 12) + 1;
        const year = y + Math.floor((m - 1 + i) / 12);
        result.push(`${year}-${String(month).padStart(2, '0')}`);
    }
    return result;
}

function makeCostCurve(bac: number, ac: number, eac: number, startMonth: string, totalMonths: number, progressMonths: number): { points: CostCurvePoint[]; cutoffPeriod: string } {
    const periods = monthsRange(startMonth, totalMonths);
    const bacCurve = generateSCurve(centsFromReais(bac), totalMonths, 100, startMonth);
    const eacCurve = generateSCurve(centsFromReais(eac), totalMonths, 100, startMonth);
    // AC follows the plan up to progressMonths, then becomes null (line break)
    const acCurve = generateSCurve(centsFromReais(ac), progressMonths, 100, startMonth);
    const cutoffPeriod = periods[progressMonths] || periods[periods.length - 1];
    const points = periods.map((period, i) => ({
        period,
        bacCumulative: bacCurve[i] ?? bacCurve[bacCurve.length - 1],
        acCumulative: i <= progressMonths ? (acCurve[i] ?? acCurve[acCurve.length - 1]) : (null as unknown as number),
        eacCumulative: eacCurve[i] ?? eacCurve[eacCurve.length - 1],
    }));
    return { points, cutoffPeriod };
}

function makeRevenueCurve(planned: number, billed: number, received: number, startMonth: string, totalMonths: number, progressMonths: number): RevenueCurvePoint[] {
    const periods = monthsRange(startMonth, totalMonths);
    const plannedCurve = generateSCurve(centsFromReais(planned), totalMonths, 100, startMonth);
    const billedCurve = generateSCurve(centsFromReais(billed), progressMonths, 100, startMonth);
    const receivedCurve = generateSCurve(centsFromReais(received), progressMonths, 100, startMonth);
    return periods.map((period, i) => ({
        period,
        plannedCumulative: plannedCurve[i] ?? plannedCurve[plannedCurve.length - 1],
        billedCumulative: i <= progressMonths ? (billedCurve[i] ?? billedCurve[billedCurve.length - 1]) : (null as unknown as number),
        receivedCumulative: i <= progressMonths ? (receivedCurve[i] ?? receivedCurve[receivedCurve.length - 1]) : (null as unknown as number),
    }));
}

function makeBreakdown(bac: number): CostBreakdownItem[] {
    // Distribute across categories with deterministic, realistic ratios
    const ratios = [
        { category: 'Mão de Obra (HH)', pct: 0.45, varFactor: 1.05 },
        { category: 'Logística', pct: 0.08, varFactor: 0.98 },
        { category: 'Materiais', pct: 0.22, varFactor: 1.12 },
        { category: 'Subcontratos', pct: 0.12, varFactor: 1.03 },
        { category: 'Taxas/Impostos', pct: 0.06, varFactor: 1.00 },
        { category: 'Outros', pct: 0.07, varFactor: 0.95 },
    ];
    return ratios.map(({ category, pct, varFactor }) => {
        const bacVal = bac * pct;
        const acVal = bacVal * varFactor * 0.6; // ~60% spent
        const eacVal = bacVal * varFactor;       // projected total
        return {
            category,
            bac: makeMoney(bacVal),
            ac: makeMoney(acVal),
            eac: makeMoney(eacVal),
        };
    });
}

function makeRevenue(totalContracted: number, billedPct: number, receivedPct: number): ProjectRevenue {
    const billed = totalContracted * billedPct;
    const received = billed * receivedPct;
    return {
        totalContracted: makeMoney(totalContracted),
        billed: makeMoney(billed),
        received: makeMoney(received),
        toBill: makeMoney(totalContracted - billed),
        toReceive: makeMoney(billed - received),
        updatedAt: '2025-10-01T12:00:00Z',
    };
}

// ─── Sample Tasks ────────────────────────────────────────────────
const makeTasks = (projId: string): ProjectTaskV2[] => [
    {
        id: `${projId}-t1`,
        projectId: projId,
        name: 'Levantamento Topográfico',
        description: 'Topografia completa da área do projeto',
        startDate: '2025-06-01',
        endDate: '2025-06-30',
        baselineStart: '2025-06-01',
        baselineEnd: '2025-06-25',
        status: 'completed',
        responsibleName: 'Carlos Santos',
        progress: 100,
    },
    {
        id: `${projId}-t2`,
        projectId: projId,
        name: 'Projeto Executivo',
        description: 'Engenharia detalhada e desenhos técnicos',
        startDate: '2025-07-01',
        endDate: '2025-08-31',
        baselineStart: '2025-07-01',
        baselineEnd: '2025-08-15',
        status: 'in_progress',
        responsibleName: 'Maria Oliveira',
        progress: 65,
        dependencies: [`${projId}-t1`],
    },
    {
        id: `${projId}-t3`,
        projectId: projId,
        name: 'Aquisição de Equipamentos',
        description: 'Compra de transformadores e painéis',
        startDate: '2025-08-01',
        endDate: '2025-10-15',
        baselineStart: '2025-08-01',
        baselineEnd: '2025-09-30',
        status: 'in_progress',
        responsibleName: 'João Silva',
        progress: 30,
        dependencies: [`${projId}-t2`],
    },
    {
        id: `${projId}-t4`,
        projectId: projId,
        name: 'Montagem Eletromecânica',
        description: 'Instalação em campo dos equipamentos',
        startDate: '2025-10-16',
        endDate: '2026-02-28',
        baselineStart: '2025-10-01',
        baselineEnd: '2026-01-31',
        status: 'not_started',
        responsibleName: 'Pedro Mendes',
        progress: 0,
        dependencies: [`${projId}-t3`],
    },
    {
        id: `${projId}-t5`,
        projectId: projId,
        name: 'Comissionamento',
        description: 'Testes e validação final',
        startDate: '2026-03-01',
        endDate: '2026-04-30',
        baselineStart: '2026-02-01',
        baselineEnd: '2026-03-31',
        status: 'not_started',
        responsibleName: 'Ana Costa',
        progress: 0,
        dependencies: [`${projId}-t4`],
        milestone: true,
    },
];

const makeTasks2 = (projId: string): ProjectTaskV2[] => [
    {
        id: `${projId}-t1`,
        projectId: projId,
        name: 'EIA/RIMA',
        description: 'Estudo de Impacto Ambiental',
        startDate: '2025-03-01',
        endDate: '2025-05-30',
        baselineStart: '2025-03-01',
        baselineEnd: '2025-05-15',
        status: 'completed',
        responsibleName: 'Fernanda Lima',
        progress: 100,
    },
    {
        id: `${projId}-t2`,
        projectId: projId,
        name: 'Fundações dos Aerogeradores',
        description: 'Construção de bases de concreto',
        startDate: '2025-06-01',
        endDate: '2025-09-30',
        baselineStart: '2025-06-01',
        baselineEnd: '2025-09-15',
        status: 'delayed',
        responsibleName: 'Ricardo Souza',
        progress: 40,
        overdueReason: 'Chuvas acima do esperado atrasaram obras civis',
        dependencies: [`${projId}-t1`],
    },
    {
        id: `${projId}-t3`,
        projectId: projId,
        name: 'Montagem de Torres',
        description: 'Instalação das torres e naceles',
        startDate: '2025-10-01',
        endDate: '2026-03-31',
        baselineStart: '2025-09-16',
        baselineEnd: '2026-02-28',
        status: 'not_started',
        responsibleName: 'Pedro Mendes',
        progress: 0,
        dependencies: [`${projId}-t2`],
    },
];

// ─── Milestones ──────────────────────────────────────────────────
const makeMilestones = (projId: string): ProjectMilestone[] => [
    { id: `${projId}-ms1`, name: 'Projeto Executivo Aprovado', date: '2025-08-31', status: 'pending', linkedTaskIds: [`${projId}-t2`] },
    { id: `${projId}-ms2`, name: 'Equipamentos no Site', date: '2025-10-15', status: 'pending', linkedTaskIds: [`${projId}-t3`] },
    { id: `${projId}-ms3`, name: 'Energização Final', date: '2026-04-30', status: 'pending', linkedTaskIds: [`${projId}-t5`] },
];

const makeMilestones2 = (projId: string): ProjectMilestone[] => [
    { id: `${projId}-ms1`, name: 'Licença Ambiental Concedida', date: '2025-05-30', status: 'completed', linkedTaskIds: [`${projId}-t1`] },
    { id: `${projId}-ms2`, name: 'Primeira Torre Erguida', date: '2025-12-15', status: 'overdue', linkedTaskIds: [`${projId}-t3`] },
];

// ─── Risk Items ──────────────────────────────────────────────────
const makeRisks = (projId: string): ProjectRiskItem[] => [
    {
        id: `${projId}-r1`,
        title: 'Atraso na entrega de transformadores',
        description: 'Fornecedor principal com backlog de 90 dias',
        category: 'Schedule',
        probability: 4,
        impact: 4,
        level: 16,
        severity: 'high',
        exposure: makeMoney(2500000),
        mitigation: 'Contato com fornecedor alternativo ABB. Negociação de prazo acelerado.',
        ownerId: 'user-1',
        ownerName: 'Alice Chen',
        status: 'mitigating',
        createdAt: '2025-07-15T10:00:00Z',
        updatedAt: '2025-09-20T14:30:00Z',
    },
    {
        id: `${projId}-r2`,
        title: 'Variação cambial em equipamentos importados',
        category: 'Financial',
        probability: 3,
        impact: 3,
        level: 9,
        severity: 'medium',
        exposure: makeMoney(1200000),
        status: 'open',
        ownerId: 'user-2',
        ownerName: 'Bob Torres',
        createdAt: '2025-08-01T09:00:00Z',
        updatedAt: '2025-08-01T09:00:00Z',
    },
    {
        id: `${projId}-r3`,
        title: 'Licença ambiental pendente para área de manejo',
        category: 'Legal',
        probability: 2,
        impact: 5,
        level: 10,
        severity: 'medium',
        status: 'open',
        createdAt: '2025-09-10T11:00:00Z',
        updatedAt: '2025-09-10T11:00:00Z',
    },
    {
        id: `${projId}-r4`,
        title: 'Interferência eletromagnética em painéis solares adjacentes',
        category: 'Operational',
        probability: 3,
        impact: 4,
        level: 12,
        severity: 'high',
        status: 'open',
        // No owner, no mitigation → triggers both alerts
        createdAt: '2025-10-01T09:00:00Z',
        updatedAt: '2025-10-01T09:00:00Z',
    },
];

const makeRisks2 = (projId: string): ProjectRiskItem[] => [
    {
        id: `${projId}-r1`,
        title: 'Chuvas prolongadas atrasando fundações',
        category: 'Environmental',
        probability: 5,
        impact: 4,
        level: 20,
        severity: 'critical',
        exposure: makeMoney(4000000),
        mitigation: 'Plano de contingência com trabalho noturno. Período seco compensatório.',
        ownerName: 'Ricardo Souza',
        status: 'mitigating',
        createdAt: '2025-07-01T08:00:00Z',
        updatedAt: '2025-10-05T16:00:00Z',
    },
    {
        id: `${projId}-r2`,
        title: 'Fadiga estrutural em torre protótipo',
        category: 'Operational',
        probability: 2,
        impact: 5,
        level: 10,
        severity: 'medium',
        status: 'open',
        createdAt: '2025-09-20T12:00:00Z',
        updatedAt: '2025-09-20T12:00:00Z',
    },
];

// ─── Documents ───────────────────────────────────────────────────
const makeDocs = (projId: string): ProjectDocument[] => [
    { id: `${projId}-d1`, name: 'Contrato Principal', category: 'contract', version: 2, required: true, uploadedAt: '2025-05-20T10:00:00Z', url: '#' },
    { id: `${projId}-d2`, name: 'Licença Ambiental', category: 'license', version: 1, required: true, uploadedAt: '2025-06-15T14:00:00Z', url: '#' },
    { id: `${projId}-d3`, name: 'Relatório de Progresso Q3', category: 'report', version: 1, required: false, uploadedAt: '2025-09-30T18:00:00Z', url: '#' },
    { id: `${projId}-d4`, name: 'Ata de Deliberação CAE-2025-07', category: 'minutes', version: 1, required: true, uploadedAt: '2025-07-20T09:00:00Z', url: '#' },
    { id: `${projId}-d5`, name: 'Estudo de Viabilidade Técnica', category: 'proposal', version: 1, required: true, uploadedAt: '', url: undefined }, // missing!
];

// ─── Finance ─────────────────────────────────────────────────────
const makeFinance1 = (): ProjectFinance => {
    const bac = makeMoney(198827691.78);
    const ac = makeMoney(89972461.30);
    const eac = makeMoney(212500000);
    const etc = makeMoney(212500000 - 89972461.30);
    const variance = eac.amountCents - bac.amountCents;
    return {
        bac,
        ac,
        eac,
        etc,
        forecastMethod: 'ac_plus_etc',
        confidence: 'medium',
        varianceAmount: { amountCents: variance, currency: 'BRL' },
        variancePercent: (variance / bac.amountCents) * 100,
        drivers: ['Aumento no custo de aço', 'Câmbio desfavorável', 'Horas extras por atraso'],
        updatedAt: '2025-10-01T12:00:00Z',
    };
};

const makeFinance2 = (): ProjectFinance => {
    const bac = makeMoney(45200000);
    const ac = makeMoney(22100000);
    const eac = makeMoney(52800000);
    const etc = makeMoney(52800000 - 22100000);
    const variance = eac.amountCents - bac.amountCents;
    return {
        bac,
        ac,
        eac,
        etc,
        forecastMethod: 'ac_plus_etc',
        confidence: 'low',
        varianceAmount: { amountCents: variance, currency: 'BRL' },
        variancePercent: (variance / bac.amountCents) * 100,
        drivers: ['Atraso em fundações', 'Mobilização adicional'],
        updatedAt: '2025-10-05T16:00:00Z',
    };
};

const makeFinance3 = (): ProjectFinance => {
    const bac = makeMoney(12500000);
    const ac = makeMoney(11800000);
    const eac = makeMoney(12200000);
    const etc = makeMoney(12200000 - 11800000);
    const variance = eac.amountCents - bac.amountCents;
    return {
        bac,
        ac,
        eac,
        etc,
        forecastMethod: 'manual',
        confidence: 'high',
        varianceAmount: { amountCents: variance, currency: 'BRL' },
        variancePercent: (variance / bac.amountCents) * 100,
        updatedAt: '2025-10-02T08:00:00Z',
    };
};

// ─── Audit Logs ──────────────────────────────────────────────────
const makeAudit = (projId: string): ProjectAuditEvent[] => [
    { id: `${projId}-a1`, path: 'status', before: 'planejamento', after: 'em_andamento', timestamp: '2025-06-01T08:00:00Z', actor: 'Alice Chen', action: 'updated' },
    { id: `${projId}-a2`, path: 'finance.eac.amountCents', before: '19882769178', after: '21250000000', timestamp: '2025-09-15T14:30:00Z', actor: 'Bob Torres', action: 'updated' },
    { id: `${projId}-a3`, path: 'risks', before: null, after: `${projId}-r1`, timestamp: '2025-07-15T10:00:00Z', actor: 'Alice Chen', action: 'created' },
];

// ─── Team Allocations V2 ─────────────────────────────────────────
export const mockAllocationsV2: Record<string, ProjectAllocationV2[]> = {
    'proj-001': [
        { id: 'a1', projectId: 'proj-001', memberId: 'user-1', memberName: 'Alice Chen', role: 'Gerente de Projeto', allocationPercent: 80, hoursPerWeek: 32, plannedHH: 1600, actualHH: 1450, hourlyRate: makeMoney(180), critical: false },
        { id: 'a2', projectId: 'proj-001', memberId: 'user-2', memberName: 'Bob Torres', role: 'Engenheiro Líder', allocationPercent: 100, hoursPerWeek: 40, plannedHH: 2000, actualHH: 2120, hourlyRate: makeMoney(220), critical: true },
        { id: 'a3', projectId: 'proj-001', memberId: 'user-3', memberName: 'Carlos Santos', role: 'Técnico Eletricista', allocationPercent: 120, hoursPerWeek: 48, plannedHH: 2400, actualHH: 2580, hourlyRate: makeMoney(95), critical: true },
        { id: 'a4', projectId: 'proj-001', memberId: 'user-4', memberName: 'Diana Reis', role: 'Analista Ambiental', allocationPercent: 40, hoursPerWeek: 16, plannedHH: 800, actualHH: 720, hourlyRate: makeMoney(150), critical: false },
    ],
    'proj-007': [
        { id: 'a5', projectId: 'proj-007', memberId: 'user-1', memberName: 'Alice Chen', role: 'Coordenadora', allocationPercent: 50, hoursPerWeek: 20, plannedHH: 1000, actualHH: 980, hourlyRate: makeMoney(180), critical: false },
        { id: 'a6', projectId: 'proj-007', memberId: 'user-5', memberName: 'Eduardo Pinto', role: 'Eng. Civil', allocationPercent: 100, hoursPerWeek: 40, plannedHH: 2000, actualHH: 2200, hourlyRate: makeMoney(200), critical: true },
        { id: 'a7', projectId: 'proj-007', memberId: 'user-3', memberName: 'Carlos Santos', role: 'Técnico Eletricista', allocationPercent: 60, hoursPerWeek: 24, plannedHH: 1200, actualHH: 1100, hourlyRate: makeMoney(95), critical: false },
    ],
};

// ─── V2 Project Overlays ─────────────────────────────────────────
// These are the v2 "enrichment" data keyed by project ID.
// During migration, these are merged on top of existing v1 projects.

export const v2Overlays: Record<string, Omit<ProjectV2, keyof import('@/lib/types').Project>> = {
    'proj-001': {
        schemaVersion: 2,
        tasks: makeTasks('proj-001'),
        milestones: makeMilestones('proj-001'),
        risks: makeRisks('proj-001'),
        documents: makeDocs('proj-001'),
        finance: makeFinance1(),
        revenue: makeRevenue(198827691.78, 0.45, 0.85),
        ...(() => { const c = makeCostCurve(198827691.78, 89972461.30, 212500000, '2025-06', 12, 5); return { costCurve: c.points, cutoffPeriod: c.cutoffPeriod }; })(),
        revenueCurve: makeRevenueCurve(198827691.78, 198827691.78 * 0.45, 198827691.78 * 0.45 * 0.85, '2025-06', 12, 5),
        costBreakdown: makeBreakdown(198827691.78),
        governance: { deliberation_ids: ['delib-001', 'delib-005'], meeting_ids: ['meet-002'] },
        audit_log: makeAudit('proj-001'),
        contract_id: 'contract-cemig-001',
        uf: 'MG',
        location: { city: 'Belo Horizonte', lat: -19.9167, lng: -43.9345 },
        health_score: 0, // will be computed
        health_reasons: [],
        last_activity_at: '2025-10-01T14:30:00Z',
        next_milestone_at: '2025-10-15',
        templateType: 'transmission',
    },
    'proj-007': {
        schemaVersion: 2,
        tasks: makeTasks2('proj-007'),
        milestones: makeMilestones2('proj-007'),
        risks: makeRisks2('proj-007'),
        documents: [
            { id: 'proj-007-d1', name: 'EIA/RIMA Aprovado', category: 'license', version: 1, required: true, uploadedAt: '2025-05-30T10:00:00Z', url: '#' },
            { id: 'proj-007-d2', name: 'Contrato EPC', category: 'contract', version: 3, required: true, uploadedAt: '2025-04-10T09:00:00Z', url: '#' },
            { id: 'proj-007-d3', name: 'Outorga ANEEL', category: 'license', version: 1, required: true, uploadedAt: '', url: undefined },
        ],
        finance: makeFinance2(),
        revenue: makeRevenue(75569079, 0.40, 0.75),
        ...(() => { const c = makeCostCurve(45200000, 22100000, 52800000, '2025-03', 14, 7); return { costCurve: c.points, cutoffPeriod: c.cutoffPeriod }; })(),
        revenueCurve: makeRevenueCurve(75569079, 75569079 * 0.40, 75569079 * 0.40 * 0.75, '2025-03', 14, 7),
        costBreakdown: makeBreakdown(45200000),
        governance: { deliberation_ids: ['delib-003'], meeting_ids: ['meet-001', 'meet-003'] },
        audit_log: makeAudit('proj-007'),
        contract_id: 'contract-enel-001',
        uf: 'PE',
        location: { city: 'Caetés', lat: -8.7731, lng: -36.6242 },
        health_score: 0,
        health_reasons: [],
        last_activity_at: '2025-10-05T16:00:00Z',
        next_milestone_at: '2025-12-15',
        templateType: 'wind',
    },
    'proj-002': {
        schemaVersion: 2,
        tasks: [
            { id: 'proj-002-t1', projectId: 'proj-002', name: 'Mobilização Offshore', startDate: '2024-03-01', endDate: '2024-05-31', baselineStart: '2024-03-01', baselineEnd: '2024-05-31', status: 'completed', responsibleName: 'Pedro Mendes', progress: 100 },
            { id: 'proj-002-t2', projectId: 'proj-002', name: 'Instalação de Cabos Submarinos', startDate: '2024-06-01', endDate: '2024-12-31', baselineStart: '2024-06-01', baselineEnd: '2024-11-30', status: 'in_progress', responsibleName: 'Ana Costa', progress: 72 },
            { id: 'proj-002-t3', projectId: 'proj-002', name: 'Testes de Energização', startDate: '2025-01-01', endDate: '2025-03-31', baselineStart: '2024-12-01', baselineEnd: '2025-02-28', status: 'not_started', responsibleName: 'Maria Oliveira', progress: 0, dependencies: ['proj-002-t2'] },
        ],
        milestones: [
            { id: 'proj-002-ms1', name: 'Chegada ao FPSO', date: '2024-06-01', status: 'completed' },
            { id: 'proj-002-ms2', name: 'Energização P-80', date: '2025-03-31', status: 'pending' },
        ],
        risks: [
            { id: 'proj-002-r1', title: 'Condições marítimas adversas', category: 'Environmental', probability: 4, impact: 3, level: 12, severity: 'high', status: 'open', createdAt: '2024-06-15T08:00:00Z', updatedAt: '2024-06-15T08:00:00Z' },
        ],
        documents: [
            { id: 'proj-002-d1', name: 'Contrato PETROBRAS P-80', category: 'contract', version: 1, required: true, uploadedAt: '2024-01-20T10:00:00Z', url: '#' },
        ],
        finance: makeFinance3(),
        revenue: makeRevenue(12500000, 0.90, 0.80),
        ...(() => { const c = makeCostCurve(12500000, 11800000, 12200000, '2024-03', 12, 10); return { costCurve: c.points, cutoffPeriod: c.cutoffPeriod }; })(),
        revenueCurve: makeRevenueCurve(12500000, 12500000 * 0.90, 12500000 * 0.90 * 0.80, '2024-03', 12, 10),
        costBreakdown: makeBreakdown(12500000),
        governance: { deliberation_ids: [], meeting_ids: [] },
        audit_log: [],
        contract_id: 'contract-petrobras-p80',
        uf: 'RJ',
        location: { city: 'Rio de Janeiro', lat: -22.9068, lng: -43.1729 },
        health_score: 0,
        health_reasons: [],
        last_activity_at: '2025-09-28T10:00:00Z',
        next_milestone_at: '2025-03-31',
        templateType: 'offshore',
    },
};

// List of project IDs that have v2 overlay data
export const V2_ENRICHED_IDS = Object.keys(v2Overlays);
