/**
 * Re-import matching / anti-duplication (spec §4) — pure functions.
 *
 * Match priority:
 *   1. original_ms_project_id + wbs_code
 *   2. wbs_code
 *   3. normalized title + parent WBS
 * Unmatched parsed rows → added; unmatched IMPORT-SOURCED existing items
 * → removed (soft-deactivated on confirm; manual items are never touched).
 */

import type {
  ImportDiffSummary,
  ImportFieldChange,
  ImportRowMatch,
  ParsedScheduleRow,
  TimelineItem,
} from '@/lib/types/project-timeline';
import { parentWbs } from '@/lib/projects/ms-project-parser';

export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldChanges(existing: TimelineItem, row: ParsedScheduleRow): ImportFieldChange[] {
  const changes: ImportFieldChange[] = [];
  const compare = (field: string, before: string | number | null, after: string | number | null) => {
    const b = before === null || before === undefined ? null : String(before);
    const a = after === null || after === undefined ? null : String(after);
    if (b !== a) changes.push({ field, before: b, after: a });
  };
  compare('title', existing.title, row.title);
  compare('planned_start', existing.plannedStart, row.plannedStart);
  compare('planned_finish', existing.plannedFinish, row.plannedFinish);
  compare('duration_minutes', existing.durationMinutes, row.durationMinutes);
  compare('percent_complete', Number(existing.percentComplete), row.percentComplete);
  compare('row_order', existing.rowOrder, row.rowOrder);
  return changes;
}

export interface MatchedRowPlan {
  row: ParsedScheduleRow;
  /** null → insert; otherwise update this item. */
  existingItemId: string | null;
}

export interface ImportPlan {
  diff: ImportDiffSummary;
  /** One entry per parsed row, in row order. */
  rows: MatchedRowPlan[];
  /** Import-sourced existing item ids to soft-deactivate (update mode). */
  deactivateIds: string[];
}

export function matchRows(existing: TimelineItem[], parsed: ParsedScheduleRow[]): ImportPlan {
  const activeExisting = existing.filter((i) => i.isActive && !i.deletedAt);
  const matchedExisting = new Set<string>();

  const byMsIdWbs = new Map<string, TimelineItem>();
  const byWbs = new Map<string, TimelineItem>();
  const byTitleParent = new Map<string, TimelineItem>();
  for (const item of activeExisting) {
    if (item.originalMsProjectId && item.wbsCode) {
      byMsIdWbs.set(`${item.originalMsProjectId}::${item.wbsCode}`, item);
    }
    if (item.wbsCode && !byWbs.has(item.wbsCode)) byWbs.set(item.wbsCode, item);
    const parent = parentWbs(item.wbsCode) ?? '';
    const key = `${normalizeTitle(item.title)}::${parent}`;
    if (!byTitleParent.has(key)) byTitleParent.set(key, item);
  }

  const added: ImportRowMatch[] = [];
  const updated: ImportRowMatch[] = [];
  const unchanged: ImportRowMatch[] = [];
  const rows: MatchedRowPlan[] = [];

  for (const row of parsed) {
    let match: TimelineItem | undefined;
    if (row.msProjectId && row.wbsCode) match = byMsIdWbs.get(`${row.msProjectId}::${row.wbsCode}`);
    if (!match && row.wbsCode) match = byWbs.get(row.wbsCode);
    if (!match) {
      match = byTitleParent.get(`${normalizeTitle(row.title)}::${parentWbs(row.wbsCode) ?? ''}`);
    }
    if (match && matchedExisting.has(match.id)) match = undefined; // one row per item

    if (match) {
      matchedExisting.add(match.id);
      const changes = fieldChanges(match, row);
      const entry: ImportRowMatch = {
        existingItemId: match.id,
        wbsCode: row.wbsCode,
        title: row.title,
        changes,
      };
      (changes.length > 0 ? updated : unchanged).push(entry);
      rows.push({ row, existingItemId: match.id });
    } else {
      added.push({ existingItemId: null, wbsCode: row.wbsCode, title: row.title, changes: [] });
      rows.push({ row, existingItemId: null });
    }
  }

  // Import-sourced items absent from the new file (manual items untouched).
  const removed = activeExisting
    .filter((i) => i.importBatchId && !matchedExisting.has(i.id))
    .map((i) => ({ existingItemId: i.id, wbsCode: i.wbsCode, title: i.title }));

  return {
    diff: { added, updated, unchanged, removed },
    rows,
    deactivateIds: removed.map((r) => r.existingItemId),
  };
}
