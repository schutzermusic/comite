/**
 * V2 Mock Projects — rich governance-grade sample data
 * Used as fallback when no v2 data exists in localStorage
 */

import type { ProjectV2, ProjectTaskV2, ProjectMilestone, ProjectRiskItem, ProjectDocument, ProjectFinance, ProjectAuditEvent, ProjectAllocationV2, ProjectRevenue, CostCurvePoint, RevenueCurvePoint, CostBreakdownItem, BillingEvent } from '@/lib/types/project-v2';
import { makeMoney, centsFromReais } from '@/lib/utils/project-utils';
import { generateMockBillingEvents } from '@/lib/utils/billing-utils';

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

export const CEMIG_TOTAL_CONTRACTED = 198827691.78;
export const CEMIG_TOTALIZER_CUTOFF_BILLED = 11153499.19;
const CEMIG_MATERIAL_PURCHASES = 33975808.11;
const CEMIG_SERVICE_DISBURSEMENTS = 30698976.49;
const CEMIG_OTHER_INSIGHT_DISBURSEMENTS = 100000;
const CEMIG_DIRECT_BILLING_DISBURSEMENTS = 41470199.02;
const CEMIG_INSIGHT_CASH_REVENUE = 157357492.76;
const CEMIG_MACHINE_STOP_MATERIAL_EXPOSURE = 8127926.01;
const CEMIG_TOTALIZER_CUTOFF = '2026-04';
const CEMIG_TOTALIZER_UPDATED_AT = '2026-04-30T12:00:00Z';

// Source: 30.04.26-Rev.30-UHE-SC Eventograma.xlsx, sheet "03_Eventos_pagamentos".
// Correct monthly cash-out is SUM(Q) by P ("Mês de desembolso"). The totalizer
// sheet had the SUMIF criteria shifted one row ahead, which made months such
// as July carry the wrong disbursement in the system S-curve.
const CEMIG_INSIGHT_DISBURSEMENT_MONTHLY = [
    ['2024-07', 0],
    ['2024-08', 0],
    ['2024-09', 0],
    ['2024-10', 0],
    ['2024-11', 0],
    ['2024-12', 0],
    ['2025-01', 0],
    ['2025-02', 0],
    ['2025-03', 0],
    ['2025-04', 0],
    ['2025-05', 0],
    ['2025-06', 0],
    ['2025-07', 0],
    ['2025-08', 0],
    ['2025-09', 0],
    ['2025-10', 57924.44],
    ['2025-11', 0],
    ['2025-12', 40000],
    ['2026-01', 5401436.85],
    ['2026-02', 1706646.55],
    ['2026-03', 1700000],
    ['2026-04', 6151716.14],
    ['2026-05', 240000],
    ['2026-06', 195816.17],
    ['2026-07', 1871731.64],
    ['2026-08', 2375450.39],
    ['2026-09', 267326.54],
    ['2026-10', 400000],
    ['2026-11', 1440145.15],
    ['2026-12', 4289595.25],
    ['2027-01', 400806.78],
    ['2027-02', 3360866.39],
    ['2027-03', 186098.68],
    ['2027-04', 2055686.67],
    ['2027-05', 1401805.31],
    ['2027-06', 351183.39],
    ['2027-07', 2751959.76],
    ['2027-08', 1491961.53],
    ['2027-09', 1158454.51],
    ['2027-10', 2337855.27],
    ['2027-11', 1165680],
    ['2027-12', 1822713.75],
    ['2028-01', 478452.5],
    ['2028-02', 346098.68],
    ['2028-03', 3360866.39],
    ['2028-04', 168000],
    ['2028-05', 0],
    ['2028-06', 0],
    ['2028-07', 248000],
    ['2028-08', 1429049.76],
    ['2028-09', 1911680],
    ['2028-10', 3953970.13],
    ['2028-11', 458452.5],
    ['2028-12', 400000],
    ['2029-01', 224287.12],
    ['2029-02', 304311.54],
    ['2029-03', 0],
    ['2029-04', 80000],
    ['2029-05', 3206398.88],
    ['2029-06', 1347504.27],
    ['2029-07', 372726.36],
    ['2029-08', 400000],
    ['2029-09', 158995.55],
    ['2029-10', 0],
    ['2029-11', 1040850.93],
    ['2029-12', 0],
    ['2030-01', 0],
    ['2030-02', 0],
    ['2030-03', 162278.83],
    ['2030-04', 815726.89],
] as const;

const CEMIG_INSIGHT_DISBURSEMENT_TOTAL = CEMIG_INSIGHT_DISBURSEMENT_MONTHLY.reduce(
    (total, [, amount]) => total + amount,
    0,
);

// Source: 30.04.26-Rev.30-UHE-SC Eventograma.xlsx, sheet "04_TOTALIZADORA (3)".
// Tuple: period, gtEvents, gtValue, dEvents, dValue, revenueMonthly, revenueCumulative,
// insightRevenueMonthly, insightRevenueCumulative, insightCashIn, totalReceivable,
// plannedInsightDisbursement, directBillingMonthly, plannedDisbursementCumulative,
// billedMonthly, billedCumulative, ordersMonthly, ordersCumulative.
const CEMIG_TOTALIZER_MONTHS = [
    ["2024-07",0,0,0,0,0,0,0,0,9941384.59,9941384.59,100000,0,100000,0,0,9546933.06,9546933.06],
    ["2024-08",0,0,0,0,0,0,0,0,0,0,100000,0,100000,9941384.59,9941384.59,0,0],
    ["2024-09",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2024-10",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2024-11",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2024-12",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-01",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-02",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-03",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-04",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-05",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-06",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-07",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-08",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.59,0,0],
    ["2025-09",0,0,0,0,0,0,0,0,0,0,157924.45,0,157924.45,350408.42,10291793.01,0,0],
    ["2025-10",24,412245.18,0,0,412245.18,412245.18,412245.18,412245.18,350408.4,350408.4,100000,0,157924.45,0,10291793.01,0,0],
    ["2025-11",0,0,0,0,0,412245.18,0,412245.18,0,0,140000,0,197924.45,680190.67,10971983.68,1724103.73,11271036.79],
    ["2025-12",0,0,0,0,0,412245.18,0,412245.18,0,0,5501436.85,0,5599361.3,0,10971983.68,996943.88,12267980.67],
    ["2026-01",2,441511.47,0,0,441511.47,853756.65,441511.47,853756.65,375284.75,375284.75,1806646.55,0,7306007.85,181515.51,11153499.19,900062.68,13168043.35],
    ["2026-02",8,3812821.55,0,0,3812821.55,4666578.2,3592295.61,4446052.26,3053451.27,3273977.21,1800000,220525.94,9226533.79,0,11153499.19,623444.52,13791487.87],
    ["2026-03",9,655154.83,0,0,655154.83,5321733.03,185675.85,4631728.11,157824.47,627303.45,6251716.14,469478.98,15847728.91,0,11153499.19,628101.5,14419589.37],
    ["2026-04",13,2732612.89,0,0,2732612.89,8054345.92,2401859.59,7033587.7,2041580.65,2372333.95,340000,330753.3,16418482.21,0,11153499.19,899398.5,15318987.87],
    ["2026-05",6,826234.57,1,801542.66,1627777.23,9682123.15,826234.57,7859822.27,702299.38,1503842.04,295816.17,801542.66,17415841.04,0,11153499.19,849378.18,16168366.05],
    ["2026-06",11,1155029.74,0,0,1155029.74,10837152.89,886490.66,8746312.93,753517.06,1022056.14,1971731.64,268539.08,19556111.76,0,11153499.19,186000,16354366.05],
    ["2026-07",10,1160023.35,0,0,1160023.35,11997176.24,943195.41,9689508.34,801716.1,1018544.04,2475450.39,216827.94,22148390.09,0,11153499.19,569901.22,16924267.27],
    ["2026-08",13,3984972.44,4,421218.05,4406190.49,16403366.73,4197400.59,13886908.93,3567790.5,3776580.4,367326.54,208789.9,22624506.54,0,11153499.19,0,16924267.27],
    ["2026-09",14,4942914.62,0,0,4942914.62,21346281.35,2800070.45,16686979.38,2380059.88,4522904.05,500000,2142844.17,25167350.71,0,11153499.19,0,16924267.27],
    ["2026-10",22,10534527.22,0,0,10534527.22,31880808.57,10534527.22,27221506.6,8954348.14,8954348.14,1540145.15,0,26607495.86,0,11153499.19,0,16924267.27],
    ["2026-11",6,3520581.38,0,0,3520581.38,35401389.95,3520581.38,30742087.98,2992494.17,2992494.17,4389595.25,0,30897091.11,0,11153499.19,0,16924267.27],
    ["2026-12",26,6938924.96,9,6081414.32,13020339.28,48421729.23,6916319.69,37658407.67,5878871.74,11982891.32,500806.78,6104019.59,37401917.47,0,11153499.19,0,16924267.27],
    ["2027-01",21,11106954.49,15,3485471.42,14592425.91,63014155.14,5117209.72,42775617.39,4349628.26,13824844.45,3460866.39,9475216.19,50238000.06,0,11153499.19,0,16924267.27],
    ["2027-02",18,7356733.98,0,0,7356733.98,70370889.11,5713430.67,48489048.05,4856416.07,6499719.38,286098.68,1643303.31,52067402.04,0,11153499.19,113319.2,17037586.47],
    ["2027-03",25,5308631.57,1,142064.99,5450696.56,75821585.67,4787228.03,53276276.08,4069143.82,4732612.35,2155686.67,663468.53,54786557.25,0,11153499.19,0,17037586.47],
    ["2027-04",30,11561534.66,9,1864951.91,13426486.56,89248072.23,12492148.03,65768424.11,10618325.83,11552664.36,1501805.31,934338.53,57122701.09,0,11153499.19,0,17037586.47],
    ["2027-05",12,4679233.79,0,0,4679233.79,93927306.03,3932919.12,69701343.24,3856798.15,4603112.82,451183.39,746314.67,58220199.15,0,11153499.19,0,17037586.47],
    ["2027-06",5,971574.58,2,162483.4,1134057.98,95061364.01,1032890.43,70734233.67,1032890.43,1134057.98,2851959.76,101167.55,61073326.46,0,11153499.19,0,17037586.47],
    ["2027-07",8,3431951.01,2,305374.8,3737325.81,98798689.82,3406022.74,74140256.41,3406022.74,3737325.81,1591961.53,331303.07,62896591.06,0,11153499.19,0,17037586.47],
    ["2027-08",10,2707327.12,1,153914.72,2861241.84,101659931.66,2693217.2,76833473.61,2693217.2,2861241.84,1258454.51,168024.64,64223070.21,0,11153499.19,0,17037586.47],
    ["2027-09",19,8180418.34,0,0,8180418.34,109840350.01,5924485.21,82757958.81,5924485.21,8180418.34,2437855.27,2255933.14,68816858.62,0,11153499.19,0,17037586.47],
    ["2027-10",13,2261479.41,0,0,2261479.41,112101829.42,2238860.85,84996819.66,2238860.85,2261479.41,1265680,22618.56,70005157.18,0,11153499.19,0,17037586.47],
    ["2027-11",0,0,0,0,0,112101829.42,0,84996819.66,0,0,1922713.75,0,71827870.93,0,11153499.19,0,17037586.47],
    ["2027-12",3,405825.62,0,0,405825.62,112507655.04,353969.07,85350788.73,353969.07,405825.62,578452.5,51856.55,72358179.98,0,11153499.19,113319.22,17150905.69],
    ["2028-01",3,2617584.64,0,0,2617584.64,115125239.68,617584.64,85968373.37,617584.64,2617584.64,446098.68,2000000,74704278.65,0,11153499.19,0,17150905.69],
    ["2028-02",10,6062885.56,0,0,6062885.56,121188125.23,5853366.36,91821739.73,5853366.36,6062885.56,3460866.39,209519.2,78274664.25,0,11153499.19,0,17150905.69],
    ["2028-03",21,4898441.31,0,0,4898441.31,126086566.55,4598969.76,96420709.48,4598969.76,4898441.31,268000,299471.56,78742135.81,0,11153499.19,0,17150905.69],
    ["2028-04",26,10417487.74,2,661312.2,11078799.94,137165366.48,10798799.94,107219509.42,10798799.94,11078799.94,100000,280000,79022135.81,0,11153499.19,0,17150905.69],
    ["2028-05",6,1673829.97,0,0,1673829.97,138839196.45,1522137.97,108741647.39,1522137.97,1673829.97,100000,151692,79173827.81,0,11153499.19,0,17150905.69],
    ["2028-06",4,452567.64,0,0,452567.64,139291764.09,400986.42,109142633.8,400986.42,452567.64,348000,51581.22,79473409.03,0,11153499.19,0,17150905.69],
    ["2028-07",7,2973836.8,0,0,2973836.8,142265600.89,2973836.8,112116470.6,2973836.8,2973836.8,1529049.76,0,80902458.79,0,11153499.19,0,17150905.69],
    ["2028-08",5,1618458.85,0,0,1618458.85,143884059.74,1557143.11,113673613.71,1557143.11,1618458.85,2011680,61315.74,82875454.53,0,11153499.19,0,17150905.69],
    ["2028-09",3,1240472.15,0,0,1240472.15,145124531.89,1240472.15,114914085.86,1240472.15,1240472.15,4053970.13,0,86829424.66,0,11153499.19,0,17150905.69],
    ["2028-10",15,5772995.85,0,0,5772995.85,150897527.74,3517062.71,118431148.57,3517062.71,5772995.85,558452.5,2255933.14,89543810.3,0,11153499.19,0,17150905.69],
    ["2028-11",6,4795019.43,0,0,4795019.43,155692547.17,795019.43,119226168,795019.43,4795019.43,500000,4000000,93943810.3,0,11153499.19,124651.83,17275557.52],
    ["2028-12",12,4721548.08,0,0,4721548.08,160414095.24,4472548.08,123698716.08,4472548.08,4721548.08,324287.12,249000,94417097.42,0,11153499.19,0,17275557.52],
    ["2029-01",26,5076342.9,0,0,5076342.9,165490438.14,4932537.16,128631253.24,4932537.16,5076342.9,404311.54,143805.74,94865214.69,0,11153499.19,0,17275557.52],
    ["2029-02",11,476969.06,2,661312.2,1138281.26,166628719.4,978936.31,129610189.54,978936.31,1138281.26,100000,159344.95,95024559.64,0,11153499.19,0,17275557.52],
    ["2029-03",4,1490473.86,3,341460.63,1831934.49,168460653.89,1532462.93,131142652.47,1532462.93,1831934.49,180000,299471.56,95404031.2,0,11153499.19,0,17275557.52],
    ["2029-04",3,1227847.99,2,320374.8,1548222.79,170008876.68,1227847.99,132370500.46,1227847.99,1548222.79,3306398.88,320374.8,98930804.89,0,11153499.19,0,17275557.52],
    ["2029-05",8,1074727.83,1,22270.57,1096998.4,171105875.08,1045417.18,133415917.64,1045417.18,1096998.4,1447504.27,51581.22,100329890.38,0,11153499.19,0,17275557.52],
    ["2029-06",5,2329835.73,0,0,2329835.73,173435710.81,2258515.96,135674433.6,2258515.96,2329835.73,472726.36,71319.77,100773936.51,0,11153499.19,0,17275557.52],
    ["2029-07",16,7554539.48,0,0,7554539.48,180990250.28,5227286.57,140901720.17,5227286.57,7554539.48,500000,2327252.91,103501189.41,0,11153499.19,0,17275557.52],
    ["2029-08",10,2422092.6,0,0,2422092.6,183412342.88,2404362.84,143306083.01,2404362.84,2422092.6,258995.55,17729.76,103677914.72,0,11153499.19,0,17275557.52],
    ["2029-09",10,3426302.03,0,0,3426302.03,186838644.91,3177302.03,146483385.04,3177302.03,3426302.03,100000,249000,103926914.72,0,11153499.19,0,17275557.52],
    ["2029-10",1,930600,0,0,930600,187769244.91,930600,147413985.04,930600,930600,1140850.93,0,104967765.65,0,11153499.19,0,17275557.52],
    ["2029-11",45,6477018.62,1,160007.52,6637026.14,194406271.04,6385236.56,153799221.6,6385236.56,6637026.14,100000,251789.57,105219555.22,0,11153499.19,0,17275557.52],
    ["2029-12",11,711240.26,5,1019658.62,1730898.87,196137169.92,1571553.92,155370775.53,1571553.92,1730898.87,100000,159344.95,105378900.17,0,11153499.19,0,17275557.52],
    ["2030-01",8,2108459.55,2,404333.07,2512792.62,198649962.54,1808987.99,157179763.51,1808987.99,2512792.62,100000,703804.63,106082704.8,0,11153499.19,0,17275557.52],
    ["2030-02",3,177729.25,0,0,177729.25,198827691.78,177729.25,157357492.76,177729.25,177729.25,262278.83,0,106244983.63,0,11153499.19,0,17275557.52],
    ["2030-03",0,0,0,0,0,198827691.78,0,157357492.76,0,0,100000,0,106244983.63,0,11153499.19,0,17275557.52],
] as const;

function totalizerCents(value: number): number {
    return centsFromReais(value);
}

function makeCemigRevenueFromTotalizer(): ProjectRevenue {
    const cutoff = CEMIG_TOTALIZER_MONTHS.find(row => row[0] === CEMIG_TOTALIZER_CUTOFF) ?? CEMIG_TOTALIZER_MONTHS[0];
    const billed = cutoff[15];
    return {
        totalContracted: makeMoney(CEMIG_TOTAL_CONTRACTED),
        billed: makeMoney(billed),
        received: makeMoney(0),
        toBill: makeMoney(Math.max(CEMIG_TOTAL_CONTRACTED - billed, 0)),
        toReceive: makeMoney(billed),
        updatedAt: CEMIG_TOTALIZER_UPDATED_AT,
    };
}

function makeCemigFinanceFromTotalizer(): ProjectFinance {
    const finalDisbursement = CEMIG_INSIGHT_DISBURSEMENT_TOTAL;
    return {
        bac: makeMoney(finalDisbursement),
        ac: makeMoney(0),
        eac: makeMoney(finalDisbursement),
        etc: makeMoney(finalDisbursement),
        forecastMethod: 'manual',
        confidence: 'medium',
        varianceAmount: makeMoney(0),
        variancePercent: 0,
        drivers: ['Fonte: totalizadora de eventos de pagamento', 'Desembolso realizado não informado na planilha'],
        updatedAt: CEMIG_TOTALIZER_UPDATED_AT,
    };
}

function makeCemigCostBreakdownFromTotalizer(): CostBreakdownItem[] {
    return [
        {
            category: 'Compras de materiais',
            bac: makeMoney(CEMIG_MATERIAL_PURCHASES),
            ac: makeMoney(0),
            eac: makeMoney(CEMIG_MATERIAL_PURCHASES),
        },
        {
            category: 'Serviços e demais eventos',
            bac: makeMoney(CEMIG_SERVICE_DISBURSEMENTS),
            ac: makeMoney(0),
            eac: makeMoney(CEMIG_SERVICE_DISBURSEMENTS),
        },
        {
            category: 'Custo fixo inicial',
            bac: makeMoney(CEMIG_OTHER_INSIGHT_DISBURSEMENTS),
            ac: makeMoney(0),
            eac: makeMoney(CEMIG_OTHER_INSIGHT_DISBURSEMENTS),
        },
        {
            category: 'Faturamento direto previsto',
            bac: makeMoney(CEMIG_DIRECT_BILLING_DISBURSEMENTS),
            ac: makeMoney(0),
            eac: makeMoney(CEMIG_DIRECT_BILLING_DISBURSEMENTS),
        },
    ];
}

function makeCemigRevenueCurveFromTotalizer(): RevenueCurvePoint[] {
    return CEMIG_TOTALIZER_MONTHS.map(row => {
        return {
            period: row[0],
            plannedCumulative: totalizerCents(row[8]),
            billedCumulative: row[0] <= CEMIG_TOTALIZER_CUTOFF ? totalizerCents(row[15]) : (null as unknown as number),
            receivedCumulative: null as unknown as number,
        };
    });
}

function makeCemigCostCurveFromTotalizer(): { points: CostCurvePoint[]; cutoffPeriod: string } {
    let cumulative = 0;
    return {
        cutoffPeriod: CEMIG_TOTALIZER_CUTOFF,
        points: CEMIG_INSIGHT_DISBURSEMENT_MONTHLY.map(([period, monthly]) => {
            cumulative += monthly;
            return {
                period,
                bacCumulative: totalizerCents(cumulative),
                acCumulative: null as unknown as number,
                eacCumulative: totalizerCents(cumulative),
            };
        }),
    };
}

function makeCemigBillingEventsFromTotalizer(projectId: string, contractId: string): BillingEvent[] {
    const monthlyEvents = CEMIG_TOTALIZER_MONTHS
        .filter(row => row[10] > 0 || row[14] > 0)
        .map((row, index) => {
            const eventCount = row[1] + row[3];
            const isPast = row[0] <= CEMIG_TOTALIZER_CUTOFF;
            const status: BillingEvent['status'] = row[14] > 0 ? 'billed' : isPast && row[10] > 0 ? 'delayed' : 'planned';
            const title = eventCount > 0
                ? `Totalizadora ${row[0]} - ${eventCount} evento(s) de pagamento`
                : `Totalizadora ${row[0]} - antecipação/faturamento`;
            return {
                id: `${projectId}-cemig-totalizer-${index + 1}`,
                projectId,
                contractId,
                datePlanned: `${row[0]}-01`,
                dateActual: status === 'billed' ? `${row[0]}-01` : undefined,
                title,
                amountPlannedCents: totalizerCents(row[10]),
                amountActualCents: row[14] > 0 ? totalizerCents(row[14]) : undefined,
                status,
                linked: {
                    documentIds: ['30.04.26-Rev.30-UHE-SC Eventograma.xlsx'],
                },
            };
        });
    const materialEvents: BillingEvent[] = [
        ['2026-06', 'Compra material - SDSC/sincronismo 1a UF', 818454.51, '006-MAT'],
        ['2026-06', 'Compra material - paineis de supervisao/controle', 682156.34, '007-MAT A'],
        ['2026-06', 'Compra material - UAC subestacao Salto Grande', 542226.60, '007-MAT B'],
        ['2026-06', 'Compra material - modulo de comunicacao MCO', 350000.00, '007-MAT C'],
        ['2026-08', 'Compra material - cubiculos media tensao 1a UF', 1582713.75, '304-MAT'],
        ['2026-09', 'Compra material - centros de distribuicao +GA/+GB', 260000.00, '065-MAT A'],
        ['2026-09', 'Faturamento direto terceiro - banco de baterias/conversores', 645609.96, '081-MAT C'],
        ['2026-10', 'Compra material - centros de controle motores +3/4CM', 600000.00, '066-MAT A'],
        ['2026-10', 'Compra material - centro de controle cargas gerais +5CM', 510000.00, '065-MAT B'],
        ['2026-10', 'Compra material - transformadores de excitacao 1a UF', 239680.00, '095-MAT'],
    ].map(([period, title, amount, code], index) => ({
        id: `${projectId}-machine-stop-material-${index + 1}`,
        projectId,
        contractId,
        datePlanned: `${period}-01`,
        title: `${title} (${code})`,
        amountPlannedCents: totalizerCents(amount as number),
        status: 'planned' as const,
        linked: {
            milestoneId: `${projectId}-ms-stop-oct-2026`,
            documentIds: ['03_Eventos_pagamentos'],
        },
    }));

    return [...monthlyEvents, ...materialEvents];
}

// ─── Sample Tasks ────────────────────────────────────────────────
const makeTasks = (projId: string): ProjectTaskV2[] => [
    {
        id: `${projId}-t1`,
        projectId: projId,
        name: 'Mobilização e engenharia de campo',
        description: 'Mobilização da frente UHE Salto Grande e baseline do eventograma Rev.30',
        startDate: '2025-06-01',
        endDate: '2025-12-31',
        baselineStart: '2025-06-01',
        baselineEnd: '2025-11-30',
        status: 'completed',
        responsibleName: 'Ricardo Ferreira',
        progress: 100,
    },
    {
        id: `${projId}-t2`,
        projectId: projId,
        name: 'Compra material — painéis supervisão/controle (007-MAT A)',
        description: 'Pedido de painéis de supervisão e controle para janela jun/2026 da parada de máquina',
        startDate: '2026-05-15',
        endDate: '2026-06-05',
        baselineStart: '2026-05-15',
        baselineEnd: '2026-05-31',
        status: 'in_progress',
        responsibleName: 'Bob Torres',
        progress: 40,
        dependencies: [`${projId}-t1`],
    },
    {
        id: `${projId}-t3`,
        projectId: projId,
        name: 'Compra material — SDSC/sincronismo 1ª UF (006-MAT)',
        description: 'Aquisição SDSC e sincronismo da 1ª UF — evento crítico jun/2026',
        startDate: '2026-05-20',
        endDate: '2026-06-10',
        baselineStart: '2026-05-20',
        baselineEnd: '2026-06-05',
        status: 'in_progress',
        responsibleName: 'Bob Torres',
        progress: 25,
        dependencies: [`${projId}-t1`],
    },
    {
        id: `${projId}-t4`,
        projectId: projId,
        name: 'Compra material — UAC subestação Salto Grande (007-MAT B)',
        description: 'UAC da subestação Salto Grande com entrega prevista para jun/2026',
        startDate: '2026-06-01',
        endDate: '2026-06-25',
        baselineStart: '2026-06-01',
        baselineEnd: '2026-06-20',
        status: 'in_progress',
        responsibleName: 'Carlos Santos',
        progress: 15,
        dependencies: [`${projId}-t2`],
    },
    {
        id: `${projId}-t5`,
        projectId: projId,
        name: 'Compra material — cubículos média tensão (304-MAT)',
        description: 'Cubículos de média tensão 1ª UF — compra prevista ago/2026',
        startDate: '2026-07-01',
        endDate: '2026-08-31',
        baselineStart: '2026-07-01',
        baselineEnd: '2026-08-15',
        status: 'not_started',
        responsibleName: 'Bob Torres',
        progress: 0,
        dependencies: [`${projId}-t3`],
    },
    {
        id: `${projId}-t6`,
        projectId: projId,
        name: 'Compra material — centros de controle parada máquina (065/066-MAT)',
        description: 'Centros de controle motores e cargas gerais para out/2026',
        startDate: '2026-08-01',
        endDate: '2026-10-15',
        baselineStart: '2026-08-01',
        baselineEnd: '2026-09-30',
        status: 'not_started',
        responsibleName: 'Alice Chen',
        progress: 0,
        dependencies: [`${projId}-t5`],
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
    { id: `${projId}-ms1`, name: 'Materiais críticos jun/2026 liberados', date: '2026-06-30', status: 'pending', linkedTaskIds: [`${projId}-t2`, `${projId}-t3`, `${projId}-t4`] },
    { id: `${projId}-ms2`, name: 'Cubículos média tensão no site', date: '2026-08-31', status: 'pending', linkedTaskIds: [`${projId}-t5`] },
    { id: `${projId}-ms-stop-oct-2026`, name: 'Parada de máquina — materiais em campo', date: '2026-10-31', status: 'pending', linkedTaskIds: [`${projId}-t6`] },
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
        title: 'Definir novo investidor projeto CEMIG',
        description: 'Incidente operacional em São Paulo escalado para governança corporativa; monitoramento ativo no comitê de riscos.',
        category: 'Operational',
        probability: 5,
        impact: 5,
        level: 25,
        severity: 'critical',
        exposure: makeMoney(3500000),
        status: 'open',
        ownerId: 'user-1',
        ownerName: 'Alice Chen',
        createdAt: '2026-04-30T17:15:00Z',
        updatedAt: '2026-04-30T17:15:00Z',
    },
    {
        id: `${projId}-r5`,
        title: 'Materiais críticos para parada de máquina em outubro/2026',
        description: 'Eventos de materiais entre junho e outubro/2026 concentram entregas de painéis, cubículos, centros de controle e transformadores necessários para a parada de máquina.',
        category: 'Schedule',
        probability: 4,
        impact: 5,
        level: 20,
        severity: 'critical',
        exposure: makeMoney(CEMIG_MACHINE_STOP_MATERIAL_EXPOSURE),
        mitigation: 'Antecipar pedidos de compra, travar lead times com fornecedores e acompanhar eventos 006-MAT, 007-MAT, 304-MAT, 065-MAT e 066-MAT semanalmente.',
        ownerId: 'user-2',
        ownerName: 'Bob Torres',
        status: 'open',
        createdAt: '2026-04-30T12:00:00Z',
        updatedAt: '2026-04-30T12:00:00Z',
    },
    {
        id: `${projId}-r6`,
        title: 'Faturamento direto a terceiros fora do caixa da Insight',
        description: 'R$ 41,47 mi do contrato estão classificados como faturamento direto para fornecedores terceiros e não devem ser tratados como caixa operacional da Insight.',
        category: 'Financial',
        probability: 3,
        impact: 4,
        level: 12,
        severity: 'high',
        mitigation: 'Separar indicadores de contrato total, caixa Insight e repasse direto em todos os relatórios para evitar superestimação de caixa disponível.',
        ownerId: 'user-4',
        ownerName: 'Diana Reis',
        status: 'mitigating',
        createdAt: '2026-04-30T12:00:00Z',
        updatedAt: '2026-04-30T12:00:00Z',
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
    { id: `${projId}-d4`, name: 'Ata de Comitê CAE-2025-07', category: 'minutes', version: 1, required: true, uploadedAt: '2025-07-20T09:00:00Z', url: '#' },
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
        finance: makeCemigFinanceFromTotalizer(),
        revenue: makeCemigRevenueFromTotalizer(),
        ...(() => {
            const c = makeCemigCostCurveFromTotalizer();
            return { costCurve: c.points, cutoffPeriod: c.cutoffPeriod };
        })(),
        revenueCurve: makeCemigRevenueCurveFromTotalizer(),
        billing_eventogram: makeCemigBillingEventsFromTotalizer('proj-001', 'contract-cemig-001'),
        costBreakdown: makeCemigCostBreakdownFromTotalizer(),
        governance: { deliberation_ids: ['delib-001', 'delib-005'], meeting_ids: ['meet-002'] },
        audit_log: makeAudit('proj-001'),
        contract_id: 'contract-cemig-001',
        // Investor view derives from the CEMIG totalizer (eventograma); no ledger cross-link.
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
        billing_eventogram: generateMockBillingEvents('proj-007', 'contract-enel-001', centsFromReais(75569079), '2025-03', 14, 7, makeMilestones2('proj-007'), makeTasks2('proj-007')),
        costBreakdown: makeBreakdown(45200000),
        governance: { deliberation_ids: ['delib-003'], meeting_ids: ['meet-001', 'meet-003'] },
        audit_log: makeAudit('proj-007'),
        contract_id: 'contract-enel-001',
        finance_project_id: 'proj-4', // Eneva GNL Parnaíba (energy generation)
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
        billing_eventogram: generateMockBillingEvents('proj-002', 'contract-petrobras-p80', centsFromReais(12500000), '2024-03', 12, 10,
            [{ id: 'proj-002-ms1', name: 'Chegada ao FPSO', date: '2024-06-01', status: 'completed' as const }, { id: 'proj-002-ms2', name: 'Energização P-80', date: '2025-03-31', status: 'pending' as const }],
            [{ id: 'proj-002-t1', projectId: 'proj-002', name: 'Mobilização Offshore', startDate: '2024-03-01', endDate: '2024-05-31', baselineStart: '2024-03-01', baselineEnd: '2024-05-31', status: 'completed' as const, responsibleName: 'Pedro Mendes', progress: 100 }]),
        costBreakdown: makeBreakdown(12500000),
        governance: { deliberation_ids: [], meeting_ids: [] },
        audit_log: [],
        contract_id: 'contract-petrobras-p80',
        finance_project_id: 'proj-1', // Petrobras FPSO P-80
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
