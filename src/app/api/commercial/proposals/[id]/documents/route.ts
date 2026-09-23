import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError, hasOptionalPermission } from '@/lib/commercial/server-session';
import {
  createExecutionBlueprint, recordExtractedFact, registerProposalDocument,
} from '@/lib/commercial/engagement-service';
import {
  COMMERCIAL_EXTRACTION_SCHEMA, COMMERCIAL_EXTRACTION_SYSTEM_PROMPT, COMMERCIAL_INTAKE_PIPELINE_VERSION,
  apexTaskForContext, buildCommercialExtractionPrompt, classificationWarnings, extractionModeForProposal,
  normalizeClassification, normalizeCommercialFacts, validateCommercialExtraction,
} from '@/lib/commercial/document-intelligence';
import { blueprintItemsFromFacts } from '@/lib/commercial/blueprint';
import { getApexAIGateway } from '@/lib/ai/gateway';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';
import { adoptStagedPdf, stagingPrefix, type StagedAnalysis } from '@/lib/commercial/proposal-staging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const registerSchema = z.object({
  action: z.literal('register'),
  revisionId: z.string().uuid(),
  path: z.string().min(10).max(500).optional(),
  /** PDF lido antes de a proposta existir ("Nova proposta" pelo PDF). */
  stagedPath: z.string().min(10).max(500).optional(),
  title: z.string().trim().min(1).max(300),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
  extract: z.boolean().default(true),
}).refine((v) => Boolean(v.path) !== Boolean(v.stagedPath), 'Informe path OU stagedPath.');

/**
 * O PDF da proposta técnica ou comercial, e a leitura dele.
 *
 *  1. `authorize` — token de envio assinado num caminho que o servidor gera.
 *  2. `register`  — o arquivo vira a linha canônica de `contract_documents`
 *     (pai: a proposta, 215) e o documento de registro da revisão.
 *  3. leitura     — mesma tarefa, mesmo prompt e mesma normalização da
 *     inteligência documental compartilhada: cada fato com página, trecho e
 *     confiança; classificação do documento comparada com o que foi
 *     declarado, e divergência dita como AVISO, nunca corrigida sozinha.
 *     Um PDF que chegou pela área de preparo (`stagedPath`) é movido para a
 *     pasta desta proposta e a leitura guardada no preparo é usada — o mesmo
 *     documento não é lido duas vezes.
 *  4. blueprint   — rascunho de planejamento montado dos fatos, se a revisão
 *     ainda não tem um.
 *
 * Se a leitura falhar, o documento continua registrado: ler de novo é uma
 * operação à parte, e o arquivo nunca se perde por causa do provedor.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.proposals.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  const { data: proposal } = await session.supabase.from('commercial_proposals')
    .select('id,proposal_number,kind,title').eq('organization_id', session.organizationId).eq('id', id).maybeSingle();
  if (!proposal) return NextResponse.json({ ok: false, error: 'Proposta não encontrada.' }, { status: 404 });
  const prop = proposal as { id: string; proposal_number: string; kind: 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED'; title: string };

  if (body?.action === 'authorize') {
    const name = String(body.fileName ?? '').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
    if (String(body.mimeType) !== 'application/pdf' || !name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ ok: false, error: 'Envie a proposta em PDF.' }, { status: 415 });
    }
    if (!(Number(body.fileSize) > 0 && Number(body.fileSize) <= 30 * 1024 * 1024)) {
      return NextResponse.json({ ok: false, error: 'O PDF deve ter no máximo 30 MB.' }, { status: 413 });
    }
    const path = `${session.organizationId}/proposals/${id}/${randomUUID()}-${name}`;
    const { data, error } = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio.' }, { status: 500 });
    return NextResponse.json({ ok: true, path, token: data.token, bucket: ONBOARDING_STORAGE_BUCKET });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Registro de documento inválido.' }, { status: 400 });
  const { data: revision } = await session.supabase.from('commercial_proposal_revisions').select('id,revision')
    .eq('organization_id', session.organizationId).eq('proposal_id', id).eq('id', parsed.data.revisionId).maybeSingle();
  if (!revision) return NextResponse.json({ ok: false, error: 'Revisão não encontrada nesta proposta.' }, { status: 404 });
  const rev = revision as { id: string; revision: number };

  let filePath = parsed.data.path ?? '';
  let staged: StagedAnalysis | null = null;
  if (parsed.data.stagedPath) {
    const prefix = stagingPrefix(session.organizationId, session.user.id);
    if (!parsed.data.stagedPath.startsWith(prefix) || parsed.data.stagedPath.includes('..')) {
      return NextResponse.json({ ok: false, error: 'Caminho do PDF fora da sua área de preparo.' }, { status: 403 });
    }
    filePath = `${session.organizationId}/proposals/${id}/${parsed.data.stagedPath.slice(prefix.length)}`;
    try {
      staged = await adoptStagedPdf(parsed.data.stagedPath, filePath);
    } catch (error) {
      return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 410 });
    }
  }
  if (!filePath.startsWith(`${session.organizationId}/proposals/${id}/`) || filePath.includes('..')) {
    return NextResponse.json({ ok: false, error: 'Caminho do PDF fora desta proposta.' }, { status: 403 });
  }

  let registered: Awaited<ReturnType<typeof registerProposalDocument>>;
  try {
    registered = await registerProposalDocument(session.organizationId, session.user.id, rev.id, {
      file_path: filePath, title: parsed.data.title, content_sha256: parsed.data.contentSha256 ?? null,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }

  const result: Record<string, unknown> = { ok: true, documentId: registered.document_id, reused: registered.reused };
  const canIngest = await hasOptionalPermission(session, 'commercial.documents.ingest');
  if (!parsed.data.extract || !canIngest) {
    return NextResponse.json({ ...result, extraction: canIngest ? 'skipped' : 'requires commercial.documents.ingest' });
  }

  try {
    // A leitura segue o tipo declarado: a COMBINADA lê técnica e comercial numa
    // passada e grava cada fato no papel do seu domínio.
    const documentContext = extractionModeForProposal(prop.kind);
    const readWithApex = async () => {
      const download = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET).download(filePath);
      if (download.error || !download.data) throw new Error('PDF indisponível no armazenamento.');
      const pdf = Buffer.from(await download.data.arrayBuffer());
      return getApexAIGateway().generate<unknown>({
        organizationId: session.organizationId,
        task: apexTaskForContext(documentContext),
        systemPrompt: COMMERCIAL_EXTRACTION_SYSTEM_PROMPT,
        userPrompt: buildCommercialExtractionPrompt(documentContext, parsed.data.title),
        document: { mediaType: 'application/pdf', base64: pdf.toString('base64') },
        structuredOutput: { name: 'commercial_facts', schema: COMMERCIAL_EXTRACTION_SCHEMA as unknown as Record<string, unknown> },
      });
    };
    const reuseStaged = Boolean(staged && staged.context === documentContext);
    const response = reuseStaged && staged
      ? { output: staged.output, provenance: staged.provenance }
      : await readWithApex();
    validateCommercialExtraction(response.output);
    const classification = normalizeClassification(response.output);
    const { facts, discarded } = normalizeCommercialFacts(documentContext, response.output);
    let recorded = 0;
    for (const fact of facts) {
      await recordExtractedFact(session.organizationId, {
        document_id: registered.document_id, document_context: fact.documentContext,
        subject_kind: 'proposal_revision', subject_id: rev.id,
        fact_domain: fact.factDomain, label: fact.label, value_text: fact.valueText,
        value_numeric: fact.valueNumeric, value_date: fact.valueDate, currency: fact.currency,
        source_revision: classification?.revisionLabel ?? `R${rev.revision}`,
        source_page: fact.sourcePage, source_section: fact.sourceSection, source_quote: fact.sourceQuote,
        confidence: fact.confidence, extraction_method: 'ai',
        ai_provider: response.provenance.provider, ai_model: response.provenance.model,
        ai_pipeline_version: COMMERCIAL_INTAKE_PIPELINE_VERSION,
      });
      recorded += 1;
    }

    // Blueprint de planejamento, só se a revisão ainda não tem um.
    const { data: existing } = await session.supabase.from('commercial_execution_blueprints').select('id')
      .eq('organization_id', session.organizationId).eq('proposal_revision_id', rev.id).limit(1);
    let blueprintId: string | null = null;
    if (!(existing ?? []).length) {
      const { data: stored } = await session.supabase.from('commercial_extracted_facts')
        .select('id,fact_domain,label,value_text,value_numeric,value_date,unit,currency,corrected_value,confidence,confirmation_state')
        .eq('organization_id', session.organizationId).eq('subject_id', rev.id).neq('confirmation_state', 'REJECTED');
      const items = blueprintItemsFromFacts((stored ?? []) as never[]);
      if (items.length) {
        blueprintId = await createExecutionBlueprint(session.organizationId, session.user.id, rev.id, {
          generated_by: 'ai', ai_provider: response.provenance.provider, ai_model: response.provenance.model,
          ai_pipeline_version: COMMERCIAL_INTAKE_PIPELINE_VERSION, items,
        });
      }
    }

    const warnings = classificationWarnings(classification, { kind: prop.kind, revision: rev.revision });
    await logAuditEventServer({
      organizationId: session.organizationId, action: 'commercial.proposal.document_read',
      entityType: 'commercial_proposal_revision', entityId: rev.id,
      metadata: { documentId: registered.document_id, facts: recorded, discarded, warnings, blueprintId,
                  model: response.provenance.model, reusedStagedRead: reuseStaged },
    }, request.headers);
    return NextResponse.json({ ...result, extraction: 'done', facts: recorded, discarded, classification, warnings, blueprintId });
  } catch (error) {
    await logAuditEventServer({
      organizationId: session.organizationId, action: 'commercial.proposal.document_read_failed',
      entityType: 'commercial_proposal_revision', entityId: rev.id,
      metadata: { documentId: registered.document_id, error: (error as Error).message?.slice(0, 300) },
    }, request.headers);
    return NextResponse.json({ ...result, extraction: 'failed',
      error: 'O PDF foi registrado; a leitura da Apex não foi concluída. Nenhum fato foi suposto.' });
  }
}
