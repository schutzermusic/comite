import type { ContractOnboardingResult } from './document-first';

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

export async function sendContractDocument(file: File): Promise<{
  intakeId?: string; status?: ContractIntakeStatus; duplicate?: boolean; contractId?: string; message?: string;
}> {
  const form = new FormData();
  form.append('document', file);
  return json(await fetch('/api/contracts/onboarding', { method: 'POST', body: form }));
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
