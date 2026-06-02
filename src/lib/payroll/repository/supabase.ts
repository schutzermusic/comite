/**
 * Supabase-backed payroll closing repository (SERVER ONLY).
 *
 * Uses the service-role client for Storage + Postgres. Tenant isolation is
 * enforced in code by always scoping queries to actor.organizationId; the
 * calling API route is responsible for the auth + permission check
 * (requireApiPermission) before invoking these methods. The service role key
 * is never exposed to the client.
 *
 * Every meaningful action also writes an audit_logs row.
 */

if (typeof window !== 'undefined') {
  throw new Error('payroll/repository/supabase.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/ai/server-clients';
import type {
  PayrollAttachment, PayrollClosingBatch, PayrollClosingBatchApproved,
  PayrollCostCenterMapping, PayrollEmailDispatch, PayrollEmailPackage,
  PayrollGeneratedReport, PayrollImportFile, PayrollParseResult,
} from '@/lib/types/payroll-closing';
import {
  GENERATED_BUCKET, IMPORT_TYPE_MAP,
  type AttachmentBytes, type AuditInput, type CreateBatchInput, type CreateFinanceCostCenterInput,
  type CreatePackageInput, type DeleteBatchResult, type FinanceCostCenterRecord, type FinancePayrollBatchRecord,
  type GeneratedAttachmentInput, type PayrollRepository,
  type RecordDispatchInput, type RemoveAttachmentResult, type RepoActor,
  type SaveReportInput, type SendToFinanceOptions, type SendToFinanceResult,
  type UpdateBatchInput, type UpsertCostCenterMappingInput, type UploadFileInput,
} from './types';

/** Slugify a name into a stable cost-center code (uppercase, hyphenated). */
function slugCode(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'CC';
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || 'file';
}

function checksum(name: string, size: number): string {
  let h = 0;
  const s = `${name}:${size}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// ── Row → domain mappers ────────────────────────────────────
function mapBatch(r: any): PayrollClosingBatch {
  return {
    id: r.id,
    organization_id: r.organization_id,
    competence_month: r.competence_month,
    total_amount_cents: Number(r.total_amount_cents ?? 0),
    previous_month_amount_cents: Number(r.previous_month_amount_cents ?? 0),
    variation_amount_cents: Number(r.variation_amount_cents ?? 0),
    variation_percentage: Number(r.variation_percentage ?? 0),
    payment_deadline: r.payment_deadline ?? undefined,
    status: r.status,
    created_by: r.created_by ?? '',
    approved_by: r.approved_by ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
    finance_batch_id: r.finance_batch_id ?? undefined,
    deleted_at: r.deleted_at ?? undefined,
    deleted_by: r.deleted_by ?? undefined,
    cancellation_reason: r.cancellation_reason ?? undefined,
    reopened_at: r.reopened_at ?? undefined,
    reopened_by: r.reopened_by ?? undefined,
  };
}
function mapImportFile(r: any): PayrollImportFile {
  return {
    id: r.id, batch_id: r.batch_id, file_name: r.file_name, file_type: r.file_type,
    storage_path: `${r.storage_bucket}/${r.object_path}`, mime_type: r.mime_type ?? '',
    file_size: Number(r.file_size ?? 0), checksum: r.checksum ?? '', uploaded_by: r.uploaded_by ?? '',
    created_at: r.created_at, metadata: r.metadata ?? undefined,
  };
}
function mapAttachment(r: any): PayrollAttachment {
  return {
    id: r.id, batch_id: r.batch_id, file_name: r.file_name, file_type: r.file_type,
    security_level: r.security_level, storage_path: `${r.storage_bucket}/${r.object_path}`,
    file_size: Number(r.file_size ?? 0), mime_type: r.mime_type ?? '', checksum: r.checksum ?? '',
    uploaded_by: r.uploaded_by ?? '', approved_by: r.approved_by ?? undefined,
    created_at: r.created_at, metadata: r.metadata ?? undefined,
  };
}
function mapReport(r: any): PayrollGeneratedReport {
  return {
    id: r.id, batch_id: r.batch_id, report_type: r.report_type, generated_text: r.generated_text ?? '',
    generated_html: r.generated_html ?? '', status: r.status, generated_by_ai: !!r.generated_by_ai,
    reviewed_by: r.reviewed_by ?? undefined, approved_by: r.approved_by ?? undefined,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}
function mapPackage(r: any): PayrollEmailPackage {
  return {
    id: r.id, batch_id: r.batch_id, audience: r.audience, subject: r.subject,
    html_body: r.html_body ?? '', attachment_ids: r.attachment_ids ?? [], status: r.status,
    created_by: r.created_by ?? '', approved_by: r.approved_by ?? undefined,
    sent_by: r.sent_by ?? undefined, sent_at: r.sent_at ?? undefined,
  };
}
function mapFinanceBatch(r: any): FinancePayrollBatchRecord {
  return {
    id: r.id,
    period_key: r.period_key,
    business_unit_id: r.business_unit_id ?? '',
    total_gross_cents: Number(r.total_gross_cents ?? 0),
    total_charges_cents: Number(r.total_charges_cents ?? 0),
    total_benefits_cents: Number(r.total_benefits_cents ?? 0),
    headcount: Number(r.headcount ?? 0),
    status: r.status,
    evidence_url: r.evidence_url ?? undefined,
    notes: r.notes ?? undefined,
    source_system: r.source_system ?? 'manual',
    created_by: r.created_by ?? '',
    approved_by: r.approved_by ?? undefined,
    approved_at: r.approved_at ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
function mapFinanceCostCenter(r: any): FinanceCostCenterRecord {
  return {
    id: r.id, organization_id: r.organization_id, code: r.code, name: r.name,
    active: !!r.active, created_at: r.created_at, updated_at: r.updated_at,
  };
}
function mapMapping(r: any): PayrollCostCenterMapping {
  return {
    id: r.id,
    organization_id: r.organization_id,
    imported_name: r.imported_name,
    normalized_name: r.normalized_name,
    cost_center_id: r.cost_center_id,
    confidence: Number(r.confidence ?? 1),
    created_by: r.created_by ?? '',
    updated_by: r.updated_by ?? '',
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}
function mapDispatch(r: any): PayrollEmailDispatch {
  return {
    id: r.id, package_id: r.package_id, recipients: r.recipients ?? [], cc: r.cc ?? [], bcc: r.bcc ?? [],
    delivery_status: r.delivery_status, provider_message_id: r.provider_message_id ?? undefined,
    error_message: r.error_message ?? undefined, attachments_sent: r.attachments_sent ?? [],
    created_at: r.created_at, sent_at: r.sent_at ?? undefined,
  };
}

export class SupabasePayrollRepository implements PayrollRepository {
  readonly mode = 'supabase' as const;
  private db: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.db = client ?? getServiceClient();
  }

  async writeAudit(actor: RepoActor, input: AuditInput): Promise<void> {
    await this.db.from('audit_logs').insert({
      organization_id: actor.organizationId,
      actor_user_id: actor.userId,
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      metadata: input.metadata ?? {},
    });
  }

  async createClosingBatch(actor: RepoActor, input: CreateBatchInput): Promise<PayrollClosingBatch> {
    const { data, error } = await this.db
      .from('payroll_closing_batches')
      .insert({
        organization_id: actor.organizationId,
        competence_month: input.competence_month,
        payment_deadline: input.payment_deadline ?? null,
        status: 'imported',
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .select('*')
      .single();
    if (error) throw new Error(`createClosingBatch: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: data.id, action: 'created', metadata: { competence_month: input.competence_month } });
    return mapBatch(data);
  }

  async getClosingBatch(actor: RepoActor, id: string): Promise<PayrollClosingBatch | null> {
    const { data, error } = await this.db
      .from('payroll_closing_batches').select('*')
      .eq('id', id).eq('organization_id', actor.organizationId).maybeSingle();
    if (error) throw new Error(`getClosingBatch: ${error.message}`);
    return data ? mapBatch(data) : null;
  }

  async listClosingBatches(actor: RepoActor): Promise<PayrollClosingBatch[]> {
    const { data, error } = await this.db
      .from('payroll_closing_batches').select('*')
      .eq('organization_id', actor.organizationId).order('created_at', { ascending: false });
    if (error) throw new Error(`listClosingBatches: ${error.message}`);
    return (data ?? []).map(mapBatch);
  }

  async addImportFile(actor: RepoActor, batchId: string, input: UploadFileInput) {
    const map = IMPORT_TYPE_MAP[input.file_type];
    const safe = sanitize(input.file_name);
    const objectPath = `${actor.organizationId}/${batchId}/${input.file_type}/${Date.now()}-${safe}`;
    const sum = checksum(input.file_name, input.bytes.length);

    const up = await this.db.storage.from(map.bucket).upload(objectPath, input.bytes, {
      contentType: input.mime_type, upsert: true,
    });
    if (up.error) throw new Error(`storage upload: ${up.error.message}`);

    const { data: impRow, error: impErr } = await this.db.from('payroll_import_files').insert({
      organization_id: actor.organizationId, batch_id: batchId, file_name: input.file_name,
      file_type: input.file_type, storage_bucket: map.bucket, object_path: objectPath,
      mime_type: input.mime_type, file_size: input.bytes.length, checksum: sum,
      uploaded_by: actor.userId, created_by: actor.userId,
    }).select('*').single();
    if (impErr) throw new Error(`insert import_file: ${impErr.message}`);

    const { data: attRow, error: attErr } = await this.db.from('payroll_attachments').insert({
      organization_id: actor.organizationId, batch_id: batchId, file_name: input.file_name,
      file_type: map.attachment_type, security_level: map.security_level, storage_bucket: map.bucket,
      object_path: objectPath, mime_type: input.mime_type, file_size: input.bytes.length, checksum: sum,
      uploaded_by: actor.userId, created_by: actor.userId,
    }).select('*').single();
    if (attErr) throw new Error(`insert attachment: ${attErr.message}`);

    await this.writeAudit(actor, {
      entity_type: 'payroll_import_file', entity_id: impRow.id, action: 'uploaded',
      metadata: { file_type: input.file_type, file_name: input.file_name, bucket: map.bucket, security_level: map.security_level },
    });
    return { importFile: mapImportFile(impRow), attachment: mapAttachment(attRow) };
  }

  async addGeneratedAttachment(actor: RepoActor, batchId: string, input: GeneratedAttachmentInput): Promise<PayrollAttachment> {
    const safe = sanitize(input.file_name);
    const objectPath = `${actor.organizationId}/${batchId}/generated/${input.file_type}-${Date.now()}-${safe}`;
    const up = await this.db.storage.from(GENERATED_BUCKET).upload(objectPath, input.bytes, {
      contentType: input.mime_type, upsert: true,
    });
    if (up.error) throw new Error(`storage upload (generated): ${up.error.message}`);

    // Replace any previous generated attachment of the same type for this batch.
    await this.db.from('payroll_attachments').delete()
      .eq('batch_id', batchId).eq('file_type', input.file_type).like('object_path', `%/generated/%`);

    const { data, error } = await this.db.from('payroll_attachments').insert({
      organization_id: actor.organizationId, batch_id: batchId, file_name: input.file_name,
      file_type: input.file_type, security_level: input.security_level ?? 'aggregate',
      storage_bucket: GENERATED_BUCKET, object_path: objectPath, mime_type: input.mime_type,
      file_size: input.bytes.length, checksum: checksum(input.file_name, input.bytes.length),
      uploaded_by: actor.userId, created_by: actor.userId,
    }).select('*').single();
    if (error) throw new Error(`insert generated attachment: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'payroll_attachment', entity_id: data.id, action: 'generated', metadata: { file_type: input.file_type } });
    return mapAttachment(data);
  }

  async getAttachments(actor: RepoActor, batchId: string): Promise<PayrollAttachment[]> {
    const { data, error } = await this.db.from('payroll_attachments').select('*')
      .eq('batch_id', batchId).eq('organization_id', actor.organizationId).order('created_at', { ascending: false });
    if (error) throw new Error(`getAttachments: ${error.message}`);
    return (data ?? []).map(mapAttachment);
  }

  async getAttachmentBytes(actor: RepoActor, attachmentId: string): Promise<AttachmentBytes | null> {
    const { data: row, error } = await this.db.from('payroll_attachments').select('*')
      .eq('id', attachmentId).eq('organization_id', actor.organizationId).maybeSingle();
    if (error) throw new Error(`getAttachmentBytes meta: ${error.message}`);
    if (!row) return null;
    const dl = await this.db.storage.from(row.storage_bucket).download(row.object_path);
    if (dl.error || !dl.data) throw new Error(`storage download: ${dl.error?.message ?? 'no data'}`);
    const bytes = Buffer.from(await dl.data.arrayBuffer());
    return {
      bytes, file_name: row.file_name, mime_type: row.mime_type ?? 'application/octet-stream',
      file_size: Number(row.file_size ?? bytes.length), security_level: row.security_level, file_type: row.file_type,
    };
  }

  async saveParsedPayrollData(actor: RepoActor, batchId: string, parse: PayrollParseResult): Promise<PayrollClosingBatch> {
    const hasError = parse.flags.some((f) => f.severity === 'error');
    const { data, error } = await this.db.from('payroll_closing_batches').update({
      competence_month: parse.competence_month || undefined,
      total_amount_cents: parse.total_amount_cents,
      previous_month_amount_cents: parse.previous_month_amount_cents,
      variation_amount_cents: parse.variation_amount_cents,
      variation_percentage: parse.variation_percentage,
      gross_amount_cents: parse.gross_amount_cents ?? null,
      charges_amount_cents: parse.charges_amount_cents ?? null,
      benefits_amount_cents: parse.benefits_amount_cents ?? null,
      headcount: parse.headcount ?? null,
      payment_deadline: parse.payment_deadline ?? undefined,
      status: hasError ? 'imported' : 'validated',
      updated_by: actor.userId,
    }).eq('id', batchId).eq('organization_id', actor.organizationId).select('*').single();
    if (error) throw new Error(`saveParsedPayrollData: ${error.message}`);

    // Replace detail rows.
    await Promise.all([
      this.db.from('payroll_cost_center_summaries').delete().eq('batch_id', batchId),
      this.db.from('payroll_employee_lines').delete().eq('batch_id', batchId),
      this.db.from('payroll_bank_payment_lines').delete().eq('batch_id', batchId),
      this.db.from('payroll_validation_flags').delete().eq('batch_id', batchId),
    ]);
    const org = actor.organizationId;
    if (parse.cost_centers.length) {
      await this.db.from('payroll_cost_center_summaries').insert(parse.cost_centers.map((c) => ({
        organization_id: org, batch_id: batchId, cost_center_label: c.cost_center_label,
        matched_cost_center_id: c.cost_center_id ?? null, amount_cents: c.amount_cents,
        previous_amount_cents: c.previous_amount_cents ?? null, variation_amount_cents: c.variation_amount_cents ?? null,
        variation_percentage: c.variation_percentage ?? null, created_by: actor.userId,
      })));
    }
    if (parse.employees.length) {
      await this.db.from('payroll_employee_lines').insert(parse.employees.map((e) => ({
        organization_id: org, batch_id: batchId, employee_name: e.employee_name,
        cost_center_label: e.cost_center_label ?? null, contract_type: e.contract_type ?? null,
        gross_amount_cents: e.gross_amount_cents, net_amount_cents: e.net_amount_cents ?? null, created_by: actor.userId,
      })));
    }
    if (parse.bank_lines.length) {
      await this.db.from('payroll_bank_payment_lines').insert(parse.bank_lines.map((b) => ({
        organization_id: org, batch_id: batchId, beneficiary: b.beneficiary, bank: b.bank ?? null,
        branch: b.branch ?? null, account: b.account ?? null, amount_cents: b.amount_cents, created_by: actor.userId,
      })));
    }
    if (parse.flags.length) {
      await this.db.from('payroll_validation_flags').insert(parse.flags.map((f) => ({
        organization_id: org, batch_id: batchId, severity: f.severity, code: f.code, message: f.message, created_by: actor.userId,
      })));
    }
    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: batchId, action: 'parsed', metadata: { sheets: parse.detected_sheets.length, cost_centers: parse.cost_centers.length, reconciled: parse.reconciled } });
    return mapBatch(data);
  }

  async saveGeneratedReport(actor: RepoActor, batchId: string, input: SaveReportInput): Promise<PayrollGeneratedReport> {
    const { data, error } = await this.db.from('payroll_generated_reports').upsert({
      organization_id: actor.organizationId, batch_id: batchId, report_type: input.report_type,
      generated_text: input.generated_text, generated_html: input.generated_html,
      generated_by_ai: input.generated_by_ai, status: 'draft', created_by: actor.userId, updated_by: actor.userId,
    }, { onConflict: 'batch_id,report_type' }).select('*').single();
    if (error) throw new Error(`saveGeneratedReport: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'payroll_report', entity_id: data.id, action: 'generated', metadata: { report_type: input.report_type, by_ai: input.generated_by_ai } });
    return mapReport(data);
  }

  async createEmailPackage(actor: RepoActor, batchId: string, input: CreatePackageInput): Promise<PayrollEmailPackage> {
    const { data, error } = await this.db.from('payroll_email_packages').insert({
      organization_id: actor.organizationId, batch_id: batchId, audience: input.audience,
      subject: input.subject, html_body: input.html_body, attachment_ids: input.attachment_ids,
      status: 'draft', created_by: actor.userId, updated_by: actor.userId,
    }).select('*').single();
    if (error) throw new Error(`createEmailPackage: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'payroll_email_package', entity_id: data.id, action: 'created', metadata: { audience: input.audience, attachments: input.attachment_ids.length } });
    return mapPackage(data);
  }

  async recordDispatch(actor: RepoActor, input: RecordDispatchInput): Promise<PayrollEmailDispatch> {
    const now = new Date().toISOString();
    const { data: pkg } = await this.db.from('payroll_email_packages').select('organization_id').eq('id', input.package_id).maybeSingle();
    const orgId = pkg?.organization_id ?? actor.organizationId;
    const { data, error } = await this.db.from('payroll_email_dispatches').insert({
      organization_id: orgId, package_id: input.package_id, recipients: input.recipients,
      cc: input.cc ?? [], bcc: input.bcc ?? [], delivery_status: input.delivery_status,
      provider_message_id: input.provider_message_id ?? null, error_message: input.error_message ?? null,
      attachments_sent: input.attachments_sent, created_by: actor.userId,
      sent_at: input.delivery_status === 'failed' ? null : now,
    }).select('*').single();
    if (error) throw new Error(`recordDispatch: ${error.message}`);

    const pkgStatus = input.delivery_status === 'failed' ? 'failed' : 'sent';
    await this.db.from('payroll_email_packages').update({ status: pkgStatus, sent_by: actor.userId, sent_at: now, updated_by: actor.userId }).eq('id', input.package_id);
    await this.writeAudit(actor, {
      entity_type: 'payroll_email_dispatch', entity_id: data.id, action: input.delivery_status,
      metadata: { recipients: input.recipients.length, attachments: input.attachments_sent },
    });
    return mapDispatch(data);
  }

  async getDispatches(actor: RepoActor, batchId: string): Promise<PayrollEmailDispatch[]> {
    const { data: pkgs } = await this.db.from('payroll_email_packages').select('id').eq('batch_id', batchId).eq('organization_id', actor.organizationId);
    const ids = (pkgs ?? []).map((p: { id: string }) => p.id);
    if (ids.length === 0) return [];
    const { data, error } = await this.db.from('payroll_email_dispatches').select('*').in('package_id', ids).order('created_at', { ascending: false });
    if (error) throw new Error(`getDispatches: ${error.message}`);
    return (data ?? []).map(mapDispatch);
  }

  async approveClosingBatch(actor: RepoActor, id: string): Promise<PayrollClosingBatch> {
    const { data, error } = await this.db.from('payroll_closing_batches').update({
      status: 'approved', approved_by: actor.userId, updated_by: actor.userId,
    }).eq('id', id).eq('organization_id', actor.organizationId).select('*').single();
    if (error) throw new Error(`approveClosingBatch: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: id, action: 'approved' });
    return mapBatch(data);
  }

  async sendToFinance(actor: RepoActor, id: string, options: SendToFinanceOptions = {}): Promise<SendToFinanceResult> {
    const batch = await this.getClosingBatch(actor, id);
    if (!batch) return { ok: false, error: 'Fechamento não encontrado.' };
    if (batch.finance_batch_id) return { ok: false, error: 'Já enviado ao Financeiro (anti-duplicidade).', finance_batch_id: batch.finance_batch_id };
    if (batch.status !== 'approved') return { ok: false, error: 'Aprove o fechamento antes de enviar ao Financeiro.' };

    // Required-mapping gate: block when any parsed cost center has no
    // matched_cost_center_id, unless an authorized override is supplied (the
    // API route verifies admin / people.payroll_override_mapping before setting
    // options.override). The override + reason are recorded in the audit log.
    const { count: unmappedCount } = await this.db
      .from('payroll_cost_center_summaries')
      .select('id', { count: 'exact', head: true })
      .eq('batch_id', id).eq('organization_id', actor.organizationId)
      .is('matched_cost_center_id', null);
    const unmapped = unmappedCount ?? 0;
    if (unmapped > 0 && !options.override) {
      return {
        ok: false,
        code: 'unmapped_cost_centers',
        unmapped_count: unmapped,
        error: `${unmapped} centro(s) de custo não vinculado(s) ao Financeiro. Vincule ou solicite override autorizado.`,
      };
    }

    // Determine gross/charges/benefits split.
    const { data: full } = await this.db.from('payroll_closing_batches')
      .select('gross_amount_cents, charges_amount_cents, benefits_amount_cents, headcount, competence_month, total_amount_cents')
      .eq('id', id).single();
    const total = Number(full?.total_amount_cents ?? batch.total_amount_cents);
    let gross = Number(full?.gross_amount_cents ?? 0);
    let charges = Number(full?.charges_amount_cents ?? 0);
    let benefits = Number(full?.benefits_amount_cents ?? 0);
    let note = `Originado do Fechamento da Folha ${id} (competência ${batch.competence_month}).`;
    if (gross + charges + benefits !== total || total === 0) {
      gross = total; charges = 0; benefits = 0;
      note += ' Planilha não separou encargos/benefícios — total lançado em bruto.';
    }

    // First active business unit (finance payroll_batch requires one).
    const { data: bu } = await this.db.from('business_unit').select('id').eq('active', true).order('code').limit(1).maybeSingle();
    if (!bu?.id) return { ok: false, error: 'Nenhuma unidade de negócio cadastrada no Financeiro.' };

    const { data: fb, error: fbErr } = await this.db.from('payroll_batch').insert({
      period_key: batch.competence_month, business_unit_id: bu.id,
      total_gross_cents: gross, total_charges_cents: charges, total_benefits_cents: benefits,
      headcount: Number(full?.headcount ?? 0), status: 'approved', source_system: 'payroll_close',
      notes: note, created_by: actor.userId, approved_by: actor.userId, approved_at: new Date().toISOString(),
    }).select('id').single();
    if (fbErr) return { ok: false, error: `Falha ao criar PayrollBatch: ${fbErr.message}` };

    const { data: updated, error: upErr } = await this.db.from('payroll_closing_batches').update({
      status: 'sent_to_finance', finance_batch_id: fb.id, updated_by: actor.userId,
    }).eq('id', id).select('*').single();
    if (upErr) throw new Error(`sendToFinance update: ${upErr.message}`);

    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: id, action: 'sent_to_finance', metadata: { finance_batch_id: fb.id } });
    if (unmapped > 0 && options.override) {
      await this.writeAudit(actor, {
        entity_type: 'payroll_closing', entity_id: id, action: 'sent_to_finance_override',
        metadata: { finance_batch_id: fb.id, unmapped_count: unmapped, reason: options.overrideReason ?? '' },
      });
    }
    return { ok: true, batch: mapBatch(updated), finance_batch_id: fb.id };
  }

  // ── Lifecycle: edit / cancel / reopen / delete ──────────────
  async updateClosingBatch(actor: RepoActor, id: string, patch: UpdateBatchInput): Promise<PayrollClosingBatch> {
    const update: Record<string, unknown> = { updated_by: actor.userId };
    if (patch.competence_month !== undefined) update.competence_month = patch.competence_month;
    if (patch.payment_deadline !== undefined) update.payment_deadline = patch.payment_deadline;
    if (patch.notes !== undefined) update.notes = patch.notes;
    const { data, error } = await this.db.from('payroll_closing_batches')
      .update(update).eq('id', id).eq('organization_id', actor.organizationId).select('*').single();
    if (error) throw new Error(`updateClosingBatch: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: id, action: 'edited', metadata: { fields: Object.keys(patch) } });
    return mapBatch(data);
  }

  async cancelClosingBatch(actor: RepoActor, id: string, reason?: string): Promise<PayrollClosingBatch> {
    const before = await this.getClosingBatch(actor, id);
    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: id, action: 'cancelled', metadata: { old_status: before?.status, reason: reason ?? '', finance_batch_id: before?.finance_batch_id ?? null } });
    const { data, error } = await this.db.from('payroll_closing_batches').update({
      status: 'cancelled', cancellation_reason: reason ?? null,
      deleted_at: new Date().toISOString(), deleted_by: actor.userId, updated_by: actor.userId,
    }).eq('id', id).eq('organization_id', actor.organizationId).select('*').single();
    if (error) throw new Error(`cancelClosingBatch: ${error.message}`);
    return mapBatch(data);
  }

  async reopenClosingBatch(actor: RepoActor, id: string, reason?: string): Promise<PayrollClosingBatch> {
    const before = await this.getClosingBatch(actor, id);
    // Reopen to the last editable state. sent_to_finance/approved → 'reviewed';
    // a cancelled batch → 'imported' (it was a soft-delete). finance_batch_id is
    // intentionally KEPT so the anti-duplication guard still blocks a re-send
    // until the finance side is reconciled.
    const newStatus = before?.status === 'cancelled' ? 'imported' : 'reviewed';
    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: id, action: 'reopened', metadata: { old_status: before?.status, new_status: newStatus, reason: reason ?? '', finance_batch_id: before?.finance_batch_id ?? null } });
    const { data, error } = await this.db.from('payroll_closing_batches').update({
      status: newStatus, deleted_at: null, deleted_by: null, cancellation_reason: null,
      reopened_at: new Date().toISOString(), reopened_by: actor.userId, updated_by: actor.userId,
    }).eq('id', id).eq('organization_id', actor.organizationId).select('*').single();
    if (error) throw new Error(`reopenClosingBatch: ${error.message}`);
    return mapBatch(data);
  }

  async deleteClosingBatch(actor: RepoActor, id: string): Promise<DeleteBatchResult> {
    const batch = await this.getClosingBatch(actor, id);
    if (!batch) return { ok: false, error: 'Fechamento não encontrado.' };
    if (batch.finance_batch_id) return { ok: false, error: 'Possui lote no Financeiro — cancele/reabra (exclusão bloqueada).' };
    if (batch.status === 'posted') return { ok: false, error: 'Lançado no ledger — exclusão bloqueada.' };

    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: id, action: 'deleted', metadata: { old_status: batch.status, competence_month: batch.competence_month } });

    // Delete Storage objects first (best-effort), grouped by bucket.
    const { data: atts } = await this.db.from('payroll_attachments')
      .select('storage_bucket, object_path').eq('batch_id', id).eq('organization_id', actor.organizationId);
    const byBucket = new Map<string, string[]>();
    for (const a of (atts ?? []) as Array<{ storage_bucket: string; object_path: string }>) {
      if (!a.storage_bucket || !a.object_path) continue;
      const arr = byBucket.get(a.storage_bucket) ?? [];
      arr.push(a.object_path);
      byBucket.set(a.storage_bucket, arr);
    }
    for (const [bucket, paths] of byBucket) {
      if (paths.length) await this.db.storage.from(bucket).remove(paths);
    }

    // Delete child rows (FKs are ON DELETE CASCADE from payroll_closing_batches,
    // but we remove explicitly so the operation is auditable and bucket-safe).
    const child = [
      'payroll_email_dispatches', 'payroll_email_packages', 'payroll_generated_reports',
      'payroll_attachments', 'payroll_import_files', 'payroll_cost_center_summaries',
      'payroll_employee_lines', 'payroll_bank_payment_lines', 'payroll_validation_flags',
    ];
    // Dispatches reference packages, not the batch — delete via the batch's packages.
    const { data: pkgs } = await this.db.from('payroll_email_packages').select('id').eq('batch_id', id);
    const pkgIds = (pkgs ?? []).map((p: { id: string }) => p.id);
    if (pkgIds.length) await this.db.from('payroll_email_dispatches').delete().in('package_id', pkgIds);
    for (const table of child) {
      if (table === 'payroll_email_dispatches') continue;
      await this.db.from(table).delete().eq('batch_id', id);
    }
    const { error } = await this.db.from('payroll_closing_batches').delete().eq('id', id).eq('organization_id', actor.organizationId);
    if (error) throw new Error(`deleteClosingBatch: ${error.message}`);
    return { ok: true };
  }

  async removeAttachment(actor: RepoActor, batchId: string, attachmentId: string): Promise<RemoveAttachmentResult> {
    const { data: att, error: selErr } = await this.db.from('payroll_attachments')
      .select('*').eq('id', attachmentId).eq('organization_id', actor.organizationId).maybeSingle();
    if (selErr) throw new Error(`removeAttachment select: ${selErr.message}`);
    if (!att) return { ok: false, error: 'Anexo não encontrado.' };

    if (att.storage_bucket && att.object_path) {
      await this.db.storage.from(att.storage_bucket).remove([att.object_path]);
    }
    await this.db.from('payroll_attachments').delete().eq('id', attachmentId);
    // Remove the paired import-file row (uploads share the object_path).
    if (att.object_path) await this.db.from('payroll_import_files').delete().eq('batch_id', batchId).eq('object_path', att.object_path);
    // Drop the attachment id from any email package selection.
    const { data: pkgs } = await this.db.from('payroll_email_packages').select('id, attachment_ids').eq('batch_id', batchId);
    for (const p of (pkgs ?? []) as Array<{ id: string; attachment_ids: string[] }>) {
      if ((p.attachment_ids ?? []).includes(attachmentId)) {
        await this.db.from('payroll_email_packages').update({ attachment_ids: p.attachment_ids.filter((x) => x !== attachmentId), updated_by: actor.userId }).eq('id', p.id);
      }
    }
    const wasPayroll = att.file_type === 'payroll_spreadsheet';
    await this.writeAudit(actor, {
      entity_type: 'payroll_attachment', entity_id: attachmentId, action: 'file_removed',
      metadata: { batch_id: batchId, file_type: att.file_type, file_name: att.file_name, sensitive: ['holerite', 'external_holerite', 'bank_payment_spreadsheet'].includes(att.file_type) },
    });
    return { ok: true, file_type: att.file_type, was_payroll_spreadsheet: wasPayroll };
  }

  async invalidateParse(actor: RepoActor, id: string): Promise<PayrollClosingBatch> {
    await Promise.all([
      this.db.from('payroll_cost_center_summaries').delete().eq('batch_id', id),
      this.db.from('payroll_employee_lines').delete().eq('batch_id', id),
      this.db.from('payroll_bank_payment_lines').delete().eq('batch_id', id),
      this.db.from('payroll_validation_flags').delete().eq('batch_id', id),
      this.db.from('payroll_generated_reports').delete().eq('batch_id', id),
    ]);
    // Drop generated artifacts (executive PDF / dashboard) — they are now stale.
    const { data: gen } = await this.db.from('payroll_attachments')
      .select('id, storage_bucket, object_path').eq('batch_id', id).like('object_path', '%/generated/%');
    for (const g of (gen ?? []) as Array<{ id: string; storage_bucket: string; object_path: string }>) {
      if (g.storage_bucket && g.object_path) await this.db.storage.from(g.storage_bucket).remove([g.object_path]);
      await this.db.from('payroll_attachments').delete().eq('id', g.id);
    }
    const { data, error } = await this.db.from('payroll_closing_batches').update({
      status: 'imported', total_amount_cents: 0, previous_month_amount_cents: 0,
      variation_amount_cents: 0, variation_percentage: 0,
      gross_amount_cents: null, charges_amount_cents: null, benefits_amount_cents: null, headcount: null,
      updated_by: actor.userId,
    }).eq('id', id).eq('organization_id', actor.organizationId).select('*').single();
    if (error) throw new Error(`invalidateParse: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'payroll_closing', entity_id: id, action: 'parse_invalidated', metadata: {} });
    return mapBatch(data);
  }

  // ── Finance cost centers ────────────────────────────────────
  async listFinanceCostCenters(actor: RepoActor): Promise<FinanceCostCenterRecord[]> {
    const { data, error } = await this.db
      .from('finance_cost_centers').select('*')
      .eq('organization_id', actor.organizationId).eq('active', true)
      .order('name', { ascending: true });
    if (error) throw new Error(`listFinanceCostCenters: ${error.message}`);
    return (data ?? []).map(mapFinanceCostCenter);
  }

  async createFinanceCostCenter(actor: RepoActor, input: CreateFinanceCostCenterInput): Promise<FinanceCostCenterRecord> {
    const base = slugCode(input.code || input.name);
    // Resolve a unique code within the org (append -2, -3, … on collision).
    const { data: existing } = await this.db
      .from('finance_cost_centers').select('code')
      .eq('organization_id', actor.organizationId).like('code', `${base}%`);
    const taken = new Set((existing ?? []).map((r: { code: string }) => r.code));
    let code = base; let n = 1;
    while (taken.has(code)) code = `${base}-${++n}`;

    const { data, error } = await this.db
      .from('finance_cost_centers')
      .insert({ organization_id: actor.organizationId, code, name: input.name.trim(), created_by: actor.userId, updated_by: actor.userId })
      .select('*').single();
    if (error) throw new Error(`createFinanceCostCenter: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'finance_cost_center', entity_id: data.id, action: 'created', metadata: { code, name: input.name } });
    return mapFinanceCostCenter(data);
  }

  // ── Cost-center mapping aliases ─────────────────────────────
  async listCostCenterMappings(actor: RepoActor): Promise<PayrollCostCenterMapping[]> {
    const { data, error } = await this.db
      .from('payroll_cost_center_mappings').select('*')
      .eq('organization_id', actor.organizationId)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(`listCostCenterMappings: ${error.message}`);
    return (data ?? []).map(mapMapping);
  }

  async upsertCostCenterMapping(actor: RepoActor, input: UpsertCostCenterMappingInput): Promise<PayrollCostCenterMapping> {
    // Detect insert vs update for the audit action (conflict on org+normalized).
    const { data: existing } = await this.db
      .from('payroll_cost_center_mappings').select('id')
      .eq('organization_id', actor.organizationId).eq('normalized_name', input.normalized_name).maybeSingle();

    const { data, error } = await this.db
      .from('payroll_cost_center_mappings')
      .upsert({
        organization_id: actor.organizationId,
        imported_name: input.imported_name,
        normalized_name: input.normalized_name,
        cost_center_id: input.cost_center_id,
        confidence: input.confidence ?? 1,
        match_method: input.match_method ?? null,
        created_by: existing ? undefined : actor.userId,
        updated_by: actor.userId,
      }, { onConflict: 'organization_id,normalized_name' })
      .select('*').single();
    if (error) throw new Error(`upsertCostCenterMapping: ${error.message}`);

    await this.writeAudit(actor, {
      entity_type: 'payroll_cost_center_mapping', entity_id: data.id,
      action: existing ? 'updated' : 'created',
      metadata: { imported_name: input.imported_name, cost_center_id: input.cost_center_id, match_method: input.match_method ?? null },
    });
    return mapMapping(data);
  }

  async saveCostCenterMappings(actor: RepoActor, inputs: UpsertCostCenterMappingInput[]): Promise<PayrollCostCenterMapping[]> {
    const out: PayrollCostCenterMapping[] = [];
    for (const input of inputs) out.push(await this.upsertCostCenterMapping(actor, input));
    return out;
  }

  async deleteCostCenterMapping(actor: RepoActor, id: string): Promise<void> {
    const { error } = await this.db
      .from('payroll_cost_center_mappings').delete()
      .eq('id', id).eq('organization_id', actor.organizationId);
    if (error) throw new Error(`deleteCostCenterMapping: ${error.message}`);
    await this.writeAudit(actor, { entity_type: 'payroll_cost_center_mapping', entity_id: id, action: 'deleted' });
  }

  async listFinancePayrollBatches(_actor: RepoActor, filters?: { periodKey?: string }): Promise<FinancePayrollBatchRecord[]> {
    // The finance payroll_batch table is not organization-scoped (see migration
    // 001) — it mirrors the single-tenant finance ledger. We read it as-is,
    // exactly the rows sendToFinance (and manual entry) persist. Read-only: this
    // never creates ledger entries.
    let q = this.db.from('payroll_batch').select('*').order('created_at', { ascending: false });
    if (filters?.periodKey) q = q.eq('period_key', filters.periodKey);
    const { data, error } = await q;
    if (error) throw new Error(`listFinancePayrollBatches: ${error.message}`);
    return (data ?? []).map(mapFinanceBatch);
  }

  async listApprovedBatches(actor: RepoActor): Promise<PayrollClosingBatchApproved[]> {
    const { data, error } = await this.db
      .from('payroll_closing_batches')
      .select('*, payroll_cost_center_summaries(*)')
      .eq('organization_id', actor.organizationId)
      .in('status', ['approved', 'sent_to_finance'])
      .order('competence_month', { ascending: false });
    if (error) throw new Error(`listApprovedBatches: ${error.message}`);
    return (data ?? []).map((r: any) => ({
      ...mapBatch(r),
      headcount: Number(r.headcount ?? 0),
      cost_center_summaries: (r.payroll_cost_center_summaries ?? []).map((s: any) => ({
        cost_center_label: s.cost_center_label,
        matched_cost_center_id: s.matched_cost_center_id ?? null,
        amount_cents: Number(s.amount_cents ?? 0),
        previous_amount_cents: s.previous_amount_cents != null ? Number(s.previous_amount_cents) : null,
        variation_amount_cents: s.variation_amount_cents != null ? Number(s.variation_amount_cents) : null,
        variation_percentage: s.variation_percentage != null ? Number(s.variation_percentage) : null,
      })),
    }));
  }
}
