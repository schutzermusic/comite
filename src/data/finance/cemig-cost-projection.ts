import type { LedgerEntry } from '@/lib/types/finance';

const CURRENT_USER = 'user-admin-001';
const START_PERIOD = '2026-06';
const END_PERIOD = '2030-03';

type CemigProjectionLine = {
  label: string;
  monthlyAmountCents: number;
  projectCostCategory: string;
  categoryId: string;
  costCenterId: string;
  detail: string;
};

const cemigFixedCostProjectionLines: CemigProjectionLine[] = [
  {
    label: 'Folha de pagamento / salários',
    monthlyAmountCents: 23_613_662,
    projectCostCategory: 'Folha / ordenados e salários',
    categoryId: 'cat-b11',
    costCenterId: 'cc-eng-campo',
    detail: 'Projeção mensal sugerida de folha direta CEMIG',
  },
  {
    label: 'Ábaco — Cursos / treinamentos',
    monthlyAmountCents: 2_000_000,
    projectCostCategory: 'Serviços / terceiros',
    categoryId: 'cat-b41',
    costCenterId: 'cc-eng-campo',
    detail: 'Projeção mensal sugerida de cursos e treinamentos',
  },
  {
    label: 'TI / processamento de dados',
    monthlyAmountCents: 393_764,
    projectCostCategory: 'Internet',
    categoryId: 'cat-c22',
    costCenterId: 'cc-ti',
    detail: 'Projeção mensal sugerida de TI e processamento de dados',
  },
  {
    label: 'Aluguel de imóvel/base de apoio',
    monthlyAmountCents: 200_000,
    projectCostCategory: 'LOGISTICAS/Mobilização',
    categoryId: 'cat-b27',
    costCenterId: 'cc-mob',
    detail: 'Projeção mensal sugerida de base de apoio',
  },
  {
    label: 'Aluguel de equipamentos / contêineres',
    monthlyAmountCents: 176_213,
    projectCostCategory: 'LOGISTICAS/Mobilização',
    categoryId: 'cat-b43',
    costCenterId: 'cc-mob',
    detail: 'Projeção mensal sugerida de equipamentos e contêineres',
  },
  {
    label: 'Locação de veículos dedicada',
    monthlyAmountCents: 2_700_000,
    projectCostCategory: 'LOGISTICAS/Mobilização',
    categoryId: 'cat-b23',
    costCenterId: 'cc-mob',
    detail: 'Projeção mensal sugerida de veículos dedicados',
  },
  {
    label: 'Imóveis/alojamentos adicionais',
    monthlyAmountCents: 677_890,
    projectCostCategory: 'LOGISTICAS/Mobilização',
    categoryId: 'cat-b21',
    costCenterId: 'cc-mob',
    detail: 'Projeção mensal sugerida de alojamentos adicionais',
  },
  {
    label: 'Internet / telecom',
    monthlyAmountCents: 30_529,
    projectCostCategory: 'Internet',
    categoryId: 'cat-c22',
    costCenterId: 'cc-ti',
    detail: 'Projeção mensal sugerida de internet e telecom',
  },
  {
    label: 'Energia / utilidades',
    monthlyAmountCents: 100_000,
    projectCostCategory: 'Energia elétrica',
    categoryId: 'cat-c22',
    costCenterId: 'cc-eng-campo',
    detail: 'Projeção mensal sugerida de energia e utilidades',
  },
  {
    label: 'Plano de saúde / benefício',
    monthlyAmountCents: 77_991,
    projectCostCategory: 'Plano de saúde',
    categoryId: 'cat-b13',
    costCenterId: 'cc-eng-campo',
    detail: 'Projeção mensal sugerida de benefício/plano de saúde',
  },
];

function projectionPeriods(start: string, end: string): string[] {
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  const out: string[] = [];
  for (let year = startYear, month = startMonth; year < endYear || (year === endYear && month <= endMonth); month += 1) {
    if (month > 12) {
      year += 1;
      month = 1;
    }
    out.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return out;
}

export const cemigProjectedCostLedgerEntries: LedgerEntry[] = projectionPeriods(START_PERIOD, END_PERIOD).flatMap((period) =>
  cemigFixedCostProjectionLines.map((line, index) => {
    const entryDate = `${period}-01`;
    return {
      id: `cemig-proj-${period}-${String(index + 1).padStart(2, '0')}`,
      entry_date: entryDate,
      competence_month: period,
      description: `CEMIG projeção · ${line.projectCostCategory} · ${line.label}`,
      amount_cents: line.monthlyAmountCents,
      currency: 'BRL',
      category_id: line.categoryId,
      cost_center_id: line.costCenterId,
      project_id: 'proj-cemig',
      contract_id: 'ctr-cemig',
      business_unit_id: 'bu-mg',
      period_key: period,
      entry_type: 'forecast',
      scenario: 'forecast',
      status: 'posted',
      source_system: 'manual',
      source_ref: `cemig-fixed-cost-projection:${period}:${index + 1}`,
      evidence_required: false,
      evidence_provided: true,
      metadata: {
        supplierName: line.label,
        expenseType: 'PROJEÇÃO DE CUSTO FIXO',
        projectCostCategory: line.projectCostCategory,
        sourceDocument: 'Projeção de custos fixos CEMIG informada pelo usuário',
        rawDetail: line.detail,
        projectionStartPeriod: START_PERIOD,
        projectionEndPeriod: END_PERIOD,
      },
      created_by: CURRENT_USER,
      posted_by: CURRENT_USER,
      posted_at: `${entryDate}T12:00:00Z`,
      created_at: `${entryDate}T08:00:00Z`,
      updated_at: `${entryDate}T12:00:00Z`,
    };
  }),
);
