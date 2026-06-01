/**
 * Payroll parser calibration harness.
 *
 *   npx tsx scripts/payroll-parse-check.mts [path/to/folha.xlsx]
 *
 * With no argument it builds a deliberately MESSY synthetic pt-BR payroll
 * workbook (modeled on common Brazilian payroll exports: "Total de Proventos",
 * "Total de Descontos", "Total Geral", "Colaboradores: N", month-name
 * competence, mixed number/text currency) and runs the deterministic parser
 * against it, printing what was extracted + validation flags. This is NOT the
 * company's real spreadsheet — it is a realistic stand-in to exercise/regress
 * the parsing rules. Pass a real .xlsx path to calibrate against actual data.
 */

import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { parseWorkbook, normalizeBRLToCents, normalizeCompetence } from '../src/lib/payroll/parser';

/** Deterministic money/competence normalization regression checks. */
function runNormalizationChecks(): void {
  console.log('\n=== Normalização (regressão) ===');
  const money: Array<[unknown, number]> = [
    ['R$ 1.234.567,89', 123456789],
    ['1.234.567,89', 123456789],
    ['1,234,567.89', 123456789],
    ['1867500', 186750000],
    [1867500, 186750000],
    ['R$ 0,00', 0],
    ['Colaboradores: 142', 14200],
    ['(1.000,00)', -100000],
    ['-R$ 250,50', -25050],
    ['12.000', 1200000],
  ];
  for (const [input, want] of money) {
    const got = normalizeBRLToCents(input);
    console.log(`   ${got === want ? 'OK ' : 'XX '} BRL ${JSON.stringify(input).padEnd(22)} got=${got} want=${want}`);
  }
  const comp: Array<[unknown, string]> = [
    ['05/2026', '2026-05'],
    ['2026-05', '2026-05'],
    ['MAIO/2026', '2026-05'],
    ['Competência: 05/2026', '2026-05'],
    ['maio de 2026', '2026-05'],
    ['Referência 12/2025', '2025-12'],
  ];
  for (const [input, want] of comp) {
    const got = normalizeCompetence(input);
    console.log(`   ${got === want ? 'OK ' : 'XX '} COMP ${JSON.stringify(input).padEnd(24)} got=${got} want=${want}`);
  }
}

function buildSyntheticWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // "Resumo" — messy on purpose: subtotals before the grand total, currency as
  // text with R$, a headcount cell with a colon, competence as month name.
  const resumo = [
    ['Folha de Pagamento — Resumo Gerencial'],
    ['Competência:', 'MAIO/2026'],
    [],
    ['Descrição', 'Valor'],
    ['Total de Proventos', 'R$ 1.430.000,00'],
    ['Total de Descontos', 'R$ 312.500,00'],
    ['Salário Bruto', 'R$ 1.250.000,00'],
    ['Encargos (INSS/FGTS)', 'R$ 437.500,00'],
    ['Benefícios (VT/VR/Saúde)', 'R$ 180.000,00'],
    ['TOTAL GERAL DA FOLHA', 'R$ 1.867.500,00'],
    ['Total Mês Anterior', 'R$ 1.790.000,00'],
    ['Colaboradores:', '142'],
  ];

  const centros = [
    ['Centro de Custo', 'Valor Atual', 'Mês Anterior'],
    ['Engenharia', 'R$ 620.000,00', 'R$ 600.000,00'],
    ['Operações', 'R$ 540.000,00', 'R$ 520.000,00'],
    ['Administrativo', 'R$ 410.000,00', 'R$ 400.000,00'],
    ['Comercial', 'R$ 297.500,00', 'R$ 270.000,00'],
    ['TOTAL', 'R$ 1.867.500,00', 'R$ 1.790.000,00'],
  ];

  const colaboradores = [
    ['Nome', 'Centro de Custo', 'Vínculo', 'Salário Bruto', 'Líquido'],
    ['João Silva', 'Engenharia', 'CLT', 9000, 8500],
    ['Maria Souza', 'Comercial', 'PJ', 12000, 12000],
    ['Carlos Lima', 'Operações', 'CLT', 'R$ 7.500,00', 'R$ 6.900,00'],
  ];

  const banco = [
    ['Beneficiário', 'Banco', 'Agência', 'Conta', 'Valor Líquido'],
    ['João Silva', '001', '1234', '56789-0', 'R$ 8.500,00'],
    ['Maria Souza', '341', '4321', '12345-6', 'R$ 12.000,00'],
    ['Carlos Lima', '237', '9876', '65432-1', 'R$ 6.900,00'],
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(centros), 'Centro de Custo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(colaboradores), 'Colaboradores');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(banco), 'Banco Pagamento');
  return wb;
}

const brl = (c: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100);

runNormalizationChecks();

const path = process.argv[2];
const wb = path
  ? XLSX.read(readFileSync(path), { type: 'buffer' })
  : buildSyntheticWorkbook();

console.log(`\n=== Fonte: ${path ?? 'workbook sintético (pt-BR messy)'} ===`);
const r = parseWorkbook(wb, { competenceHint: '2026-05' });

console.log('Abas detectadas      :', r.detected_sheets.join(', '));
console.log('Competência          :', r.competence_month);
console.log('Total da folha       :', brl(r.total_amount_cents));
console.log('Mês anterior         :', brl(r.previous_month_amount_cents));
console.log('Variação             :', brl(r.variation_amount_cents), `(${r.variation_percentage}%)`);
console.log('Bruto / Encargos / Benef:', brl(r.gross_amount_cents ?? 0), '/', brl(r.charges_amount_cents ?? 0), '/', brl(r.benefits_amount_cents ?? 0));
console.log('Headcount            :', r.headcount, ` (CLT ${r.clt_count ?? '-'} / PJ ${r.pj_count ?? '-'})`);
console.log('Reconciliado         :', r.reconciled);
console.log('Centros de custo     :');
for (const c of r.cost_centers) console.log('   -', c.cost_center_label.padEnd(16), brl(c.amount_cents), c.variation_percentage != null ? `(${c.variation_percentage}%)` : '');
console.log('Linhas bancárias     :', r.bank_lines.length);
for (const b of r.bank_lines) console.log('   -', b.beneficiary.padEnd(14), b.bank, b.branch, b.account, brl(b.amount_cents));
console.log('Colaboradores        :', r.employees.length);
console.log('Flags                :');
for (const f of r.flags) console.log(`   [${f.severity}] ${f.code}: ${f.message}`);

const expect = (label: string, got: unknown, want: unknown) =>
  console.log(`   ${got === want ? 'OK ' : 'XX '} ${label}: got=${String(got)} want=${String(want)}`);

// Expectations for the synthetic workbook (sanity asserts when no real file).
if (!path) {
  console.log('\n=== Asserções (workbook sintético) ===');
  expect('competence', r.competence_month, '2026-05');
  expect('total_cents', r.total_amount_cents, 186750000);
  expect('previous_cents', r.previous_month_amount_cents, 179000000);
  expect('gross_cents', r.gross_amount_cents, 125000000);
  expect('headcount', r.headcount, 142);
  expect('cost_centers', r.cost_centers.length, 4);
  expect('bank_lines', r.bank_lines.length, 3);

  runRealLayoutChecks();
}

/**
 * Regression test for the REAL company layout (Demonstrativo - Folha 04-2026):
 * "Centro de Custos" with side-by-side current/previous tables each ending in a
 * TOTAL row, and a "POR BANCO" sheet with a title banner + PD/PF sub-header.
 * Uses the real expected aggregates but entirely fake personal data, so the
 * layout is covered without committing the sensitive spreadsheet.
 */
function runRealLayoutChecks(): void {
  const wb2 = XLSX.utils.book_new();
  // Side-by-side cost-center tables: current (cols 0-1) + previous (cols 4-5).
  const cc = [
    ['Folha 04/2026', '', '', '', 'Folha 03/2026', ''],
    ['CENTRO DE CUSTO ', 'VALOR (Group+ Energia)', '', '', 'CENTRO DE CUSTO ', 'VALOR (Group+ Energia)'],
    ['LONDRINA', 1000000.0, '', '', 'LONDRINA', 900000.0],
    ['ENGENHARIA', 500000.0, '', '', 'ENGENHARIA', 450000.0],
    ['PJ', 178355.8, '', '', 'PJ', 195218.58],
    ['TOTAL', 1678355.8, '', '', '', ''],
    ['', '', '', '', 'TOTAL', 1545218.58],
  ];
  // Bank sheet with the title banner that used to hijack columns.
  const banco = [
    ['VALOR TOTAL POR BANCO '],
    ['', 'Group X-Bradesco'],
    ['', 'COLABORADOR', 'BANCO', 'AGÊNC.', 'OPER.', 'CONTA', 'CPF', 'VALOR'],
    ['', '', '', '', '', '', '', 'PD', 'PF'],
    [1, 'Fulano de Tal', 'Bradesco', '0560', 'C/S', '12345-6', '000.000.000-00', 3000.0],
    [2, 'Beltrano Silva', 'Itau', '0001', 'C/C', '65432-1', '111.111.111-11', 4500.5],
  ];
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['FOLHA PAGAMENTO', '', 'Folha 04/2026']]), 'Folha 04-2026');
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(banco), 'Folha 04-2026 POR BANCO ');
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(cc), 'Centro de Custos');

  const x = parseWorkbook(wb2);
  console.log('\n=== Asserções (layout real — dados fake) ===');
  expect('competence', x.competence_month, '2026-04');
  expect('total_cents', x.total_amount_cents, 167835580);
  expect('previous_cents', x.previous_month_amount_cents, 154521858);
  expect('variation_cents', x.variation_amount_cents, 13313722);
  expect('cost_centers', x.cost_centers.length, 3);
  expect('cc_prev_attached', x.cost_centers[0].previous_amount_cents, 90000000);
  expect('bank_lines', x.bank_lines.length, 2);
  expect('bank_amount_real', x.bank_lines[0].amount_cents, 300000);
  expect('reconciled', x.reconciled, true);
}
