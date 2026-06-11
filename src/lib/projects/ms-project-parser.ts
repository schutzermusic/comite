/**
 * MS Project PDF schedule parser (deterministic, pt-BR).
 *
 * Pure functions — no pdfjs/Supabase imports — so the column/row
 * reconstruction and normalizers are unit-testable and shared with
 * the AI fallback validator. The PDF route extracts positioned text
 * items (x/y per string) and hands them to extractScheduleFromPages.
 *
 * Golden rules (spec plan/projetos_restructure.md §3):
 *  - keep every raw string verbatim in `raw` for audit;
 *  - normalize dates/durations/percent when possible, else null +
 *    issue (never invent data);
 *  - dependencies/resources do not exist in the PDF → never created.
 */

import type { ParsedScheduleRow, ParseStats, RawImportValues } from '@/lib/types/project-timeline';

/* ───────────── Calendar ───────────── */

/**
 * Working day length used to convert "dias" to minutes. The sample
 * schedules print "Segunda à Sábado 07:30 às 17:30" and use 9h tasks
 * as 1 day, so the project calendar day is 9h (540 min).
 */
export const WORKDAY_MINUTES = 540;

/* ───────────── Normalizers ───────────── */

const WEEKDAY_PREFIX = /^(seg|ter|qua|qui|sex|s[áa]b|dom)\.?\s+/i;

/** "Ter 19/05/26" | "19/05/2026" → "2026-05-19" (null if unparseable). */
export function parsePtBrDate(rawValue: string | null | undefined): string | null {
  if (!rawValue) return null;
  const cleaned = rawValue.trim().replace(WEEKDAY_PREFIX, '');
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}(?:\d{2})?)$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (m[3].length === 2) year = year >= 70 ? 1900 + year : 2000 + year;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * "31 dias" | "24,17 dias" | "9 hrs" | "0,5 dias" | "0 hrs" | "2 diasd"
 * (typo'd unit tolerated) → minutes. null when unparseable.
 */
export function parseDurationToMinutes(rawValue: string | null | undefined): number | null {
  if (rawValue == null) return null;
  const cleaned = rawValue.trim().toLowerCase();
  if (!cleaned) return null;
  const m = cleaned.match(/^([\d.,]+)\s*(dia|d\b|hr|hora|h\b|min)/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(num)) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith('dia') || unit === 'd') return Math.round(num * WORKDAY_MINUTES);
  if (unit.startsWith('hr') || unit.startsWith('hora') || unit === 'h') return Math.round(num * 60);
  if (unit.startsWith('min')) return Math.round(num);
  return null;
}

/** "11%" | "12,5%" | "100" → 0–100 (null if unparseable). */
export function parsePercent(rawValue: string | null | undefined): number | null {
  if (rawValue == null) return null;
  const cleaned = rawValue.trim().replace('%', '').replace(',', '.');
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  if (Number.isNaN(num) || num < 0 || num > 100) return null;
  return num;
}

/** "2.3.11.1" → 4; "0" → 0; "" → 0. */
export function inferOutlineLevel(wbs: string | null | undefined): number {
  if (!wbs) return 0;
  const trimmed = wbs.trim();
  if (!trimmed || trimmed === '0') return 0;
  return trimmed.split('.').length;
}

export function parentWbs(wbs: string | null | undefined): string | null {
  if (!wbs) return null;
  const trimmed = wbs.trim();
  if (!trimmed || trimmed === '0') return null;
  const parts = trimmed.split('.');
  if (parts.length === 1) return '0';
  return parts.slice(0, -1).join('.');
}

/* ───────────── Positioned-text table extraction ───────────── */

/** One text run from pdfjs getTextContent (x grows right, y grows UP). */
export interface PositionedItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

interface ColumnRange {
  key: 'id' | 'wbs' | 'name' | 'percent' | 'duration' | 'start' | 'finish';
  from: number;
  to: number;
}

const Y_TOLERANCE = 3;

/** Clusters items of one page into visual lines (top → bottom). */
function clusterLines(items: PositionedItem[]): PositionedItem[][] {
  const sorted = [...items]
    .filter((i) => i.str.trim().length > 0)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedItem[][] = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - item.y) <= Y_TOLERANCE) {
      line.push(item);
    } else {
      lines.push([item]);
    }
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

/** Locates the pt-BR header anchors on a page and derives column x-ranges. */
function findColumns(lines: PositionedItem[][]): { columns: ColumnRange[]; headerY: number } | null {
  for (const line of lines) {
    const joined = line.map((i) => i.str.trim());
    const idIdx = joined.findIndex((s) => s === 'Id');
    const wbsIdx = joined.findIndex((s) => s === 'EDT');
    const nameIdx = joined.findIndex((s) => s.startsWith('Nome da Tarefa'));
    if (idIdx === -1 || wbsIdx === -1 || nameIdx === -1) continue;

    // Remaining anchors may sit on the same or a neighboring header line;
    // search the header band (this line ± 2 lines).
    const bandIdx = lines.indexOf(line);
    const band = lines.slice(Math.max(0, bandIdx - 2), bandIdx + 3).flat();
    const anchor = (pred: (s: string) => boolean) => band.find((i) => pred(i.str.trim()));

    const idAnchor = line[idIdx];
    const wbsAnchor = line[wbsIdx];
    const nameAnchor = line[nameIdx];
    const pctAnchor = anchor((s) => s === '%' || s.startsWith('% conclu') || s.startsWith('concluí'));
    const durAnchor = anchor((s) => s.startsWith('Duraç'));
    const startAnchor = anchor((s) => s === 'Início' || s === 'Inicio');
    const finishAnchor = anchor((s) => s === 'Término' || s === 'Termino');
    if (!durAnchor || !startAnchor || !finishAnchor) continue;

    const anchors: { key: ColumnRange['key']; x: number }[] = [
      { key: 'id', x: idAnchor.x },
      { key: 'wbs', x: wbsAnchor.x },
      { key: 'name', x: nameAnchor.x },
      { key: 'percent', x: pctAnchor ? pctAnchor.x : (nameAnchor.x + durAnchor.x) / 2 + 1 },
      { key: 'duration', x: durAnchor.x },
      { key: 'start', x: startAnchor.x },
      { key: 'finish', x: finishAnchor.x },
    ];
    const xs = anchors.sort((a, b) => a.x - b.x);

    const columns: ColumnRange[] = xs.map((c, i) => ({
      key: c.key,
      // Generous left edge: half-way to the previous anchor (covers the
      // "Modo da Tarefa" icon column and name indentation).
      from: i === 0 ? -Infinity : (xs[i - 1].x + c.x) / 2,
      to: i === xs.length - 1 ? Infinity : (c.x + xs[i + 1].x) / 2,
    }));

    return { columns, headerY: Math.min(...line.map((i) => i.y)) };
  }
  return null;
}

function columnOf(columns: ColumnRange[], item: PositionedItem): ColumnRange['key'] | null {
  // Classify by the run's horizontal center for robustness.
  const cx = item.x + (item.width > 0 ? item.width / 2 : 0);
  for (const col of columns) if (cx >= col.from && cx < col.to) return col.key;
  return null;
}

interface RawRow {
  cells: Record<ColumnRange['key'], string>;
  nameIndentX: number;
}

/**
 * Reconstructs table rows from the positioned text of every page.
 * A new row starts at a line whose Id cell is a pure integer; lines
 * without an Id contribute only wrapped continuations (task names and
 * other wide cells).
 */
export function extractScheduleFromPages(pages: PositionedItem[][]): ParsedScheduleRow[] {
  const rawRows: RawRow[] = [];

  for (const pageItems of pages) {
    const lines = clusterLines(pageItems);
    const header = findColumns(lines);
    if (!header) continue; // page without the schedule table (cover, etc.)

    let current: RawRow | null = null;
    for (const line of lines) {
      if (line[0].y >= header.headerY - Y_TOLERANCE) continue; // header band & above

      const byCol = new Map<ColumnRange['key'], PositionedItem[]>();
      for (const item of line) {
        const key = columnOf(header.columns, item);
        if (!key) continue;
        const list = byCol.get(key) ?? [];
        list.push(item);
        byCol.set(key, list);
      }
      const cellText = (key: ColumnRange['key']) =>
        (byCol.get(key) ?? [])
          .map((i) => i.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

      const idText = cellText('id');
      const isRowStart = /^\d+$/.test(idText);

      if (isRowStart) {
        const nameItems = byCol.get('name') ?? [];
        current = {
          cells: {
            id: idText,
            wbs: cellText('wbs'),
            name: cellText('name'),
            percent: cellText('percent'),
            duration: cellText('duration'),
            start: cellText('start'),
            finish: cellText('finish'),
          },
          nameIndentX: nameItems[0]?.x ?? 0,
        };
        rawRows.push(current);
      } else if (current) {
        // Wrapped continuation: only merge cells that already have content
        // direction (name) or are still empty (dates/duration split rows).
        const nameCont = cellText('name');
        if (nameCont) current.cells.name = `${current.cells.name} ${nameCont}`.trim();
        for (const key of ['wbs', 'percent', 'duration', 'start', 'finish'] as const) {
          const cont = cellText(key);
          if (cont && !current.cells[key]) current.cells[key] = cont;
        }
      }
    }
  }

  // Footer noise safety: drop "rows" without WBS and without any date.
  const meaningful = rawRows.filter((r) => r.cells.wbs || r.cells.start || r.cells.finish);

  return meaningful.map((r, index) => {
    const raw: RawImportValues = {
      original_task_name: r.cells.name,
      original_start_raw: r.cells.start,
      original_finish_raw: r.cells.finish,
      original_duration_raw: r.cells.duration,
      original_percent_raw: r.cells.percent,
      original_wbs_code: r.cells.wbs,
    };
    const durationMinutes = parseDurationToMinutes(r.cells.duration);
    return {
      msProjectId: r.cells.id,
      wbsCode: r.cells.wbs.trim(),
      title: r.cells.name.trim(),
      percentComplete: parsePercent(r.cells.percent),
      durationMinutes,
      plannedStart: parsePtBrDate(r.cells.start),
      plannedFinish: parsePtBrDate(r.cells.finish),
      outlineLevel: inferOutlineLevel(r.cells.wbs),
      rowOrder: index,
      isSummary: false, // resolved by buildHierarchy
      isMilestone: durationMinutes === 0,
      raw,
      issues: [],
    };
  });
}

/* ───────────── Hierarchy + validation ───────────── */

/** Marks summary rows (those with WBS children present in the set). */
export function buildHierarchy(rows: ParsedScheduleRow[]): ParsedScheduleRow[] {
  const wbsSet = new Set(rows.map((r) => r.wbsCode).filter(Boolean));
  return rows.map((row) => {
    const hasChildren = rows.some((r) => r !== row && parentWbs(r.wbsCode) === row.wbsCode);
    void wbsSet;
    return { ...row, isSummary: hasChildren, isMilestone: !hasChildren && row.durationMinutes === 0 };
  });
}

export interface ValidationResult {
  rows: ParsedScheduleRow[];
  warnings: string[];
  stats: ParseStats;
}

/** Spec §3 validation: flags issues per row + global warnings. */
export function validateParsedRows(input: ParsedScheduleRow[]): ValidationResult {
  const rows = buildHierarchy(input.map((r) => ({ ...r, issues: [...r.issues] })));
  const warnings: string[] = [];

  if (rows.length === 0) {
    warnings.push('Nenhuma linha de cronograma reconhecida no arquivo.');
    return { rows, warnings, stats: { totalRows: 0, tasks: 0, phases: 0, milestones: 0, rowsWithIssues: 0 } };
  }

  // Duplicate WBS
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (!row.wbsCode) continue;
    seen.set(row.wbsCode, (seen.get(row.wbsCode) ?? 0) + 1);
  }
  for (const [wbs, count] of seen) {
    if (count > 1) warnings.push(`EDT duplicado: ${wbs} (${count} linhas).`);
  }

  // Missing root
  if (!rows.some((r) => r.wbsCode === '0' || r.outlineLevel <= 1)) {
    warnings.push('Tarefa raiz do projeto não encontrada (EDT 0).');
  }

  // Non-sequential MS Project Ids
  const ids = rows.map((r) => parseInt(r.msProjectId, 10)).filter((n) => !Number.isNaN(n));
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] <= ids[i - 1]) {
      warnings.push(`Ids do MS Project fora de sequência próximo ao Id ${ids[i]}.`);
      break;
    }
  }

  const byWbs = new Map(rows.filter((r) => r.wbsCode).map((r) => [r.wbsCode, r]));

  for (const row of rows) {
    if (!row.title) row.issues.push('Nome da tarefa ausente.');
    if (!row.wbsCode) row.issues.push('EDT/WBS ausente.');
    if (!row.plannedStart && row.raw.original_start_raw) row.issues.push(`Data de início inválida: "${row.raw.original_start_raw}".`);
    if (!row.plannedFinish && row.raw.original_finish_raw) row.issues.push(`Data de término inválida: "${row.raw.original_finish_raw}".`);
    if (!row.plannedStart && !row.raw.original_start_raw) row.issues.push('Data de início ausente.');
    if (!row.plannedFinish && !row.raw.original_finish_raw) row.issues.push('Data de término ausente.');
    if (row.durationMinutes === null && row.raw.original_duration_raw) {
      row.issues.push(`Duração inválida: "${row.raw.original_duration_raw}".`);
    }
    if (row.percentComplete === null && row.raw.original_percent_raw) {
      row.issues.push(`% concluída inválido: "${row.raw.original_percent_raw}".`);
    }
    if (row.plannedStart && row.plannedFinish && row.plannedFinish < row.plannedStart) {
      row.issues.push('Término anterior ao início.');
    }
    // Child outside parent range
    const parent = byWbs.get(parentWbs(row.wbsCode) ?? '');
    if (parent) {
      if (row.plannedStart && parent.plannedStart && row.plannedStart < parent.plannedStart) {
        row.issues.push(`Início anterior ao da fase pai (${parent.wbsCode}).`);
      }
      if (row.plannedFinish && parent.plannedFinish && row.plannedFinish > parent.plannedFinish) {
        row.issues.push(`Término posterior ao da fase pai (${parent.wbsCode}).`);
      }
    }
  }

  const rowsWithIssues = rows.filter((r) => r.issues.length > 0).length;
  if (rowsWithIssues > 0) warnings.push(`${rowsWithIssues} linha(s) com problemas de leitura/validação.`);

  const stats: ParseStats = {
    totalRows: rows.length,
    tasks: rows.filter((r) => !r.isSummary && !r.isMilestone).length,
    phases: rows.filter((r) => r.isSummary).length,
    milestones: rows.filter((r) => r.isMilestone).length,
    rowsWithIssues,
  };
  return { rows, warnings, stats };
}

/** Heurística de qualidade: aciona o fallback de IA quando fraca. */
export function isWeakExtraction(result: ValidationResult): boolean {
  if (result.rows.length === 0) return true;
  return result.stats.rowsWithIssues / result.rows.length > 0.3;
}
