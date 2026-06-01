/**
 * Mode-aware CLIENT facade for the Fechamento da Folha page.
 *
 * mock     → delegates to the in-memory client store (payroll-closing-store),
 *            preserving the original zero-backend behavior.
 * supabase → calls the API routes backed by the server repository (Postgres +
 *            secure Storage + audit). Bytes never include the service role.
 *
 * Selected by NEXT_PUBLIC_PAYROLL_CLOSING_REPOSITORY_MODE ('mock' | 'supabase').
 * The page imports only this facade, so the JSX/flow is identical in both modes.
 */

'use client';

import * as store from '@/lib/payroll/payroll-closing-store';
import { blobToBase64, sendPayrollEmail, type SendEmailResponse } from '@/lib/payroll/client';
import type {
  PayrollAttachment, PayrollAttachmentFileType, PayrollClosingBatch, PayrollEmailAudience,
  PayrollEmailDispatch, PayrollImportFileType, PayrollParseResult, PayrollReportType, PayrollSecurityLevel,
} from '@/lib/types/payroll-closing';

export function repositoryMode(): 'mock' | 'supabase' {
  return process.env.NEXT_PUBLIC_PAYROLL_CLOSING_REPOSITORY_MODE === 'supabase' ? 'supabase' : 'mock';
}
const isSupabase = () => repositoryMode() === 'supabase';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
}

// ── Batch lifecycle ─────────────────────────────────────────
export async function createBatch(input: { competence_month: string; payment_deadline?: string }): Promise<PayrollClosingBatch> {
  if (!isSupabase()) return store.createClosingBatch(input);
  const r = await jsonFetch<{ ok: boolean; batch?: PayrollClosingBatch; error?: string }>('/api/payroll/batches', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!r.ok || !r.batch) throw new Error(r.error ?? 'Falha ao criar fechamento');
  return r.batch;
}

export interface UploadResult { attachment: PayrollAttachment }
export async function uploadFile(batchId: string, file: File, fileType: PayrollImportFileType): Promise<UploadResult> {
  if (!isSupabase()) {
    store.addImportFiles(batchId, [{ file, file_type: fileType }]);
    const atts = store.getAttachments(batchId);
    return { attachment: atts[0] };
  }
  const form = new FormData();
  form.append('file', file);
  form.append('file_type', fileType);
  form.append('file_name', file.name);
  const r = await jsonFetch<{ ok: boolean; attachment?: PayrollAttachment; error?: string }>(`/api/payroll/batches/${batchId}/files`, { method: 'POST', body: form });
  if (!r.ok || !r.attachment) throw new Error(r.error ?? 'Falha no upload');
  return { attachment: r.attachment };
}

export async function getAttachments(batchId: string): Promise<PayrollAttachment[]> {
  if (!isSupabase()) return store.getAttachments(batchId);
  const r = await jsonFetch<{ ok: boolean; attachments?: PayrollAttachment[] }>(`/api/payroll/batches/${batchId}`);
  return r.attachments ?? [];
}

export async function saveParse(batchId: string, parse: PayrollParseResult): Promise<PayrollClosingBatch | undefined> {
  if (!isSupabase()) return store.setParseResult(batchId, parse);
  const r = await jsonFetch<{ ok: boolean; batch?: PayrollClosingBatch; error?: string }>(`/api/payroll/batches/${batchId}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_parse', parse }),
  });
  if (!r.ok) throw new Error(r.error ?? 'Falha ao salvar parsing');
  return r.batch;
}

export async function saveReport(batchId: string, input: { report_type: PayrollReportType; generated_text: string; generated_html: string; generated_by_ai: boolean }): Promise<void> {
  if (!isSupabase()) { store.saveGeneratedReport(batchId, input); return; }
  await jsonFetch(`/api/payroll/batches/${batchId}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save_report', ...input }),
  });
}

export async function addGeneratedAttachment(batchId: string, input: { file_name: string; file_type: PayrollAttachmentFileType; mime_type: string; html: string; security_level?: PayrollSecurityLevel }): Promise<void> {
  if (!isSupabase()) {
    store.addGeneratedAttachment(batchId, { file_name: input.file_name, file_type: input.file_type, mime_type: input.mime_type, security_level: input.security_level, blob: new Blob([input.html], { type: input.mime_type }) });
    return;
  }
  await jsonFetch(`/api/payroll/batches/${batchId}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add_generated_attachment', file_name: input.file_name, file_type: input.file_type, mime_type: input.mime_type, content: input.html, encoding: 'utf8', security_level: input.security_level }),
  });
}

export async function approveBatch(batchId: string): Promise<PayrollClosingBatch | undefined> {
  if (!isSupabase()) return store.approveBatch(batchId);
  const r = await jsonFetch<{ ok: boolean; batch?: PayrollClosingBatch; error?: string }>(`/api/payroll/batches/${batchId}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }),
  });
  if (!r.ok) throw new Error(r.error ?? 'Falha ao aprovar');
  return r.batch;
}

export interface SendToFinanceResult { ok: boolean; batch?: PayrollClosingBatch; finance_batch_id?: string; error?: string }
export async function sendToFinance(batchId: string): Promise<SendToFinanceResult> {
  if (!isSupabase()) {
    // Must be approved first in mock mode (page approves before calling).
    return store.sendToFinance(batchId);
  }
  return jsonFetch<SendToFinanceResult>(`/api/payroll/batches/${batchId}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send_to_finance' }),
  });
}

export async function getDispatches(batchId: string): Promise<PayrollEmailDispatch[]> {
  if (!isSupabase()) return store.getDispatches(batchId);
  const r = await jsonFetch<{ ok: boolean; dispatches?: PayrollEmailDispatch[] }>(`/api/payroll/batches/${batchId}`);
  return r.dispatches ?? [];
}

// ── E-mail send (handles both attachment sources) ───────────
export interface SendArgs {
  batchId: string;
  subject: string;
  html: string;
  recipients: string[];
  cc?: string[];
  audience: PayrollEmailAudience;
  attachmentIds: string[];
  confirmSensitive: boolean;
  test: boolean;
}

export async function sendEmail(args: SendArgs): Promise<SendEmailResponse> {
  if (isSupabase()) {
    // Server loads bytes from Storage by id, records the dispatch + audit.
    return sendPayrollEmail({
      subject: args.subject, html: args.html, recipients: args.recipients, cc: args.cc,
      attachments: [], // not used in supabase mode — server loads from Storage
      attachment_ids: args.attachmentIds, batch_id: args.batchId, audience: args.audience,
      confirm_sensitive: args.confirmSensitive, test: args.test,
    });
  }
  // Mock mode: read blobs from the store, base64 inline, then record dispatch locally.
  const atts = store.getAttachments(args.batchId).filter((a) => args.attachmentIds.includes(a.id));
  const attachments = await Promise.all(atts.map(async (a) => {
    const blob = store.getAttachmentBlob(a.id);
    const content_base64 = blob ? await blobToBase64(blob) : '';
    return { file_name: a.file_name, content_base64, mime_type: a.mime_type, file_size: a.file_size };
  }));
  const res = await sendPayrollEmail({ subject: args.subject, html: args.html, recipients: args.recipients, cc: args.cc, attachments, test: args.test });
  if (res.ok && !args.test) {
    const pkg = store.buildEmailPackage(args.batchId, { audience: args.audience, subject: args.subject, html_body: args.html, attachment_ids: args.attachmentIds });
    store.recordDispatch({
      package_id: pkg.id, recipients: args.recipients, cc: args.cc,
      delivery_status: res.delivery_status ?? 'simulated', provider_message_id: res.provider_message_id,
      attachments_sent: res.attachments_sent ?? atts.map((a) => ({ file_name: a.file_name, file_size: a.file_size })),
    });
  }
  return res;
}
