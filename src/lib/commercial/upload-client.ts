'use client';

/**
 * Envio direto ao Storage com token assinado — o mesmo desenho do contrato:
 * o arquivo nunca atravessa o corpo de uma função do servidor, e o caminho é
 * sempre o que o servidor gerou.
 */
import { createClient } from '@/utils/supabase/client';

export async function sha256Hex(file: Blob): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

export async function uploadWithSignedToken(
  authorizeUrl: string, authorizeBody: Record<string, unknown>, file: File,
): Promise<{ path: string; sha256: string | null }> {
  const response = await fetch(authorizeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...authorizeBody, fileName: file.name, fileSize: file.size, mimeType: file.type }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload?.error || 'Não foi possível iniciar o envio.');
  const { error } = await createClient().storage.from(payload.bucket)
    .uploadToSignedUrl(payload.path, payload.token, file, { contentType: file.type });
  if (error) throw new Error('O arquivo não foi enviado. Verifique a conexão e tente novamente.');
  return { path: payload.path as string, sha256: await sha256Hex(file) };
}
