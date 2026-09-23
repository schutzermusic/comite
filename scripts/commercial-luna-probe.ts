import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getApexAIGateway } from '../src/lib/ai/gateway';
import { COMMERCIAL_EXTRACTION_SCHEMA, COMMERCIAL_EXTRACTION_SYSTEM_PROMPT,
  buildCommercialExtractionPrompt, normalizeCommercialFacts, normalizeClassification,
  validateCommercialExtraction,
  type ExtractionMode } from '../src/lib/commercial/document-intelligence';

const file = process.argv[2];
const mode = process.argv[3] as ExtractionMode;
if (!file || !mode) throw new Error('Usage: probe PDF MODE');
async function main() {
const result = await getApexAIGateway().generate<Record<string, unknown>>({
  organizationId: 'local-diagnostic-only', task: 'COMMERCIAL_DOCUMENT_EXTRACTION',
  systemPrompt: COMMERCIAL_EXTRACTION_SYSTEM_PROMPT,
  userPrompt: buildCommercialExtractionPrompt(mode, file.split('/').at(-1) ?? 'document.pdf'),
  document: { mediaType: 'application/pdf', base64: readFileSync(file).toString('base64') },
  structuredOutput: { name: 'commercial_facts', schema: COMMERCIAL_EXTRACTION_SCHEMA as unknown as Record<string, unknown> },
});
validateCommercialExtraction(result.output);
const normalized = normalizeCommercialFacts(mode, result.output);
console.log(JSON.stringify({
  provider: result.provenance.provider, model: result.provenance.model,
  task: result.provenance.task, durationMs: result.provenance.durationMs,
  usage: result.provenance.usage, stopReason: result.stopReason,
  responseId: result.provenance.responseId, requestId: result.provenance.requestId,
  outputKeys: Object.keys(result.output), rawFacts: Array.isArray(result.output.facts) ? result.output.facts.length : null,
  normalizedFacts: normalized.facts.length, discarded: normalized.discarded,
  domains: [...new Set(normalized.facts.map((fact) => fact.documentContext))],
  classified: Boolean(normalizeClassification(result.output)),
}));
}

main().catch((error) => {
  console.error(JSON.stringify({ code: error?.code ?? 'UNKNOWN', message: error?.message,
    context: error?.context }));
  process.exitCode = 1;
});
