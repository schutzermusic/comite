/**
 * Deterministic payroll spreadsheet parser (SheetJS / xlsx).
 *
 * Runs in the browser from an uploaded `File`. The spreadsheet is the SOURCE OF
 * TRUTH — this module extracts numbers; the AI narrative only ever sees the
 * `PayrollParseResult` produced here, never the raw workbook. All money helpers
 * are pure and unit-testable.
 */

import * as XLSX from 'xlsx';
import type {
  PayrollBankLine,
  PayrollComparison,
  PayrollComparisonRow,
  PayrollCostCenterTotal,
  PayrollEmployeeLine,
  PayrollParseResult,
  PayrollValidationFlag,
} from '@/lib/types/payroll-closing';

// ── Money & competence normalization (pure) ─────────────────

/**
 * Normalize a Brazilian currency string/number to integer cents.
 * Handles `R$ 1.234.567,89`, `1234567,89`, `1,234,567.89`, raw numbers.
 */
export function normalizeBRLToCents(input: unknown): number {
  if (input == null) return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0;
    return Math.round(input * 100);
  }
  let s = String(input).trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || s.includes('-');
  // Keep only digits and separators — drops "R$", letters, ":", "%", spaces,
  // parentheses and any other stray label characters (real exports are messy).
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Last separator is the decimal one.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // pt-BR: '.' thousands, ',' decimal
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // en: ',' thousands, '.' decimal
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Only comma → decimal separator
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    // No comma present. pt-BR currency has no decimals without a comma, so a
    // pure thousands pattern (1.234.567 / 12.000) means the dots are thousands
    // separators. Anything else (e.g. "1234.56") keeps the dot as a decimal.
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  // else: plain digits → already JS-parseable

  s = s.replace(/-/g, '');
  const value = Number.parseFloat(s);
  if (!Number.isFinite(value)) return 0;
  const cents = Math.round(value * 100);
  return negative ? -cents : cents;
}

const MONTHS_PT: Record<string, string> = {
  janeiro: '01', jan: '01',
  fevereiro: '02', fev: '02',
  marco: '03', mar: '03',
  abril: '04', abr: '04',
  maio: '05', mai: '05',
  junho: '06', jun: '06',
  julho: '07', jul: '07',
  agosto: '08', ago: '08',
  setembro: '09', set: '09',
  outubro: '10', out: '10',
  novembro: '11', nov: '11',
  dezembro: '12', dez: '12',
};

/** Normalize many competence spellings to YYYY-MM. Returns '' if unknown. */
export function normalizeCompetence(input: unknown): string {
  if (input == null) return '';
  const raw = String(input).trim().toLowerCase();
  if (!raw) return '';

  // YYYY-MM or YYYY/MM
  let m = raw.match(/(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  // MM/YYYY or MM-YYYY
  m = raw.match(/(\d{1,2})[-/](\d{4})/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  // "maio/2026", "maio de 2026", "mai 2026"
  m = raw.match(/([a-zç]+)\D+(\d{4})/);
  if (m) {
    const key = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '');
    const mm = MONTHS_PT[key];
    if (mm) return `${m[2]}-${mm}`;
  }
  return '';
}

export function previousCompetence(competence: string): string {
  const m = competence.match(/(\d{4})-(\d{2})/);
  if (!m) return '';
  let year = Number(m[1]);
  let month = Number(m[2]) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

// ── Sheet detection ─────────────────────────────────────────

const SHEET_PATTERNS = {
  payroll: /folha|resumo|geral|sal[aá]rio|consolidad/i,
  bank: /banco|pagamento|remessa|transfer|pix/i,
  costCenter: /centro|custo|cc|setor|departament/i,
  employees: /colaborador|funcion[aá]rio|empregad|nominal/i,
};

function pickSheet(wb: XLSX.WorkBook, pattern: RegExp): string | undefined {
  return wb.SheetNames.find((n) => pattern.test(n));
}

type Grid = unknown[][];

function sheetToGrid(wb: XLSX.WorkBook, name: string): Grid {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' });
}

function flat(grid: Grid): string[] {
  return grid.flat().map((c) => String(c ?? ''));
}

/** Find the first cents value on the row whose first non-empty cell matches `label`. */
/**
 * First monetary value on the row whose label matches `label`. When `exclude`
 * is given, rows whose label also matches `exclude` are skipped — this is how
 * we avoid grabbing subtotal rows ("Total de Proventos/Descontos") instead of
 * the grand total, a common shape in real payroll exports.
 */
function findLabeledValue(grid: Grid, label: RegExp, exclude?: RegExp): number | undefined {
  for (const row of grid) {
    const cells = row.map((c) => String(c ?? ''));
    if (!cells.some((c) => label.test(c))) continue;
    if (exclude && cells.some((c) => exclude.test(c))) continue;
    // Take the last cell that looks monetary on that row.
    for (let i = cells.length - 1; i >= 0; i--) {
      const cents = normalizeBRLToCents(row[i]);
      if (cents !== 0 && /[\d]/.test(cells[i])) return cents;
    }
  }
  return undefined;
}

// ── Comparison ──────────────────────────────────────────────

function pct(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(2));
}

export function buildComparison(
  currentTotal: number,
  previousTotal: number,
  costCenters: PayrollCostCenterTotal[],
): PayrollComparison {
  const rows: PayrollComparisonRow[] = costCenters
    .filter((cc) => cc.previous_amount_cents != null)
    .map((cc) => {
      const prev = cc.previous_amount_cents ?? 0;
      const variation = cc.amount_cents - prev;
      return {
        label: cc.cost_center_label,
        current_cents: cc.amount_cents,
        previous_cents: prev,
        variation_cents: variation,
        variation_percentage: pct(cc.amount_cents, prev),
      };
    });
  const sorted = [...rows].sort((a, b) => b.variation_cents - a.variation_cents);
  return {
    current_total_cents: currentTotal,
    previous_total_cents: previousTotal,
    variation_cents: currentTotal - previousTotal,
    variation_percentage: pct(currentTotal, previousTotal),
    top_increases: sorted.filter((r) => r.variation_cents > 0).slice(0, 5),
    top_decreases: sorted.filter((r) => r.variation_cents < 0).reverse().slice(0, 5),
  };
}

// ── Main parse ──────────────────────────────────────────────

export interface ParseOptions {
  /** Fallback competence (e.g. from the form) if the workbook has none. */
  competenceHint?: string;
}

export async function parsePayrollWorkbook(
  file: File,
  options: ParseOptions = {},
): Promise<PayrollParseResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  return parseWorkbook(wb, options);
}

/** Pure-ish core (workbook in, result out) — easy to unit test. */
export function parseWorkbook(wb: XLSX.WorkBook, options: ParseOptions = {}): PayrollParseResult {
  const flags: PayrollValidationFlag[] = [];
  const detected_sheets = [...wb.SheetNames];

  const payrollSheet = pickSheet(wb, SHEET_PATTERNS.payroll) ?? wb.SheetNames[0];
  const grid = payrollSheet ? sheetToGrid(wb, payrollSheet) : [];

  // The cost-center summary sheet is the authoritative source for the grand
  // totals (current + previous month) in real exports; the payroll sheet only
  // holds per-employee detail and per-obra subtotals.
  const ccSheetName = pickSheet(wb, SHEET_PATTERNS.costCenter);
  const ccGrid = ccSheetName ? sheetToGrid(wb, ccSheetName) : [];

  // Competence — scan the summary sheet first, then the payroll sheet.
  let competence_month = '';
  for (const c of [...flat(ccGrid), ...flat(grid)]) {
    const norm = normalizeCompetence(c);
    if (norm) { competence_month = norm; break; }
  }
  if (!competence_month) competence_month = normalizeCompetence(options.competenceHint) || options.competenceHint || '';
  if (!competence_month) {
    flags.push({
      severity: 'warning',
      code: 'competence_missing',
      message: 'Competência não localizada na planilha. Informe a competência manualmente.',
    });
  }

  // Cost centers + grand totals from the summary sheet (handles side-by-side
  // current/previous tables, each ending in a TOTAL row).
  const cc = parseCostCenterSheet(ccGrid, competence_month);
  const cost_centers = cc.centers;

  // Totals: prefer the summary sheet's TOTAL rows; fall back to qualified
  // grand-total labels on the payroll sheet, then to the sum of cost centers.
  const EXCLUDE_SUBTOTAL = /proventos|descontos|m[eê]s\s*anterior|anterior|por\s+obra|por\s+banco/i;
  let total_amount_cents =
    cc.currentTotal ??
    findLabeledValue(grid, /total\s+geral|total\s+da\s+folha|total\s+l[ií]quido|l[ií]quido\s+a\s+pagar/i) ??
    findLabeledValue(grid, /valor\s+total|total\s+folha|custo\s+total\s+da\s+folha/i) ??
    findLabeledValue(grid, /total/i, EXCLUDE_SUBTOTAL) ??
    0;
  if (total_amount_cents === 0 && cost_centers.length > 0) {
    total_amount_cents = cost_centers.reduce((s, c) => s + c.amount_cents, 0);
  }
  const previous_month_amount_cents =
    cc.previousTotal ??
    findLabeledValue(grid, /m[eê]s\s*anterior|compet[eê]ncia anterior/i) ??
    findLabeledValue(grid, /anterior/i) ??
    0;

  // Gross/charges/benefits split only from a real totals-summary grid (one with
  // a grand-total label or a short summary) — never from per-employee detail,
  // which would surface a single employee's value as a "total".
  const isSummary = (g: Grid) =>
    g.length > 0 && (g.length < 20 || g.some((row) => row.some((c) => /total\s+geral|total\s+da\s+folha/i.test(String(c ?? '')))));
  const splitGrid = isSummary(grid) ? grid : isSummary(ccGrid) ? ccGrid : [];
  const gross_amount_cents = splitGrid.length ? findLabeledValue(splitGrid, /sal[aá]rio\s+bruto|^bruto|proventos/i, /total|l[ií]quido|desconto/i) : undefined;
  const charges_amount_cents = splitGrid.length ? findLabeledValue(splitGrid, /encargo|inss|fgts|provis/i, /total\s+geral/i) : undefined;
  const benefits_amount_cents = splitGrid.length ? findLabeledValue(splitGrid, /benef[ií]cio|vale\s|vt\b|vr\b|sa[uú]de/i, /total\s+geral/i) : undefined;
  // Only searched on a summary grid, so a per-employee "Colaborador" column
  // can't be mistaken for a headcount total here.
  const headcountValue = splitGrid.length ? findLabeledValue(splitGrid, /headcount|colaboradores|funcion[aá]rios|qtd/i) : undefined;
  const payment_deadline = undefined;

  if (total_amount_cents === 0) {
    flags.push({
      severity: 'error',
      code: 'total_missing',
      message: 'Total da folha não localizado. Verifique se a aba/linha de total está presente.',
    });
  }

  // Employees
  const empSheetName = pickSheet(wb, SHEET_PATTERNS.employees);
  const employees = empSheetName ? parseEmployees(sheetToGrid(wb, empSheetName)) : [];

  // Bank lines
  const bankSheetName = pickSheet(wb, SHEET_PATTERNS.bank);
  const bank_lines = bankSheetName ? parseBankLines(sheetToGrid(wb, bankSheetName)) : [];

  const headcount = headcountValue
    ? Math.round(headcountValue / 100)
    : (employees.length || bank_lines.length || undefined);

  // Reconciliation: cost-center sum vs grand total
  let reconciled = true;
  if (cost_centers.length > 0 && total_amount_cents > 0) {
    const ccSum = cost_centers.reduce((s, c) => s + c.amount_cents, 0);
    const drift = Math.abs(ccSum - total_amount_cents);
    const tolerance = Math.max(100, Math.round(total_amount_cents * 0.005)); // R$1 or 0.5%
    if (drift > tolerance) {
      reconciled = false;
      flags.push({
        severity: 'warning',
        code: 'cost_center_reconcile',
        message: `Soma dos centros de custo (${formatCentsBR(ccSum)}) difere do total (${formatCentsBR(total_amount_cents)}).`,
      });
    }
  }
  for (const cc of cost_centers) {
    if (!cc.cost_center_id) {
      flags.push({
        severity: 'info',
        code: 'cost_center_unmatched',
        message: `Centro de custo "${cc.cost_center_label}" não vinculado ao cadastro do Financeiro.`,
      });
    }
  }

  // Bank reconciliation vs total (informational)
  if (bank_lines.length > 0 && total_amount_cents > 0) {
    const bankSum = bank_lines.reduce((s, b) => s + b.amount_cents, 0);
    const drift = Math.abs(bankSum - total_amount_cents);
    if (drift > Math.max(10000, Math.round(total_amount_cents * 0.1))) {
      flags.push({
        severity: 'info',
        code: 'bank_total_drift',
        message: `Total da remessa bancária (${formatCentsBR(bankSum)}) difere do total da folha — pode incluir descontos/líquido.`,
      });
    }
  }

  const variation_amount_cents = total_amount_cents - previous_month_amount_cents;
  const variation_percentage = pct(total_amount_cents, previous_month_amount_cents);

  const clt_count = employees.filter((e) => e.contract_type === 'CLT').length || undefined;
  const pj_count = employees.filter((e) => e.contract_type === 'PJ').length || undefined;

  const comparison = buildComparison(total_amount_cents, previous_month_amount_cents, cost_centers);

  return {
    competence_month,
    total_amount_cents,
    previous_month_amount_cents,
    variation_amount_cents,
    variation_percentage,
    gross_amount_cents,
    charges_amount_cents,
    benefits_amount_cents,
    headcount: headcount ?? (employees.length || undefined),
    clt_count,
    pj_count,
    payment_deadline,
    cost_centers,
    employees,
    bank_lines,
    comparison,
    flags,
    detected_sheets,
    reconciled,
  };
}

// ── Tabular sub-parsers ─────────────────────────────────────

function headerIndex(grid: Grid, pattern: RegExp): { row: number; col: number } | undefined {
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (pattern.test(String(row[c] ?? ''))) return { row: r, col: c };
    }
  }
  return undefined;
}

/**
 * First row index where EVERY pattern matches some cell — locates the real
 * header row and skips banner/title rows (e.g. "VALOR TOTAL POR BANCO", which
 * would otherwise hijack the BANCO/VALOR columns onto a sequence column).
 */
function findHeaderRow(grid: Grid, patterns: RegExp[], maxRows = 20): number {
  for (let r = 0; r < Math.min(grid.length, maxRows); r++) {
    const cells = (grid[r] ?? []).map((c) => String(c ?? ''));
    if (patterns.every((p) => cells.some((c) => p.test(c)))) return r;
  }
  return -1;
}

/** Index of the first column in [start,end) whose header matches `pattern` (and not `exclude`). */
function colInRange(header: unknown[], start: number, end: number, pattern: RegExp, exclude?: RegExp): number {
  for (let c = start; c < end; c++) {
    const s = String(header[c] ?? '');
    if (pattern.test(s) && (!exclude || !exclude.test(s))) return c;
  }
  return -1;
}

function colMatching(header: unknown[], pattern: RegExp, exclude?: RegExp): number {
  return colInRange(header, 0, header.length, pattern, exclude);
}

function normLabel(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface CostCenterSheetResult {
  centers: PayrollCostCenterTotal[];
  currentTotal?: number;
  previousTotal?: number;
}

/**
 * Parses the cost-center summary sheet. Handles two real-world shapes:
 *  - side-by-side current/previous tables (each with its own CENTRO label
 *    column, value column and TOTAL row), disambiguated by the month header
 *    above each table vs the closing competence; and
 *  - a single table with a current value column plus a "Mês Anterior" column.
 * Returns the cost centers (current, with previous matched by label) and the
 * grand TOTAL for the current and previous months.
 */
export function parseCostCenterSheet(grid: Grid, competence: string): CostCenterSheetResult {
  if (grid.length === 0) return { centers: [] };
  const hr = findHeaderRow(grid, [/centro\s*de\s*custo|^\s*centro\b|setor|departament/i], 8);
  if (hr < 0) return { centers: parseCostCenters(grid) };
  const header = grid[hr];

  const labelCols: number[] = [];
  for (let c = 0; c < header.length; c++) {
    if (/centro|setor|departament/i.test(String(header[c] ?? ''))) labelCols.push(c);
  }
  if (labelCols.length === 0) labelCols.push(0);

  const monthForRegion = (lc: number, vc: number): string => {
    for (let r = 0; r <= hr; r++) {
      for (let c = lc; c <= vc; c++) {
        const m = normalizeCompetence(String(grid[r]?.[c] ?? ''));
        if (m) return m;
      }
    }
    return '';
  };

  let curLabelCol = labelCols[0];
  let curValueCol: number;
  let prevLabelCol = -1;
  let prevValueCol = -1;

  if (labelCols.length >= 2) {
    // Parallel tables — classify by month vs the closing competence.
    const tbls = labelCols.map((lc, i) => {
      const end = labelCols[i + 1] ?? header.length;
      let vc = colInRange(header, lc + 1, end, /valor|atual|total|l[ií]quido|\d{4}/i, /anterior/i);
      if (vc < 0) vc = lc + 1;
      return { lc, vc, month: monthForRegion(lc, vc) };
    });
    let curIdx = competence ? tbls.findIndex((t) => t.month === competence) : -1;
    if (curIdx < 0) curIdx = 0;
    const prevIdx = tbls.findIndex((_, i) => i !== curIdx);
    curLabelCol = tbls[curIdx].lc; curValueCol = tbls[curIdx].vc;
    if (prevIdx >= 0) { prevLabelCol = tbls[prevIdx].lc; prevValueCol = tbls[prevIdx].vc; }
  } else {
    const lc = labelCols[0];
    curValueCol = colInRange(header, lc + 1, header.length, /valor|atual|total|\d{4}/i, /anterior/i);
    if (curValueCol < 0) curValueCol = lc + 1;
    prevValueCol = colInRange(header, lc + 1, header.length, /anterior/i);
    prevLabelCol = prevValueCol >= 0 ? lc : -1; // previous shares the same label column
  }

  const centers: PayrollCostCenterTotal[] = [];
  const prevByLabel = new Map<string, number>();
  let currentTotal: number | undefined;
  let previousTotal: number | undefined;

  for (let r = hr + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const curLabel = String(row[curLabelCol] ?? '').trim();
    const curVal = normalizeBRLToCents(row[curValueCol]);
    if (curLabel) {
      if (/^total/i.test(curLabel)) { if (currentTotal == null && curVal) currentTotal = curVal; }
      else if (curVal) centers.push({ cost_center_label: curLabel, amount_cents: curVal });
    }
    if (prevValueCol >= 0) {
      const prevLabel = prevLabelCol >= 0 ? String(row[prevLabelCol] ?? '').trim() : curLabel;
      const prevVal = normalizeBRLToCents(row[prevValueCol]);
      if (prevLabel) {
        if (/^total/i.test(prevLabel)) { if (previousTotal == null && prevVal) previousTotal = prevVal; }
        else if (prevVal) prevByLabel.set(normLabel(prevLabel), prevVal);
      }
    }
  }

  for (const c of centers) {
    const p = prevByLabel.get(normLabel(c.cost_center_label));
    if (p != null) {
      c.previous_amount_cents = p;
      c.variation_amount_cents = c.amount_cents - p;
      c.variation_percentage = pct(c.amount_cents, p);
    }
  }

  return { centers, currentTotal, previousTotal };
}

function parseCostCenters(grid: Grid): PayrollCostCenterTotal[] {
  if (grid.length === 0) return [];
  const labelHdr = headerIndex(grid, /centro|custo|setor|departament/i);
  const valueHdr = headerIndex(grid, /total|valor|atual|m[eê]s/i);
  const prevHdr = headerIndex(grid, /anterior/i);
  const startRow = (labelHdr?.row ?? 0) + 1;
  const labelCol = labelHdr?.col ?? 0;
  const valueCol = valueHdr?.col ?? 1;

  const out: PayrollCostCenterTotal[] = [];
  for (let r = startRow; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const label = String(row[labelCol] ?? '').trim();
    if (!label || /total/i.test(label)) continue;
    const amount = normalizeBRLToCents(row[valueCol]);
    if (amount === 0) continue;
    const prev = prevHdr ? normalizeBRLToCents(row[prevHdr.col]) : undefined;
    out.push({
      cost_center_label: label,
      amount_cents: amount,
      previous_amount_cents: prev || undefined,
      variation_amount_cents: prev != null ? amount - prev : undefined,
      variation_percentage: prev != null ? pct(amount, prev) : undefined,
    });
  }
  return out;
}

function parseEmployees(grid: Grid): PayrollEmployeeLine[] {
  if (grid.length === 0) return [];
  const nameHdr = headerIndex(grid, /nome|colaborador|funcion/i);
  const grossHdr = headerIndex(grid, /bruto|proventos|sal[aá]rio/i);
  const netHdr = headerIndex(grid, /l[ií]quido/i);
  const typeHdr = headerIndex(grid, /tipo|v[ií]nculo|regime|clt|pj/i);
  const ccHdr = headerIndex(grid, /centro|custo|setor/i);
  const startRow = (nameHdr?.row ?? 0) + 1;
  const nameCol = nameHdr?.col ?? 0;

  const out: PayrollEmployeeLine[] = [];
  for (let r = startRow; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const name = String(row[nameCol] ?? '').trim();
    if (!name || /total/i.test(name)) continue;
    const gross = grossHdr ? normalizeBRLToCents(row[grossHdr.col]) : 0;
    if (gross === 0) continue;
    const typeRaw = typeHdr ? String(row[typeHdr.col] ?? '').toUpperCase() : '';
    const contract_type = /PJ/.test(typeRaw) ? 'PJ' : /CLT/.test(typeRaw) ? 'CLT' : undefined;
    out.push({
      employee_name: name,
      cost_center_label: ccHdr ? String(row[ccHdr.col] ?? '').trim() || undefined : undefined,
      contract_type,
      gross_amount_cents: gross,
      net_amount_cents: netHdr ? normalizeBRLToCents(row[netHdr.col]) || undefined : undefined,
    });
  }
  return out;
}

function parseBankLines(grid: Grid): PayrollBankLine[] {
  if (grid.length === 0) return [];
  // Find the real header row (must carry BOTH a beneficiary and a value column)
  // so the title banner ("VALOR TOTAL POR BANCO") cannot hijack the columns.
  const hr = findHeaderRow(grid, [/benefici|nome|favorecid|colaborador/i, /valor|l[ií]quido|cr[eé]dito/i], 20);
  if (hr < 0) return [];
  const header = grid[hr];
  const nameCol = colMatching(header, /benefici|nome|favorecid|colaborador/i);
  const amountCol = colMatching(header, /valor|l[ií]quido|cr[eé]dito/i);
  const bankCol = colMatching(header, /banco/i);
  const branchCol = colMatching(header, /ag[eê]nc/i);
  const accCol = colMatching(header, /conta/i, /cpf/i);
  if (nameCol < 0 || amountCol < 0) return [];

  const out: PayrollBankLine[] = [];
  for (let r = hr + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const beneficiary = String(row[nameCol] ?? '').trim();
    if (!beneficiary || /total/i.test(beneficiary)) continue;
    const amount = normalizeBRLToCents(row[amountCol]);
    if (amount === 0) continue;
    out.push({
      beneficiary,
      bank: bankCol >= 0 ? String(row[bankCol] ?? '').trim() || undefined : undefined,
      branch: branchCol >= 0 ? String(row[branchCol] ?? '').trim() || undefined : undefined,
      account: accCol >= 0 ? String(row[accCol] ?? '').trim() || undefined : undefined,
      amount_cents: amount,
    });
  }
  return out;
}

// ── Local formatter (kept independent of finance-store) ─────

export function formatCentsBR(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
