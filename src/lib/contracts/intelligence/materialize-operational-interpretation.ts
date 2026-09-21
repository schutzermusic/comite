/**
 * Materializa uma interpretação operacional já confirmada por um humano.
 *
 * Server-only. Espelha a escrita por família de `contract-operationalization.ts`,
 * mas para UMA linha — a que acabou de sair de `requires_attention` via Aceitar.
 *
 * Idempotente por `(organization_id, contract_id, source_document_id, ai_fingerprint)`:
 * se o fato já existe (reanálise automática, clique duplo), não duplica.
 */

if (typeof window !== 'undefined') {
  throw new Error('materialize-operational-interpretation.ts não pode ser importado no browser');
}

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ContractOperationalInterpretationRow } from '@/lib/contracts/intelligence/operational-interpretations';
import type {
  OperationalBillingCondition,
  OperationalGuarantee,
  OperationalIndexation,
  OperationalInsurance,
  OperationalObligation,
} from '@/lib/ai/contract-operationalization';

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Credenciais de serviço do Supabase ausentes.');
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

const FAMILY_TABLE: Record<ContractOperationalInterpretationRow['family'], string> = {
  obligations: 'contract_obligation_definitions',
  billing_conditions: 'contract_billing_conditions',
  guarantees: 'contract_guarantees',
  insurance_requirements: 'contract_insurance_requirements',
  indexation_rules: 'contract_indexation_rules',
};

export type MaterializeResult = {
  readonly materialized: boolean;
  readonly alreadyPresent: boolean;
  readonly family: ContractOperationalInterpretationRow['family'];
  readonly materializedInstances: number;
};

async function factExists(
  supabase: SupabaseClient,
  table: string,
  row: ContractOperationalInterpretationRow,
): Promise<boolean> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', row.organization_id)
    .eq('contract_id', row.contract_id)
    .eq('source_document_id', row.source_document_id)
    .eq('ai_fingerprint', row.fingerprint);
  if (error) throw new Error(`Erro ao verificar fato existente (${table}): ${error.message}`);
  return (count ?? 0) > 0;
}

function num(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function bool(payload: Record<string, unknown>, key: string): boolean | null {
  const v = payload[key];
  return typeof v === 'boolean' ? v : null;
}

function confidenceOf(row: ContractOperationalInterpretationRow): number {
  const n = typeof row.confidence === 'number' ? row.confidence : Number(row.confidence);
  return Number.isFinite(n) ? n : 0;
}

function provenance(
  row: ContractOperationalInterpretationRow,
  actorUserId: string | null,
) {
  return {
    ai_origin: 'apex_ai' as const,
    ai_analysis_id: row.analysis_id,
    ai_provider: row.provider,
    ai_model: row.model,
    ai_confidence: confidenceOf(row),
    ai_pipeline_version: row.pipeline_version,
    ai_requesting_user_id: row.requesting_user_id ?? actorUserId,
    ai_evidence: {
      documentId: row.source_document_id,
      page: row.source_page,
      excerpt: row.source_excerpt,
    },
    // Usa o fingerprint da interpretação (não o da família singular) para
    // casar com o bypass do guard e com o índice único pós-Aceitar.
    ai_fingerprint: row.fingerprint,
  };
}

/**
 * Copia a interpretação confirmada para a tabela de fato correspondente.
 * Só deve ser chamada depois da RPC `contract_operational_interpretation_resolve`
 * com `confirm` — o guard de autoridade depende do carimbo humano.
 */
export async function materializeOperationalInterpretation(
  row: ContractOperationalInterpretationRow,
  options: { actorUserId?: string | null; documentTitle?: string | null } = {},
): Promise<MaterializeResult> {
  if (row.human_decision !== 'confirm' || row.trust_state !== 'automatic') {
    throw new Error('Só interpretações confirmadas podem ser materializadas.');
  }

  const payload = (row.normalized_payload ?? {}) as Record<string, unknown>;
  const table = FAMILY_TABLE[row.family];
  const supabase = getServiceClient();
  const actorUserId = options.actorUserId ?? row.requesting_user_id ?? null;
  const base = {
    organization_id: row.organization_id,
    contract_id: row.contract_id,
  };

  if (await factExists(supabase, table, row)) {
    return {
      materialized: false,
      alreadyPresent: true,
      family: row.family,
      materializedInstances: 0,
    };
  }

  const title = str(payload, 'title') ?? 'Exigência operacional';
  const prov = provenance(row, actorUserId);
  let materializedInstances = 0;

  if (row.family === 'obligations') {
    const o = payload as unknown as OperationalObligation;
    const { data: inserted, error } = await supabase
      .from('contract_obligation_definitions')
      .insert({
        ...base,
        ...prov,
        title: o.title ?? title,
        requirement_text: o.requirement_text ?? str(payload, 'requirement_text') ?? title,
        category: o.category ?? str(payload, 'category'),
        responsible_side: o.responsible_side ?? str(payload, 'responsible_side') ?? 'unknown',
        source_document_id: row.source_document_id,
        source_page: row.source_page,
        source_excerpt: row.source_excerpt,
        activation_kind: o.activation_kind ?? str(payload, 'activation_kind') ?? 'unspecified',
        activation_offset_days: o.activation_offset_days ?? num(payload, 'activation_offset_days'),
        activation_fixed_date: o.activation_fixed_date ?? str(payload, 'activation_fixed_date'),
        activation_event_text: o.activation_event_text ?? str(payload, 'activation_event_text'),
        due_kind: o.due_kind ?? str(payload, 'due_kind') ?? 'unspecified',
        due_offset_days: o.due_offset_days ?? num(payload, 'due_offset_days'),
        due_fixed_date: o.due_fixed_date ?? str(payload, 'due_fixed_date'),
        calendar_basis: o.calendar_basis ?? str(payload, 'calendar_basis') ?? 'unspecified',
        schedule_anchor: o.schedule_anchor ?? str(payload, 'schedule_anchor'),
        schedule_anchor_offset_days:
          o.schedule_anchor_offset_days ?? num(payload, 'schedule_anchor_offset_days'),
        schedule_anchor_text: o.schedule_anchor_text ?? str(payload, 'schedule_anchor_text'),
        recurrence_kind: o.recurrence_kind ?? str(payload, 'recurrence_kind') ?? 'one_time',
        recurrence_interval: o.recurrence_interval ?? num(payload, 'recurrence_interval'),
        blocks_billing: o.blocks_billing ?? bool(payload, 'blocks_billing'),
        created_by: actorUserId,
        recorded_note: options.documentTitle
          ? `Aceita por autoridade humana a partir de "${options.documentTitle}".`
          : 'Aceita por autoridade humana a partir da interpretação operacional.',
      })
      .select('id')
      .single();
    if (error) throw new Error(`Erro ao materializar obrigação: ${error.message}`);

    const horizon = new Date();
    horizon.setUTCFullYear(horizon.getUTCFullYear() + 2);
    const { data: created, error: materializeError } = await supabase.rpc(
      'contract_obligations_materialize',
      {
        p_definition_id: inserted.id,
        p_through: horizon.toISOString().slice(0, 10),
        p_organization_id: row.organization_id,
      },
    );
    if (materializeError) {
      throw new Error(`Erro ao materializar ocorrências: ${materializeError.message}`);
    }
    materializedInstances = Number(created ?? 0);
  } else if (row.family === 'billing_conditions') {
    const b = payload as unknown as OperationalBillingCondition;
    const { error } = await supabase.from('contract_billing_conditions').insert({
      ...base,
      ...prov,
      title: b.title ?? title,
      source_document_id: row.source_document_id,
      source_page: row.source_page,
      source_reference: row.source_excerpt,
      created_by: actorUserId,
      condition_type: b.condition_type ?? str(payload, 'condition_type') ?? 'contractual_event',
      requirement_text: b.requirement_text ?? str(payload, 'requirement_text') ?? title,
      required_document_type: b.required_document_type ?? str(payload, 'required_document_type'),
      elapsed_period_days: b.elapsed_period_days ?? num(payload, 'elapsed_period_days'),
    });
    if (error) throw new Error(`Erro ao materializar condição de faturamento: ${error.message}`);
  } else if (row.family === 'guarantees') {
    const g = payload as unknown as OperationalGuarantee;
    const { error } = await supabase.from('contract_guarantees').insert({
      ...base,
      ...prov,
      title: g.title ?? title,
      source_document_id: row.source_document_id,
      source_page: row.source_page,
      source_reference: row.source_excerpt,
      created_by: actorUserId,
      guarantee_type: g.guarantee_type ?? str(payload, 'guarantee_type'),
      required_amount: g.required_amount ?? num(payload, 'required_amount'),
      required_percentage: g.required_percentage ?? num(payload, 'required_percentage'),
      percentage_basis: g.percentage_basis ?? str(payload, 'percentage_basis'),
      renewal_required: g.renewal_required ?? bool(payload, 'renewal_required'),
    });
    if (error) throw new Error(`Erro ao materializar garantia: ${error.message}`);
  } else if (row.family === 'insurance_requirements') {
    const i = payload as unknown as OperationalInsurance;
    const { error } = await supabase.from('contract_insurance_requirements').insert({
      ...base,
      ...prov,
      title: i.title ?? title,
      source_document_id: row.source_document_id,
      source_page: row.source_page,
      source_reference: row.source_excerpt,
      created_by: actorUserId,
      insurance_type: i.insurance_type ?? str(payload, 'insurance_type'),
      required_coverage: i.required_coverage ?? num(payload, 'required_coverage'),
      policy_required: i.policy_required ?? bool(payload, 'policy_required'),
      validity_requirement: i.validity_requirement ?? str(payload, 'validity_requirement'),
    });
    if (error) throw new Error(`Erro ao materializar exigência de seguro: ${error.message}`);
  } else if (row.family === 'indexation_rules') {
    const r = payload as unknown as OperationalIndexation;
    const { error } = await supabase.from('contract_indexation_rules').insert({
      ...base,
      ...prov,
      title: r.title ?? title,
      source_document_id: row.source_document_id,
      source_page: row.source_page,
      source_reference: row.source_excerpt,
      created_by: actorUserId,
      indexer: r.indexer ?? str(payload, 'indexer'),
      periodicity_months: r.periodicity_months ?? num(payload, 'periodicity_months'),
      anniversary_rule: r.anniversary_rule ?? str(payload, 'anniversary_rule'),
      lag_months: r.lag_months ?? num(payload, 'lag_months'),
    });
    if (error) throw new Error(`Erro ao materializar regra de reajuste: ${error.message}`);
  }

  return {
    materialized: true,
    alreadyPresent: false,
    family: row.family,
    materializedInstances,
  };
}
