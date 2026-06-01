/**
 * Process-lifetime in-memory payroll repository (SERVER, mock mode).
 *
 * Lets the API routes function without a database (PAYROLL_CLOSING_REPOSITORY_MODE
 * = 'mock'). State lives for the lifetime of the server process and is NOT shared
 * with the client-side in-memory store. Bytes are held in a Map. Audit is logged
 * to the console. This is for local/dev use; production uses the Supabase repo.
 */

import type {
  PayrollAttachment, PayrollClosingBatch, PayrollEmailDispatch, PayrollEmailPackage,
  PayrollGeneratedReport, PayrollImportFile, PayrollParseResult,
} from '@/lib/types/payroll-closing';
import {
  IMPORT_TYPE_MAP,
  type AttachmentBytes, type AuditInput, type CreateBatchInput, type CreatePackageInput,
  type GeneratedAttachmentInput, type PayrollRepository, type RecordDispatchInput, type RepoActor,
  type SaveReportInput, type SendToFinanceResult, type UploadFileInput,
} from './types';

let batches: PayrollClosingBatch[] = [];
let importFiles: PayrollImportFile[] = [];
let attachments: PayrollAttachment[] = [];
let reports: PayrollGeneratedReport[] = [];
let packages: PayrollEmailPackage[] = [];
let dispatches: PayrollEmailDispatch[] = [];
const blobs = new Map<string, Buffer>();
let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`;
const now = () => new Date().toISOString();

export class InMemoryServerRepository implements PayrollRepository {
  readonly mode = 'mock' as const;

  async writeAudit(_actor: RepoActor, input: AuditInput): Promise<void> {
    console.info('[payroll-audit:mock]', input.action, input.entity_type, input.entity_id, input.metadata ?? {});
  }

  async createClosingBatch(actor: RepoActor, input: CreateBatchInput): Promise<PayrollClosingBatch> {
    const b: PayrollClosingBatch = {
      id: uid('pcb'), organization_id: actor.organizationId, competence_month: input.competence_month,
      total_amount_cents: 0, previous_month_amount_cents: 0, variation_amount_cents: 0, variation_percentage: 0,
      payment_deadline: input.payment_deadline, status: 'imported', created_by: actor.userId,
      created_at: now(), updated_at: now(),
    };
    batches = [b, ...batches];
    return b;
  }

  async getClosingBatch(actor: RepoActor, id: string): Promise<PayrollClosingBatch | null> {
    return batches.find((b) => b.id === id && b.organization_id === actor.organizationId) ?? null;
  }

  async listClosingBatches(actor: RepoActor): Promise<PayrollClosingBatch[]> {
    return batches.filter((b) => b.organization_id === actor.organizationId);
  }

  private patch(id: string, p: Partial<PayrollClosingBatch>): PayrollClosingBatch {
    const i = batches.findIndex((b) => b.id === id);
    batches[i] = { ...batches[i], ...p, updated_at: now() };
    return batches[i];
  }

  async addImportFile(actor: RepoActor, batchId: string, input: UploadFileInput) {
    const map = IMPORT_TYPE_MAP[input.file_type];
    const path = `${map.bucket}/${actor.organizationId}/${batchId}/${input.file_type}/${input.file_name}`;
    const importFile: PayrollImportFile = {
      id: uid('pif'), batch_id: batchId, file_name: input.file_name, file_type: input.file_type,
      storage_path: path, mime_type: input.mime_type, file_size: input.bytes.length, checksum: '',
      uploaded_by: actor.userId, created_at: now(),
    };
    const attachment: PayrollAttachment = {
      id: uid('pat'), batch_id: batchId, file_name: input.file_name, file_type: map.attachment_type,
      security_level: map.security_level, storage_path: path, file_size: input.bytes.length,
      mime_type: input.mime_type, checksum: '', uploaded_by: actor.userId, created_at: now(),
    };
    importFiles = [importFile, ...importFiles];
    attachments = [attachment, ...attachments];
    blobs.set(attachment.id, input.bytes);
    return { importFile, attachment };
  }

  async addGeneratedAttachment(actor: RepoActor, batchId: string, input: GeneratedAttachmentInput): Promise<PayrollAttachment> {
    attachments = attachments.filter((a) => !(a.batch_id === batchId && a.file_type === input.file_type && a.storage_path.includes('/generated/')));
    const att: PayrollAttachment = {
      id: uid('pat'), batch_id: batchId, file_name: input.file_name, file_type: input.file_type,
      security_level: input.security_level ?? 'aggregate',
      storage_path: `payroll-reports/${actor.organizationId}/${batchId}/generated/${input.file_name}`,
      file_size: input.bytes.length, mime_type: input.mime_type, checksum: '', uploaded_by: actor.userId, created_at: now(),
    };
    attachments = [att, ...attachments];
    blobs.set(att.id, input.bytes);
    return att;
  }

  async getAttachments(actor: RepoActor, batchId: string): Promise<PayrollAttachment[]> {
    return attachments.filter((a) => a.batch_id === batchId);
  }

  async getAttachmentBytes(_actor: RepoActor, attachmentId: string): Promise<AttachmentBytes | null> {
    const att = attachments.find((a) => a.id === attachmentId);
    const bytes = blobs.get(attachmentId);
    if (!att || !bytes) return null;
    return { bytes, file_name: att.file_name, mime_type: att.mime_type, file_size: att.file_size, security_level: att.security_level, file_type: att.file_type };
  }

  async saveParsedPayrollData(_actor: RepoActor, batchId: string, parse: PayrollParseResult): Promise<PayrollClosingBatch> {
    const hasError = parse.flags.some((f) => f.severity === 'error');
    return this.patch(batchId, {
      competence_month: parse.competence_month || batches.find((b) => b.id === batchId)?.competence_month || '',
      total_amount_cents: parse.total_amount_cents, previous_month_amount_cents: parse.previous_month_amount_cents,
      variation_amount_cents: parse.variation_amount_cents, variation_percentage: parse.variation_percentage,
      payment_deadline: parse.payment_deadline, status: hasError ? 'imported' : 'validated',
    });
  }

  async saveGeneratedReport(_actor: RepoActor, batchId: string, input: SaveReportInput): Promise<PayrollGeneratedReport> {
    reports = reports.filter((r) => !(r.batch_id === batchId && r.report_type === input.report_type));
    const r: PayrollGeneratedReport = {
      id: uid('pgr'), batch_id: batchId, report_type: input.report_type, generated_text: input.generated_text,
      generated_html: input.generated_html, status: 'draft', generated_by_ai: input.generated_by_ai,
      created_at: now(), updated_at: now(),
    };
    reports = [r, ...reports];
    return r;
  }

  async createEmailPackage(actor: RepoActor, batchId: string, input: CreatePackageInput): Promise<PayrollEmailPackage> {
    const p: PayrollEmailPackage = {
      id: uid('pep'), batch_id: batchId, audience: input.audience, subject: input.subject,
      html_body: input.html_body, attachment_ids: input.attachment_ids, status: 'draft', created_by: actor.userId,
    };
    packages = [p, ...packages];
    return p;
  }

  async recordDispatch(actor: RepoActor, input: RecordDispatchInput): Promise<PayrollEmailDispatch> {
    const d: PayrollEmailDispatch = {
      id: uid('ped'), package_id: input.package_id, recipients: input.recipients, cc: input.cc ?? [], bcc: input.bcc ?? [],
      delivery_status: input.delivery_status, provider_message_id: input.provider_message_id, error_message: input.error_message,
      attachments_sent: input.attachments_sent, created_at: now(), sent_at: input.delivery_status === 'failed' ? undefined : now(),
    };
    dispatches = [d, ...dispatches];
    const i = packages.findIndex((p) => p.id === input.package_id);
    if (i !== -1) packages[i] = { ...packages[i], status: input.delivery_status === 'failed' ? 'failed' : 'sent', sent_by: actor.userId, sent_at: now() };
    return d;
  }

  async getDispatches(actor: RepoActor, batchId: string): Promise<PayrollEmailDispatch[]> {
    const ids = new Set(packages.filter((p) => p.batch_id === batchId).map((p) => p.id));
    return dispatches.filter((d) => ids.has(d.package_id));
  }

  async approveClosingBatch(actor: RepoActor, id: string): Promise<PayrollClosingBatch> {
    return this.patch(id, { status: 'approved', approved_by: actor.userId });
  }

  async sendToFinance(actor: RepoActor, id: string): Promise<SendToFinanceResult> {
    const batch = await this.getClosingBatch(actor, id);
    if (!batch) return { ok: false, error: 'Fechamento não encontrado.' };
    if (batch.finance_batch_id) return { ok: false, error: 'Já enviado ao Financeiro (anti-duplicidade).', finance_batch_id: batch.finance_batch_id };
    if (batch.status !== 'approved') return { ok: false, error: 'Aprove o fechamento antes de enviar ao Financeiro.' };
    const financeId = uid('pb');
    const updated = this.patch(id, { status: 'sent_to_finance', finance_batch_id: financeId });
    return { ok: true, batch: updated, finance_batch_id: financeId };
  }
}
