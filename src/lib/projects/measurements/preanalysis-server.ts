/**
 * A PRÉ-ANÁLISE DO APEX, executada — server-only.
 *
 * ─── O que roda aqui, em ordem ─────────────────────────────────────────────
 *
 *   1. lê o VÍNCULO de evidência e o documento canônico dele;
 *   2. lê as EXIGÊNCIAS RESOLVIDAS daquele marco (a verdade contratual, com
 *      proveniência) — nunca uma lista genérica de "documentos usuais";
 *   3. abre a execução no banco (estado PENDING, com versão);
 *   4. baixa o PDF do bucket privado e manda ao provedor pelo gateway;
 *   5. fecha a execução com o parecer, ou a marca FAILED dizendo por quê.
 *
 * ─── A regra que o prompt codifica ─────────────────────────────────────────
 *
 *   NÃO AFIRMAR O QUE NÃO ESTÁ NO DOCUMENTO.
 *
 * O modelo recebe as exigências REAIS e é instruído a devolver `NOT_FOUND`
 * quando a informação não estiver no papel — e não `NOT_MET`. A diferença é a
 * razão de existirem cinco desfechos: "o laudo não menciona a data" não é "o
 * ensaio não foi feito".
 *
 * ─── O que esta execução nunca faz ─────────────────────────────────────────
 *
 * Não valida evidência, não satisfaz exigência, não muda estado de medição e
 * não fatura. A única escrita é nas duas tabelas de parecer (migration 193),
 * e as funções que as escrevem são inalcançáveis pelo navegador.
 */

import { platformServiceClient } from '@/lib/platform/server-client';
import { getApexAIGateway } from '@/lib/ai/gateway';
import { ApexAIError } from '@/lib/ai/gateway/errors';
import { PREANALYSIS_OUTPUT_SCHEMA } from './preanalysis';
import { REQUIREMENT_KIND_LABEL, type RequirementKind } from './types';

export class PreAnalysisUnavailableError extends Error {
  constructor(message = 'A pré-análise do Apex não está configurada nesta instalação.') {
    super(message);
    this.name = 'PreAnalysisUnavailableError';
  }
}

interface AiFinding {
  requirement_kind?: string;
  verdict?: string;
  rationale?: string;
  quote?: string;
  page?: number;
  confidence?: number;
}

interface AiPayload {
  summary?: string;
  findings?: AiFinding[];
}

export interface PreAnalysisRunResult {
  readonly analysisId: string;
  readonly state: 'COMPLETED' | 'FAILED';
  readonly verifiable: number;
  readonly met: number;
  readonly notMet: number;
  readonly notFound: number;
  readonly inconsistent: number;
  readonly needsHumanReview: number;
  readonly failureReason: string | null;
}

const SYSTEM_PROMPT = [
  'Você é o analista documental do INSIGHT APEX.',
  'Sua tarefa é comparar UM documento comprobatório com as EXIGÊNCIAS CONTRATUAIS',
  'de um evento de medição, e emitir um parecer por exigência.',
  '',
  'REGRAS ABSOLUTAS:',
  '1. Nunca afirme algo que não esteja escrito no documento.',
  '2. Se a informação exigida não aparece no documento, o veredito é NOT_FOUND.',
  '   NOT_FOUND não é NOT_MET: ausência de informação não é negativa de fato.',
  '3. NOT_MET só quando o documento CONTRADIZ a exigência ou declara menos do que ela pede.',
  '4. INCONSISTENT quando o documento se contradiz, ou contradiz os dados do contrato/projeto informados.',
  '5. NEEDS_HUMAN_REVIEW quando a exigência só pode ser conferida por uma pessoa',
  '   (assinatura manuscrita, juízo técnico, aceite de terceiro).',
  '6. MET exige LASTRO: cite o trecho literal (`quote`) e a página (`page`).',
  '   Um "atendido" sem trecho é recusado pelo sistema.',
  '7. Você NÃO aprova, NÃO valida, NÃO conclui medição e NÃO autoriza faturamento.',
  '   Seu parecer é insumo para uma decisão humana.',
  '8. Responda apenas sobre as exigências listadas. Não invente exigências novas.',
].join('\n');

/** Exigências apuradas na base, com a proveniência que explica por que existem. */
interface RequirementRow {
  requirement_kind: RequirementKind;
  required: boolean;
  requirement_certainty: 'declared' | 'unknown';
  document_type: string | null;
  detail: string | null;
  source_reference: string | null;
  source_page: number | null;
}

function buildUserPrompt(
  requirements: readonly RequirementRow[],
  context: {
    contractNumber: string | null;
    projectCode: string | null;
    milestoneTitle: string | null;
    fileName: string | null;
    evidenceCategory: string | null;
  },
): string {
  const lines: string[] = [];
  lines.push('CONTEXTO');
  lines.push(`Contrato: ${context.contractNumber ?? 'não informado'}`);
  lines.push(`Projeto/OS: ${context.projectCode ?? 'não informado'}`);
  lines.push(`Evento contratual: ${context.milestoneTitle ?? 'não informado'}`);
  lines.push(`Documento anexado: ${context.fileName ?? 'sem nome'}`
    + (context.evidenceCategory ? ` (classe declarada: ${context.evidenceCategory})` : ''));
  lines.push('');
  lines.push('EXIGÊNCIAS CONTRATUAIS DESTE EVENTO');
  for (const r of requirements) {
    const parts = [`- ${r.requirement_kind} (${REQUIREMENT_KIND_LABEL[r.requirement_kind]})`];
    parts.push(r.requirement_certainty === 'unknown'
      // A incerteza VIAJA. Apresentar exigência incerta como exigida faria o
      // parecer cobrar algo que o contrato talvez não peça.
      ? '· o contrato NÃO declara se esta exigência se aplica'
      : r.required ? '· exigida' : '· dispensada pelo contrato');
    if (r.document_type) parts.push(`· tipo documental: ${r.document_type}`);
    if (r.detail) parts.push(`· detalhe: ${r.detail}`);
    if (r.source_reference) {
      parts.push(`· origem: ${r.source_reference}`
        + (r.source_page ? ` (p. ${r.source_page})` : ''));
    }
    lines.push(parts.join(' '));
  }
  lines.push('');
  lines.push('TAREFA');
  lines.push('Para cada exigência acima que NÃO esteja dispensada, emita um achado com');
  lines.push('`requirement_kind`, `verdict` e a justificativa. Exigência dispensada pelo');
  lines.push('contrato deve ser OMITIDA do parecer. Exigência de certeza desconhecida deve');
  lines.push('sair como NEEDS_HUMAN_REVIEW, porque decidir se ela se aplica é ato humano.');
  return lines.join('\n');
}

/**
 * Roda a pré-análise sobre UM vínculo de evidência.
 *
 * Não lança quando o provedor falha: registra `FAILED` com a razão e devolve o
 * resultado. Uma falha de provedor não pode derrubar o upload que já aconteceu
 * nem deixar a execução pendurada em PENDING para sempre.
 */
export async function runEvidencePreAnalysis(
  evidenceId: string,
  requestedBy: string | null,
): Promise<PreAnalysisRunResult> {
  const service = platformServiceClient();

  // ── 1) o vínculo ──────────────────────────────────────────────────────
  const { data: ev, error: evErr } = await service
    .from('project_measurement_evidence')
    .select('id, organization_id, measurement_id, source_type, source_id, revoked_at, requirement_kind')
    .eq('id', evidenceId)
    .maybeSingle();
  if (evErr) throw new Error(`Falha ao ler a evidência: ${evErr.message}`);
  if (!ev) throw new Error('EVIDENCE_NOT_FOUND');
  if (ev.revoked_at) throw new Error('EVIDENCE_REVOKED');
  if (ev.source_type !== 'project_file') {
    // Pré-análise documental só existe sobre DOCUMENTO. Uma batida de ponto não
    // tem página nem trecho, e forçá-la aqui produziria parecer sobre nada.
    throw new Error('EVIDENCE_NOT_A_DOCUMENT');
  }

  // ── 2) o documento e as exigências reais ──────────────────────────────
  const [file, reqs, m] = await Promise.all([
    service.from('project_files')
      .select('id, bucket_id, object_path, file_name, content_type, evidence_category')
      .eq('id', ev.source_id).maybeSingle(),
    service.from('project_measurement_requirements')
      .select('requirement_kind, required, requirement_certainty, document_type, detail, '
        + 'source_reference, source_page')
      .eq('measurement_id', ev.measurement_id)
      .order('requirement_kind'),
    service.from('project_measurements')
      .select('contract_id, project_id, milestone_id').eq('id', ev.measurement_id).maybeSingle(),
  ]);
  if (!file.data) throw new Error('SOURCE_NOT_FOUND');

  const [contract, project, milestone] = await Promise.all([
    m.data?.contract_id
      ? service.from('contracts').select('contract_number').eq('id', m.data.contract_id).maybeSingle()
      : Promise.resolve({ data: null }),
    m.data?.project_id
      ? service.from('projects').select('project').eq('id', m.data.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    m.data?.milestone_id
      ? service.from('contract_milestones').select('title').eq('id', m.data.milestone_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const requirements = ((reqs.data ?? []) as unknown as RequirementRow[])
    // Exigência dispensada NÃO vai ao modelo: pedir parecer sobre o que o
    // contrato dispensou gasta contexto e convida a inventar pendência.
    .filter((r) => r.required || r.requirement_certainty === 'unknown');

  // ── 3) abre a execução ────────────────────────────────────────────────
  const { data: analysisId, error: openErr } = await service.rpc(
    'project_measurement_preanalysis_open',
    { p_evidence_id: evidenceId, p_requested_by: requestedBy });
  if (openErr) throw new Error(`Falha ao abrir a pré-análise: ${openErr.message}`);

  const fail = async (reason: string): Promise<PreAnalysisRunResult> => {
    await service.rpc('project_measurement_preanalysis_fail',
      { p_analysis_id: analysisId, p_reason: reason });
    return {
      analysisId: analysisId as string, state: 'FAILED',
      verifiable: 0, met: 0, notMet: 0, notFound: 0, inconsistent: 0, needsHumanReview: 0,
      failureReason: reason,
    };
  };

  if (requirements.length === 0) {
    return fail('Este evento não tem exigência contratual resolvida para conferir. '
      + 'Cadastre a exigência de medição no contrato antes de pedir a pré-análise.');
  }

  // ── 4) o documento, e o provedor ──────────────────────────────────────
  let pdf: Buffer;
  try {
    const { data: blob, error } = await service.storage
      .from(file.data.bucket_id as string)
      .download(file.data.object_path as string);
    if (error || !blob) throw new Error(error?.message ?? 'download vazio');
    pdf = Buffer.from(await blob.arrayBuffer());
  } catch (e) {
    return fail(`Não foi possível ler o documento no acervo: ${e instanceof Error ? e.message : e}`);
  }

  const contentType = (file.data.content_type as string | null) ?? '';
  if (!contentType.includes('pdf')) {
    // O gateway só aceita PDF. Dizer isso é melhor que mandar bytes que o
    // provedor recusaria com uma mensagem que ninguém entende.
    return fail(`A pré-análise documental do Apex lê PDF. Este anexo é ${contentType || 'de tipo desconhecido'}.`);
  }

  let payload: AiPayload;
  let provenance: { provider: string; model: string; usage: { inputTokens: number; outputTokens: number }; durationMs: number; attempts: number };
  try {
    const response = await getApexAIGateway().generate<AiPayload>({
      organizationId: ev.organization_id as string,
      task: 'MEASUREMENT_EVIDENCE_PREANALYSIS',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(requirements, {
        contractNumber: (contract.data?.contract_number as string | undefined) ?? null,
        projectCode: ((project.data?.project as Record<string, unknown> | undefined)?.codigo as string | undefined) ?? null,
        milestoneTitle: (milestone.data?.title as string | undefined) ?? null,
        fileName: (file.data.file_name as string | null) ?? null,
        evidenceCategory: (file.data.evidence_category as string | null) ?? null,
      }),
      document: { mediaType: 'application/pdf', base64: pdf.toString('base64') },
      structuredOutput: {
        name: 'measurement_evidence_preanalysis',
        schema: PREANALYSIS_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      },
    });
    payload = response.output;
    provenance = response.provenance;
  } catch (e) {
    if (e instanceof ApexAIError && ['AI_DISABLED', 'PROVIDER_NOT_CONFIGURED'].includes(e.code)) {
      await service.rpc('project_measurement_preanalysis_fail', {
        p_analysis_id: analysisId,
        p_reason: 'Provedor de IA não configurado nesta instalação.',
      });
      throw new PreAnalysisUnavailableError();
    }
    return fail(`O provedor não devolveu um parecer: ${e instanceof Error ? e.message : e}`);
  }

  // ── 5) fecha a execução ───────────────────────────────────────────────
  const declared = new Set(requirements.map((r) => r.requirement_kind));
  const findings = (payload.findings ?? [])
    // Achado sobre exigência que não está na lista é DESCARTADO. O modelo não
    // cria exigência: a verdade contratual é do contrato, não do parecer.
    .filter((f) => f.requirement_kind && declared.has(f.requirement_kind as RequirementKind));

  const { data: done, error: doneErr } = await service.rpc(
    'project_measurement_preanalysis_complete', {
      p_analysis_id: analysisId,
      p_findings: findings,
      p_summary: payload.summary ?? null,
      p_provider: provenance.provider,
      p_model: provenance.model,
      p_input_tokens: provenance.usage.inputTokens,
      p_output_tokens: provenance.usage.outputTokens,
      p_duration_ms: Math.round(provenance.durationMs),
      p_attempts: provenance.attempts,
    });
  if (doneErr) return fail(`Falha ao registrar o parecer: ${doneErr.message}`);

  const j = (done ?? {}) as Record<string, number>;
  return {
    analysisId: analysisId as string,
    state: 'COMPLETED',
    verifiable: Number(j.verifiable ?? 0),
    met: Number(j.met ?? 0),
    notMet: Number(j.not_met ?? 0),
    notFound: Number(j.not_found ?? 0),
    inconsistent: Number(j.inconsistent ?? 0),
    needsHumanReview: Number(j.needs_human_review ?? 0),
    failureReason: null,
  };
}
