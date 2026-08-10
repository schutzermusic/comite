import { authenticateMobile, json } from '@/lib/mobile/server';
import { getServiceClient } from '@/lib/ai/server-clients';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'attendance-selfies';
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB de imagem decodificada

interface SelfieBody {
  /** Data URL da selfie (ex.: "data:image/jpeg;base64,...."). */
  imageDataUrl?: string;
}

/** RFC4122-ish UUID sem depender de libs. */
function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Recebe a SELFIE tirada no portal web de ponto, grava no bucket privado
 * `attendance-selfies` e cria a linha de authentication_evidence
 * (method = 'facial_verification', result = 'success') que a marcação
 * consome via `authenticationEvidenceId`. Substitui o Face ID/Touch ID
 * (WebAuthn) do app nativo quando o navegador não oferece biometria.
 *
 * Retorna { authenticationEvidenceId } válido por 3 min (o mesmo frescor
 * exigido por /api/mobile/punch).
 */
export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { orgId, personId } = auth.auth;

  let body: SelfieBody = {};
  try {
    body = (await req.json()) as SelfieBody;
  } catch {
    return json({ ok: false, error: 'Corpo inválido' }, 400);
  }

  const dataUrl = body.imageDataUrl;
  if (!dataUrl || typeof dataUrl !== 'string') {
    return json({ ok: false, error: 'imageDataUrl é obrigatório' }, 400);
  }

  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);
  if (!match) {
    return json({ ok: false, error: 'Formato de imagem inválido (use JPEG/PNG/WEBP em base64).' }, 400);
  }
  const contentType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';

  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    return json({ ok: false, error: 'Não foi possível decodificar a imagem.' }, 400);
  }
  if (bytes.length === 0) return json({ ok: false, error: 'Imagem vazia.' }, 400);
  if (bytes.length > MAX_BYTES) return json({ ok: false, error: 'A foto excede 4MB.' }, 400);

  const service = getServiceClient();
  const path = `${orgId}/${personId}/${Date.now()}-${uuid()}.${ext}`;

  const { error: upErr } = await service.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });
  if (upErr) return json({ ok: false, error: upErr.message }, 500);

  const { data: ev, error: evErr } = await service
    .from('authentication_evidence')
    .insert({
      organization_id: orgId,
      person_id: personId,
      method: 'facial_verification',
      result: 'success',
      assurance_level: 'standard',
      provider_reference: path,
      metadata: { source: 'web_selfie', bucket: BUCKET, path },
    })
    .select('id')
    .single();
  if (evErr) {
    // limpa a foto órfã se a evidência não gravou
    await service.storage.from(BUCKET).remove([path]).catch(() => {});
    return json({ ok: false, error: evErr.message }, 500);
  }

  return json({ ok: true, authenticationEvidenceId: ev.id as string, path });
}
