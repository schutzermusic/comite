import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { requireSurveySession } from '@/lib/commercial/survey-access';
import { recordSiteSurveyApexCandidate } from '@/lib/commercial/engagement-service';
import { getApexAIGateway } from '@/lib/ai/gateway';
import { platformServiceClient } from '@/lib/platform/server-client';
import {
  SITE_SURVEY_PIPELINE_VERSION, SITE_SURVEY_SCHEMA, SITE_SURVEY_SYSTEM_PROMPT,
  buildSiteSurveyPrompt, normalizeSurveyCandidate, type SurveyForUnderstanding,
} from '@/lib/commercial/site-survey-understanding';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/**
 * Pede à Apex a leitura estruturada do levantamento. Só depois do campo
 * (AWAITING_REPORT ou COMPLETED) — o banco recusa antes disso. O resultado
 * grava em `apex_candidate`, nunca em `findings`.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSurveySession('write');
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  const { data: survey } = await session.supabase.from('commercial_site_surveys')
    .select('id,code,purpose,site_name,site_address,opportunity_id,status,findings,checklist,open_questions')
    .eq('organization_id', session.organizationId).eq('id', id).maybeSingle();
  if (!survey) return NextResponse.json({ ok: false, error: 'Levantamento não encontrado.' }, { status: 404 });
  const row = survey as unknown as {
    code: string; purpose: string; site_name: string | null; site_address: string | null;
    opportunity_id: string; status: string; findings: Record<string, unknown>;
    checklist: unknown[]; open_questions: unknown[];
  };
  if (!['AWAITING_REPORT', 'COMPLETED'].includes(row.status)) {
    return NextResponse.json({ ok: false,
      error: 'A Apex lê o levantamento depois que o campo termina.' }, { status: 422 });
  }

  const service = platformServiceClient();
  const [opportunity, docs] = await Promise.all([
    service.from('commercial_opportunities').select('title')
      .eq('organization_id', session.organizationId).eq('id', row.opportunity_id).maybeSingle(),
    service.from('contract_documents').select('title,document_type')
      .eq('organization_id', session.organizationId).eq('site_survey_id', id)
      .is('superseded_by_document_id', null),
  ]);

  const input: SurveyForUnderstanding = {
    code: row.code, purpose: row.purpose, site_name: row.site_name, site_address: row.site_address,
    opportunity_title: (opportunity.data as { title?: string } | null)?.title ?? '—',
    findings: row.findings ?? {}, checklist: row.checklist ?? [], open_questions: row.open_questions ?? [],
    attachments: (docs.data ?? []) as Array<{ title: string; document_type: string }>,
  };

  try {
    const response = await getApexAIGateway().generate<unknown>({
      organizationId: session.organizationId,
      task: 'SITE_SURVEY_UNDERSTANDING',
      systemPrompt: SITE_SURVEY_SYSTEM_PROMPT,
      userPrompt: buildSiteSurveyPrompt(input),
      structuredOutput: { name: 'site_survey_candidate', schema: SITE_SURVEY_SCHEMA as unknown as Record<string, unknown> },
    });
    const candidate = normalizeSurveyCandidate(response.output, input);
    await recordSiteSurveyApexCandidate(session.organizationId, id, candidate as unknown as Record<string, unknown>, {
      provider: response.provenance.provider, model: response.provenance.model,
      pipelineVersion: SITE_SURVEY_PIPELINE_VERSION,
    });
    await logAuditEventServer({
      organizationId: session.organizationId, action: 'commercial.site_survey.apex_read',
      entityType: 'commercial_site_survey', entityId: id,
      metadata: { model: response.provenance.model, durationMs: response.provenance.durationMs },
    }, request.headers);
    return NextResponse.json({ ok: true, candidate });
  } catch (error) {
    const message = (error as Error).message ?? '';
    return NextResponse.json({ ok: false,
      error: message.startsWith('Site survey') ? safeGovernedError(message)
        : 'A leitura da Apex não foi concluída. O levantamento continua íntegro; tente novamente.' },
      { status: 502 });
  }
}
