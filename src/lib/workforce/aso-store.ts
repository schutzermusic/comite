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
import type { AsoDivergence, AsoEsocialMatchStatus, AsoExtractionMethod } from './aso-extractor';
import type {
  AsoDocumentStatus,
  AsoFields,
  AsoReviewEntry,
  AsoReviewStatus,
} from './aso-review';

export const ASO_BUCKET = 'aso-documents';

export class AsoSchemaMissingError extends Error {
  constructor() {
    super(
      'A tabela de documentos de ASO ainda não foi provisionada nesta base (migrations 085 e 089).',
    );
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

  // ── Arquivo ORIGINAL, preservado sem transformação ──
  file_name: string;
  storage_bucket: string;
  object_path: string;
  /** `bucket/caminho` do PDF como ele subiu. Nunca reescrito. */
  original_file_url: string | null;
  mime_type: string | null;
  file_size: number | null;
  checksum: string | null;

  // ── Campos vigentes = leitura sobreposta pela revisão ──
  exam_date: string | null;
  exam_kind: string | null;
  exam_result: string | null;
  validity_date: string | null;
  validity_basis: 'declared_document' | 'inferred_periodicity' | 'undetermined';
  doctor_name: string | null;
  doctor_crm: string | null;
  company_name: string | null;
  company_cnpj: string | null;
  clinic_name: string | null;
  worker_registration: string | null;
  occupational_risks: string[];

  // ── As duas camadas, separadas ──
  /** O que a máquina leu, congelado. */
  extracted_fields_json: AsoFields;
  /** Só o que uma pessoa corrigiu. */
  reviewed_fields_json: AsoFields;

  extraction_method: AsoExtractionMethod;
  extraction_confidence: number | null;
  extraction_issues: { field: string; reason: string }[];

  // ── Conferência OPCIONAL com o eSocial ──
  esocial_event_id: string | null;
  esocial_match_status: AsoEsocialMatchStatus;
  divergences: AsoDivergence[];
  divergence_summary: string | null;

  // ── Curadoria humana ──
  review_status: AsoReviewStatus;
  /** Projeção de `review_status`, mantida por trigger. Nunca escrever. */
  document_status: AsoDocumentStatus;
  review_history: AsoReviewEntry[];
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;

  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `document_status` fica de fora: é derivado por trigger. Enviá-lo daqui
 * criaria uma segunda fonte para o mesmo valor, e uma delas estaria errada.
 */
export type AsoDocumentInsert = Omit<
  AsoDocumentRow,
  'id' | 'created_at' | 'updated_at' | 'document_status'
>;

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
  patch: Partial<Omit<AsoDocumentRow, 'document_status'>>,
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
