/**
 * Process-lifetime in-memory payroll repository (SERVER, mock mode).
 *
 * Lets the API routes function without a database (PAYROLL_CLOSING_REPOSITORY_MODE
 * = 'mock'). State lives for the lifetime of the server process and is NOT shared
 * with the client-side in-memory store. Bytes are held in a Map. Audit is logged
 * to the console. This is for local/dev use; production uses the Supabase repo.
 */

import type {
  PayrollAttachment, PayrollClosingBatch, PayrollClosingBatchApproved,
  PayrollCostCenterMapping, PayrollEmailDispatch, PayrollEmailPackage,
  PayrollGeneratedReport, PayrollImportFile, PayrollParseResult,
} from '@/lib/types/payroll-closing';
import {
  IMPORT_TYPE_MAP,
  type AttachmentBytes, type AuditInput, type CreateBatchInput, type CreateFinanceCostCenterInput,
  type CreatePackageInput, type DeleteBatchResult, type FinanceCostCenterRecord, type FinancePayrollBatchRecord,
  type GeneratedAttachmentInput, type PayrollRepository,
  type RecordDispatchInput, type RemoveAttachmentResult, type RepoActor,
  type SaveReportInput, type SendToFinanceOptions, type SendToFinanceResult,
  type UpdateBatchInput, type UpsertCostCenterMappingInput, type UploadFileInput,
} from './types';

/** Standard cost centers, mirroring the seed used by migration 022. */
const SEED_COST_CENTERS: Array<{ code: string; name: string }> = [
  { code: 'ENG-CAMPO', name: 'Engenharia de Campo' }, { code: 'MANUT', name: 'Manutenção Industrial' },
  { code: 'MOB', name: 'Mobilização' }, { code: 'ADM-SP', name: 'Administrativo SP' },
  { code: 'TI', name: 'Tecnologia da Informação' }, { code: 'RH', name: 'Recursos Humanos' },
  { code: 'COMERC', name: 'Comercial' }, { code: 'FIN', name: 'Financeiro' },
];

let batches: PayrollClosingBatch[] = [];
let importFiles: PayrollImportFile[] = [];
let attachments: PayrollAttachment[] = [];
let reports: PayrollGeneratedReport[] = [];
let packages: PayrollEmailPackage[] = [];
let dispatches: PayrollEmailDispatch[] = [];
let mappings: PayrollCostCenterMapping[] = [];
let financeCostCenters: FinanceCostCenterRecord[] = [];
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

  async sendToFinance(actor: RepoActor, id: string, _options: SendToFinanceOptions = {}): Promise<SendToFinanceResult> {
    // Mock mode keeps no parsed cost-center summaries, so it can't evaluate the
    // unmapped-mapping gate server-side — the client gate covers dev/mock. The
    // options param is accepted for signature parity with the Supabase repo.
    const batch = await this.getClosingBatch(actor, id);
    if (!batch) return { ok: false, error: 'Fechamento não encontrado.' };
    if (batch.finance_batch_id) return { ok: false, error: 'Já enviado ao Financeiro (anti-duplicidade).', finance_batch_id: batch.finance_batch_id };
    if (batch.status !== 'approved') return { ok: false, error: 'Aprove o fechamento antes de enviar ao Financeiro.' };
    const financeId = uid('pb');
    const updated = this.patch(id, { status: 'sent_to_finance', finance_batch_id: financeId });
    return { ok: true, batch: updated, finance_batch_id: financeId };
  }

  // ── Lifecycle: edit / cancel / reopen / delete ──────────────
  async updateClosingBatch(_actor: RepoActor, id: string, patch: UpdateBatchInput): Promise<PayrollClosingBatch> {
    return this.patch(id, {
      ...(patch.competence_month !== undefined ? { competence_month: patch.competence_month } : {}),
      ...(patch.payment_deadline !== undefined ? { payment_deadline: patch.payment_deadline ?? undefined } : {}),
    });
  }

  async cancelClosingBatch(actor: RepoActor, id: string, reason?: string): Promise<PayrollClosingBatch> {
    return this.patch(id, { status: 'cancelled', cancellation_reason: reason, deleted_at: now(), deleted_by: actor.userId });
  }

  async reopenClosingBatch(actor: RepoActor, id: string, _reason?: string): Promise<PayrollClosingBatch> {
    const current = batches.find((b) => b.id === id);
    const newStatus: PayrollClosingBatch['status'] = current?.status === 'cancelled' ? 'imported' : 'reviewed';
    return this.patch(id, { status: newStatus, deleted_at: undefined, deleted_by: undefined, cancellation_reason: undefined, reopened_at: now(), reopened_by: actor.userId });
  }

  async deleteClosingBatch(actor: RepoActor, id: string): Promise<DeleteBatchResult> {
    const batch = batches.find((b) => b.id === id && b.organization_id === actor.organizationId);
    if (!batch) return { ok: false, error: 'Fechamento não encontrado.' };
    if (batch.finance_batch_id) return { ok: false, error: 'Possui lote no Financeiro — exclusão bloqueada.' };
    if (batch.status === 'posted') return { ok: false, error: 'Lançado no ledger — exclusão bloqueada.' };
    const attIds = new Set(attachments.filter((a) => a.batch_id === id).map((a) => a.id));
    attIds.forEach((aid) => blobs.delete(aid));
    attachments = attachments.filter((a) => a.batch_id !== id);
    importFiles = importFiles.filter((f) => f.batch_id !== id);
    reports = reports.filter((r) => r.batch_id !== id);
    const pkgIds = new Set(packages.filter((p) => p.batch_id === id).map((p) => p.id));
    packages = packages.filter((p) => p.batch_id !== id);
    dispatches = dispatches.filter((d) => !pkgIds.has(d.package_id));
    batches = batches.filter((b) => b.id !== id);
    return { ok: true };
  }

  async removeAttachment(_actor: RepoActor, batchId: string, attachmentId: string): Promise<RemoveAttachmentResult> {
    const att = attachments.find((a) => a.id === attachmentId && a.batch_id === batchId);
    if (!att) return { ok: false, error: 'Anexo não encontrado.' };
    blobs.delete(attachmentId);
    attachments = attachments.filter((a) => a.id !== attachmentId);
    importFiles = importFiles.filter((f) => !(f.batch_id === batchId && f.storage_path === att.storage_path));
    packages = packages.map((p) => p.batch_id === batchId && p.attachment_ids.includes(attachmentId)
      ? { ...p, attachment_ids: p.attachment_ids.filter((x) => x !== attachmentId) } : p);
    return { ok: true, file_type: att.file_type, was_payroll_spreadsheet: att.file_type === 'payroll_spreadsheet' };
  }

  async invalidateParse(_actor: RepoActor, id: string): Promise<PayrollClosingBatch> {
    reports = reports.filter((r) => r.batch_id !== id);
    attachments = attachments.filter((a) => !(a.batch_id === id && a.storage_path.includes('/generated/')));
    return this.patch(id, { status: 'imported', total_amount_cents: 0, previous_month_amount_cents: 0, variation_amount_cents: 0, variation_percentage: 0 });
  }

  // ── Finance cost centers ────────────────────────────────────
  async listFinanceCostCenters(actor: RepoActor): Promise<FinanceCostCenterRecord[]> {
    if (!financeCostCenters.some((c) => c.organization_id === actor.organizationId)) {
      // Lazy-seed the standard set for this org on first read.
      for (const s of SEED_COST_CENTERS) {
        financeCostCenters.push({
          id: uid('fcc'), organization_id: actor.organizationId, code: s.code, name: s.name,
          active: true, created_at: now(), updated_at: now(),
        });
      }
    }
    return financeCostCenters.filter((c) => c.organization_id === actor.organizationId && c.active);
  }

  async createFinanceCostCenter(actor: RepoActor, input: CreateFinanceCostCenterInput): Promise<FinanceCostCenterRecord> {
    const base = (input.code || input.name).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'CC';
    let code = base; let n = 1;
    while (financeCostCenters.some((c) => c.organization_id === actor.organizationId && c.code === code)) code = `${base}-${++n}`;
    const cc: FinanceCostCenterRecord = {
      id: uid('fcc'), organization_id: actor.organizationId, code, name: input.name.trim(),
      active: true, created_at: now(), updated_at: now(),
    };
    financeCostCenters = [cc, ...financeCostCenters];
    return cc;
  }

  // ── Cost-center mapping aliases ─────────────────────────────
  async listCostCenterMappings(actor: RepoActor): Promise<PayrollCostCenterMapping[]> {
    return mappings.filter((m) => m.organization_id === actor.organizationId);
  }

  async upsertCostCenterMapping(actor: RepoActor, input: UpsertCostCenterMappingInput): Promise<PayrollCostCenterMapping> {
    const idx = mappings.findIndex((m) => m.organization_id === actor.organizationId && m.normalized_name === input.normalized_name);
    if (idx !== -1) {
      mappings[idx] = {
        ...mappings[idx], imported_name: input.imported_name, cost_center_id: input.cost_center_id,
        confidence: input.confidence ?? 1, updated_by: actor.userId, updated_at: now(),
      };
      return mappings[idx];
    }
    const record: PayrollCostCenterMapping = {
      id: uid('pccm'), organization_id: actor.organizationId,
      imported_name: input.imported_name, normalized_name: input.normalized_name,
      cost_center_id: input.cost_center_id, confidence: input.confidence ?? 1,
      created_by: actor.userId, updated_by: actor.userId, created_at: now(), updated_at: now(),
    };
    mappings = [record, ...mappings];
    return record;
  }

  async saveCostCenterMappings(actor: RepoActor, inputs: UpsertCostCenterMappingInput[]): Promise<PayrollCostCenterMapping[]> {
    const out: PayrollCostCenterMapping[] = [];
    for (const input of inputs) out.push(await this.upsertCostCenterMapping(actor, input));
    return out;
  }

  async deleteCostCenterMapping(actor: RepoActor, id: string): Promise<void> {
    mappings = mappings.filter((m) => !(m.id === id && m.organization_id === actor.organizationId));
  }

  async listFinancePayrollBatches(_actor: RepoActor, _filters?: { periodKey?: string }): Promise<FinancePayrollBatchRecord[]> {
    // Mock mode keeps no persisted finance batches — the client-side in-memory
    // finance store (with its mock seed + injectPayrollBatch mirror) is the
    // source of truth there, so there is nothing to hydrate from the server.
    return [];
  }

  async listApprovedBatches(actor: RepoActor): Promise<PayrollClosingBatchApproved[]> {
    const all = await this.listClosingBatches(actor);
    return all
      .filter((b) => b.status === 'approved' || b.status === 'sent_to_finance')
      .map((b) => ({ ...b, headcount: 0, cost_center_summaries: [] }));
  }
}
