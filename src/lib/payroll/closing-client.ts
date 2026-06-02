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
import { injectPayrollBatch, getCostCenters, createCostCenter } from '@/lib/finance/finance-store';
import {
  getCostCenterMappings, saveCostCenterMappings as saveLocalMappings,
  deleteCostCenterMapping as deleteLocalMapping, type CostCenterLike,
} from '@/lib/payroll/cost-center-mapping';
import type {
  CostCenterMatchMethod,
  PayrollAttachment, PayrollAttachmentFileType, PayrollClosingBatch, PayrollCostCenterMapping,
  PayrollEmailAudience, PayrollEmailDispatch, PayrollImportFileType, PayrollParseResult,
  PayrollReportType, PayrollSecurityLevel,
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

/**
 * Return the existing active batch for this competence, or create a new one.
 * Prevents the unique-constraint error (`uq_pcb_org_comp_active`) when the user
 * uploads a second file into the same competence session — the constraint allows
 * only one non-cancelled batch per org+competence.
 */
export async function findOrCreateBatch(input: { competence_month: string; payment_deadline?: string }): Promise<PayrollClosingBatch> {
  if (!isSupabase()) {
    // Mock: find an existing non-cancelled batch for the competence.
    const existing = store.getClosingBatches().find(
      (b) => b.competence_month === input.competence_month && b.status !== 'cancelled',
    );
    if (existing) return existing;
    return store.createClosingBatch(input);
  }
  // Supabase: list batches and look for a match first.
  try {
    const list = await jsonFetch<{ ok: boolean; batches?: PayrollClosingBatch[] }>('/api/payroll/batches');
    if (list.ok && list.batches) {
      const existing = list.batches.find(
        (b) => b.competence_month === input.competence_month && b.status !== 'cancelled',
      );
      if (existing) return existing;
    }
  } catch {
    // If list fails, fall through to create — let the server return the constraint error.
  }
  return createBatch(input);
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

export interface SendToFinanceResult { ok: boolean; batch?: PayrollClosingBatch; finance_batch_id?: string; error?: string; code?: string; unmapped_count?: number }
export interface SendToFinanceOptions { override?: boolean; overrideReason?: string }
export async function sendToFinance(batchId: string, options: SendToFinanceOptions = {}): Promise<SendToFinanceResult> {
  if (!isSupabase()) {
    // Must be approved first in mock mode (page approves before calling). The
    // unmapped-center gate is enforced client-side in mock mode.
    return store.sendToFinance(batchId);
  }
  const result = await jsonFetch<SendToFinanceResult>(`/api/payroll/batches/${batchId}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'send_to_finance', override: options.override, override_reason: options.overrideReason }),
  });
  // Mirror the DB-created finance batch into the in-memory finance store so
  // Financeiro > Folha & Alocação can see it without a server-backed finance module.
  if (result.ok && result.finance_batch_id && result.batch) {
    const now = new Date().toISOString();
    injectPayrollBatch({
      id: result.finance_batch_id,
      period_key: result.batch.competence_month,
      business_unit_id: '',
      total_gross_cents: result.batch.total_amount_cents,
      total_charges_cents: 0,
      total_benefits_cents: 0,
      headcount: 0,
      status: 'approved',
      source_system: 'payroll_close',
      notes: `Fechamento ${result.batch.id} (${result.batch.competence_month})`,
      created_by: '',
      created_at: now,
      updated_at: now,
    });
  }
  return result;
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

// ── Cost-center mapping aliases ─────────────────────────────
// supabase → shared, server-persisted table (payroll_cost_center_mappings).
// mock/dev → org-scoped localStorage (cost-center-mapping.ts), unchanged.

export interface SaveMappingInput {
  imported_name: string;
  cost_center_id: string;
  confidence?: number;
  match_method?: CostCenterMatchMethod;
}

export async function listCostCenterMappings(): Promise<PayrollCostCenterMapping[]> {
  if (!isSupabase()) return getCostCenterMappings();
  try {
    const r = await jsonFetch<{ ok: boolean; mappings?: PayrollCostCenterMapping[] }>('/api/payroll/cost-center-mappings');
    return r.ok && r.mappings ? r.mappings : [];
  } catch {
    // Network/parse failure — fall back to any local aliases so the UI still
    // auto-matches instead of showing everything as unmapped.
    return getCostCenterMappings();
  }
}

export async function saveCostCenterMappings(inputs: SaveMappingInput[]): Promise<PayrollCostCenterMapping[]> {
  if (!isSupabase()) return saveLocalMappings(inputs);
  const r = await jsonFetch<{ ok: boolean; mappings?: PayrollCostCenterMapping[]; error?: string }>('/api/payroll/cost-center-mappings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mappings: inputs }),
  });
  if (!r.ok) throw new Error(r.error ?? 'Falha ao salvar mapeamentos');
  return r.mappings ?? [];
}

export async function deleteCostCenterMapping(mapping: { id?: string; imported_name: string }): Promise<void> {
  if (!isSupabase()) { deleteLocalMapping(mapping.imported_name); return; }
  if (!mapping.id) return;
  await jsonFetch(`/api/payroll/cost-center-mappings?id=${encodeURIComponent(mapping.id)}`, { method: 'DELETE' });
}

// ── Finance cost centers (mapping dropdown source) ──────────
// supabase → finance_cost_centers (uuid ids) via API. mock/dev → client
// finance-store (cc-* ids). Returns the minimal CostCenterLike shape the
// matcher + dropdown need.

export async function listFinanceCostCenters(): Promise<CostCenterLike[]> {
  if (!isSupabase()) {
    return getCostCenters().filter((c) => c.active).map((c) => ({ id: c.id, code: c.code, name: c.name }));
  }
  try {
    const r = await jsonFetch<{ ok: boolean; costCenters?: CostCenterLike[] }>('/api/finance/cost-centers');
    return r.ok && r.costCenters ? r.costCenters : [];
  } catch {
    // Fall back to the client seed so the dropdown isn't empty on a transient error.
    return getCostCenters().filter((c) => c.active).map((c) => ({ id: c.id, code: c.code, name: c.name }));
  }
}

export async function createFinanceCostCenter(name: string): Promise<CostCenterLike> {
  if (!isSupabase()) {
    const cc = createCostCenter({ name });
    return { id: cc.id, code: cc.code, name: cc.name };
  }
  const r = await jsonFetch<{ ok: boolean; costCenter?: CostCenterLike; error?: string }>('/api/finance/cost-centers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  if (!r.ok || !r.costCenter) throw new Error(r.error ?? 'Falha ao criar centro de custo');
  return r.costCenter;
}

// ── Lifecycle: edit / cancel / reopen / delete ──────────────
async function batchAction(batchId: string, body: Record<string, unknown>): Promise<{ ok: boolean; batch?: PayrollClosingBatch; error?: string }> {
  return jsonFetch(`/api/payroll/batches/${batchId}/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

export async function updateBatch(batchId: string, patch: { competence_month?: string; payment_deadline?: string | null; notes?: string | null }): Promise<PayrollClosingBatch | undefined> {
  if (!isSupabase()) return store.updateClosingBatch(batchId, patch);
  const r = await batchAction(batchId, { action: 'update', ...patch });
  if (!r.ok) throw new Error(r.error ?? 'Falha ao editar fechamento');
  return r.batch;
}

export async function cancelBatch(batchId: string, reason?: string): Promise<PayrollClosingBatch | undefined> {
  if (!isSupabase()) return store.cancelClosingBatch(batchId, reason);
  const r = await batchAction(batchId, { action: 'cancel', reason });
  if (!r.ok) throw new Error(r.error ?? 'Falha ao cancelar fechamento');
  return r.batch;
}

export async function reopenBatch(batchId: string, reason?: string): Promise<PayrollClosingBatch | undefined> {
  if (!isSupabase()) return store.reopenClosingBatch(batchId, reason);
  const r = await batchAction(batchId, { action: 'reopen', reason });
  if (!r.ok) throw new Error(r.error ?? 'Falha ao reabrir fechamento');
  return r.batch;
}

export async function invalidateParse(batchId: string): Promise<PayrollClosingBatch | undefined> {
  if (!isSupabase()) return store.invalidateParse(batchId);
  const r = await batchAction(batchId, { action: 'invalidate_parse' });
  if (!r.ok) throw new Error(r.error ?? 'Falha ao reprocessar');
  return r.batch;
}

export interface DeleteBatchResult { ok: boolean; error?: string }
export async function deleteBatch(batchId: string): Promise<DeleteBatchResult> {
  if (!isSupabase()) return store.deleteClosingBatch(batchId);
  return jsonFetch<DeleteBatchResult>(`/api/payroll/batches/${batchId}`, { method: 'DELETE' });
}

export interface RemoveAttachmentResult { ok: boolean; file_type?: string; was_payroll_spreadsheet?: boolean; error?: string }
export async function removeAttachment(batchId: string, attachmentId: string): Promise<RemoveAttachmentResult> {
  if (!isSupabase()) return store.removeAttachment(batchId, attachmentId);
  return jsonFetch<RemoveAttachmentResult>(`/api/payroll/batches/${batchId}/files?attachment_id=${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
}
