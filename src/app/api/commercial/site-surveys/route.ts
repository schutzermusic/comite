import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import {
  requireCommercialSession, isSessionError, safeGovernedError, hasOptionalPermission,
} from '@/lib/commercial/server-session';
import { createSiteSurvey } from '@/lib/commercial/engagement-service';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { notifyMember } from '@/lib/commercial/notify';
import { DEFAULT_SURVEY_CHECKLIST } from '@/lib/commercial/site-survey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SURVEY_COLUMNS = 'id,opportunity_id,code,title,counterparty_name,site_name,site_address,purpose,'
  + 'technical_responsible_user_id,planned_visit_date,status,started_at,completed_at,cancel_reason,'
  + 'findings,checklist,open_questions,apex_generated_at,created_at,updated_at';

/**
 * Levantamentos técnicos. `?opportunityId=` para os de uma oportunidade;
 * `?mine=1` para a fila de campo de quem está logado.
 *
 * A leitura aceita `commercial.view` OU `commercial.surveys.manage`: o
 * engenheiro de campo vê o levantamento sem ver o funil. Nenhuma coluna de
 * valor da oportunidade atravessa esta rota.
 */
export async function GET(request: Request) {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const canView = await hasOptionalPermission(session, 'commercial.view')
    || await hasOptionalPermission(session, 'commercial.surveys.manage');
  if (!canView) {
    return NextResponse.json({ ok: false,
      error: 'Esta ação exige: commercial.view ou commercial.surveys.manage.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const opportunityId = url.searchParams.get('opportunityId');
  let query = session.supabase.from('commercial_site_surveys').select(SURVEY_COLUMNS)
    .eq('organization_id', session.organizationId)
    .order('planned_visit_date', { ascending: true, nullsFirst: false })
    .limit(200);
  if (opportunityId) query = query.eq('opportunity_id', opportunityId);
  if (url.searchParams.get('mine') === '1') query = query.eq('technical_responsible_user_id', session.user.id);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: 'Não foi possível ler os levantamentos.' }, { status: 500 });
  }
  const rows = (data ?? []) as unknown as Array<{ technical_responsible_user_id: string | null }>;
  const owners = await resolveOwnerNames(session.organizationId,
    rows.map((row) => row.technical_responsible_user_id));
  return NextResponse.json({ ok: true, surveys: rows, owners });
}

const createSchema = z.object({
  opportunityId: z.string().uuid(),
  purpose: z.string().trim().min(3).max(2000),
  title: z.string().trim().max(300).nullish(),
  siteName: z.string().trim().max(300).nullish(),
  siteAddress: z.string().trim().max(500).nullish(),
  technicalResponsibleUserId: z.string().uuid().nullish(),
  plannedVisitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/** "Solicitar levantamento técnico" — dentro da oportunidade, nunca solto. */
export async function POST(request: Request) {
  const session = await requireCommercialSession(['commercial.surveys.manage']);
  if (isSessionError(session)) return session.error;

  let parsed: z.infer<typeof createSchema>;
  try { parsed = createSchema.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false,
    error: 'Informe a oportunidade e o propósito do levantamento.' }, { status: 400 }); }

  try {
    const result = await createSiteSurvey(session.organizationId, session.user.id, {
      opportunity_id: parsed.opportunityId,
      purpose: parsed.purpose,
      title: parsed.title ?? null,
      site_name: parsed.siteName ?? null,
      site_address: parsed.siteAddress ?? null,
      technical_responsible_user_id: parsed.technicalResponsibleUserId ?? null,
      planned_visit_date: parsed.plannedVisitDate ?? null,
      checklist: DEFAULT_SURVEY_CHECKLIST,
    });
    const notice = parsed.technicalResponsibleUserId && parsed.technicalResponsibleUserId !== session.user.id
      ? await notifyMember({
          organizationId: session.organizationId,
          recipientUserId: parsed.technicalResponsibleUserId,
          type: 'commercial_site_survey_assigned',
          title: `Levantamento técnico ${result.code} atribuído a você`,
          body: parsed.plannedVisitDate ? `Visita prevista para ${parsed.plannedVisitDate}.` : parsed.purpose,
          link: `/comercial/levantamentos/${result.survey_id}`,
        })
      : { delivered: false, error: null };
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.site_survey.requested', entityType: 'commercial_site_survey',
      entityId: result.survey_id,
      metadata: { opportunityId: parsed.opportunityId, code: result.code, notified: notice.delivered,
                  notificationError: notice.error },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
