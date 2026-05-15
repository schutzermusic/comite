/**
 * Persists AI risk findings into public.risks via the service-role client.
 *
 * Dedup contract: migration 012 has a UNIQUE partial index on
 * (organization_id, source_module, source_entity_id, category) WHERE
 * origin='ai' AND ai_dismissed=false. Rather than rely on PostgREST's
 * ON CONFLICT (which is awkward with partial indexes), we pre-filter:
 * load the already-active AI risks for the target entity set and drop
 * findings whose (entity, category) tuple already exists. This keeps the
 * SQL portable and lets us return a clear "skipped" count to the caller.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/risk-persistence.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_MODEL } from './server-clients';
import type { AiRiskFinding, AiSourceModule } from './types';

export interface PersistFindingsContext {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  sourceModule: AiSourceModule;
  /** Default anchor entity used when a finding does not declare its own. */
  defaultEntityId: string;
  /** Pretty name surfaced on the risk card (contract code, project name, period label, ...). */
  referenceName: string;
  /** Free-form domain label shown under the risk card (e.g. "Financeiro / 2026-03"). */
  area: string;
}

export interface PersistFindingsResult {
  inserted: Array<Record<string, unknown>>;
  skippedDuplicates: number;
}

export async function persistAiRiskFindings(
  findings: AiRiskFinding[],
  ctx: PersistFindingsContext,
): Promise<PersistFindingsResult> {
  if (findings.length === 0) return { inserted: [], skippedDuplicates: 0 };

  const entityIds = Array.from(
    new Set(
      findings.map((f) => (f.sourceEntityId && f.sourceEntityId.trim()) || ctx.defaultEntityId),
    ),
  );

  // Pre-load active AI risks for the entities we're about to write.
  const { data: existing, error: selErr } = await ctx.supabase
    .from('risks')
    .select('source_entity_id,category')
    .eq('organization_id', ctx.orgId)
    .eq('origin', 'ai')
    .eq('source_module', ctx.sourceModule)
    .eq('ai_dismissed', false)
    .in('source_entity_id', entityIds);

  if (selErr) {
    throw new Error(`Erro ao consultar riscos IA existentes: ${selErr.message}`);
  }

  const activeKey = (entityId: string, category: string) => `${entityId}::${category}`;
  const activeSet = new Set<string>(
    (existing ?? []).map((r: { source_entity_id: string; category: string }) =>
      activeKey(r.source_entity_id, r.category),
    ),
  );

  const now = new Date().toISOString();
  let skipped = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const f of findings) {
    const entityId = (f.sourceEntityId && f.sourceEntityId.trim()) || ctx.defaultEntityId;
    if (activeSet.has(activeKey(entityId, f.category))) {
      skipped += 1;
      continue;
    }
    rows.push({
      organization_id: ctx.orgId,
      title: f.title,
      description: f.description,
      category: f.category,
      area: ctx.area,
      probability: f.probability,
      impact: f.impact,
      severity: f.severity,
      origin: 'ai',
      reference_id: entityId,
      reference_name: ctx.referenceName,
      status: 'open' as const,
      mitigation_plan: f.mitigation || null,
      source_module: ctx.sourceModule,
      source_entity_id: entityId,
      ai_model: AI_MODEL,
      ai_confidence: f.confidence,
      ai_rationale: f.rationale,
      ai_analyzed_at: now,
      created_by: ctx.userId,
    });
  }

  if (rows.length === 0) {
    return { inserted: [], skippedDuplicates: skipped };
  }

  const { data, error } = await ctx.supabase.from('risks').insert(rows).select('*');
  if (error) {
    // The partial unique index acts as a backstop against races. Surface 23505
    // distinctly so the caller can decide whether to ignore.
    throw new Error(`Erro ao inserir riscos IA (service-role): ${error.message}`);
  }

  return {
    inserted: (data ?? []) as Array<Record<string, unknown>>,
    skippedDuplicates: skipped,
  };
}
