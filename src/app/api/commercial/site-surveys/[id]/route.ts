import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { requireSurveySession } from '@/lib/commercial/survey-access';
import { recordSiteSurvey } from '@/lib/commercial/engagement-service';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O levantamento inteiro, para a tela de campo e para o espaço da
 * oportunidade: registro, checklist, perguntas, arquivos de campo (com link
 * assinado de curta duração), candidato da Apex e a história.
 *
 * Da oportunidade só atravessam título, conta e etapa — nunca valor nem
 * probabilidade: quem está em campo não precisa do preço para medir.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSurveySession('read');
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  const { data: survey, error } = await session.supabase.from('commercial_site_surveys')
    .select('*').eq('organization_id', session.organizationId).eq('id', id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: 'Não foi possível ler o levantamento.' }, { status: 500 });
  if (!survey) return NextResponse.json({ ok: false, error: 'Levantamento não encontrado.' }, { status: 404 });
  const row = survey as unknown as Record<string, unknown> & {
    opportunity_id: string; technical_responsible_user_id: string | null;
    created_by: string | null; completed_by: string | null;
  };

  /*
    Documentos e oportunidade são lidos pelo service role, e só por chave que
    a leitura AUTENTICADA acima acabou de provar visível. A policy de
    `contract_documents` já libera arquivo de campo a quem lê levantamento;
    a de `commercial_opportunities` não libera a oportunidade a quem só opera
    campo — daí o recorte de três colunas.
  */
  const service = platformServiceClient();
  const [docs, events, opportunity] = await Promise.all([
    service.from('contract_documents')
      .select('id,title,file_path,document_type,content_sha256,created_at,uploaded_by')
      .eq('organization_id', session.organizationId).eq('site_survey_id', id)
      .is('superseded_by_document_id', null).order('created_at', { ascending: false }),
    session.supabase.from('commercial_site_survey_events')
      .select('id,event_type,from_status,to_status,actor_user_id,actor_source,note,detail,occurred_at')
      .eq('organization_id', session.organizationId).eq('survey_id', id)
      .order('occurred_at', { ascending: false }).limit(100),
    service.from('commercial_opportunities')
      .select('id,title,counterparty_name,stage')
      .eq('organization_id', session.organizationId).eq('id', row.opportunity_id).maybeSingle(),
  ]);

  const documents = (docs.data ?? []) as Array<{ id: string; file_path: string } & Record<string, unknown>>;
  const signed = documents.length
    ? await service.storage.from(ONBOARDING_STORAGE_BUCKET)
        .createSignedUrls(documents.map((d) => d.file_path), 600)
    : { data: [] as Array<{ signedUrl: string | null; path: string | null }> };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const eventRows = (events.data ?? []) as Array<{ actor_user_id: string | null }>;

  const owners = await resolveOwnerNames(session.organizationId, [
    row.technical_responsible_user_id, row.created_by, row.completed_by,
    ...eventRows.map((e) => e.actor_user_id),
    ...documents.map((d) => d.uploaded_by as string | null),
  ]);

  return NextResponse.json({
    ok: true,
    survey: row,
    opportunity: opportunity.data ?? null,
    attachments: documents.map(({ file_path: filePath, ...rest }) => ({
      ...rest, url: urlByPath.get(filePath) ?? null })),
    events: eventRows,
    owners,
    canManage: session.permissions.has('commercial.surveys.manage'),
  });
}

const listItem = z.object({ id: z.string().max(80), text: z.string().max(2000), detail: z.string().max(2000).nullish() });
const patchSchema = z.object({
  findings: z.object({
    technical_conditions: z.string().max(8000).nullish(),
    existing_infrastructure: z.string().max(8000).nullish(),
    access_constraints: z.string().max(8000).nullish(),
    notes: z.string().max(16000).nullish(),
    equipment: z.array(z.object({
      id: z.string().max(80), tag: z.string().max(200), description: z.string().max(2000),
      nameplate: z.string().max(4000).nullish(), condition: z.string().max(2000).nullish(),
    })).max(300).optional(),
    measurements: z.array(z.object({
      id: z.string().max(80), label: z.string().max(300), value: z.string().max(300), unit: z.string().max(40).nullish(),
    })).max(500).optional(),
    risks: z.array(z.object({
      id: z.string().max(80), text: z.string().max(2000), severity: z.enum(['low', 'medium', 'high']).nullish(),
    })).max(200).optional(),
    required_materials: z.array(listItem).max(300).optional(),
    estimated_activities: z.array(listItem).max(300).optional(),
    customer_dependencies: z.array(listItem).max(200).optional(),
  }).partial().optional(),
  checklist: z.array(z.object({
    key: z.string().max(80), label: z.string().max(300), done: z.boolean(), required: z.boolean().optional(),
  })).max(100).optional(),
  open_questions: z.array(z.object({
    id: z.string().max(80), text: z.string().max(2000), resolved: z.boolean(), answer: z.string().max(4000).nullish(),
  })).max(200).optional(),
  site_name: z.string().max(300).nullish(),
  site_address: z.string().max(500).nullish(),
});

/** Registro de campo — só o que mudou; o banco mescla por seção. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSurveySession('write');
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  let patch: z.infer<typeof patchSchema>;
  try { patch = patchSchema.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false, error: 'Registro de campo inválido.' }, { status: 400 }); }
  try {
    const result = await recordSiteSurvey(session.organizationId, session.user.id, id, patch);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
