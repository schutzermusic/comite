/** Document-first contract metadata extraction through the Apex gateway. */
if (typeof window !== 'undefined') {
  throw new Error('contract-onboarding-extractor.ts must not be imported in the browser');
}

import { createHash } from 'node:crypto';
import { platformServiceClient } from '@/lib/platform/server-client';
import { getApexAIGateway } from '@/lib/ai/gateway';
import {
  buildContractOnboardingResult,
  normalizeCompactContractOnboardingExtraction,
  CONTRACT_ONBOARDING_EXTRACTION_SCHEMA,
  CONTRACT_ONBOARDING_PIPELINE_VERSION,
  CONTRACT_ONBOARDING_TRUST_VERSION,
  type ContractOnboardingProviderExtraction,
} from '@/lib/contracts/onboarding/document-first';

const BUCKET = 'contract-files';
const MAX_BYTES = 30 * 1024 * 1024;

const SYSTEM_PROMPT = `You structure contract onboarding facts for Insight Apex.
The attached PDF is the only documentary source. Never invent a number, title, party, date, value,
status, risk, project, responsible employee, approval or review.

Return "facts" as a flat list containing EXACTLY ONE entry for each of these 18 keys:
contract_number, title, counterparty, contract_type, object, documentary_state, signature_date,
start_date, effective_date, end_date, renewal_date, total_value, monthly_value, currency,
payment_terms, indexation, retention, risk.
Never omit a key. Never repeat a key. Never invent a key outside this list. A fact you did not find
must still be returned, using the missing convention below — omitting it is an error, not an answer.

Every fact carries: key, value (always a string), page, excerpt, confidence, ambiguous, conflicting.

Missing convention (use exactly these):
- most keys: value = "", page = 0, excerpt = ""
- contract_type and risk: value = "unknown", page = 0, excerpt = ""
- documentary_state: "unknown" is a real answer meaning the document's situation genuinely cannot be
  determined, not an absence marker.

Value formats (the transport is strings; the format is not optional):
- dates (signature_date, start_date, effective_date, end_date, renewal_date): "YYYY-MM-DD" only, or
  "" when not confidently identified. Never "12/09/2026", never "September 12", never a partial date.
- total_value and monthly_value: a canonical decimal string using "." as the decimal separator and no
  grouping separators or currency symbol — "1500000" or "1500000.50", never "R$ 1.500.000,50". Use ""
  when the document states no such value.
- currency: the ISO code as written in the document, e.g. "BRL".
- contract_type: one of "Prestação de serviços", "Fornecimento", "Ordem de serviço", "Manutenção",
  "Aditivo contratual", "unknown".
- documentary_state: one of "draft", "signed", "active", "cancelled", "expired", "unknown".
- risk: one of "low", "medium", "high", "unknown".

When a documentary value exists: page must be a real one-based PDF page number greater than 0, never
a fabricated positive page; excerpt must be a short literal quote from the document, never invented or
paraphrased; confidence must be a number from 0 to 1 reflecting confidence in that specific value.
Do not fabricate evidence to make a fact look supported.

Mark ambiguous when two readings are possible and conflicting when the document contains incompatible
evidence. Distinguish signature, start, effective and end dates. Set the top-level
effective_date_derivation to "from_signature" only when the document states that the contract takes
effect on signature; use "explicit" when an effective date is stated directly and "unknown" otherwise.
Do not copy a nearby signature date by assumption.

Classify contract_type only when supported, otherwise "unknown". Risk is a recommendation based only
on material obligations, penalties, guarantees, liability, termination, payment, indexation,
retention, insurance and performance conditions; list its reasons in the top-level risk_factors array,
or return risk "unknown" with an empty risk_factors list when the document gives no basis. Never
fabricate a value merely to avoid a sentinel. Do not output internal responsibility or project
assignment. Do not claim human confirmation.`;

export async function extractContractOnboarding(intakeId: string) {
  const supabase = platformServiceClient();
  const { data: intake, error } = await supabase.from('contract_onboarding_intakes')
    .select('id,organization_id,file_path,content_sha256,status,contract_id')
    .eq('id', intakeId).maybeSingle<{
      id: string; organization_id: string; file_path: string; content_sha256: string;
      status: string; contract_id: string | null;
    }>();
  if (error) throw new Error(`Unable to load contract intake: ${error.message}`);
  if (!intake) throw new Error('Contract intake was not found.');
  if (intake.contract_id || ['READY', 'REQUIRES_ATTENTION'].includes(intake.status)) {
    return { intake_id: intake.id, status: intake.status, skipped: true };
  }

  await supabase.from('contract_onboarding_intakes').update({
    status: 'READING', started_at: new Date().toISOString(), error_code: null, error_safe: null,
  }).eq('id', intake.id).eq('organization_id', intake.organization_id);

  const download = await supabase.storage.from(BUCKET).download(intake.file_path);
  if (download.error || !download.data) {
    throw new Error(`Unable to download contract PDF: ${download.error?.message ?? 'missing file'}`);
  }
  const bytes = Buffer.from(await download.data.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error('Contract PDF exceeds the 30 MB reading limit.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== intake.content_sha256) throw new Error('Contract PDF integrity check failed.');

  const response = await getApexAIGateway().generate<ContractOnboardingProviderExtraction>({
    organizationId: intake.organization_id,
    task: 'CONTRACT_EXTRACTION',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: 'Read this original contract and return only the structured onboarding result.',
    document: { mediaType: 'application/pdf', base64: bytes.toString('base64') },
    structuredOutput: { name: 'contract_onboarding_extraction', schema: CONTRACT_ONBOARDING_EXTRACTION_SCHEMA },
  });

  await supabase.from('contract_onboarding_intakes').update({ status: 'STRUCTURING' })
    .eq('id', intake.id).eq('organization_id', intake.organization_id);

  if (!response.output || typeof response.output !== 'object') {
    throw new Error('Apex returned no structured contract result.');
  }
  // The compact provider transport (a flat fact list with string values and
  // page 0 / "" / "unknown" sentinels) is validated and reconstructed into the
  // canonical ContractOnboardingExtraction here, before the trust gate,
  // persistence or prefill ever see it. A fact set that is not exactly the 18
  // expected keys fails safe instead of being silently repaired.
  const extraction = normalizeCompactContractOnboardingExtraction(response.output);
  const result = buildContractOnboardingResult(extraction);
  const status = result.attentionCount > 0 ? 'REQUIRES_ATTENTION' : 'READY';
  const { error: updateError } = await supabase.from('contract_onboarding_intakes').update({
    status,
    extraction,
    structured_result: result,
    attention_count: result.attentionCount,
    ai_provider: response.provenance.provider,
    ai_model: response.provenance.model,
    ai_pipeline_version: CONTRACT_ONBOARDING_PIPELINE_VERSION,
    trust_policy_version: CONTRACT_ONBOARDING_TRUST_VERSION,
    ai_input_tokens: response.provenance.usage.inputTokens,
    ai_output_tokens: response.provenance.usage.outputTokens,
    completed_at: new Date().toISOString(),
  }).eq('id', intake.id).eq('organization_id', intake.organization_id);
  if (updateError) throw new Error(`Unable to persist contract intake result: ${updateError.message}`);
  return { intake_id: intake.id, status, attention_count: result.attentionCount };
}
