/** Document-first contract metadata extraction through the Apex gateway. */
if (typeof window !== 'undefined') {
  throw new Error('contract-onboarding-extractor.ts must not be imported in the browser');
}

import { createHash } from 'node:crypto';
import { platformServiceClient } from '@/lib/platform/server-client';
import { getApexAIGateway } from '@/lib/ai/gateway';
import {
  buildContractOnboardingResult,
  CONTRACT_ONBOARDING_EXTRACTION_SCHEMA,
  CONTRACT_ONBOARDING_PIPELINE_VERSION,
  CONTRACT_ONBOARDING_TRUST_VERSION,
  type ContractOnboardingExtraction,
} from '@/lib/contracts/onboarding/document-first';

const BUCKET = 'contract-files';
const MAX_BYTES = 30 * 1024 * 1024;

const SYSTEM_PROMPT = `You structure contract onboarding facts for Insight Apex.
The attached PDF is the only documentary source. Never invent a number, title, party, date, value,
status, risk, project, responsible employee, approval or review. Return null/unknown when absent.
Every non-null documentary value needs a one-based source page, a short literal excerpt and a
confidence from 0 to 1. Mark ambiguous when two readings are possible and conflicting when the
document contains incompatible evidence. Distinguish signature, start, effective and end dates.
Effective-from-signature may use derivation=from_signature only when the document states that rule;
do not copy a nearby signature date by assumption. Classify contract_type only when supported.
Risk is a recommendation based only on material obligations, penalties, guarantees, liability,
termination, payment, indexation, retention, insurance and performance conditions; list its factors.
Do not output internal responsibility or project assignment. Do not claim human confirmation.`;

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

  const response = await getApexAIGateway().generate<ContractOnboardingExtraction>({
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
  const extraction = response.output;
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
