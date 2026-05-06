import { MockEsocialBiService, getEsocialDashboardData } from "@/lib/esocial/services";

export class EsocialPayrollAggregator extends MockEsocialBiService {
  getConsumerPayload() {
    const data = getEsocialDashboardData();
    return {
      workforceSummary: data.workforce,
      payrollSummary: data.payroll,
      errors: data.errors,
      headcountTrend: data.monthlyTrend.map((point) => ({
        competence: point.competence,
        headcount: point.headcount,
      })),
      turnoverSummary: {
        turnoverPercent: data.workforce.turnoverPercent,
        admissions: data.workforce.admissions,
        terminations: data.workforce.terminations,
      },
      tenureRanking: data.tenureRanking,
      overtimeRanking: data.overtimeRanking,
      departmentCostConcentration: data.departmentConcentration,
      workforceAlerts: data.workforce.alerts,
      payrollMonthlySnapshot: data.payroll,
      payrollRubricBreakdown: {
        base_salary: 0,
        overtime: data.payroll.overtimeAmount,
        benefits: data.payroll.benefits,
        taxes_charges: data.payroll.taxesCharges,
        deductions: data.payroll.deductions,
      },
      payrollCostByProject: [],
      payrollCostByCostCenter: data.departmentConcentration,
      overtimeCost: data.payroll.overtimeAmount,
      benefitsCost: data.payroll.benefits,
      payrollAllocationMatrix: [],
      dreImpact: data.payroll.dreImpactAmount,
    };
  }
}

export const esocialPayrollAggregator = new EsocialPayrollAggregator();
