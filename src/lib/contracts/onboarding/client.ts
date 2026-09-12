'use client';

import { createClient } from '@/utils/supabase/client';
import type { ContractOnboardingResult } from './document-first';
import { isPdfUpload, MAX_ONBOARDING_PDF_BYTES, ONBOARDING_STORAGE_BUCKET } from './upload-paths';

export type ContractIntakeStatus = 'RECEIVED' | 'QUEUED' | 'READING' | 'STRUCTURING'
  | 'READY' | 'REQUIRES_ATTENTION' | 'FAILED' | 'REGISTERED' | 'CANCELLED';

export interface ContractIntakeView {
  id: string;
  file_name: string;
  status: ContractIntakeStatus;
  structured_result: ContractOnboardingResult | null;
  attention_count: number;
  error_safe: string | null;
  contract_id: string | null;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Não foi possível concluir a operação.');
  return body;
}

/**
 * The PDF never enters a Vercel Function request body (that is what produced
 * the earlier HTTP 413 for large contracts). This authorizes a direct,
 * signed, path-scoped upload to private Storage, performs it, then tells
 * Apex only small metadata about what was uploaded.
 */
export async function sendContractDocument(file: File): Promise<{
  intakeId?: string; status?: ContractIntakeStatus; duplicate?: boolean; contractId?: string; message?: string;
}> {
  if (file.size <= 0) throw new Error('Selecione o contrato em PDF.');
  if (!isPdfUpload(file.name, file.type)) throw new Error('O envio inicial aceita o contrato em PDF.');
  if (file.size > MAX_ONBOARDING_PDF_BYTES) throw new Error('O PDF deve ter no máximo 30 MB.');

  const authorized = await json<{ uploadId: string; path: string; token: string }>(
    await fetch('/api/contracts/onboarding/upload-authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, fileSize: file.size, mimeType: file.type || 'application/pdf' }),
    }),
  );

  const supabase = createClient();
  const { error: uploadError } = await supabase.storage.from(ONBOARDING_STORAGE_BUCKET)
    .uploadToSignedUrl(authorized.path, authorized.token, file, { contentType: 'application/pdf' });
  if (uploadError) throw new Error('Não foi possível enviar o documento. Tente novamente.');

  return json(await fetch('/api/contracts/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploadId: authorized.uploadId, path: authorized.path, fileName: file.name }),
  }));
}

export async function getContractIntake(id: string): Promise<ContractIntakeView> {
  const body = await json<{ intake: ContractIntakeView }>(await fetch(`/api/contracts/onboarding/${id}`, { cache: 'no-store' }));
  return body.intake;
}

export async function retryContractIntake(id: string): Promise<void> {
  await json(await fetch(`/api/contracts/onboarding/${id}`, { method: 'POST' }));
}

export async function finalizeContractIntake(id: string, values: Record<string, unknown>): Promise<{ contractId: string }> {
  return json(await fetch(`/api/contracts/onboarding/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(values),
  }));
}
