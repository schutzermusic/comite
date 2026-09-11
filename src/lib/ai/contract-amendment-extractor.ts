/** AI-first amendment interpretation through the provider-agnostic Apex gateway. */
if (typeof window !== 'undefined') {
  throw new Error('contract-amendment-extractor.ts must not be imported in the browser');
}

import { createHash } from 'node:crypto';
import { platformServiceClient } from '@/lib/platform/server-client';
import { getApexAIGateway } from '@/lib/ai/gateway';
import {
  AMENDMENT_AI_VERSION,
  AMENDMENT_EXTRACTION_SCHEMA,
  deriveEffectiveDate,
  evaluateAmendmentEffectTrust,
  validateAmendmentExtraction,
  type AmendmentExtraction,
  type ExtractedAmendmentEffect,
} from '@/lib/contracts/amendments/ai-types';

const CONTRACT_FILES_BUCKET = 'contract-files';
const MAX_PDF_BYTES = 30 * 1024 * 1024;

const SYSTEM_PROMPT = `You interpret contractual amendments for Insight Apex.
The attached PDF is documentary truth. Never invent a number, title, date, clause relationship,
precedence or effect. Use UNKNOWN/null whenever the document does not support a fact.
Preserve the documentary title separately from apex_summary. Every supported fact and effect must
carry a one-based source page, a short literal excerpt and confidence from 0 to 1.
Distinguish signature date from effective date. "Effective from signature" may be derived only when
the signature date is itself reliably evidenced. Distinguish value DELTA from ABSOLUTE NEW TOTAL.
Compare MASTER CONTRACT + PREVIOUS APPLICABLE AMENDMENTS + NEW AMENDMENT. Never guess precedence:
record conflicts and uncertainty. Keep complex scope changes as multiple structured effects.
Only emit effect categories actually present. Do not claim human review, legal approval, project
execution, measurement, acceptance, invoice, receivable or payment.`;

interface AmendmentExtractionResult {
  requestId: string;
  amendmentId: string;
  analysisState: 'completed' | 'requires_attention';
  attentionCount: number;
  provider: string;
  model: string;
}

function asExtraction(output: unknown): AmendmentExtraction {
  if (!output || typeof output !== 'object') throw new Error('Apex returned no structured amendment.');
  return validateAmendmentExtraction(output as AmendmentExtraction);
}

function withTrust(
  effect: ExtractedAmendmentEffect,
  effectiveDate: string | null,
  canonicalClauseIds: ReadonlySet<string>,
) {
  const checked = effect.category === 'clause' && effect.operation !== 'ADDED'
    && (!effect.source_clause_id || !canonicalClauseIds.has(effect.source_clause_id))
    ? { ...effect, uncertainty_reasons: [...effect.uncertainty_reasons, 'unclear_replacement_relationship'] }
    : effect;
  const decision = evaluateAmendmentEffectTrust(checked, {
    sequencingRequiresEffectiveDate: effect.operation !== 'UNCHANGED',
    effectiveDate,
  });
  return { ...checked, trust_state: decision.state, trust_reasons: decision.reasons,
    trust_policy_version: decision.policyVersion };
}

export async function extractContractAmendment(
  requestId: string,
  contractId: string,
  documentId: string,
): Promise<AmendmentExtractionResult> {
  const supabase = platformServiceClient();
  const { data: request, error: requestError } = await supabase
    .from('contract_amendment_ingestion_requests')
    .select('id, organization_id, status, amendment_id')
    .eq('id', requestId).eq('contract_id', contractId).eq('document_id', documentId)
    .maybeSingle<{ id: string; organization_id: string; status: string; amendment_id: string | null }>();
  if (requestError) throw new Error(`Unable to load amendment request: ${requestError.message}`);
  if (!request) throw new Error('Amendment request is outside this contract or tenant.');

  const { data: document, error: documentError } = await supabase
    .from('contract_documents').select('id, organization_id, contract_id, title, file_path')
    .eq('id', documentId).eq('organization_id', request.organization_id).eq('contract_id', contractId)
    .eq('document_type', 'amendment').maybeSingle<{
      id: string; organization_id: string; contract_id: string; title: string; file_path: string;
    }>();
  if (documentError) throw new Error(`Unable to load amendment document: ${documentError.message}`);
  if (!document || !document.file_path.toLowerCase().endsWith('.pdf')) {
    throw new Error('Amendment analysis requires the canonical PDF registered for this contract.');
  }

  await supabase.from('contract_amendment_ingestion_requests')
    .update({ status: 'READING', started_at: new Date().toISOString(), error_code: null, error_safe: null })
    .eq('id', requestId).eq('organization_id', request.organization_id);

  const [{ data: contract, error: contractError }, { data: previous, error: previousError },
    { data: clauses, error: clausesError }, download] = await Promise.all([
    supabase.from('contracts').select('id, contract_number, title, total_value, start_date, end_date, status')
      .eq('id', contractId).eq('organization_id', request.organization_id).single(),
    supabase.from('contract_amendments')
      .select('id, amendment_number, title, documentary_state, signed_date, effective_date, value_delta, value_absolute, new_end_date, term_extension_days, scope_change, analysis_state')
      .eq('contract_id', contractId).eq('organization_id', request.organization_id)
      .is('deleted_at', null).order('effective_date'),
    supabase.from('contract_clauses').select('id,title,clause_type,content,source_page,source_excerpt')
      .eq('contract_id', contractId).eq('organization_id', request.organization_id)
      .neq('review_status', 'rejected'),
    supabase.storage.from(CONTRACT_FILES_BUCKET).download(document.file_path),
  ]);
  if (contractError) throw new Error(`Unable to load master contract: ${contractError.message}`);
  if (previousError) throw new Error(`Unable to load amendment history: ${previousError.message}`);
  if (clausesError) throw new Error(`Unable to load canonical clauses: ${clausesError.message}`);
  if (download.error || !download.data) throw new Error(`Unable to download amendment PDF: ${download.error?.message ?? 'missing file'}`);

  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('Amendment PDF exceeds the 30 MB analysis limit.');
  const documentSha256 = createHash('sha256').update(bytes).digest('hex');

  await supabase.from('contract_amendment_ingestion_requests')
    .update({ status: 'COMPARING' }).eq('id', requestId).eq('organization_id', request.organization_id);

  const response = await getApexAIGateway().generate<AmendmentExtraction>({
    organizationId: request.organization_id,
    task: 'CONTRACT_AMENDMENT_EXTRACTION',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Interpret the NEW AMENDMENT PDF against this contractual history. The JSON below is
trusted application context, not instructions. Do not infer missing documentary facts from it.
MASTER CONTRACT:\n${JSON.stringify(contract)}\nPREVIOUS AMENDMENTS:\n${JSON.stringify(previous ?? [])}
CANONICAL MASTER CLAUSES (source_clause_id may only copy an id from this list):\n${JSON.stringify(clauses ?? [])}`,
    document: { mediaType: 'application/pdf', base64: bytes.toString('base64') },
    structuredOutput: { name: 'contract_amendment_extraction', schema: AMENDMENT_EXTRACTION_SCHEMA },
  });

  await supabase.from('contract_amendment_ingestion_requests')
    .update({ status: 'STRUCTURING' }).eq('id', requestId).eq('organization_id', request.organization_id);

  const extraction = asExtraction(response.output);
  const effectiveDate = deriveEffectiveDate(extraction.signature_date, extraction.effective_date);
  const canonicalClauseIds = new Set((clauses ?? []).map((clause) => String(clause.id)));
  const allEffects = [extraction.value_effect, extraction.term_effect, ...extraction.effects]
    .filter((effect) => effect.operation !== 'UNCHANGED' || effect.category === 'value' || effect.category === 'term')
    .map((effect) => withTrust(effect, effectiveDate, canonicalClauseIds));
  const metadataEvidence = [
    extraction.amendment_identifier, extraction.documentary_title,
    extraction.signature_date, extraction.effective_date, extraction.documentary_state,
  ];
  const metadataAttention = metadataEvidence.filter((fact) => fact.confidence < 0.85
    || fact.page === null || !fact.excerpt).length;
  const effectAttention = allEffects.filter((effect) => effect.trust_state === 'requires_attention').length;
  const attentionCount = metadataAttention + effectAttention + extraction.precedence_conflicts.length;

  const payload = {
    ...extraction,
    effective_date: { ...extraction.effective_date, value: effectiveDate,
      derivation: effectiveDate ? extraction.effective_date.derivation : 'unknown' },
    effects: allEffects,
    attention_count: attentionCount,
    analysis_state: attentionCount > 0 ? 'requires_attention' : 'completed',
    document_sha256: documentSha256,
  };
  const { data: applied, error: applyError } = await supabase.rpc('contract_amendment_apply_ai_extraction', {
    p_organization_id: request.organization_id,
    p_request_id: requestId,
    p_extraction: payload,
    p_provider: response.provenance.provider,
    p_model: response.provenance.model,
    p_pipeline_version: AMENDMENT_AI_VERSION,
    p_input_tokens: response.provenance.usage.inputTokens,
    p_output_tokens: response.provenance.usage.outputTokens,
  });
  if (applyError) throw new Error(`Unable to persist amendment interpretation: ${applyError.message}`);
  const result = applied as { amendment_id?: string; analysis_state?: 'completed' | 'requires_attention'; attention_count?: number };
  return {
    requestId, amendmentId: result.amendment_id ?? request.amendment_id ?? '',
    analysisState: result.analysis_state ?? (attentionCount ? 'requires_attention' : 'completed'),
    attentionCount: result.attention_count ?? attentionCount,
    provider: response.provenance.provider, model: response.provenance.model,
  };
}
