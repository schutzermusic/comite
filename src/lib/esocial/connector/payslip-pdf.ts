/**
 * Contracheque PDF -> rubricas provisórias.
 *
 * Esta camada não tenta reconstruir o S-1010. O PDF prova apenas o que está
 * impresso: a coluna (vencimento/desconto), a descrição, a referência e o
 * valor. Campos oficiais do eSocial permanecem explicitamente nulos.
 */

export const PAYSLIP_CLASSIFICATION_WARNING =
  'Classificação provisória por holerite/PDF. A tabela oficial S-1010 segue pendente.';

export type PayslipRubricRole = 'earning' | 'deduction' | 'informative';

export type PayslipSemanticCategory =
  | 'base_salary'
  | 'overtime_50'
  | 'overtime_100'
  | 'overtime_150'
  | 'night_overtime'
  | 'overtime_dsr_reflex'
  | 'night_additional'
  | 'insalubridade'
  | 'periculosidade'
  | 'vacation'
  | 'absence_deduction'
  | 'statutory_inss'
  | 'statutory_irrf'
  | 'benefit_deduction'
  | 'allowance'
  | 'bonus'
  | 'loan_deduction'
  | 'pension_deduction'
  | 'unknown';

export interface PayslipTextItem {
  text: string;
  x: number;
  y: number;
}

export interface PayslipTextPage {
  pageNumber: number;
  items: PayslipTextItem[];
}

export interface ProvisionalPayslipLine {
  employee_name: string;
  employee_code: string;
  competence: string;
  cost_center: string;
  job_title: string;
  rubric_code: string;
  rubric_description: string;
  reference: string | null;
  reference_quantity: number | null;
  reference_hours: number | null;
  earning_cents: number;
  deduction_cents: number;
  rubric_role: PayslipRubricRole;
  semantic_category: PayslipSemanticCategory;
  classification_basis: 'payslip_pdf';
  natRubr: null;
  inssIncidence: null;
  fgtsIncidence: null;
  irrfIncidence: null;
  validity: null;
  source_page: number;
}

export interface PayslipComposition {
  competence: string;
  gross_cents: number;
  deductions_cents: number;
  net_cents: number;
  overtime_cents: number;
  overtime_hours: number;
  benefits_cents: number;
  absence_deductions_cents: number;
  headcount: number;
  line_count: number;
  classification_basis: 'payslip_pdf';
}

interface Row { y: number; items: PayslipTextItem[]; text: string }
interface Metadata {
  employee_name: string;
  employee_code: string;
  competence: string;
  cost_center: string;
  job_title: string;
}

const MONTHS: Record<string, string> = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function rowsOf(page: PayslipTextPage): Row[] {
  const rows: Row[] = [];
  for (const item of page.items.filter((i) => i.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 1.6);
    if (!row) {
      row = { y: item.y, items: [], text: '' };
      rows.push(row);
    }
    row.items.push(item);
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      row.items.sort((a, b) => a.x - b.x);
      row.text = row.items.map((i) => i.text.trim()).filter(Boolean).join(' ');
      return row;
    });
}

function competenceOf(text: string): string {
  const match = normalized(text).match(
    /\b(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)\s+DE\s+(\d{4})\b/,
  );
  if (!match) return '';
  return `${match[2]}-${MONTHS[match[1].toLowerCase()]}`;
}

function moneyToCents(value: string | undefined): number {
  if (!value || !/^-?[\d.]+,\d{2}$/.test(value.trim())) return 0;
  const amount = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function parsePayslipReference(raw: string | null): {
  quantity: number | null;
  hours: number | null;
} {
  if (!raw) return { quantity: null, hours: null };
  const clock = raw.match(/^(\d+):(\d{2})$/);
  if (clock) {
    const minutes = Number(clock[2]);
    if (minutes < 60) return { quantity: null, hours: Number(clock[1]) + minutes / 60 };
  }
  const quantity = Number(raw.replace(/\./g, '').replace(',', '.'));
  return { quantity: Number.isFinite(quantity) ? quantity : null, hours: null };
}

export function classifyPayslipRubric(
  description: string,
  earningCents: number,
  deductionCents: number,
): { role: PayslipRubricRole; category: PayslipSemanticCategory } {
  const d = normalized(description).replace(/[^A-Z0-9%]+/g, ' ').trim();
  const role: PayslipRubricRole =
    /\bINFOR(?:M|MATIV[AO]?)?\b/.test(d)
      ? 'informative'
      : deductionCents > 0
        ? 'deduction'
        : 'earning';

  let category: PayslipSemanticCategory = 'unknown';
  if (/\bINSS\b|I N S S/.test(d)) category = 'statutory_inss';
  else if (/\bIRRF\b|IMPOSTO DE RENDA/.test(d)) category = 'statutory_irrf';
  else if (/PENSAO/.test(d)) category = 'pension_deduction';
  else if (/EMPREST|CONSIGNAD|CRED TRAB/.test(d)) category = 'loan_deduction';
  else if (/FALTAS?|ATRASO/.test(d) || (role === 'deduction' && /AFASTAD/.test(d))) category = 'absence_deduction';
  else if (/REFLEXO.*(?:HORAS? )?EXTRAS?.*DSR|DSR.*HORAS? EXTRAS?/.test(d)) category = 'overtime_dsr_reflex';
  else if (/HORAS? EXTRAS?.*(?:NOT|NOTURN)|(?:NOT|NOTURN).*HORAS? EXTRAS?/.test(d)) category = 'night_overtime';
  else if (/HORAS? EXTRAS?.*150%/.test(d)) category = 'overtime_150';
  else if (/HORAS? EXTRAS?.*100%/.test(d)) category = 'overtime_100';
  else if (/HORAS? EXTRAS?.*50%/.test(d)) category = 'overtime_50';
  else if (/ADIC(?:IONAL)? NOTURN|REFLEXO ADIC.*NOTURN/.test(d)) category = 'night_additional';
  else if (/INSALUBR/.test(d)) category = 'insalubridade';
  else if (/PERICULOS/.test(d)) category = 'periculosidade';
  else if (/FERIAS/.test(d)) category = 'vacation';
  else if (/VALE (?:ALIMENT|REFEIC|TRANSP)|PLANO (?:DE )?(?:SAUDE|ODONT)|ASSISTENCIA (?:MEDICA|ODONT)|SEGURO SAUDE|CESTA|UNIMED|CONVENIO (?:MEDICO|ODONTO)|FARMACIA/.test(d)) category = 'benefit_deduction';
  else if (/AJUDA DE CUSTO|DIARIA|AUXILIO|REEMBOLSO/.test(d)) category = 'allowance';
  else if (/PREMIA|GRATIFICA|BONUS|BONIFICA|PLR|QUADRIENIO/.test(d)) category = 'bonus';
  else if (/DIAS NORMAIS|SALARIO BASE|SALARIO MENSAL|HORAS NORMAIS|ORDENADO|DIFERENCA DE SALARIOS/.test(d)) category = 'base_salary';

  // Coluna vazia dos dois lados não constitui verba, mas manter a função total
  // facilita testes e extensões de leiaute.
  void earningCents;
  return { role, category };
}

function metadataFrom(rows: Row[], previous?: Metadata): Metadata | undefined {
  const allText = rows.map((r) => r.text).join('\n');
  const employeeHeader = rows.findIndex((r) => /Nome do Funcion.rio/i.test(r.text));
  if (employeeHeader < 0) return previous;

  const employeeRow = rows.slice(employeeHeader + 1).find((row) =>
    row.items.some((i) => i.x < 50 && /^\d+$/.test(i.text.trim())) &&
    row.items.some((i) => i.x >= 45 && i.x < 350 && /[A-Za-zÀ-ÿ]/.test(i.text)),
  );
  if (!employeeRow) return previous;
  const employeeCode = employeeRow.items.find((i) => i.x < 50 && /^\d+$/.test(i.text.trim()))?.text.trim() ?? '';
  const employeeName = employeeRow.items
    .filter((i) => i.x >= 45 && i.x < 350)
    .map((i) => i.text.trim()).filter(Boolean).join(' ');
  const employeeIndex = rows.indexOf(employeeRow);
  const titleRow = rows.slice(employeeIndex + 1).find((row) =>
    row.items.some((i) => i.x >= 45 && i.x < 350 && /[A-Za-zÀ-ÿ]/.test(i.text)) &&
    !/C.digo|Total de/i.test(row.text),
  );
  const jobTitle = titleRow?.items
    .filter((i) => i.x >= 45 && i.x < 350)
    .map((i) => i.text.trim()).filter(Boolean).join(' ') ?? previous?.job_title ?? '';

  const cnpjRow = rows.find((r) => /\bCNPJ\s*:/i.test(r.text));
  const ccToken = cnpjRow?.items.findIndex((i) => /^CC:$/i.test(i.text.trim())) ?? -1;
  const costCenter = ccToken >= 0
    ? cnpjRow!.items.slice(ccToken + 1).filter((i) => i.x < 430).map((i) => i.text.trim()).join(' ')
    : previous?.cost_center ?? '';

  return {
    employee_name: employeeName || previous?.employee_name || '',
    employee_code: employeeCode || previous?.employee_code || '',
    competence: competenceOf(allText) || previous?.competence || '',
    cost_center: costCenter || previous?.cost_center || '',
    job_title: jobTitle,
  };
}

function parseBlock(rows: Row[], pageNumber: number, previous?: Metadata): {
  metadata?: Metadata;
  lines: ProvisionalPayslipLine[];
} {
  const metadata = metadataFrom(rows, previous);
  if (!metadata?.employee_code || !metadata.competence) return { metadata, lines: [] };
  const header = rows.findIndex((r) => /C.digo.*Descri..o.*Refer.ncia.*Vencimentos.*Descontos/i.test(r.text));
  if (header < 0) return { metadata, lines: [] };
  const end = rows.findIndex((r, index) => index > header && /Total de Vencimentos/i.test(r.text));
  const body = rows.slice(header + 1, end < 0 ? rows.length : end);
  const lines: ProvisionalPayslipLine[] = [];

  for (const row of body) {
    const rubricCode = row.items.find((i) => i.x < 35 && /^\d+$/.test(i.text.trim()))?.text.trim();
    const description = row.items
      .filter((i) => i.x >= 35 && i.x < 285)
      .map((i) => i.text.trim()).filter(Boolean).join(' ');
    if (!rubricCode || !description) continue;
    const reference = row.items.filter((i) => i.x >= 285 && i.x < 360).map((i) => i.text.trim()).join(' ') || null;
    const earning = row.items.find((i) => i.x >= 360 && i.x < 445 && /^-?[\d.]+,\d{2}$/.test(i.text.trim()))?.text;
    const deduction = row.items.find((i) => i.x >= 445 && i.x < 530 && /^-?[\d.]+,\d{2}$/.test(i.text.trim()))?.text;
    const earningCents = moneyToCents(earning);
    const deductionCents = moneyToCents(deduction);
    if (earningCents === 0 && deductionCents === 0) continue;
    const parsedReference = parsePayslipReference(reference);
    const classification = classifyPayslipRubric(description, earningCents, deductionCents);
    lines.push({
      ...metadata,
      rubric_code: rubricCode,
      rubric_description: description,
      reference,
      reference_quantity: parsedReference.quantity,
      reference_hours: parsedReference.hours,
      earning_cents: earningCents,
      deduction_cents: deductionCents,
      rubric_role: classification.role,
      semantic_category: classification.category,
      classification_basis: 'payslip_pdf' as const,
      natRubr: null,
      inssIncidence: null,
      fgtsIncidence: null,
      irrfIncidence: null,
      validity: null,
      source_page: pageNumber,
    });
  }
  return { metadata, lines };
}

/** Interpreta páginas já extraídas e remove as duas vias idênticas do recibo. */
export function parsePayslipPages(pages: PayslipTextPage[]): ProvisionalPayslipLine[] {
  const parsed: ProvisionalPayslipLine[] = [];
  let previous: Metadata | undefined;

  for (const page of pages) {
    const rows = rowsOf(page);
    const starts = rows
      .map((row, index) => (/\bCNPJ\s*:/i.test(row.text) ? Math.max(0, index - 1) : -1))
      .filter((index) => index >= 0);
    const blocks = starts.length > 0
      ? starts.map((start, i) => rows.slice(start, starts[i + 1] ?? rows.length))
      : [rows]; // continuação sem novo cabeçalho

    for (const block of blocks) {
      const result = parseBlock(block, page.pageNumber, previous);
      if (result.metadata) previous = result.metadata;
      parsed.push(...result.lines);
    }
  }

  const unique = new Map<string, ProvisionalPayslipLine>();
  for (const line of parsed) {
    const key = [
      line.employee_code, normalized(line.employee_name), line.competence,
      normalized(line.cost_center), line.rubric_code, normalized(line.rubric_description),
      line.reference ?? '', line.earning_cents, line.deduction_cents,
    ].join('|');
    if (!unique.has(key)) unique.set(key, line);
  }
  return [...unique.values()];
}

export function aggregatePayslipLines(lines: ProvisionalPayslipLine[]): PayslipComposition[] {
  const byCompetence = new Map<string, ProvisionalPayslipLine[]>();
  for (const line of lines) {
    const list = byCompetence.get(line.competence) ?? [];
    list.push(line);
    byCompetence.set(line.competence, list);
  }
  return [...byCompetence].map(([competence, list]) => {
    const effective = list.filter((l) => l.rubric_role !== 'informative');
    const gross = effective.reduce((sum, l) => sum + l.earning_cents, 0);
    const deductions = effective.reduce((sum, l) => sum + l.deduction_cents, 0);
    const overtime = effective.filter((l) =>
      ['overtime_50', 'overtime_100', 'overtime_150', 'night_overtime', 'overtime_dsr_reflex'].includes(l.semantic_category),
    );
    const hourLines = overtime.filter((l) => l.semantic_category !== 'overtime_dsr_reflex');
    return {
      competence,
      gross_cents: gross,
      deductions_cents: deductions,
      net_cents: gross - deductions,
      overtime_cents: overtime.reduce((sum, l) => sum + l.earning_cents, 0),
      overtime_hours: hourLines.reduce((sum, l) => sum + (l.reference_hours ?? 0), 0),
      benefits_cents: effective.filter((l) => l.semantic_category === 'benefit_deduction')
        .reduce((sum, l) => sum + l.earning_cents + l.deduction_cents, 0),
      absence_deductions_cents: effective.filter((l) => l.semantic_category === 'absence_deduction')
        .reduce((sum, l) => sum + l.deduction_cents, 0),
      headcount: new Set(list.map((l) => `${l.cost_center}|${l.employee_code}|${normalized(l.employee_name)}`)).size,
      line_count: list.length,
      classification_basis: 'payslip_pdf' as const,
    };
  }).sort((a, b) => a.competence.localeCompare(b.competence));
}

/** Extrai texto posicional com pdf.js; PDFs escaneados falham de forma explícita. */
export async function extractPayslipPdf(buffer: Buffer): Promise<{
  pages: number;
  lines: ProvisionalPayslipLine[];
}> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const doc = await task.promise;
  const pages: PayslipTextPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        pageNumber,
        items: content.items.flatMap((item) => {
          if (!('str' in item) || typeof item.str !== 'string' || !item.str.trim() || !('transform' in item)) return [];
          return [{ text: item.str, x: item.transform[4], y: item.transform[5] }];
        }),
      });
    }
  } finally {
    await task.destroy();
  }
  const lines = parsePayslipPages(pages);
  if (lines.length === 0) {
    throw new Error('Nenhuma rubrica foi encontrada. O PDF precisa ter camada de texto e o leiaute de contracheque esperado.');
  }
  return { pages: doc.numPages, lines };
}
