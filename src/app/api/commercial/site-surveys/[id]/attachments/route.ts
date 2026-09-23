import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { requireSurveySession } from '@/lib/commercial/survey-access';
import { registerSiteSurveyAttachment } from '@/lib/commercial/engagement-service';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 60 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm)|application\/pdf|audio\/(mpeg|mp4|webm|ogg|wav|x-m4a))$/;

const typeFor = (mime: string) => mime.startsWith('image/') ? 'site_survey_photo'
  : mime.startsWith('video/') ? 'site_survey_video'
  : mime === 'application/pdf' ? 'site_survey_report' : 'site_survey_attachment';

const authorizeSchema = z.object({
  action: z.literal('authorize'),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().max(100),
  fileSize: z.number().int().positive(),
});
const registerSchema = z.object({
  action: z.literal('register'),
  path: z.string().min(10).max(500),
  title: z.string().trim().min(1).max(300),
  mimeType: z.string().max(100),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
  caption: z.string().trim().max(1000).nullish(),
});

/**
 * Arquivo de campo, em dois passos — o mesmo desenho do envio de contrato:
 *  1. `authorize`: o servidor gera o caminho (inquilino/levantamento/uuid) e
 *     devolve um token de envio assinado, de curta duração. O navegador não
 *     escolhe prefixo nenhum.
 *  2. `register`: o arquivo já está no bucket; a função governada o registra
 *     em `contract_documents` — o acervo canônico — ligado ao levantamento.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSurveySession('write');
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  if (body?.action === 'authorize') {
    const parsed = authorizeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: false, error: 'Arquivo inválido.' }, { status: 400 });
    if (!ALLOWED.test(parsed.data.mimeType)) {
      return NextResponse.json({ ok: false, error: 'Aceitamos foto, vídeo, áudio e PDF.' }, { status: 415 });
    }
    if (parsed.data.fileSize > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: 'O arquivo deve ter no máximo 60 MB.' }, { status: 413 });
    }
    const { data: survey } = await session.supabase.from('commercial_site_surveys').select('id,status')
      .eq('organization_id', session.organizationId).eq('id', id).maybeSingle();
    if (!survey) return NextResponse.json({ ok: false, error: 'Levantamento não encontrado.' }, { status: 404 });

    const safeName = parsed.data.fileName.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
    const path = `${session.organizationId}/site-surveys/${id}/${randomUUID()}-${safeName}`;
    const { data, error } = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ ok: false, error: 'Não foi possível iniciar o envio.' }, { status: 500 });
    return NextResponse.json({ ok: true, path, token: data.token, bucket: ONBOARDING_STORAGE_BUCKET });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Registro de arquivo inválido.' }, { status: 400 });
  if (!parsed.data.path.startsWith(`${session.organizationId}/site-surveys/${id}/`)) {
    return NextResponse.json({ ok: false, error: 'Caminho de arquivo fora deste levantamento.' }, { status: 403 });
  }
  try {
    const result = await registerSiteSurveyAttachment(session.organizationId, session.user.id, id, {
      title: parsed.data.title,
      file_path: parsed.data.path,
      document_type: typeFor(parsed.data.mimeType),
      content_sha256: parsed.data.contentSha256 ?? null,
      caption: parsed.data.caption ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
