import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { matchRows } from '@/lib/projects/timeline-import-matcher';
import { parentWbs, validateParsedRows } from '@/lib/projects/ms-project-parser';
import type {
  ConfirmImportPayload,
  ParsedScheduleRow,
  TimelineItem,
} from '@/lib/types/project-timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/[id]/timeline/import/confirm
 * Persists a previewed import: creates the project_schedule_imports batch,
 * upserts items in two passes (insert/update without parent, then resolve
 * parent_id by WBS), and on mode='update' soft-deactivates import-sourced
 * items missing from the new file. Never hard-deletes.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireApiPermission('projects.timeline.import', { allowAdmin: true });
  if (!guard.ok) return guard.response;
  const { id: projectId } = await context.params;

  let body: ConfirmImportPayload;
  try {
    body = (await req.json()) as ConfirmImportPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0 || !body.fileHash) {
    return NextResponse.json({ ok: false, error: 'rows e fileHash são obrigatórios.' }, { status: 400 });
  }
  const mode = body.mode === 'update' ? 'update' : 'new';

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();
  const orgId = profile?.organization_id as string | undefined;
  if (!orgId) return NextResponse.json({ ok: false, error: 'Usuário sem organização.' }, { status: 403 });

  // Re-validate server-side (client payload is untrusted).
  const validated = validateParsedRows(body.rows as ParsedScheduleRow[]);
  const rows = validated.rows;

  // Current schedule version.
  const { data: lastImport } = await supabase
    .from('project_schedule_imports')
    .select('schedule_version')
    .eq('project_id', projectId)
    .order('schedule_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const scheduleVersion = ((lastImport?.schedule_version as number | undefined) ?? 0) + 1;

  // Import batch row.
  const { data: importRow, error: importErr } = await supabase
    .from('project_schedule_imports')
    .insert({
      organization_id: orgId,
      project_id: projectId,
      source_file_name: body.fileName ?? null,
      source_file_path: body.filePath ?? null,
      source_file_hash: body.fileHash,
      source_type: 'ms_project_pdf',
      schedule_version: scheduleVersion,
      imported_by: guard.userId,
      parse_status: validated.stats.rowsWithIssues > 0 ? 'completed_with_warnings' : 'completed',
      parser_used: body.parserUsed === 'ai' ? 'ai' : 'deterministic',
      parse_summary: validated.stats as unknown as Record<string, unknown>,
      warnings: [...validated.warnings, ...(body.warnings ?? [])],
    })
    .select('id')
    .single();
  if (importErr || !importRow) {
    return NextResponse.json(
      { ok: false, error: `Falha ao registrar importação: ${importErr?.message ?? 'sem retorno'}` },
      { status: 500 },
    );
  }
  const importId = importRow.id as string;

  // Existing items (for matching on update mode).
  const { data: existingData } = await supabase
    .from('project_timeline_items')
    .select('id, project_id, parent_id, import_batch_id, original_ms_project_id, wbs_code, title, planned_start, planned_finish, duration_minutes, percent_complete, row_order, is_active, deleted_at')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .is('deleted_at', null);
  const existing = (existingData ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    importBatchId: row.import_batch_id,
    originalMsProjectId: row.original_ms_project_id,
    wbsCode: row.wbs_code,
    title: row.title,
    plannedStart: row.planned_start,
    plannedFinish: row.planned_finish,
    durationMinutes: row.duration_minutes,
    percentComplete: Number(row.percent_complete ?? 0),
    rowOrder: row.row_order,
    isActive: row.is_active,
    deletedAt: row.deleted_at,
  })) as TimelineItem[];

  const plan = mode === 'update' ? matchRows(existing, rows) : null;

  const toRowPayload = (row: ParsedScheduleRow) => ({
    organization_id: orgId,
    project_id: projectId,
    import_batch_id: importId,
    original_ms_project_id: row.msProjectId || null,
    wbs_code: row.wbsCode || null,
    outline_level: row.outlineLevel,
    row_order: row.rowOrder,
    type: row.isMilestone ? 'milestone' : row.isSummary ? 'phase' : 'task',
    title: row.title || `(sem nome — EDT ${row.wbsCode || '?'})`,
    planned_start: row.plannedStart,
    planned_finish: row.plannedFinish,
    duration_minutes: row.durationMinutes,
    percent_complete: row.percentComplete ?? 0,
    status:
      (row.percentComplete ?? 0) >= 100
        ? 'completed'
        : (row.percentComplete ?? 0) > 0
          ? 'in_progress'
          : 'not_started',
    is_summary: row.isSummary,
    is_milestone: row.isMilestone,
    is_active: true,
    raw_import: row.raw,
    created_by: guard.userId,
  });

  // Pass 1 — inserts and updates (no parent_id yet).
  const idByWbs = new Map<string, string>();
  let inserted = 0;
  let updated = 0;

  const planRows = plan ? plan.rows : rows.map((row) => ({ row, existingItemId: null as string | null }));
  for (const { row, existingItemId } of planRows) {
    if (existingItemId) {
      const { error } = await supabase
        .from('project_timeline_items')
        .update({
          import_batch_id: importId,
          original_ms_project_id: row.msProjectId || null,
          wbs_code: row.wbsCode || null,
          outline_level: row.outlineLevel,
          row_order: row.rowOrder,
          title: row.title || undefined,
          planned_start: row.plannedStart,
          planned_finish: row.plannedFinish,
          duration_minutes: row.durationMinutes,
          percent_complete: row.percentComplete ?? 0,
          is_summary: row.isSummary,
          is_milestone: row.isMilestone,
          is_active: true,
          raw_import: row.raw,
        })
        .eq('id', existingItemId);
      if (error) {
        return NextResponse.json(
          { ok: false, error: `Falha ao atualizar item (EDT ${row.wbsCode}): ${error.message}` },
          { status: 500 },
        );
      }
      updated += 1;
      if (row.wbsCode) idByWbs.set(row.wbsCode, existingItemId);
    } else {
      const { data, error } = await supabase
        .from('project_timeline_items')
        .insert(toRowPayload(row))
        .select('id')
        .single();
      if (error || !data) {
        return NextResponse.json(
          { ok: false, error: `Falha ao inserir item (EDT ${row.wbsCode}): ${error?.message ?? 'sem retorno'}` },
          { status: 500 },
        );
      }
      inserted += 1;
      if (row.wbsCode) idByWbs.set(row.wbsCode, data.id as string);
    }
  }

  // Pass 2 — resolve parent_id by WBS prefix.
  for (const { row } of planRows) {
    const childId = row.wbsCode ? idByWbs.get(row.wbsCode) : undefined;
    if (!childId) continue;
    const parentCode = parentWbs(row.wbsCode);
    const parentId = parentCode ? (idByWbs.get(parentCode) ?? null) : null;
    const { error } = await supabase
      .from('project_timeline_items')
      .update({ parent_id: parentId })
      .eq('id', childId);
    if (error) console.error('[timeline/import] parent link failed:', error.message);
  }

  // Soft-deactivate removed (update mode only, import-sourced only).
  let deactivated = 0;
  if (plan && plan.deactivateIds.length > 0) {
    const { error } = await supabase
      .from('project_timeline_items')
      .update({ is_active: false })
      .in('id', plan.deactivateIds);
    if (error) {
      console.error('[timeline/import] deactivate failed:', error.message);
    } else {
      deactivated = plan.deactivateIds.length;
    }
  }

  // Audit (best-effort).
  try {
    await supabase.from('audit_logs').insert({
      organization_id: orgId,
      actor_user_id: guard.userId,
      action: 'timeline.schedule_imported',
      entity_type: 'project_schedule_import',
      entity_id: importId,
      metadata: {
        projectId,
        mode,
        scheduleVersion,
        inserted,
        updated,
        deactivated,
        parser: body.parserUsed,
        fileName: body.fileName,
      },
    });
  } catch (e) {
    console.error('[timeline/import] audit failed:', e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ok: true, importId, scheduleVersion, inserted, updated, deactivated });
}
