/**
 * In-memory store for the payroll-closing workflow, mirroring the service-layer
 * pattern of `finance-store.ts` (module-level arrays + pure-ish actions). It is
 * mock-backed: uploaded files live as in-memory blobs (storage simulated) so we
 * can attach them to e-mails without a real bucket.
 *
 * The ONLY bridge to finance is `sendToFinance`, which creates the existing
 * `PayrollBatch` (consumed by Folha & Alocação). It is guarded so a closing can
 * feed finance at most once — preventing duplicate payroll cost recognition.
 */

import {
  createPayrollBatch,
  getBusinessUnits,
} from '@/lib/finance/finance-store';
import type {
  PayrollAttachment,
  PayrollAttachmentFileType,
  PayrollClosingBatch,
  PayrollEmailDispatch,
  PayrollEmailPackage,
  PayrollGeneratedReport,
  PayrollImportFile,
  PayrollImportFileType,
  PayrollParseResult,
  PayrollSecurityLevel,
} from '@/lib/types/payroll-closing';

const ORG_ID = 'org-insight-001';
const CURRENT_USER = 'user-admin-001';

// ── State ───────────────────────────────────────────────────

let closingBatches: PayrollClosingBatch[] = [];
let importFiles: PayrollImportFile[] = [];
let attachments: PayrollAttachment[] = [];
let reports: PayrollGeneratedReport[] = [];
let emailPackages: PayrollEmailPackage[] = [];
let dispatches: PayrollEmailDispatch[] = [];

/** attachment_id → raw bytes (storage simulated). */
const attachmentBlobs = new Map<string, Blob>();

interface PayrollAuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  at: string;
  detail?: string;
}
const auditLog: PayrollAuditEntry[] = [];

function audit(entityType: string, entityId: string, action: string, detail?: string) {
  auditLog.push({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    entity_type: entityType,
    entity_id: entityId,
    action,
    actor: CURRENT_USER,
    at: new Date().toISOString(),
    detail,
  });
}

let _seq = 0;
function uid(prefix: string): string {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

function cheapChecksum(name: string, size: number): string {
  let h = 0;
  const s = `${name}:${size}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// ── Import file → attachment mapping ────────────────────────

const IMPORT_TO_ATTACHMENT: Record<
  PayrollImportFileType,
  { file_type: PayrollAttachmentFileType; security_level: PayrollSecurityLevel }
> = {
  payroll_spreadsheet: { file_type: 'payroll_spreadsheet', security_level: 'hr_restricted' },
  bank_payment_spreadsheet: { file_type: 'bank_payment_spreadsheet', security_level: 'finance_restricted' },
  holerite: { file_type: 'holerite', security_level: 'confidential' },
  external_holerite: { file_type: 'external_holerite', security_level: 'confidential' },
  supporting_document: { file_type: 'supporting_document', security_level: 'aggregate' },
};

// ── Batch lifecycle ─────────────────────────────────────────

export function createClosingBatch(input: { competence_month: string; payment_deadline?: string }): PayrollClosingBatch {
  const now = new Date().toISOString();
  const batch: PayrollClosingBatch = {
    id: uid('pcb'),
    organization_id: ORG_ID,
    competence_month: input.competence_month,
    total_amount_cents: 0,
    previous_month_amount_cents: 0,
    variation_amount_cents: 0,
    variation_percentage: 0,
    payment_deadline: input.payment_deadline,
    status: 'imported',
    created_by: CURRENT_USER,
    created_at: now,
    updated_at: now,
  };
  closingBatches = [batch, ...closingBatches];
  audit('payroll_closing', batch.id, 'created');
  return batch;
}

export function getClosingBatches(): PayrollClosingBatch[] {
  return closingBatches;
}

export function getClosingBatch(id: string): PayrollClosingBatch | undefined {
  return closingBatches.find((b) => b.id === id);
}

function patchBatch(id: string, patch: Partial<PayrollClosingBatch>): PayrollClosingBatch | undefined {
  const idx = closingBatches.findIndex((b) => b.id === id);
  if (idx === -1) return undefined;
  closingBatches[idx] = { ...closingBatches[idx], ...patch, updated_at: new Date().toISOString() };
  return closingBatches[idx];
}

// ── File upload (simulated storage) ─────────────────────────

export interface UploadFileInput {
  file: File;
  file_type: PayrollImportFileType;
}

export function addImportFiles(batchId: string, inputs: UploadFileInput[]): PayrollImportFile[] {
  const now = new Date().toISOString();
  const created: PayrollImportFile[] = [];
  for (const { file, file_type } of inputs) {
    const checksum = cheapChecksum(file.name, file.size);
    const storage_path = `mock://payroll/${batchId}/${file_type}/${file.name}`;
    const imp: PayrollImportFile = {
      id: uid('pif'),
      batch_id: batchId,
      file_name: file.name,
      file_type,
      storage_path,
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      checksum,
      uploaded_by: CURRENT_USER,
      created_at: now,
    };
    importFiles = [imp, ...importFiles];
    created.push(imp);

    // Register a matching attachment + keep the bytes in memory.
    const mapping = IMPORT_TO_ATTACHMENT[file_type];
    const att: PayrollAttachment = {
      id: uid('pat'),
      batch_id: batchId,
      file_name: file.name,
      file_type: mapping.file_type,
      security_level: mapping.security_level,
      storage_path,
      file_size: file.size,
      mime_type: imp.mime_type,
      checksum,
      uploaded_by: CURRENT_USER,
      created_at: now,
    };
    attachments = [att, ...attachments];
    attachmentBlobs.set(att.id, file);
    audit('payroll_import_file', imp.id, 'uploaded', `${file_type}: ${file.name}`);
  }
  return created;
}

export function getImportFiles(batchId: string): PayrollImportFile[] {
  return importFiles.filter((f) => f.batch_id === batchId);
}

// ── Generated attachments (PDF / dashboard snapshot, HTML bytes) ──

export function addGeneratedAttachment(
  batchId: string,
  input: { file_name: string; file_type: PayrollAttachmentFileType; mime_type: string; blob: Blob; security_level?: PayrollSecurityLevel },
): PayrollAttachment {
  const att: PayrollAttachment = {
    id: uid('pat'),
    batch_id: batchId,
    file_name: input.file_name,
    file_type: input.file_type,
    security_level: input.security_level ?? 'aggregate',
    storage_path: `mock://payroll/${batchId}/generated/${input.file_name}`,
    file_size: input.blob.size,
    mime_type: input.mime_type,
    checksum: cheapChecksum(input.file_name, input.blob.size),
    uploaded_by: CURRENT_USER,
    created_at: new Date().toISOString(),
  };
  // Replace any previous generated attachment of the same file_type for this batch.
  attachments = attachments.filter(
    (a) => !(a.batch_id === batchId && a.file_type === input.file_type && a.storage_path.includes('/generated/')),
  );
  attachments = [att, ...attachments];
  attachmentBlobs.set(att.id, input.blob);
  audit('payroll_attachment', att.id, 'generated', input.file_type);
  return att;
}

export function getAttachments(batchId: string): PayrollAttachment[] {
  return attachments.filter((a) => a.batch_id === batchId);
}

export function getAttachmentBlob(attachmentId: string): Blob | undefined {
  return attachmentBlobs.get(attachmentId);
}

// ── Parse result ────────────────────────────────────────────

const parseResults = new Map<string, PayrollParseResult>();

export function setParseResult(batchId: string, result: PayrollParseResult): PayrollClosingBatch | undefined {
  parseResults.set(batchId, result);
  audit('payroll_closing', batchId, 'parsed', `${result.detected_sheets.length} abas`);
  return patchBatch(batchId, {
    competence_month: result.competence_month || getClosingBatch(batchId)?.competence_month || '',
    total_amount_cents: result.total_amount_cents,
    previous_month_amount_cents: result.previous_month_amount_cents,
    variation_amount_cents: result.variation_amount_cents,
    variation_percentage: result.variation_percentage,
    payment_deadline: result.payment_deadline ?? getClosingBatch(batchId)?.payment_deadline,
    status: result.flags.some((f) => f.severity === 'error') ? 'imported' : 'validated',
  });
}

export function getParseResult(batchId: string): PayrollParseResult | undefined {
  return parseResults.get(batchId);
}

// ── Generated reports / narrative ───────────────────────────

export function saveGeneratedReport(
  batchId: string,
  input: { report_type: PayrollGeneratedReport['report_type']; generated_text: string; generated_html: string; generated_by_ai: boolean },
): PayrollGeneratedReport {
  const now = new Date().toISOString();
  // One report per (batch, type): replace if it exists.
  reports = reports.filter((r) => !(r.batch_id === batchId && r.report_type === input.report_type));
  const report: PayrollGeneratedReport = {
    id: uid('pgr'),
    batch_id: batchId,
    report_type: input.report_type,
    generated_text: input.generated_text,
    generated_html: input.generated_html,
    status: 'draft',
    generated_by_ai: input.generated_by_ai,
    created_at: now,
    updated_at: now,
  };
  reports = [report, ...reports];
  audit('payroll_report', report.id, 'generated', input.report_type);
  return report;
}

export function updateReportText(reportId: string, text: string, html: string): PayrollGeneratedReport | undefined {
  const idx = reports.findIndex((r) => r.id === reportId);
  if (idx === -1) return undefined;
  reports[idx] = { ...reports[idx], generated_text: text, generated_html: html, generated_by_ai: false, status: 'reviewed', updated_at: new Date().toISOString() };
  return reports[idx];
}

export function getReports(batchId: string): PayrollGeneratedReport[] {
  return reports.filter((r) => r.batch_id === batchId);
}

// ── Status transitions ──────────────────────────────────────

export function reviewBatch(batchId: string): PayrollClosingBatch | undefined {
  audit('payroll_closing', batchId, 'reviewed');
  return patchBatch(batchId, { status: 'reviewed' });
}

export function approveBatch(batchId: string): PayrollClosingBatch | undefined {
  audit('payroll_closing', batchId, 'approved');
  return patchBatch(batchId, { status: 'approved', approved_by: CURRENT_USER });
}

export function cancelBatch(batchId: string): PayrollClosingBatch | undefined {
  audit('payroll_closing', batchId, 'cancelled');
  return patchBatch(batchId, { status: 'cancelled' });
}

// ── E-mail packages & dispatch ──────────────────────────────

export function buildEmailPackage(
  batchId: string,
  input: { audience: PayrollEmailPackage['audience']; subject: string; html_body: string; attachment_ids: string[] },
): PayrollEmailPackage {
  const pkg: PayrollEmailPackage = {
    id: uid('pep'),
    batch_id: batchId,
    audience: input.audience,
    subject: input.subject,
    html_body: input.html_body,
    attachment_ids: input.attachment_ids,
    status: 'draft',
    created_by: CURRENT_USER,
  };
  emailPackages = [pkg, ...emailPackages];
  audit('payroll_email_package', pkg.id, 'built', `${input.audience} / ${input.attachment_ids.length} anexos`);
  return pkg;
}

export function getEmailPackages(batchId: string): PayrollEmailPackage[] {
  return emailPackages.filter((p) => p.batch_id === batchId);
}

export function recordDispatch(input: {
  package_id: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  delivery_status: PayrollEmailDispatch['delivery_status'];
  provider_message_id?: string;
  error_message?: string;
  attachments_sent: Array<{ file_name: string; file_size: number }>;
}): PayrollEmailDispatch {
  const now = new Date().toISOString();
  const dispatch: PayrollEmailDispatch = {
    id: uid('ped'),
    package_id: input.package_id,
    recipients: input.recipients,
    cc: input.cc ?? [],
    bcc: input.bcc ?? [],
    delivery_status: input.delivery_status,
    provider_message_id: input.provider_message_id,
    error_message: input.error_message,
    attachments_sent: input.attachments_sent,
    created_at: now,
    sent_at: input.delivery_status === 'failed' ? undefined : now,
  };
  dispatches = [dispatch, ...dispatches];
  const pkgIdx = emailPackages.findIndex((p) => p.id === input.package_id);
  if (pkgIdx !== -1) {
    const status: PayrollEmailPackage['status'] = input.delivery_status === 'failed' ? 'failed' : 'sent';
    emailPackages[pkgIdx] = { ...emailPackages[pkgIdx], status, sent_by: CURRENT_USER, sent_at: now };
  }
  audit('payroll_email_dispatch', dispatch.id, input.delivery_status, `${input.recipients.length} dest. / ${input.attachments_sent.length} anexos`);
  return dispatch;
}

export function getDispatches(batchId: string): PayrollEmailDispatch[] {
  const pkgIds = new Set(emailPackages.filter((p) => p.batch_id === batchId).map((p) => p.id));
  return dispatches.filter((d) => pkgIds.has(d.package_id));
}

// ── Finance bridge (anti-duplication) ───────────────────────

export interface SendToFinanceResult {
  ok: boolean;
  batch?: PayrollClosingBatch;
  finance_batch_id?: string;
  error?: string;
}

/**
 * Create the existing finance `PayrollBatch` from an approved closing.
 * Guarded: refuses if the closing is not approved or already linked to a
 * finance batch — this is the single control point against duplicate payroll
 * cost recognition. It never posts to the ledger (that is Folha & Alocação).
 */
export function sendToFinance(batchId: string): SendToFinanceResult {
  const batch = getClosingBatch(batchId);
  if (!batch) return { ok: false, error: 'Fechamento não encontrado.' };
  if (batch.finance_batch_id) {
    return { ok: false, error: 'Este fechamento já foi enviado ao Financeiro (anti-duplicidade).', finance_batch_id: batch.finance_batch_id };
  }
  if (batch.status !== 'approved') {
    return { ok: false, error: 'Aprove o fechamento antes de enviar ao Financeiro.' };
  }

  const parse = getParseResult(batchId);
  const total = batch.total_amount_cents;
  // Use the workbook split when present; otherwise put everything in gross with a note.
  let gross = parse?.gross_amount_cents ?? 0;
  let charges = parse?.charges_amount_cents ?? 0;
  let benefits = parse?.benefits_amount_cents ?? 0;
  let note = `Originado do Fechamento da Folha ${batch.id} (competência ${batch.competence_month}).`;
  if (gross + charges + benefits === 0 || gross + charges + benefits !== total) {
    gross = total;
    charges = 0;
    benefits = 0;
    note += ' Planilha não separou encargos/benefícios — total lançado em bruto.';
  }

  const bu = getBusinessUnits()[0];
  const created = createPayrollBatch({
    period_key: batch.competence_month,
    business_unit_id: bu?.id ?? '',
    total_gross_cents: gross,
    total_charges_cents: charges,
    total_benefits_cents: benefits,
    headcount: parse?.headcount ?? 0,
    source_system: 'payroll_close',
    notes: note,
  });

  const updated = patchBatch(batchId, { status: 'sent_to_finance', finance_batch_id: created.id });
  audit('payroll_closing', batchId, 'sent_to_finance', `finance batch ${created.id}`);
  return { ok: true, batch: updated, finance_batch_id: created.id };
}

// ── Audit ───────────────────────────────────────────────────

export function getPayrollAuditLog(batchId?: string): PayrollAuditEntry[] {
  if (!batchId) return auditLog;
  return auditLog.filter((a) => a.entity_id === batchId || a.detail?.includes(batchId));
}
