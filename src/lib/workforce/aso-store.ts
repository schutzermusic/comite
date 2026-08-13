/**
 * Persistência dos documentos de ASO (SERVER-ONLY).
 *
 * Service role, como o resto do conector: o bucket é privado e sem policy de
 * cliente, então o arquivo só entra e só sai por rota autenticada.
 */

if (typeof window !== 'undefined') {
  throw new Error('src/lib/workforce/aso-store.ts não pode ser importado no browser');
}

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AsoDivergence } from './aso-extractor';

export const ASO_BUCKET = 'aso-documents';

export class AsoSchemaMissingError extends Error {
  constructor() {
    super('A tabela de documentos de ASO ainda não foi provisionada nesta base (migration 085).');
    this.name = 'AsoSchemaMissingError';
  }
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    /relation .* does not exist|could not find the table/i.test(error.message ?? '')
  );
}

let _client: SupabaseClient | null = null;
export function getAsoServiceClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessários para gravar documentos de ASO.',
    );
  }
  _client = createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export interface AsoDocumentRow {
  id: string;
  organization_id: string;
  person_id: string | null;
  worker_cpf_hash: string | null;
  worker_name_raw: string | null;
  file_name: string;
  storage_bucket: string;
  object_path: string;
  mime_type: string | null;
  file_size: number | null;
  checksum: string | null;
  exam_date: string | null;
  exam_kind: string | null;
  exam_result: string | null;
  valid_until: string | null;
  validity_basis: 'declared_document' | 'inferred_periodicity' | 'undetermined';
  doctor_name: string | null;
  doctor_crm: string | null;
  company_name: string | null;
  extraction_method: 'deterministic' | 'ai' | 'manual';
  extraction_confidence: number | null;
  extraction_issues: { field: string; reason: string }[];
  esocial_event_id: string | null;
  match_status: 'pending' | 'matched' | 'divergent' | 'no_esocial_event';
  divergences: AsoDivergence[];
  status: 'pending_review' | 'confirmed' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AsoDocumentInsert = Omit<AsoDocumentRow, 'id' | 'created_at' | 'updated_at'>;

export async function uploadAsoFile(
  organizationId: string,
  fileName: string,
  bytes: Buffer,
  mimeType: string,
): Promise<string> {
  const db = getAsoServiceClient();
  await ensureBucket(db);

  // Caminho com timestamp: o mesmo nome de arquivo reenviado não colide, e a
  // deduplicação de verdade é feita pelo checksum na tabela.
  const safeName = fileName.replace(/[^\w.\-]/g, '_').slice(0, 120);
  const path = `${organizationId}/${Date.now()}-${safeName}`;

  const { error } = await db.storage.from(ASO_BUCKET).upload(path, bytes, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error(`Falha ao gravar o arquivo do ASO: ${error.message}`);
  return path;
}

export async function downloadAsoFile(path: string): Promise<Buffer> {
  const { data, error } = await getAsoServiceClient().storage.from(ASO_BUCKET).download(path);
  if (error || !data) throw new Error(`Falha ao ler o arquivo do ASO: ${error?.message ?? 'vazio'}`);
  return Buffer.from(await data.arrayBuffer());
}

/** URL assinada de curta duração — o bucket é privado e continua privado. */
export async function signAsoFile(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data, error } = await getAsoServiceClient()
    .storage.from(ASO_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function removeAsoFile(path: string): Promise<void> {
  await getAsoServiceClient().storage.from(ASO_BUCKET).remove([path]);
}

async function ensureBucket(db: SupabaseClient): Promise<void> {
  const { data } = await db.storage.getBucket(ASO_BUCKET);
  if (data) return;
  await db.storage.createBucket(ASO_BUCKET, { public: false, fileSizeLimit: 20 * 1024 * 1024 });
}

export async function findByChecksum(
  organizationId: string,
  checksum: string,
): Promise<AsoDocumentRow | null> {
  const { data, error } = await getAsoServiceClient()
    .from('aso_documents')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('checksum', checksum)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new AsoSchemaMissingError();
    return null;
  }
  return (data as AsoDocumentRow | null) ?? null;
}

export async function insertAsoDocument(row: AsoDocumentInsert): Promise<AsoDocumentRow> {
  const { data, error } = await getAsoServiceClient()
    .from('aso_documents')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    if (isMissingTable(error)) throw new AsoSchemaMissingError();
    throw new Error(`Falha ao gravar o documento de ASO: ${error.message}`);
  }
  return data as AsoDocumentRow;
}

export async function updateAsoDocument(
  organizationId: string,
  id: string,
  patch: Partial<AsoDocumentRow>,
): Promise<AsoDocumentRow> {
  const { data, error } = await getAsoServiceClient()
    .from('aso_documents')
    .update(patch)
    .eq('organization_id', organizationId)
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    if (isMissingTable(error)) throw new AsoSchemaMissingError();
    throw new Error(`Falha ao atualizar o documento de ASO: ${error.message}`);
  }
  return data as AsoDocumentRow;
}

export async function listAsoDocuments(organizationId: string): Promise<AsoDocumentRow[]> {
  const { data, error } = await getAsoServiceClient()
    .from('aso_documents')
    .select('*')
    .eq('organization_id', organizationId)
    .order('exam_date', { ascending: false, nullsFirst: false });
  if (error) {
    if (isMissingTable(error)) throw new AsoSchemaMissingError();
    throw new Error(`Falha ao listar documentos de ASO: ${error.message}`);
  }
  return (data as AsoDocumentRow[] | null) ?? [];
}

export async function getAsoDocument(
  organizationId: string,
  id: string,
): Promise<AsoDocumentRow | null> {
  const { data, error } = await getAsoServiceClient()
    .from('aso_documents')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new AsoSchemaMissingError();
    return null;
  }
  return (data as AsoDocumentRow | null) ?? null;
}

export async function deleteAsoDocument(organizationId: string, id: string): Promise<void> {
  const { error } = await getAsoServiceClient()
    .from('aso_documents')
    .delete()
    .eq('organization_id', organizationId)
    .eq('id', id);
  if (error) throw new Error(`Falha ao excluir o documento de ASO: ${error.message}`);
}
