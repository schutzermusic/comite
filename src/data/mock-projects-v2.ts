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
const CEMIG_OTHER_INSIGHT_DISBURSEMENTS = 0;
const CEMIG_DIRECT_BILLING_DISBURSEMENTS = 41470199.02;
const CEMIG_TAX_DISBURSEMENTS = 33024500;
const CEMIG_INSIGHT_CASH_REVENUE = 157357492.76;
const CEMIG_MACHINE_STOP_MATERIAL_EXPOSURE = 8127926.01;
const CEMIG_TOTALIZER_CUTOFF = '2026-04';
const CEMIG_TOTALIZER_UPDATED_AT = '2026-04-30T12:00:00Z';

// Source: 30.04.26-Rev.30-UHE-SC Eventograma.xlsx, sheet "04_TOTALIZADORA (3)".
// Tuple: period, gtEvents, gtValue, dEvents, dValue, revenueMonthly, revenueCumulative,
// insightRevenueMonthly, insightRevenueCumulative, insightCashIn, totalReceivable,
// plannedInsightDisbursement, directBillingMonthly, plannedDisbursementCumulative,
// billedMonthly, billedCumulative, ordersMonthly, ordersCumulative.
const CEMIG_TOTALIZER_MONTHS = [
    ["2024-07",0,0,0,0,0,0,0,0,9941384.58901,9941384.58901,100000,0,100000,0,0,9546933.06,9546933.06],
    ["2024-08",0,0,0,0,0,0,0,0,0,0,100000,0,100000,9941384.58901,9941384.58901,0,0],
    ["2024-09",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2024-10",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2024-11",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2024-12",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-01",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-02",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-03",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-04",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-05",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-06",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-07",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-08",0,0,0,0,0,0,0,0,0,0,100000,0,100000,0,9941384.58901,0,0],
    ["2025-09",0,0,0,0,0,0,0,0,0,0,157924.445,0,157924.445,350408.42,10291793.009,0,0],
    ["2025-10",24,412245.17633,0,0,412245.17633,412245.17633,412245.17633,412245.17633,350408.39988,350408.39988,100000,0,157924.445,0,10291793.009,0,0],
    ["2025-11",0,0,0,0,0,412245.17633,0,412245.17633,0,0,140000,0,197924.445,680190.672,10971983.681,1724103.73,11271036.79],
    ["2025-12",0,0,0,0,0,412245.17633,0,412245.17633,0,0,5501436.85,0,5599361.295,0,10971983.681,996943.88,12267980.67],
    ["2026-01",2,441511.47,0,0,441511.47,853756.64633,441511.47,853756.64633,375284.7495,375284.7495,1806646.55,0,7306007.845,181515.511,11153499.192,900062.68,13168043.35],
    ["2026-02",8,3812821.55446,0,0,3812821.55446,4666578.20079,3592295.61446,4446052.26079,3053451.27229,3273977.21229,1800000,220525.94,9226533.785,0,11153499.192,623444.52,13791487.87],
    ["2026-03",9,655154.83,0,0,655154.83,5321733.03079,185675.85,4631728.11079,157824.4725,627303.4525,6251716.141,469478.98,15847728.906,0,11153499.192,628101.5,14419589.37],
    ["2026-04",13,2732612.89283,0,0,2732612.89283,8054345.92362,2401859.59283,7033587.70362,2041580.65391,2372333.95391,340000,330753.3,16418482.206,0,11153499.192,899398.5,15318987.87],
    ["2026-05",6,826234.57,1,801542.66,1627777.23,9682123.15362,826234.57,7859822.27362,702299.3845,1503842.0445,295816.17,801542.66,17415841.036,0,11153499.192,849378.18,16168366.05],
    ["2026-06",11,1155029.7375,0,0,1155029.7375,10837152.8911,886490.6575,8746312.93112,753517.058875,1022056.13887,1971731.644,268539.08,19556111.76,0,11153499.192,186000,16354366.05],
    ["2026-07",10,1160023.34932,0,0,1160023.34932,11997176.2404,943195.41,9689508.34112,801716.0985,1018544.03782,2475450.39,216827.939319,22148390.0893,0,11153499.192,569901.22,16924267.27],
    ["2026-08",13,3984972.43968,4,421218.05,4406190.48968,16403366.7301,4197400.58707,13886908.9282,3567790.49901,3776580.40162,367326.544,208789.902618,22624506.5359,0,11153499.192,0,16924267.27],
    ["2026-09",14,4942914.62,0,0,4942914.62,21346281.3501,2800070.45,16686979.3782,2380059.8825,4522904.0525,500000,2142844.17,25167350.7059,0,11153499.192,0,16924267.27],
    ["2026-10",22,10534527.22,0,0,10534527.22,31880808.5701,10534527.22,27221506.5982,8954348.137,8954348.137,1540145.154,0,26607495.8599,0,11153499.192,0,16924267.27],
    ["2026-11",6,3520581.38,0,0,3520581.38,35401389.9501,3520581.38,30742087.9782,2992494.173,2992494.173,4389595.2501,0,30897091.11,0,11153499.192,0,16924267.27],
    ["2026-12",26,6938924.9575,9,6081414.32,13020339.2775,48421729.2276,6916319.69,37658407.6682,5878871.7365,11982891.324,500806.775,6104019.5875,37401917.4725,0,11153499.192,0,16924267.27],
    ["2027-01",21,11106954.49,15,3485471.42,14592425.91,63014155.1376,5117209.72,42775617.3882,4349628.262,13824844.452,3460866.39375,9475216.19,50238000.0563,0,11153499.192,0,16924267.27],
    ["2027-02",18,7356733.977,0,0,7356733.977,70370889.1146,5713430.665,48489048.0532,4856416.06525,6499719.37725,286098.676,1643303.312,52067402.0443,0,11153499.192,113319.2,17037586.47],
    ["2027-03",25,5308631.567,1,142064.99,5450696.557,75821585.6716,4787228.025,53276276.0782,4069143.82125,4732612.35325,2155686.672,663468.532,54786557.2483,0,11153499.192,0,17037586.47],
    ["2027-04",30,11561534.6555,9,1864951.9075,13426486.563,89248072.2346,12492148.033,65768424.1112,10618325.8281,11552664.3581,1501805.312,934338.53,57122701.0903,0,11153499.192,0,17037586.47],
    ["2027-05",12,4679233.79464,0,0,4679233.79464,93927306.0293,3932919.12464,69701343.2358,3856798.15231,4603112.82231,451183.39,746314.67,58220199.1503,0,11153499.192,0,17037586.47],
    ["2027-06",5,971574.58,2,162483.4,1134057.98,95061364.0093,1032890.43,70734233.6658,1032890.43,1134057.98,2851959.76,101167.55,61073326.4603,0,11153499.192,0,17037586.47],
    ["2027-07",8,3431951.01,2,305374.804,3737325.814,98798689.8233,3406022.74,74140256.4058,3406022.74,3737325.814,1591961.526,331303.074,62896591.0603,0,11153499.192,0,17037586.47],
    ["2027-08",10,2707327.12,1,153914.72,2861241.84,101659931.663,2693217.2,76833473.6058,2693217.2,2861241.84,1258454.51,168024.64,64223070.2103,0,11153499.192,0,17037586.47],
    ["2027-09",19,8180418.34402,0,0,8180418.34402,109840350.007,5924485.20652,82757958.8123,5924485.20652,8180418.34402,2437855.27,2255933.1375,68816858.6178,0,11153499.192,0,17037586.47],
    ["2027-10",13,2261479.41,0,0,2261479.41,112101829.417,2238860.85,84996819.6623,2238860.85,2261479.41,1265680,22618.56,70005157.1778,0,11153499.192,0,17037586.47],
    ["2027-11",0,0,0,0,0,112101829.417,0,84996819.6623,0,0,1922713.75,0,71827870.9278,0,11153499.192,0,17037586.47],
    ["2027-12",3,405825.62,0,0,405825.62,112507655.037,353969.07,85350788.7323,353969.07,405825.62,578452.5,51856.55,72358179.9778,0,11153499.192,113319.22,17150905.69],
    ["2028-01",3,2617584.64,0,0,2617584.64,115125239.677,617584.64,85968373.3723,617584.64,2617584.64,446098.676,2000000,74704278.6538,0,11153499.192,0,17150905.69],
    ["2028-02",10,6062885.555,0,0,6062885.555,121188125.232,5853366.355,91821739.7273,5853366.355,6062885.555,3460866.39375,209519.2,78274664.2475,0,11153499.192,0,17150905.69],
    ["2028-03",21,4898441.315,0,0,4898441.315,126086566.547,4598969.755,96420709.4823,4598969.755,4898441.315,268000,299471.56,78742135.8075,0,11153499.192,0,17150905.69],
    ["2028-04",26,10417487.7395,2,661312.1975,11078799.937,137165366.484,10798799.937,107219509.419,10798799.937,11078799.937,100000,280000,79022135.8075,0,11153499.192,0,17150905.69],
    ["2028-05",6,1673829.96779,0,0,1673829.96779,138839196.452,1522137.96779,108741647.387,1522137.96779,1673829.96779,100000,151692,79173827.8075,0,11153499.192,0,17150905.69],
    ["2028-06",4,452567.6375,0,0,452567.6375,139291764.09,400986.4175,109142633.805,400986.4175,452567.6375,348000,51581.22,79473409.0275,0,11153499.192,0,17150905.69],
    ["2028-07",7,2973836.8,0,0,2973836.8,142265600.89,2973836.8,112116470.605,2973836.8,2973836.8,1529049.758,0,80902458.7855,0,11153499.192,0,17150905.69],
    ["2028-08",5,1618458.85,0,0,1618458.85,143884059.74,1557143.11,113673613.715,1557143.11,1618458.85,2011680,61315.74,82875454.5255,0,11153499.192,0,17150905.69],
    ["2028-09",3,1240472.15,0,0,1240472.15,145124531.89,1240472.15,114914085.865,1240472.15,1240472.15,4053970.13375,0,86829424.6593,0,11153499.192,0,17150905.69],
    ["2028-10",15,5772995.8475,0,0,5772995.8475,150897527.737,3517062.71,118431148.575,3517062.71,5772995.8475,558452.5,2255933.1375,89543810.2968,0,11153499.192,0,17150905.69],
    ["2028-11",6,4795019.43,0,0,4795019.43,155692547.167,795019.43,119226168.005,795019.43,4795019.43,500000,4000000,93943810.2968,0,11153499.192,124651.83,17275557.52],
    ["2028-12",12,4721548.0775,0,0,4721548.0775,160414095.245,4472548.0775,123698716.082,4472548.0775,4721548.0775,324287.121,249000,94417097.4178,0,11153499.192,0,17275557.52],
    ["2029-01",26,5076342.895,0,0,5076342.895,165490438.14,4932537.155,128631253.237,4932537.155,5076342.895,404311.535,143805.74,94865214.6928,0,11153499.192,0,17275557.52],
    ["2029-02",11,476969.059596,2,661312.1975,1138281.2571,166628719.397,978936.307096,129610189.544,978936.307096,1138281.2571,100000,159344.95,95024559.6428,0,11153499.192,0,17275557.52],
    ["2029-03",4,1490473.86,3,341460.63,1831934.49,168460653.887,1532462.93,131142652.474,1532462.93,1831934.49,180000,299471.56,95404031.2028,0,11153499.192,0,17275557.52],
    ["2029-04",3,1227847.99,2,320374.804,1548222.794,170008876.681,1227847.99,132370500.464,1227847.99,1548222.794,3306398.88375,320374.804,98930804.8905,0,11153499.192,0,17275557.52],
    ["2029-05",8,1074727.8275,1,22270.57,1096998.3975,171105875.078,1045417.1775,133415917.642,1045417.1775,1096998.3975,1447504.268,51581.22,100329890.379,0,11153499.192,0,17275557.52],
    ["2029-06",5,2329835.728,0,0,2329835.728,173435710.806,2258515.96,135674433.602,2258515.96,2329835.728,472726.36,71319.768,100773936.507,0,11153499.192,0,17275557.52],
    ["2029-07",16,7554539.4755,0,0,7554539.4755,180990250.282,5227286.57,140901720.172,5227286.57,7554539.4755,500000,2327252.9055,103501189.412,0,11153499.192,0,17275557.52],
    ["2029-08",10,2422092.6,0,0,2422092.6,183412342.882,2404362.84,143306083.012,2404362.84,2422092.6,258995.547,17729.76,103677914.719,0,11153499.192,0,17275557.52],
    ["2029-09",10,3426302.0275,0,0,3426302.0275,186838644.909,3177302.0275,146483385.039,3177302.0275,3426302.0275,100000,249000,103926914.719,0,11153499.192,0,17275557.52],
    ["2029-10",1,930600,0,0,930600,187769244.909,930600,147413985.039,930600,930600,1140850.926,0,104967765.645,0,11153499.192,0,17275557.52],
    ["2029-11",45,6477018.61578,1,160007.52,6637026.13578,194406271.045,6385236.56345,153799221.603,6385236.56345,6637026.13578,100000,251789.57233,105219555.217,0,11153499.192,0,17275557.52],
    ["2029-12",11,711240.255792,5,1019658.6175,1730898.87329,196137169.918,1571553.92329,155370775.526,1571553.92329,1730898.87329,100000,159344.95,105378900.167,0,11153499.192,0,17275557.52],
    ["2030-01",8,2108459.545,2,404333.072,2512792.617,198649962.535,1808987.985,157179763.511,1808987.985,2512792.617,100000,703804.632,106082704.799,0,11153499.192,0,17275557.52],
    ["2030-02",3,177729.245,0,0,177729.245,198827691.78,177729.245,157357492.756,177729.245,177729.245,262278.826,0,106244983.625,0,11153499.192,0,17275557.52],
    ["2030-03",0,0,0,0,0,198827691.78,0,157357492.756,0,0,100000,0,106244983.625,0,11153499.192,0,17275557.52],
] as const;

function totalizerCents(value: number): number {
    return centsFromReais(value);
}

const CEMIG_TOTALIZER_INSIGHT_REVENUE_TOTAL = CEMIG_TOTALIZER_MONTHS.reduce(
    (total, row) => total + row[7],
    0,
);

function totalizerMonthlyTax(row: typeof CEMIG_TOTALIZER_MONTHS[number]): number {
    if (CEMIG_TOTALIZER_INSIGHT_REVENUE_TOTAL <= 0) return 0;
    return (row[7] / CEMIG_TOTALIZER_INSIGHT_REVENUE_TOTAL) * CEMIG_TAX_DISBURSEMENTS;
}

function totalizerMonthlyDisbursement(row: typeof CEMIG_TOTALIZER_MONTHS[number]): number {
    // Monthly cash-out in the S-curve is Insight disbursement plus taxes.
    // Direct billing is a pass-through and must not reduce the cash curve.
    // row[11] came from the totalizer's P+Q monthly display, so remove the
    // auxiliary R$ 100k.
    return Math.max(0, row[11] - 100000) + totalizerMonthlyTax(row);
}

const CEMIG_TOTALIZER_DISBURSEMENT_TOTAL = CEMIG_TOTALIZER_MONTHS.reduce(
    (total, row) => total + totalizerMonthlyDisbursement(row),
    0,
);

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
    const finalDisbursement = CEMIG_TOTALIZER_DISBURSEMENT_TOTAL;
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
            category: 'Impostos sobre receita (20%)',
            bac: makeMoney(CEMIG_TAX_DISBURSEMENTS),
            ac: makeMoney(0),
            eac: makeMoney(CEMIG_TAX_DISBURSEMENTS),
        },
        {
            category: 'Faturamento direto previsto (fora da Curva S)',
            bac: makeMoney(0),
            ac: makeMoney(0),
            eac: makeMoney(0),
        },
    ];
}

function makeCemigRevenueCurveFromTotalizer(): RevenueCurvePoint[] {
    let cashRevenueCumulative = 0;
    return CEMIG_TOTALIZER_MONTHS.map(row => {
        // Eventograma condition: Curva S revenue follows "Valor para entrar
        // em caixa da Insight", including the initial anticipation.
        cashRevenueCumulative += row[9];
        return {
            period: row[0],
            plannedCumulative: totalizerCents(cashRevenueCumulative),
            billedCumulative: row[0] <= CEMIG_TOTALIZER_CUTOFF ? totalizerCents(row[15]) : (null as unknown as number),
            receivedCumulative: null as unknown as number,
        };
    });
}

function makeCemigCostCurveFromTotalizer(): { points: CostCurvePoint[]; cutoffPeriod: string } {
    let cumulative = 0;
    let taxCumulative = 0;
    return {
        cutoffPeriod: CEMIG_TOTALIZER_CUTOFF,
        points: CEMIG_TOTALIZER_MONTHS.map(row => {
            cumulative += totalizerMonthlyDisbursement(row);
            taxCumulative += totalizerMonthlyTax(row);
            return {
                period: row[0],
                bacCumulative: totalizerCents(cumulative),
                acCumulative: null as unknown as number,
                eacCumulative: totalizerCents(cumulative),
                taxCumulative: totalizerCents(taxCumulative),
            };
        }),
    };
}

function makeCemigBillingEventsFromTotalizer(projectId: string, contractId: string): BillingEvent[] {
    return CEMIG_TOTALIZER_MONTHS
        .filter(row => row[10] > 0 || row[14] > 0)
        .map((row, index) => {
            const eventCount = row[1] + row[3];
            const isPast = row[0] <= CEMIG_TOTALIZER_CUTOFF;
            const status: BillingEvent['status'] = row[14] > 0 ? 'billed' : isPast && row[10] > 0 ? 'delayed' : 'planned';
            const title = eventCount > 0
                ? `Totalizadora ${row[0]} - ${eventCount} evento(s) de faturamento`
                : `Totalizadora ${row[0]} - antecipação`;
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
        id: `${projId}-r4`,
        title: 'Definir novo investidor projeto CEMIG',
        description: 'Incidente operacional em São Paulo escalado para governança corporativa; monitoramento ativo no comitê de riscos.',
        category: 'Operational',
        probability: 5,
        impact: 5,
        level: 25,
        severity: 'critical',
        exposure: makeMoney(3500000),
        mitigation: 'Mapeamento de investidores estratégicos em andamento; pauta priorizada no comitê de riscos com revisão quinzenal.',
        status: 'mitigating',
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
    { id: `${projId}-a3`, path: 'risks', before: null, after: `${projId}-r4`, timestamp: '2026-04-30T17:15:00Z', actor: 'Alice Chen', action: 'created' },
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
        directPassThroughCents: centsFromReais(CEMIG_DIRECT_BILLING_DISBURSEMENTS),
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
