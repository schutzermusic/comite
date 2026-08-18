/**
 * Série sintética para PRÉ-VISUALIZAÇÃO de relatório e QA visual.
 *
 * ─── Por que isto mora em `scripts/` e não em `src/` ───────────────────────
 *
 * Pessoas & Custos removeu toda a camada de demonstração por decisão de
 * produto: depois de formatado na tela, um número modelado é indistinguível de
 * um apurado, e a única defesa é não produzi-lo. Uma série sintética alcançável
 * pelo bundle da aplicação é exatamente o risco que aquela decisão eliminou —
 * bastaria um import distraído para o cockpit voltar a exibir uma empresa que
 * não existe.
 *
 * Aqui os números servem para OLHAR O LAYOUT: conferir paginação, quebra de
 * página, densidade dos gráficos e contraste nos dois temas. Eles nunca
 * chegam ao usuário.
 *
 * A série cobre os dois extremos que o layout precisa aguentar:
 *   • `WORKFORCE_DEMO_SERIES` — competências completas, todos os indicadores;
 *   • `WORKFORCE_SPARSE_SERIES` — folha sem eSocial, para provar que a
 *     ausência é desenhada como ausência, e não como zero.
 */

import type { WorkforceActuals, WorkforceMonthlyRecord } from '@/lib/workforce/period';

const AREAS = [
  { code: 'OPER', label: 'Operações de Campo', headcount: 28, payroll: 384_000 },
  { code: 'MANU', label: 'Manutenção Pesada', headcount: 17, payroll: 246_000 },
  { code: 'ADM', label: 'Administrativo', headcount: 9, payroll: 118_000 },
  { code: 'ENG', label: 'Engenharia', headcount: 6, payroll: 132_000 },
  { code: 'SUP', label: 'Suprimentos', headcount: 4, payroll: 62_000 },
];

function areasFor(i: number): WorkforceActuals['areas'] {
  return AREAS.map((a, ai) => ({
    code: a.code,
    label: a.label,
    headcount: a.headcount + ((i + ai) % 3),
    admissions: ai === 0 ? 2 : ai === 1 ? 1 : 0,
    terminations: ai === 0 ? 1 : ai === 3 ? 1 : 0,
    absenceDays: 4 + ((i * 3 + ai * 5) % 14),
    payroll: a.payroll + i * 2_400,
  }));
}

function actualsFor(i: number): WorkforceActuals {
  const areas = areasFor(i);
  const salary = 640_000 + i * 9_000;
  return {
    admissions: areas.reduce((s, a) => s + a.admissions, 0),
    terminations: areas.reduce((s, a) => s + a.terminations, 0),
    absenceDays: areas.reduce((s, a) => s + a.absenceDays, 0),
    absenceEvents: 8 + (i % 5),
    overtimePct: Number((8.4 + i * 0.7).toFixed(1)),
    headcountSource: 'esocial',
    composition: { salary, benefits: 118_000 + i * 1_200, charges: 122_000 + i * 1_600 },
    benefitsByType: {
      va: 42_000,
      vr: 31_000,
      health: 28_000 + i * 400,
      dental: 7_000,
      transport: 10_000,
      other: 0,
    },
    areas,
  };
}

const MONTHS = [
  '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
];

/** Doze competências completas — o caso "tudo apurado". */
export const WORKFORCE_DEMO_SERIES: WorkforceMonthlyRecord[] = MONTHS.map((competenceMonth, i) => {
  const areas = areasFor(i);
  const payroll = areas.reduce((s, a) => s + a.payroll, 0);
  const headcount = areas.reduce((s, a) => s + a.headcount, 0);
  return {
    competenceMonth,
    headcount,
    payroll,
    // Crescimento da receita abaixo do da folha nos últimos meses, para o
    // relatório exercitar o caminho de alerta em vez de só o caminho saudável.
    revenue: 2_760_000 + i * (i > 7 ? 12_000 : 46_000),
    pj: 0,
    clt: headcount,
    pjCost: 0,
    cltCost: payroll,
    costCenters: areas.map((a) => ({
      id: `esocial-${a.code}`,
      name: a.label,
      payrollValue: a.payroll,
      headcount: a.headcount,
    })),
    actuals: actualsFor(i),
  };
});

/**
 * Folha importada sem apuração do eSocial.
 *
 * Exercita o caminho que mais importa revisar no layout: metade dos
 * indicadores AUSENTE. Se algum deles aparecer como `0` no documento, o
 * problema aparece aqui antes de aparecer num relatório de board.
 */
export const WORKFORCE_SPARSE_SERIES: WorkforceMonthlyRecord[] = MONTHS.slice(-4).map(
  (competenceMonth, i) => ({
    competenceMonth,
    headcount: 0,
    payroll: 910_000 + i * 7_000,
    revenue: 0,
    pj: 0,
    clt: 0,
    pjCost: 0,
    cltCost: 910_000 + i * 7_000,
    costCenters: [
      { id: 'cc-importado-total', name: 'Folha Importada', payrollValue: 910_000 + i * 7_000, headcount: 0 },
    ],
  }),
);
