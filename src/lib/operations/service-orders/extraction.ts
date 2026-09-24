/**
 * "Importar OS" — a leitura do PDF e o confronto assistido.
 *
 * Nada aqui é um pipeline novo: a leitura é a MESMA da inteligência
 * documental compartilhada (`document-intelligence.ts`, papel
 * `INTERNAL_SERVICE_ORDER`, portão `ApexAIGateway`), e cada fato cai em
 * `commercial_extracted_facts` com página, trecho e modelo. A função
 * governada transforma os fatos em linhas PENDENTES de revisão — a IA nunca
 * escreve uma linha confirmada.
 */
if (typeof window !== 'undefined') {
  throw new Error('operations/service-orders/extraction.ts não pode ser importado no navegador');
}

import {
  COMMERCIAL_EXTRACTION_SCHEMA, COMMERCIAL_EXTRACTION_SYSTEM_PROMPT, COMMERCIAL_INTAKE_PIPELINE_VERSION,
  apexTaskForContext, buildCommercialExtractionPrompt, normalizeCommercialFacts, validateCommercialExtraction,
} from '@/lib/commercial/document-intelligence';
import { recordExtractedFact } from '@/lib/commercial/engagement-service';
import { getApexAIGateway } from '@/lib/ai/gateway';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';
import { applyExtraction, recordDivergence } from './service';
import {
  DIVERGENCE_REVIEW_SCHEMA, DIVERGENCE_REVIEW_SYSTEM_PROMPT, buildDivergenceReviewPrompt,
  normalizeDivergenceCandidates, type ReviewFact,
} from './divergence-review';

export const SERVICE_ORDER_UPLOAD_PREFIX = 'service-orders';

/** Caminho gerado pelo servidor: dentro do inquilino, nunca escolhido pelo navegador. */
export function serviceOrderUploadPath(organizationId: string, uuid: string, fileName: string): string {
  const name = fileName.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
  return `${organizationId}/${SERVICE_ORDER_UPLOAD_PREFIX}/${uuid}-${name}`;
}

export function isServiceOrderUploadPath(organizationId: string, path: string): boolean {
  return path.startsWith(`${organizationId}/${SERVICE_ORDER_UPLOAD_PREFIX}/`) && !path.includes('..');
}

export interface ExtractionOutcome {
  facts: number;
  discarded: number;
  itemsAdded: number;
  provider: string;
  model: string;
}

export async function extractUploadedServiceOrder(input: {
  organizationId: string; actorId: string; serviceOrderId: string; engagementId: string;
  documentId: string; path: string; fileName: string;
}): Promise<ExtractionOutcome> {
  const client = platformServiceClient();

  // Reenviar o mesmo PDF não relê: os fatos desta OS já estão lá.
  const { count } = await client.from('commercial_extracted_facts')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', input.organizationId).eq('subject_kind', 'internal_service_order')
    .eq('subject_id', input.serviceOrderId);
  if ((count ?? 0) > 0) {
    const applied = await applyExtraction(input.organizationId, input.actorId, input.serviceOrderId);
    return { facts: count ?? 0, discarded: 0, itemsAdded: applied.items_added, provider: 'cached', model: 'cached' };
  }

  const download = await client.storage.from(ONBOARDING_STORAGE_BUCKET).download(input.path);
  if (download.error || !download.data) throw new Error('PDF indisponível no armazenamento.');
  const pdf = Buffer.from(await download.data.arrayBuffer());

  const context = 'INTERNAL_SERVICE_ORDER' as const;
  const response = await getApexAIGateway().generate<unknown>({
    organizationId: input.organizationId,
    task: apexTaskForContext(context),
    systemPrompt: COMMERCIAL_EXTRACTION_SYSTEM_PROMPT,
    userPrompt: buildCommercialExtractionPrompt(context, input.fileName),
    document: { mediaType: 'application/pdf', base64: pdf.toString('base64') },
    structuredOutput: { name: 'commercial_facts', schema: COMMERCIAL_EXTRACTION_SCHEMA as unknown as Record<string, unknown> },
  });
  validateCommercialExtraction(response.output);
  const { facts, discarded } = normalizeCommercialFacts(context, response.output);

  for (const fact of facts) {
    await recordExtractedFact(input.organizationId, {
      engagement_id: input.engagementId, document_id: input.documentId,
      document_context: fact.documentContext,
      subject_kind: 'internal_service_order', subject_id: input.serviceOrderId,
      fact_domain: fact.factDomain, label: fact.label, value_text: fact.valueText,
      value_numeric: fact.valueNumeric, value_date: fact.valueDate, currency: fact.currency,
      source_page: fact.sourcePage, source_section: fact.sourceSection, source_quote: fact.sourceQuote,
      confidence: fact.confidence, extraction_method: 'ai',
      ai_provider: response.provenance.provider, ai_model: response.provenance.model,
      ai_pipeline_version: COMMERCIAL_INTAKE_PIPELINE_VERSION,
    });
  }
  const applied = await applyExtraction(input.organizationId, input.actorId, input.serviceOrderId);
  return {
    facts: facts.length, discarded, itemsAdded: applied.items_added,
    provider: response.provenance.provider, model: response.provenance.model,
  };
}

type FactRow = { fact_domain: string; label: string; value_text: string | null; value_numeric: string | null;
  currency: string | null; unit: string | null; value_date: string | null; corrected_value: string | null;
  source_page: number | null; document_context: string; confirmation_state: string };

const factValue = (f: FactRow) => f.corrected_value ?? f.value_text
  ?? (f.value_numeric !== null ? `${f.value_numeric}${f.currency ? ` ${f.currency}` : f.unit ? ` ${f.unit}` : ''}` : null)
  ?? f.value_date;

/**
 * Candidatas de divergência da OS carregada contra o pacote aceito.
 * Sem fatos dos dois lados, não há o que comparar — e isso é dito, não
 * inventado.
 */
export async function reviewDivergencesWithAI(input: {
  organizationId: string; actorId: string; serviceOrderId: string; packageRevisionIds: string[];
}): Promise<{ compared: boolean; reason?: string; recorded: number; discarded: number; model?: string }> {
  const client = platformServiceClient();
  const select = 'fact_domain,label,value_text,value_numeric,currency,unit,value_date,corrected_value,source_page,document_context,confirmation_state';
  const [osFacts, pkgFacts] = await Promise.all([
    client.from('commercial_extracted_facts').select(select)
      .eq('organization_id', input.organizationId).eq('subject_kind', 'internal_service_order')
      .eq('subject_id', input.serviceOrderId).neq('confirmation_state', 'REJECTED'),
    input.packageRevisionIds.length
      ? client.from('commercial_extracted_facts').select(select)
          .eq('organization_id', input.organizationId).eq('subject_kind', 'proposal_revision')
          .in('subject_id', input.packageRevisionIds).neq('confirmation_state', 'REJECTED')
      : Promise.resolve({ data: [] as FactRow[] }),
  ]);
  const os = (osFacts.data ?? []) as FactRow[];
  const pkg = (pkgFacts.data ?? []) as FactRow[];
  if (!os.length || !pkg.length) {
    return { compared: false, reason: !os.length ? 'NO_SERVICE_ORDER_FACTS' : 'NO_PACKAGE_FACTS', recorded: 0, discarded: 0 };
  }

  const facts: ReviewFact[] = [
    ...os.map((f) => ({ source: 'OS' as const, domain: f.fact_domain, label: f.label, value: factValue(f), page: f.source_page })),
    ...pkg.map((f) => ({ source: (f.document_context === 'COMMERCIAL_PROPOSAL' ? 'PC' : 'PT') as 'PC' | 'PT',
      domain: f.fact_domain, label: f.label, value: factValue(f), page: f.source_page })),
  ];
  const response = await getApexAIGateway().generate<unknown>({
    organizationId: input.organizationId,
    task: 'SERVICE_ORDER_DIVERGENCE_REVIEW',
    systemPrompt: DIVERGENCE_REVIEW_SYSTEM_PROMPT,
    userPrompt: buildDivergenceReviewPrompt(facts),
    structuredOutput: { name: 'service_order_divergences', schema: DIVERGENCE_REVIEW_SCHEMA as unknown as Record<string, unknown> },
  });
  const { candidates, discarded } = normalizeDivergenceCandidates(response.output);
  let recorded = 0;
  for (const c of candidates) {
    const r = await recordDivergence(input.organizationId, null, input.serviceOrderId, {
      scope: c.scope, severity: c.severity, summary: c.summary,
      left_source_kind: 'accepted_proposal', left_value: c.leftValue, right_value: c.rightValue,
      detected_by: 'ai', ai_provider: response.provenance.provider, ai_model: response.provenance.model,
      confidence: c.confidence,
    });
    if (r.recorded) recorded += 1;
  }
  return { compared: true, recorded, discarded, model: response.provenance.model };
}
