import { createHash, randomUUID } from 'node:crypto';
import { getFiscalProvider } from '../provider';
import type { FiscalProviderDocument, FiscalProviderResult } from '../provider';
import type { FiscalDocument, FiscalTaxLine } from '../types';
import type { FiscalActor } from './actor';
import {
  FISCAL_DOCUMENT_BUCKET,
  appendFiscalEvent,
  enqueueFiscalJob,
  getFiscalServiceClient,
} from './store';

interface FiscalJobRow {
  id: string;
  organization_id: string;
  document_id: string;
  operation: 'issue' | 'consult' | 'cancel' | 'replace' | 'artifact' | 'finance_post' | 'finance_reverse';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';
  idempotency_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Falha desconhecida.';
  return message.replace(/(token|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]').slice(0, 500);
}

async function fetchDocumentBundle(job: FiscalJobRow) {
  const client = getFiscalServiceClient();
  const [documentResult, establishmentResult, configResult] = await Promise.all([
    client.from('fiscal_documents').select('*').eq('organization_id', job.organization_id).eq('id', job.document_id).single(),
    client.from('fiscal_documents').select('establishment_id').eq('id', job.document_id).single(),
    client.from('fiscal_provider_configs').select('*').eq('organization_id', job.organization_id).eq('enabled', true).limit(1).maybeSingle(),
  ]);
  if (documentResult.error || !documentResult.data) throw new Error('Documento fiscal da tarefa não encontrado.');
  if (establishmentResult.error || !establishmentResult.data) throw new Error('Estabelecimento da tarefa não encontrado.');
  const { data: establishment, error } = await client
    .from('fiscal_establishments')
    .select('*')
    .eq('organization_id', job.organization_id)
    .eq('id', establishmentResult.data.establishment_id)
    .single();
  if (error || !establishment) throw new Error('Configuração do estabelecimento não encontrada.');
  return {
    document: documentResult.data as FiscalProviderDocument,
    establishment: establishment as { id: string; environment: 'homologation' | 'production'; production_enabled: boolean },
    config: configResult.data as { provider_key?: string; environment?: string } | null,
  };
}

async function claimJob(jobId: string): Promise<FiscalJobRow | null> {
  const client = getFiscalServiceClient();
  const { data: current, error } = await client.from('fiscal_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error || !current || !['pending', 'failed'].includes(current.status)) return null;
  const { data, error: claimError } = await client
    .from('fiscal_jobs')
    .update({ status: 'processing', locked_at: new Date().toISOString(), locked_by: `fiscal-${process.pid}`, attempts: current.attempts + 1 })
    .eq('id', jobId)
    .eq('status', current.status)
    .select('*')
    .maybeSingle();
  if (claimError || !data) return null;
  return data as FiscalJobRow;
}

async function finishJob(job: FiscalJobRow): Promise<void> {
  await getFiscalServiceClient().from('fiscal_jobs').update({ status: 'completed', locked_at: null, locked_by: null, last_error: null }).eq('id', job.id);
}

async function failJob(job: FiscalJobRow, error: unknown, terminal = false): Promise<void> {
  const attempts = job.attempts;
  const dead = terminal || attempts >= job.max_attempts;
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  await getFiscalServiceClient().from('fiscal_jobs').update({
    status: dead ? 'dead_letter' : 'failed',
    next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: safeError(error),
  }).eq('id', job.id);
}

async function recordAttempt(
  job: FiscalJobRow,
  status: 'success' | 'retryable_error' | 'terminal_error',
  startedAt: number,
  result?: FiscalProviderResult,
  message?: string,
): Promise<void> {
  await getFiscalServiceClient().from('fiscal_transmission_attempts').insert({
    organization_id: job.organization_id,
    document_id: job.document_id,
    operation: job.operation === 'finance_post' || job.operation === 'finance_reverse' ? 'consult' : job.operation,
    attempt_number: job.attempts,
    request_id: `${job.id}:${job.attempts}`,
    status,
    provider_code: result?.rejectionCode ?? null,
    safe_message: message ?? result?.rejectionMessage ?? null,
    duration_ms: Date.now() - startedAt,
    finished_at: new Date().toISOString(),
  });
}

async function storeXml(document: FiscalProviderDocument, xml: string): Promise<{ path: string; sha256: string }> {
  const path = `${document.organization_id}/${document.id}/nfse.xml`;
  const bytes = Buffer.from(xml, 'utf8');
  const { error } = await getFiscalServiceClient().storage
    .from(FISCAL_DOCUMENT_BUCKET)
    .upload(path, bytes, { contentType: 'application/xml', upsert: true });
  if (error) throw new Error(`Falha ao guardar XML fiscal: ${error.message}`);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function updateProviderResult(job: FiscalJobRow, document: FiscalProviderDocument, result: FiscalProviderResult): Promise<void> {
  const client = getFiscalServiceClient();
  const previous = document.status;
  const patch: Record<string, unknown> = {
    status: result.status,
    provider_document_id: result.providerDocumentId ?? document.provider_document_id,
    access_key: result.accessKey ?? document.access_key,
    document_number: result.documentNumber ?? document.document_number,
    verification_code: result.verificationCode ?? document.verification_code,
    rejection_code: result.rejectionCode ?? null,
    rejection_message: result.rejectionMessage ?? null,
    provider_payload_sanitized: result.safePayload ?? {},
    authorized_at: result.authorizedAt ?? document.authorized_at,
    cancelled_at: result.cancelledAt ?? document.cancelled_at,
  };
  if (result.artifacts?.xml) {
    const artifact = await storeXml(document, result.artifacts.xml);
    patch.xml_storage_path = artifact.path;
    patch.xml_sha256 = artifact.sha256;
  }
  const { error } = await client.from('fiscal_documents').update(patch).eq('organization_id', job.organization_id).eq('id', job.document_id);
  if (error) throw new Error(`Falha ao persistir retorno fiscal: ${error.message}`);
  await appendFiscalEvent(
    job.organization_id,
    job.document_id,
    result.status === 'authorized' ? 'provider_authorized' : result.status === 'cancelled' ? 'provider_cancelled' : 'provider_response',
    previous,
    result.status,
    result.rejectionMessage ?? (result.status === 'authorized' ? 'NFS-e autorizada em homologação.' : `Retorno fiscal: ${result.status}.`),
    null,
    result.safePayload ?? {},
  );
}

async function runProviderJob(job: FiscalJobRow): Promise<void> {
  const started = Date.now();
  const { document, establishment, config } = await fetchDocumentBundle(job);
  if (establishment.environment === 'production' && !establishment.production_enabled) {
    throw new Error('Produção fiscal ainda não foi habilitada para o estabelecimento.');
  }
  const providerKey = config?.provider_key ?? 'sandbox';
  const provider = getFiscalProvider(providerKey);
  const requestId = `${job.id}:${job.attempts}`;
  const context = { organizationId: job.organization_id, establishmentId: establishment.id, environment: establishment.environment, requestId };

  if (job.operation === 'issue' && document.status === 'queued') {
    await getFiscalServiceClient().from('fiscal_documents').update({ status: 'processing', provider_key: providerKey }).eq('id', document.id).eq('status', 'queued');
    await appendFiscalEvent(job.organization_id, document.id, 'provider_processing', 'queued', 'processing', 'Transmissão iniciada pelo worker fiscal.', null);
    document.status = 'processing';
  }

  let result: FiscalProviderResult;
  if (job.operation === 'issue' && document.replaced_document_id) {
    const { data: original, error } = await getFiscalServiceClient().from('fiscal_documents').select('*').eq('organization_id', job.organization_id).eq('id', document.replaced_document_id).single();
    if (error || !original) throw new Error('NFS-e original da substituição não encontrada.');
    result = await provider.replace(original as FiscalProviderDocument, document, context);
  }
  else if (job.operation === 'issue') result = await provider.issue(document, context);
  else if (job.operation === 'consult') result = await provider.consult(document, context);
  else if (job.operation === 'cancel') result = await provider.cancel(document, String(job.payload.reason ?? ''), context);
  else throw new Error(`Operação ${job.operation} não suportada pelo worker do provedor.`);

  await updateProviderResult(job, document, result);
  const terminalError = result.status === 'error';
  await recordAttempt(job, terminalError ? 'terminal_error' : 'success', started, result);
  if (terminalError) throw new Error(result.rejectionMessage ?? 'Erro terminal do provedor.');

  const actor: FiscalActor = { organizationId: job.organization_id, userId: String(job.payload.actorUserId ?? document.created_by ?? document.submitted_by) };
  if (result.status === 'authorized') {
    if (document.replaced_document_id) {
      await getFiscalServiceClient().from('fiscal_documents').update({ status: 'replaced', replacement_document_id: document.id }).eq('organization_id', job.organization_id).eq('id', document.replaced_document_id).eq('status', 'authorized');
      await appendFiscalEvent(job.organization_id, document.replaced_document_id, 'replaced', 'authorized', 'replaced', `NFS-e substituída pelo documento ${result.documentNumber ?? document.id}.`, null, { replacementDocumentId: document.id });
      await enqueueFiscalJob(actor, document.replaced_document_id, 'finance_reverse', `finance-reverse:replacement:${document.replaced_document_id}`, { actorUserId: actor.userId });
    }
    await enqueueFiscalJob(actor, document.id, 'finance_post', `finance-post:${document.id}`, { actorUserId: actor.userId });
  }
  if (result.status === 'cancelled') {
    await enqueueFiscalJob(actor, document.id, 'finance_reverse', `finance-reverse:${document.id}`, { actorUserId: actor.userId });
  }
}

function dueDateFromRules(document: FiscalDocument): string | null {
  const service = document.service_snapshot as { tax_rules?: { taxDueDay?: number; taxDueMonthOffset?: number } };
  const dueDay = Number(service.tax_rules?.taxDueDay ?? 0);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) return null;
  const offset = Number(service.tax_rules?.taxDueMonthOffset ?? 1);
  const date = new Date(`${document.competence_date.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  date.setUTCDate(dueDay);
  return date.toISOString().slice(0, 10);
}

async function postFinance(job: FiscalJobRow): Promise<void> {
  const client = getFiscalServiceClient();
  const { data: document, error } = await client.from('fiscal_documents').select('*').eq('organization_id', job.organization_id).eq('id', job.document_id).single();
  if (error || !document) throw new Error('Documento autorizado não encontrado para contabilização.');
  if (document.status !== 'authorized') throw new Error('Somente documento autorizado pode ser contabilizado.');
  if (document.finance_status === 'posted' || document.finance_status === 'review_required') return;

  const recipient = document.recipient_snapshot as { client_id?: string | null };
  const configured = document.business_unit_id && document.cost_center_id && document.revenue_category_id && recipient.client_id;
  if (!configured) {
    await client.from('fiscal_documents').update({ finance_status: 'pending_configuration' }).eq('id', document.id);
    await appendFiscalEvent(job.organization_id, document.id, 'finance_pending_configuration', 'authorized', 'authorized', 'NFS-e autorizada; configure cliente e mapeamentos financeiros para contabilizar.', null);
    return;
  }

  const actorUserId = String(job.payload.actorUserId ?? document.created_by);
  const externalKey = `fiscal:${document.id}`;
  const existingLedger = await client.from('ledger_entry').select('id').eq('organization_id', job.organization_id).eq('source_system', 'fiscal').eq('external_key', externalKey).maybeSingle();
  let ledgerId = existingLedger.data?.id as string | undefined;
  if (!ledgerId) {
    const issueDate = document.issue_date ?? document.authorized_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const inserted = await client.from('ledger_entry').insert({
      organization_id: job.organization_id,
      entry_date: issueDate,
      description: `Receita NFS-e ${document.document_number ?? document.id}`,
      amount_cents: document.service_amount_cents,
      category_id: document.revenue_category_id,
      cost_center_id: document.cost_center_id,
      project_id: document.project_id,
      contract_id: document.contract_id,
      client_id: recipient.client_id,
      business_unit_id: document.business_unit_id,
      period_key: document.competence_date.slice(0, 7),
      entry_type: 'actual',
      status: 'posted',
      source_system: 'fiscal',
      source_ref: document.access_key,
      external_key: externalKey,
      evidence_required: true,
      evidence_provided: Boolean(document.xml_storage_path),
      metadata: { fiscal_document_id: document.id, access_key: document.access_key, gross_revenue: true },
      created_by: actorUserId,
      posted_by: actorUserId,
      posted_at: new Date().toISOString(),
    }).select('id').single();
    if (inserted.error) throw new Error(`Falha ao criar receita: ${inserted.error.message}`);
    ledgerId = String(inserted.data.id);
  }

  const existingApar = await client.from('apar_title').select('id').eq('organization_id', job.organization_id).eq('source_system', 'fiscal').eq('external_key', externalKey).maybeSingle();
  let aparId = existingApar.data?.id as string | undefined;
  if (!aparId) {
    const inserted = await client.from('apar_title').insert({
      organization_id: job.organization_id,
      type: 'receivable',
      title_number: `NFS-${document.document_number ?? document.id.slice(0, 8)}`,
      client_id: recipient.client_id,
      contract_id: document.contract_id,
      project_id: document.project_id,
      issue_date: document.issue_date ?? document.authorized_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      due_date: document.due_date ?? document.competence_date,
      amount_cents: document.net_amount_cents,
      status: 'open',
      linked_entry_id: ledgerId,
      source_system: 'fiscal',
      external_key: externalKey,
      notes: `Gerado automaticamente pela NFS-e ${document.document_number ?? ''}`,
      created_by: actorUserId,
    }).select('id').single();
    if (inserted.error) throw new Error(`Falha ao criar conta a receber: ${inserted.error.message}`);
    aparId = String(inserted.data.id);
  }

  const { data: taxes } = await client.from('fiscal_tax_lines').select('*').eq('document_id', document.id).eq('responsibility', 'issuer');
  const taxDueDate = dueDateFromRules(document as FiscalDocument);
  let reviewRequired = false;
  if ((taxes ?? []).length && !taxDueDate) reviewRequired = true;
  if (taxDueDate) {
    for (const tax of (taxes ?? []) as FiscalTaxLine[]) {
      const existing = await client.from('tax_obligation').select('id').eq('organization_id', job.organization_id).eq('fiscal_document_id', document.id).eq('tax_type', tax.tax_code).maybeSingle();
      if (!existing.data) {
        const inserted = await client.from('tax_obligation').insert({
          organization_id: job.organization_id,
          fiscal_document_id: document.id,
          tax_type: tax.tax_code,
          title: `${tax.tax_code} — NFS-e ${document.document_number ?? ''}`,
          competence_month: document.competence_date.slice(0, 7),
          due_date: taxDueDate,
          amount_cents: tax.amount_cents,
          client_id: recipient.client_id,
          contract_id: document.contract_id,
          project_id: document.project_id,
          cost_center_id: document.cost_center_id,
          accrual_entry_id: ledgerId,
          linked_apar_title_id: aparId,
          source_document: document.access_key,
          invoice_number: document.document_number,
          created_by: actorUserId,
        });
        if (inserted.error) throw new Error(`Falha ao criar obrigação de ${tax.tax_code}: ${inserted.error.message}`);
      }
    }
  }

  const financeStatus = reviewRequired ? 'review_required' : 'posted';
  await client.from('fiscal_documents').update({ finance_status: financeStatus, ledger_entry_id: ledgerId, apar_title_id: aparId }).eq('id', document.id);
  await appendFiscalEvent(job.organization_id, document.id, 'finance_posted', 'authorized', 'authorized', reviewRequired
    ? 'Receita e contas a receber contabilizadas; vencimentos tributários aguardam regra fiscal.'
    : 'Receita, contas a receber e tributos integrados ao Financeiro.', null);
}

async function reverseFinance(job: FiscalJobRow): Promise<void> {
  const client = getFiscalServiceClient();
  const { data: document, error } = await client.from('fiscal_documents').select('*').eq('organization_id', job.organization_id).eq('id', job.document_id).single();
  if (error || !document) throw new Error('Documento cancelado não encontrado para estorno.');
  const actorUserId = String(job.payload.actorUserId ?? document.created_by);
  if (document.ledger_entry_id) {
    await client.from('ledger_entry').update({ status: 'void', voided_by: actorUserId, voided_at: new Date().toISOString(), void_reason: 'Cancelamento da NFS-e vinculada' }).eq('organization_id', job.organization_id).eq('id', document.ledger_entry_id);
  }
  if (document.apar_title_id) {
    await client.from('apar_title').update({ status: 'cancelled' }).eq('organization_id', job.organization_id).eq('id', document.apar_title_id);
  }
  await client.from('tax_obligation').update({ status: 'cancelled' }).eq('organization_id', job.organization_id).eq('fiscal_document_id', document.id);
  await client.from('fiscal_documents').update({ finance_status: 'reversed' }).eq('id', document.id);
  await appendFiscalEvent(job.organization_id, document.id, 'finance_reversed', 'cancelled', 'cancelled', 'Vínculos financeiros estornados após cancelamento.', null);
}

export async function processFiscalJob(jobId: string): Promise<{ processed: boolean; error?: string }> {
  const job = await claimJob(jobId);
  if (!job) return { processed: false };
  try {
    if (['issue', 'consult', 'cancel'].includes(job.operation)) await runProviderJob(job);
    else if (job.operation === 'finance_post') await postFinance(job);
    else if (job.operation === 'finance_reverse') await reverseFinance(job);
    else throw new Error(`Operação fiscal ainda não implementada: ${job.operation}`);
    await finishJob(job);
    return { processed: true };
  } catch (error) {
    const terminal = /não possui adaptador|não pode transmitir em produção|Produção fiscal ainda não foi habilitada/i.test(safeError(error));
    await failJob(job, error, terminal);
    return { processed: true, error: safeError(error) };
  }
}

export async function processDueFiscalJobs(limit = 10): Promise<Array<{ id: string; processed: boolean; error?: string }>> {
  const { data, error } = await getFiscalServiceClient()
    .from('fiscal_jobs')
    .select('id')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at')
    .limit(Math.min(limit, 25));
  if (error) throw new Error(`Falha ao consultar fila fiscal: ${error.message}`);
  const results = [];
  for (const row of data ?? []) results.push({ id: String(row.id), ...(await processFiscalJob(String(row.id))) });
  return results;
}
