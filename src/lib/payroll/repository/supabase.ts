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
  PayrollAttachment, PayrollClosingBatch, PayrollEmailDispatch, PayrollEmailPackage,
  PayrollGeneratedReport, PayrollImportFile, PayrollParseResult,
} from '@/lib/types/payroll-closing';
import {
  GENERATED_BUCKET, IMPORT_TYPE_MAP,
  type AttachmentBytes, type AuditInput, type CreateBatchInput, type CreatePackageInput,
  type GeneratedAttachmentInput, type PayrollRepository, type RecordDispatchInput, type RepoActor,
  type SaveReportInput, type SendToFinanceResult, type UploadFileInput,
} from './types';

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

  async sendToFinance(actor: RepoActor, id: string): Promise<SendToFinanceResult> {
    const batch = await this.getClosingBatch(actor, id);
    if (!batch) return { ok: false, error: 'Fechamento não encontrado.' };
    if (batch.finance_batch_id) return { ok: false, error: 'Já enviado ao Financeiro (anti-duplicidade).', finance_batch_id: batch.finance_batch_id };
    if (batch.status !== 'approved') return { ok: false, error: 'Aprove o fechamento antes de enviar ao Financeiro.' };

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
    return { ok: true, batch: mapBatch(updated), finance_batch_id: fb.id };
  }
}
