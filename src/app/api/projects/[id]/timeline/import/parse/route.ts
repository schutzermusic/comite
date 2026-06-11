import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import {
  extractScheduleFromPages,
  isWeakExtraction,
  validateParsedRows,
  type PositionedItem,
} from '@/lib/projects/ms-project-parser';
import {
  AiExtractionUnavailableError,
  extractScheduleWithAi,
} from '@/lib/projects/ms-project-ai-extractor';
import { matchRows } from '@/lib/projects/timeline-import-matcher';
import type { ParsePreview, TimelineItem } from '@/lib/types/project-timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** pdfjs-dist (legacy build, dynamic import — see next.config serverExternalPackages). */
async function extractPositionedText(buffer: Buffer): Promise<PositionedItem[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const pages: PositionedItem[][] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PositionedItem[] = [];
      for (const item of content.items) {
        if (!('str' in item) || typeof item.str !== 'string') continue;
        const transform = (item as { transform?: number[] }).transform;
        if (!Array.isArray(transform) || transform.length < 6) continue;
        items.push({
          str: item.str,
          x: transform[4],
          y: transform[5],
          width: (item as { width?: number }).width ?? 0,
        });
      }
      pages.push(items);
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

/** Loads the project's current active timeline items (for the re-import diff). */
async function loadExistingItems(projectId: string): Promise<TimelineItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('project_timeline_items')
    .select('id, project_id, parent_id, import_batch_id, original_ms_project_id, wbs_code, title, planned_start, planned_finish, duration_minutes, percent_complete, row_order, is_active, deleted_at')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .is('deleted_at', null);
  return (data ?? []).map((row: Record<string, unknown>) => ({
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
}

/**
 * POST /api/projects/[id]/timeline/import/parse
 * Multipart upload of an MS Project PDF. Stateless: parses (deterministic →
 * AI fallback), validates and returns the preview + diff. Writes nothing.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireApiPermission('projects.timeline.import', { allowAdmin: true });
  if (!guard.ok) return guard.response;
  const { id: projectId } = await context.params;

  let file: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get('file');
    if (entry instanceof File) file = entry;
  } catch {
    return NextResponse.json({ ok: false, error: 'Envio multipart inválido.' }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ ok: false, error: 'Arquivo PDF ausente (campo "file").' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ ok: false, error: 'Arquivo acima de 15MB.' }, { status: 413 });
  }
  if (file.type && file.type !== 'application/pdf') {
    return NextResponse.json({ ok: false, error: 'Apenas PDF exportado do MS Project é suportado.' }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  // 1) Deterministic positioned-text extraction.
  let parserUsed: 'deterministic' | 'ai' = 'deterministic';
  let result;
  const extraWarnings: string[] = [];
  try {
    const pages = await extractPositionedText(buffer);
    result = validateParsedRows(extractScheduleFromPages(pages));
  } catch (e) {
    console.error('[timeline/import] pdfjs extraction failed:', e instanceof Error ? e.message : e);
    result = validateParsedRows([]);
    extraWarnings.push('Extração determinística falhou — usando IA.');
  }

  // 2) AI fallback when the deterministic result is weak.
  if (isWeakExtraction(result)) {
    try {
      const aiRows = await extractScheduleWithAi(buffer.toString('base64'));
      const aiResult = validateParsedRows(aiRows);
      if (!isWeakExtraction(aiResult) || aiResult.rows.length > result.rows.length) {
        result = aiResult;
        parserUsed = 'ai';
      }
    } catch (e) {
      if (e instanceof AiExtractionUnavailableError) {
        extraWarnings.push(
          'Leitura determinística fraca e ANTHROPIC_API_KEY ausente — revise as linhas sinalizadas antes de importar.',
        );
      } else {
        console.error('[timeline/import] AI fallback failed:', e instanceof Error ? e.message : e);
        extraWarnings.push('Fallback de IA falhou — resultado determinístico mantido.');
      }
    }
  }

  if (result.rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Nenhuma linha de cronograma reconhecida no PDF.', warnings: [...result.warnings, ...extraWarnings] },
      { status: 422 },
    );
  }

  // 3) Diff vs existing timeline (RLS-scoped to the caller's org).
  const existing = await loadExistingItems(projectId);
  const plan = matchRows(existing, result.rows);

  const preview: ParsePreview = {
    rows: result.rows,
    warnings: [...result.warnings, ...extraWarnings],
    stats: result.stats,
    fileHash,
    fileName: file.name,
    parserUsed,
    diff: plan.diff,
  };
  return NextResponse.json({ ok: true, preview, hasExistingTimeline: existing.length > 0 });
}
