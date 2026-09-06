/**
 * Motor de transmissão fiscal.
 *
 * Conduz uma operação com o provedor do começo ao fim: reivindica a tarefa,
 * chama o adaptador, guarda o retorno REAL, registra a tentativa e o evento, e
 * decide se a falha merece nova tentativa.
 *
 * ─── O que ele não faz ─────────────────────────────────────────────────────
 *
 * Não escreve no Financeiro. Razão, contas a receber e obrigações tributárias
 * são de Finanças, e a integração é a Fase 7. Aqui a NFS-e autorizada apenas
 * declara `finance_status = 'not_posted'`: ausência registrada, não silêncio.
 *
 * ─── Idempotência ──────────────────────────────────────────────────────────
 *
 * A chave de idempotência é da TAREFA, não da chamada. Reenviar a mesma
 * transmissão devolve a tarefa já existente em vez de criar outra, e o número
 * de DPS, uma vez reservado, fica gravado no documento — uma retentativa
 * reaproveita o número em vez de queimar outro. É o que impede que instabilidade
 * de rede vire duas NFS-e para o mesmo serviço.
 */
import { createHash } from 'node:crypto';
import { FiscalCredentialsRequiredError, FiscalProviderProtocolError } from '../provider';
import { NfseNacionalProvider } from '../provider/nfse-nacional';
import type { FiscalProviderDocument, FiscalProviderResult } from '../provider';
import { resolveDocumentProvider } from './provider-resolution';
import { FISCAL_DOCUMENT_BUCKET, appendFiscalEvent, getFiscalServiceClient } from './store';

interface FiscalJobRow {
  id: string;
  organization_id: string;
  document_id: string;
  operation: 'issue' | 'consult' | 'cancel' | 'replace' | 'artifact';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';
  idempotency_key: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Mensagem de erro sem segredo dentro. Vai para o banco e para a tela. */
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Falha desconhecida.';
  return message
    .replace(/(token|secret|password|senha|authorization|passphrase)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[CHAVE REMOVIDA]')
    .slice(0, 500);
}

/**
 * Falta de credencial e ambiente indisponível são coisas diferentes.
 * A primeira nenhuma retentativa resolve; a segunda quase sempre resolve.
 */
function isTerminal(error: unknown): boolean {
  if (error instanceof FiscalCredentialsRequiredError) return true;
  if (error instanceof FiscalProviderProtocolError) return false;
  return /não possui adaptador|não pode transmitir em produção|não opera em|Produção fiscal bloqueada|imutável/i
    .test(safeError(error));
}

async function claimJob(jobId: string): Promise<FiscalJobRow | null> {
  const client = getFiscalServiceClient();
  const { data: current, error } = await client.from('fiscal_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error || !current || !['pending', 'failed'].includes(current.status)) return null;
  // Reivindicação condicionada ao estado lido: dois workers na mesma tarefa,
  // só um consegue a atualização.
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
  await getFiscalServiceClient().from('fiscal_jobs')
    .update({ status: 'completed', locked_at: null, locked_by: null, last_error: null }).eq('id', job.id);
}

async function failJob(job: FiscalJobRow, error: unknown, terminal: boolean): Promise<void> {
  const dead = terminal || job.attempts >= job.max_attempts;
  const delayMinutes = Math.min(60, 2 ** Math.max(0, job.attempts - 1));
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
  input: {
    status: 'success' | 'retryable_error' | 'terminal_error';
    startedAt: number;
    environment: string;
    providerKey?: string;
    httpStatus?: number;
    code?: string | null;
    message?: string | null;
  },
): Promise<void> {
  const { error } = await getFiscalServiceClient().from('fiscal_transmission_attempts').insert({
    organization_id: job.organization_id,
    document_id: job.document_id,
    operation: job.operation,
    attempt_number: job.attempts,
    request_id: `${job.id}:${job.attempts}`,
    environment: input.environment,
    provider_key: input.providerKey ?? null,
    status: input.status,
    http_status: input.httpStatus ?? null,
    provider_code: input.code ?? null,
    safe_message: input.message ? safeError(input.message) : null,
    duration_ms: Date.now() - input.startedAt,
    finished_at: new Date().toISOString(),
  });
  // A tentativa já foi registrada por uma execução anterior com o mesmo número:
  // reexecutar não deve explodir, mas também não deve gravar duas linhas.
  if (error && error.code !== '23505') {
    throw new Error(`Falha ao registrar tentativa de transmissão: ${error.message}`);
  }
}

async function storeArtifact(
  document: FiscalProviderDocument,
  kind: 'xml' | 'danfse',
  bytes: Buffer,
): Promise<{ path: string; sha256: string }> {
  const path = `${document.organization_id}/${document.id}/nfse.${kind === 'xml' ? 'xml' : 'pdf'}`;
  const { error } = await getFiscalServiceClient().storage
    .from(FISCAL_DOCUMENT_BUCKET)
    .upload(path, bytes, { contentType: kind === 'xml' ? 'application/xml' : 'application/pdf', upsert: true });
  if (error) throw new Error(`Falha ao guardar ${kind === 'xml' ? 'XML' : 'DANFSe'} fiscal: ${error.message}`);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function updateProviderResult(
  job: FiscalJobRow,
  document: FiscalProviderDocument,
  result: FiscalProviderResult,
  providerKey: string,
): Promise<void> {
  const client = getFiscalServiceClient();
  const previous = document.status;
  const patch: Record<string, unknown> = {
    status: result.status,
    provider_key: providerKey,
    provider_document_id: result.providerDocumentId ?? document.provider_document_id,
    access_key: result.accessKey ?? document.access_key,
    document_number: result.documentNumber ?? document.document_number,
    verification_code: result.verificationCode ?? document.verification_code,
    rejection_code: result.rejectionCode ?? null,
    rejection_message: result.rejectionMessage ? safeError(result.rejectionMessage) : null,
    provider_payload_sanitized: result.safePayload ?? {},
    authorized_at: result.authorizedAt ?? document.authorized_at,
    cancelled_at: result.cancelledAt ?? document.cancelled_at,
  };
  if (result.status === 'authorized' && !document.issue_date) {
    patch.issue_date = (result.authorizedAt ?? new Date().toISOString()).slice(0, 10);
  }
  if (result.artifacts?.xml) {
    const artifact = await storeArtifact(document, 'xml', Buffer.from(result.artifacts.xml, 'utf8'));
    patch.xml_storage_path = artifact.path;
    patch.xml_sha256 = artifact.sha256;
  }
  if (result.artifacts?.danfsePdf) {
    const artifact = await storeArtifact(document, 'danfse', result.artifacts.danfsePdf);
    patch.danfse_storage_path = artifact.path;
    patch.danfse_sha256 = artifact.sha256;
  }
  const { error } = await client.from('fiscal_documents').update(patch)
    .eq('organization_id', job.organization_id).eq('id', job.document_id);
  if (error) throw new Error(`Falha ao persistir retorno fiscal: ${error.message}`);

  await appendFiscalEvent(
    job.organization_id,
    job.document_id,
    result.status === 'authorized' ? 'provider_authorized'
      : result.status === 'cancelled' ? 'provider_cancelled'
      : result.status === 'rejected' ? 'provider_rejected'
      : 'provider_response',
    previous,
    result.status,
    result.rejectionMessage
      ? safeError(result.rejectionMessage)
      : result.status === 'authorized'
        ? `NFS-e autorizada pelo provedor ${providerKey}.`
        : `Retorno do provedor: ${result.status}.`,
    null,
    result.safePayload ?? {},
  );
}

/**
 * Busca a DANFSe quando o provedor a oferece. A ausência do PDF NÃO invalida a
 * NFS-e nem falha a transmissão: a nota já está autorizada, e o representante
 * impresso é conveniência. Registrar a falta é o correto; abortar não seria.
 */
async function fetchDanfseIfAvailable(
  job: FiscalJobRow,
  document: FiscalProviderDocument,
  resolved: Awaited<ReturnType<typeof resolveDocumentProvider>>,
): Promise<void> {
  const accessKey = document.access_key;
  if (!accessKey || !(resolved.provider instanceof NfseNacionalProvider)) return;
  try {
    const pdf = await resolved.provider.fetchDanfse(accessKey, {
      organizationId: job.organization_id,
      establishmentId: resolved.establishment.id,
      environment: resolved.environment,
      requestId: `${job.id}:danfse`,
    });
    if (!pdf) {
      await appendFiscalEvent(job.organization_id, job.document_id, 'danfse_unavailable', document.status, document.status,
        'DANFSe ainda não disponível no provedor.', null);
      return;
    }
    const artifact = await storeArtifact(document, 'danfse', pdf);
    await getFiscalServiceClient().from('fiscal_documents')
      .update({ danfse_storage_path: artifact.path, danfse_sha256: artifact.sha256 })
      .eq('organization_id', job.organization_id).eq('id', job.document_id);
    await appendFiscalEvent(job.organization_id, job.document_id, 'danfse_stored', document.status, document.status,
      'DANFSe recebida e arquivada.', null);
  } catch (error) {
    await appendFiscalEvent(job.organization_id, job.document_id, 'danfse_failed', document.status, document.status,
      safeError(error), null);
  }
}

async function runProviderJob(job: FiscalJobRow): Promise<void> {
  const started = Date.now();
  const client = getFiscalServiceClient();
  const { data: documentRow, error } = await client.from('fiscal_documents').select('*')
    .eq('organization_id', job.organization_id).eq('id', job.document_id).single();
  if (error || !documentRow) throw new Error('Documento fiscal da tarefa não encontrado.');
  const document = documentRow as FiscalProviderDocument;

  const resolved = await resolveDocumentProvider(document, { reserveDps: job.operation === 'issue' });
  const context = {
    organizationId: job.organization_id,
    establishmentId: resolved.establishment.id,
    environment: resolved.environment,
    requestId: `${job.id}:${job.attempts}`,
  };

  // O número de DPS reservado é gravado ANTES da chamada. Se a transmissão
  // falhar, a retentativa reencontra o mesmo número em vez de reservar outro —
  // que é o que evita duas declarações para o mesmo serviço.
  if (job.operation === 'issue' && resolved.dpsNumber && !document.dps_number) {
    await client.from('fiscal_documents').update({ dps_number: resolved.dpsNumber })
      .eq('organization_id', job.organization_id).eq('id', document.id);
    document.dps_number = resolved.dpsNumber;
  }

  if (job.operation === 'issue' && document.status === 'queued') {
    await client.from('fiscal_documents')
      .update({ status: 'processing', provider_key: resolved.providerKey })
      .eq('id', document.id).eq('status', 'queued');
    await appendFiscalEvent(job.organization_id, document.id, 'provider_processing', 'queued', 'processing',
      'Transmissão iniciada pelo worker fiscal.', null);
    document.status = 'processing';
  }

  let result: FiscalProviderResult;
  try {
    if (job.operation === 'issue' && document.replaced_document_id) {
      const { data: original, error: originalError } = await client.from('fiscal_documents').select('*')
        .eq('organization_id', job.organization_id).eq('id', document.replaced_document_id).single();
      if (originalError || !original) throw new Error('NFS-e original da substituição não encontrada.');
      result = await resolved.provider.replace(original as FiscalProviderDocument, document, context);
    } else if (job.operation === 'issue') {
      result = await resolved.provider.issue(document, context);
    } else if (job.operation === 'consult') {
      result = await resolved.provider.consult(document, context);
    } else if (job.operation === 'cancel') {
      result = await resolved.provider.cancel(document, String(job.payload.reason ?? ''), context);
    } else {
      throw new Error(`Operação ${job.operation} não suportada pelo worker do provedor.`);
    }
  } catch (providerError) {
    await recordAttempt(job, {
      status: isTerminal(providerError) ? 'terminal_error' : 'retryable_error',
      startedAt: started,
      environment: resolved.environment,
      providerKey: resolved.providerKey,
      httpStatus: providerError instanceof FiscalProviderProtocolError ? providerError.httpStatus : undefined,
      message: safeError(providerError),
    });
    throw providerError;
  }

  await updateProviderResult(job, document, result, resolved.providerKey);
  const terminalError = result.status === 'error';
  await recordAttempt(job, {
    status: terminalError ? 'terminal_error' : result.status === 'rejected' ? 'terminal_error' : 'success',
    startedAt: started,
    environment: resolved.environment,
    providerKey: resolved.providerKey,
    code: result.rejectionCode,
    message: result.rejectionMessage,
  });
  if (terminalError) throw new Error(result.rejectionMessage ?? 'Erro terminal do provedor.');

  if (result.status === 'authorized') {
    document.access_key = result.accessKey ?? document.access_key;
    await fetchDanfseIfAvailable(job, document, resolved);
    if (document.replaced_document_id) {
      // A substituída só vira `replaced` DEPOIS que a substituta foi
      // autorizada. Marcar antes deixaria a original inutilizada caso a nova
      // fosse rejeitada.
      await client.from('fiscal_documents')
        .update({ status: 'replaced', replacement_document_id: document.id })
        .eq('organization_id', job.organization_id).eq('id', document.replaced_document_id).eq('status', 'authorized');
      await appendFiscalEvent(job.organization_id, document.replaced_document_id, 'replaced', 'authorized', 'replaced',
        `NFS-e substituída pelo documento ${result.documentNumber ?? document.id}.`, null,
        { replacementDocumentId: document.id });
    }
  }
}

export async function processFiscalJob(jobId: string): Promise<{ processed: boolean; error?: string }> {
  const job = await claimJob(jobId);
  if (!job) return { processed: false };
  try {
    await runProviderJob(job);
    await finishJob(job);
    return { processed: true };
  } catch (error) {
    const terminal = isTerminal(error);
    await failJob(job, error, terminal);
    await appendFiscalEvent(job.organization_id, job.document_id,
      terminal ? 'transmission_blocked' : 'transmission_failed', null, null, safeError(error), null,
      { terminal, attempt: job.attempts });
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
