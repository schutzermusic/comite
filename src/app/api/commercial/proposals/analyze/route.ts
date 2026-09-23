import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, hasOptionalPermission } from '@/lib/commercial/server-session';
import {
  COMMERCIAL_EXTRACTION_SCHEMA, COMMERCIAL_EXTRACTION_SYSTEM_PROMPT,
  apexTaskForContext, buildCommercialExtractionPrompt, normalizeClassification, normalizeCommercialFacts,
} from '@/lib/commercial/document-intelligence';
import {
  contextForKind, discardStaged, stagingPrefix, sweepExpiredStaging, writeStagedAnalysis,
} from '@/lib/commercial/proposal-staging';
import { getApexAIGateway } from '@/lib/ai/gateway';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const analyzeSchema = z.object({
  action: z.literal('analyze'),
  path: z.string().min(10).max(500),
  fileName: z.string().trim().min(1).max(300),
  kind: z.enum(['TECHNICAL', 'COMMERCIAL', 'COMBINED']),
});
const discardSchema = z.object({
  action: z.literal('discard'),
  paths: z.array(z.string().min(10).max(500)).max(4),
});

/**
 * Ler a PT/PC ANTES de a proposta existir.
 *
 *  1. `authorize` — envio assinado para a pasta de preparo da pessoa.
 *  2. `analyze`   — mesma tarefa, prompt e normalização do registro canônico;
 *                   a resposta volta para revisão e fica guardada ao lado do
 *                   PDF para o registro adotar. Nada é gravado no domínio.
 *  3. `discard`   — a pessoa desistiu: o preparo some.
 *
 * O que ninguém adotou nem descartou expira (`staging-sweep.ts`): a cada novo
 * envio, na pasta da própria pessoa; diariamente, em todas
 * (`/api/platform/jobs/commercial-staging-sweep`).
 *
 * Preparar o PDF não exige leitura: quem não tem `commercial.documents.ingest`
 * recebe 403 no `analyze`, com a razão, e a proposta ainda nasce do PDF — o
 * arquivo é anexado sem leitura, e a tela diz isso.
 */
export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.proposals.manage']);
  if (isSessionError(session)) return session.error;
  const body = await request.json().catch(() => null);
  const prefix = stagingPrefix(session.organizationId, session.user.id);

  if (body?.action === 'authorize') {
    const name = String(body.fileName ?? '').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
    if (String(body.mimeType) !== 'application/pdf' || !name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ ok: false, error: 'Envie a proposta em PDF.' }, { status: 415 });
    }
    if (!(Number(body.fileSize) > 0 && Number(body.fileSize) <= 30 * 1024 * 1024)) {
      return NextResponse.json({ ok: false, error: 'O PDF deve ter no máximo 30 MB.' }, { status: 413 });
    }
    // Varredura oportunista da pasta desta pessoa: o que ela abandonou em outra
    // sessão e passou do prazo sai antes do novo envio. Falha aqui não impede
    // o envio — o agendador diário passa de novo.
    await sweepExpiredStaging({ organizationId: session.organizationId, userId: session.user.id })
      .catch(() => undefined);
    const path = `${prefix}${randomUUID()}-${name}`;
    const { data, error } = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio.' }, { status: 500 });
    return NextResponse.json({ ok: true, path, token: data.token, bucket: ONBOARDING_STORAGE_BUCKET });
  }

  if (body?.action === 'discard') {
    const parsed = discardSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Pedido inválido.' }, { status: 400 });
    await discardStaged(parsed.data.paths.filter((p) => p.startsWith(prefix) && !p.includes('..')));
    return NextResponse.json({ ok: true });
  }

  const parsed = analyzeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Pedido de leitura inválido.' }, { status: 400 });
  if (!parsed.data.path.startsWith(prefix) || parsed.data.path.includes('..')) {
    return NextResponse.json({ ok: false, error: 'Caminho do PDF fora da sua área de preparo.' }, { status: 403 });
  }
  if (!(await hasOptionalPermission(session, 'commercial.documents.ingest'))) {
    return NextResponse.json({ ok: false, code: 'INGEST_REQUIRED',
      error: 'A leitura da Apex exige commercial.documents.ingest.' }, { status: 403 });
  }

  const context = contextForKind(parsed.data.kind);
  try {
    const download = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET).download(parsed.data.path);
    if (download.error || !download.data) throw new Error('PDF indisponível no armazenamento.');
    const pdf = Buffer.from(await download.data.arrayBuffer());
    const response = await getApexAIGateway().generate<unknown>({
      organizationId: session.organizationId,
      task: apexTaskForContext(context),
      systemPrompt: COMMERCIAL_EXTRACTION_SYSTEM_PROMPT,
      userPrompt: buildCommercialExtractionPrompt(context, parsed.data.fileName),
      document: { mediaType: 'application/pdf', base64: pdf.toString('base64') },
      structuredOutput: { name: 'commercial_facts', schema: COMMERCIAL_EXTRACTION_SCHEMA as unknown as Record<string, unknown> },
    });
    await writeStagedAnalysis(parsed.data.path, {
      version: 1, context, fileName: parsed.data.fileName, analyzedAt: new Date().toISOString(),
      output: response.output,
      provenance: { provider: response.provenance.provider, model: response.provenance.model },
    });
    const classification = normalizeClassification(response.output);
    const { facts, discarded } = normalizeCommercialFacts(context, response.output);
    await logAuditEventServer({
      organizationId: session.organizationId, action: 'commercial.proposal.document_preread',
      entityType: 'commercial_proposal_staging', entityId: session.user.id,
      metadata: { facts: facts.length, discarded, model: response.provenance.model, kind: parsed.data.kind },
    }, request.headers);
    return NextResponse.json({ ok: true, path: parsed.data.path, context, classification, facts, discarded,
      model: response.provenance.model });
  } catch (error) {
    return NextResponse.json({ ok: false, code: 'READ_FAILED',
      error: 'A Apex não concluiu a leitura. Nenhum fato foi suposto — tente de novo ou crie manualmente.',
      detail: (error as Error).message?.slice(0, 200) }, { status: 502 });
  }
}
