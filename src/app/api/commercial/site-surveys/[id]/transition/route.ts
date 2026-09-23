import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { requireSurveySession } from '@/lib/commercial/survey-access';
import { transitionSiteSurvey } from '@/lib/commercial/engagement-service';
import { SURVEY_TRANSITIONS, type SiteSurveyStatus } from '@/lib/commercial/site-survey';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  to: z.enum(['PLANNED', 'SCHEDULED', 'IN_FIELD', 'AWAITING_REPORT', 'COMPLETED', 'CANCELLED']),
  note: z.string().trim().max(2000).nullish(),
  plannedVisitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  technicalResponsibleUserId: z.string().uuid().nullish(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSurveySession('write');
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  let parsed: z.infer<typeof schema>;
  try { parsed = schema.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false, error: 'Informe o próximo estado.' }, { status: 400 }); }
  if (parsed.to === 'CANCELLED' && !parsed.note) {
    return NextResponse.json({ ok: false, error: 'Cancelar o levantamento exige motivo.' }, { status: 400 });
  }

  const { data: current } = await session.supabase.from('commercial_site_surveys').select('status')
    .eq('organization_id', session.organizationId).eq('id', id).maybeSingle();
  const from = (current as { status?: SiteSurveyStatus } | null)?.status;
  if (!from) return NextResponse.json({ ok: false, error: 'Levantamento não encontrado.' }, { status: 404 });
  if (from !== parsed.to && !SURVEY_TRANSITIONS[from].includes(parsed.to)) {
    return NextResponse.json({ ok: false, error: `Não é possível passar de ${from} para ${parsed.to}.` }, { status: 422 });
  }

  try {
    const result = await transitionSiteSurvey(session.organizationId, session.user.id, id, parsed.to,
      parsed.note ?? null, {
        planned_visit_date: parsed.plannedVisitDate ?? null,
        technical_responsible_user_id: parsed.technicalResponsibleUserId ?? null,
      });
    await logAuditEventServer({
      organizationId: session.organizationId, action: 'commercial.site_survey.transitioned',
      entityType: 'commercial_site_survey', entityId: id,
      metadata: { from, to: parsed.to },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
