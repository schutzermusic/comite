/**
 * Acesso a dados da ingestão do eSocial (service role — ignora RLS).
 *
 * Só a API e o cron chegam aqui. As políticas da migration 080 protegem o
 * acesso direto do cliente; este módulo é o único caminho de escrita.
 */
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ParsedEsocialEvent } from './parser';
import type { EsocialEndpoints, EsocialEnvironmentKey } from './endpoints';
import type { SstEventRow } from './sst';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/esocial/connector/store.ts não pode ser importado no browser');
}

export const CERT_BUCKET = 'esocial-certificates';

export interface EsocialConfigRow {
  organization_id: string;
  tp_insc: number;
  nr_insc: string;
  environment: EsocialEnvironmentKey;
  cert_storage_path: string | null;
  cert_password_cipher: string | null;
  cert_subject: string | null;
  cert_expires_at: string | null;
  cert_fingerprint: string | null;
  auto_sync_enabled: boolean;
  sync_frequency: 'manual' | 'daily' | 'weekly';
  lookback_months: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  next_sync_at: string | null;
  endpoints: Partial<EsocialEndpoints>;
}

export interface CompetenceMetricsRow {
  organization_id: string;
  competence: string;
  /** Soma das rubricas classificadas como provento pela tabela S-1010. */
  gross_payroll_cents: number;
  overtime_cents: number;
  overtime_hours: number;
  benefits_cents: number;
  /** Benefícios por tipo (va, vr, health, dental, transport, other), em centavos. */
  benefits_by_nature: Record<string, number>;
  deductions_cents: number;
  net_paid_cents: number;
  /**
   * Cobertura da tabela de rubricas nesta competência: quanto do valor
   * declarado no S-1200 tem definição conhecida. É o que separa "não houve
   * hora extra" de "não sabemos classificar esta folha".
   */
  rubric_total_cents: number;
  rubric_mapped_cents: number;
  headcount: number;
  admissions: number;
  terminations: number;
  absence_days: number;
  absence_events: number;
  /** Guias REAIS, da versão mais recente de cada totalizador. */
  inss_cents: number | null;
  inss_withheld_cents: number | null;
  irrf_cents: number | null;
  fgts_cents: number | null;
  /** Bases apuradas pelo próprio eSocial — completas mesmo sem o S-1200. */
  cp_base_cents: number | null;
  fgts_base_cents: number | null;
  rat_fap_rate: number | null;
  totalizers: Record<string, boolean>;
  source_event_count: number;
  /** Fallback provisório, isolado dos campos oficiais do eSocial. */
  payslip_gross_cents?: number;
  payslip_deductions_cents?: number;
  payslip_net_cents?: number;
  payslip_overtime_cents?: number;
  payslip_overtime_hours?: number;
  payslip_benefits_cents?: number;
  payslip_benefits_by_nature?: Record<string, number> | null;
  payslip_absence_deductions_cents?: number;
  payslip_headcount?: number;
  payslip_line_count?: number;
  payslip_updated_at?: string | null;
}

export interface AreaMetricsRow {
  organization_id: string;
  competence: string;
  area_code: string;
  area_label: string;
  headcount: number;
  admissions: number;
  terminations: number;
  absence_days: number;
  gross_cents: number;
  overtime_cents: number;
  /** Base de cálculo apurada pelo eSocial para esta lotação (S-5011). */
  base_cents: number;
}

/**
 * A migration 080 pode ainda não ter sido aplicada no ambiente. Detectar isso e
 * dizê-lo explicitamente evita o clássico "erro 500 sem explicação" na tela de
 * configuração.
 */
export class EsocialSchemaMissingError extends Error {
  constructor() {
    super(
      'As tabelas do eSocial ainda não existem neste ambiente. ' +
        'Aplique a migration 080_esocial_ingestion.sql antes de configurar o conector.',
    );
    this.name = 'EsocialSchemaMissingError';
  }
}

function isMissingTable(error: { code?: string; message?: string }): boolean {
  // 42P01 = undefined_table (Postgres); PGRST205 = tabela ausente no cache de
  // schema do PostgREST, que é o que a API do Supabase devolve na prática.
  const code = error.code ?? '';
  const message = error.message ?? '';
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message)
  );
}

let _client: SupabaseClient | null = null;

export function getEsocialServiceClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL não está configurado.');
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não está configurado — a ingestão do eSocial precisa dele.');
  }
  _client = createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// ── Configuração ────────────────────────────────────────────────────────────

export async function getConfig(organizationId: string): Promise<EsocialConfigRow | null> {
  const { data, error } = await getEsocialServiceClient()
    .from('esocial_config')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw new EsocialSchemaMissingError();
    throw new Error(`Falha ao ler configuração do eSocial: ${error.message}`);
  }
  return (data as EsocialConfigRow | null) ?? null;
}

/**
 * Atualiza campos de acompanhamento de uma configuração JÁ existente.
 *
 * Deliberadamente `update`, não `upsert`: o upsert do PostgREST monta um
 * INSERT ... ON CONFLICT, e o INSERT precisa satisfazer as colunas NOT NULL
 * (nr_insc, entre outras) mesmo quando a linha já existe.
 */
export async function touchConfig(
  organizationId: string,
  patch: Partial<Pick<EsocialConfigRow, 'last_sync_at' | 'last_sync_status' | 'next_sync_at'>>,
): Promise<void> {
  const { error } = await getEsocialServiceClient()
    .from('esocial_config')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('organization_id', organizationId);
  if (error) console.warn('[esocial] falha ao atualizar acompanhamento:', error.message);
}

export async function upsertConfig(
  row: Partial<EsocialConfigRow> & { organization_id: string },
): Promise<void> {
  const { error } = await getEsocialServiceClient()
    .from('esocial_config')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'organization_id' });
  if (error) throw new Error(`Falha ao gravar configuração do eSocial: ${error.message}`);
}

// ── Certificado ─────────────────────────────────────────────────────────────

/**
 * Garante o bucket privado do certificado.
 *
 * O `INSERT INTO storage.buckets` da migration não roda em todo projeto
 * Supabase (depende de como o SQL é aplicado), e o sintoma disso é um upload
 * que falha com "Bucket not found" — erro sem pista nenhuma para quem está
 * apenas tentando anexar um .pfx. Criar aqui é idempotente e mantém o conector
 * no espírito de "configure uma vez e pronto".
 */
async function ensureCertBucket(): Promise<void> {
  const storage = getEsocialServiceClient().storage;
  const { data: buckets, error } = await storage.listBuckets();
  if (error) throw new Error(`Falha ao verificar o armazenamento: ${error.message}`);
  if (buckets?.some((b) => b.id === CERT_BUCKET)) return;

  const { error: createError } = await storage.createBucket(CERT_BUCKET, {
    public: false,
    fileSizeLimit: 1_048_576, // 1 MB
  });
  // Corrida entre dois uploads simultâneos: se já existe, seguimos.
  if (createError && !/already exists/i.test(createError.message)) {
    throw new Error(`Falha ao criar o armazenamento do certificado: ${createError.message}`);
  }
}

export async function uploadCertificate(
  organizationId: string,
  file: Buffer,
  fileName: string,
): Promise<string> {
  await ensureCertBucket();
  const path = `${organizationId}/${Date.now()}-${fileName.replace(/[^\w.-]/g, '_')}`;
  const { error } = await getEsocialServiceClient()
    .storage.from(CERT_BUCKET)
    .upload(path, file, { contentType: 'application/x-pkcs12', upsert: false });
  if (error) throw new Error(`Falha ao gravar o certificado: ${error.message}`);
  return path;
}

export async function downloadCertificate(path: string): Promise<Buffer> {
  const { data, error } = await getEsocialServiceClient().storage.from(CERT_BUCKET).download(path);
  if (error || !data) throw new Error(`Falha ao ler o certificado: ${error?.message ?? 'arquivo ausente'}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function removeCertificate(path: string): Promise<void> {
  await getEsocialServiceClient().storage.from(CERT_BUCKET).remove([path]);
}

// ── Execuções ───────────────────────────────────────────────────────────────

export interface SyncRunInsert {
  run_id: string;
  organization_id: string;
  dry_run: boolean;
  automation_enabled: boolean;
  triggered_by: string;
  environment: string;
  competence_from: string;
  competence_to: string;
}

export async function startSyncRun(input: SyncRunInsert): Promise<string | null> {
  const { data, error } = await getEsocialServiceClient()
    .from('esocial_sync_runs')
    .insert({ ...input, status: 'running' })
    .select('id')
    .single();
  if (error) {
    // Observabilidade nunca derruba a sincronização.
    console.warn('[esocial] falha ao registrar início da execução:', error.message);
    return null;
  }
  return (data as { id: string }).id;
}

export async function finishSyncRun(
  id: string | null,
  patch: {
    status: 'success' | 'partial' | 'failed' | 'skipped';
    events_found?: number;
    events_imported?: number;
    events_duplicated?: number;
    events_failed?: number;
    safe_message?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!id) return;
  const { error } = await getEsocialServiceClient()
    .from('esocial_sync_runs')
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.warn('[esocial] falha ao fechar execução:', error.message);
}

export async function listRecentRuns(organizationId: string, limit = 10) {
  const { data, error } = await getEsocialServiceClient()
    .from('esocial_sync_runs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) throw new EsocialSchemaMissingError();
    throw new Error(`Falha ao listar execuções: ${error.message}`);
  }
  return data ?? [];
}

// ── Eventos ─────────────────────────────────────────────────────────────────

export interface EventInsert {
  organization_id: string;
  sync_run_id: string | null;
  event_type: string;
  esocial_event_id: string;
  receipt_number?: string;
  competence?: string;
  worker_cpf_hash?: string;
  worker_cpf_mask?: string;
  raw_xml: string;
  raw_xml_sha256: string;
  metadata?: Record<string, unknown>;
}

/** Ids já ingeridos, para não baixar de novo o que já temos. */
export async function findExistingEventIds(
  organizationId: string,
  eventIds: string[],
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const found = new Set<string>();
  // O `in` do PostgREST vai na URL; lotes evitam estourar o limite de tamanho.
  const CHUNK = 200;
  for (let i = 0; i < eventIds.length; i += CHUNK) {
    const { data, error } = await getEsocialServiceClient()
      .from('esocial_events')
      .select('esocial_event_id')
      .eq('organization_id', organizationId)
      .in('esocial_event_id', eventIds.slice(i, i + CHUNK));
    if (error) throw new Error(`Falha ao verificar eventos existentes: ${error.message}`);
    for (const row of (data ?? []) as { esocial_event_id: string }[]) found.add(row.esocial_event_id);
  }
  return found;
}

export async function insertEvents(rows: EventInsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { data, error } = await getEsocialServiceClient()
    .from('esocial_events')
    .upsert(rows, { onConflict: 'organization_id,esocial_event_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`Falha ao gravar eventos: ${error.message}`);
  return (data ?? []).length;
}

/**
 * TODOS os eventos do acervo, sem filtrar por competência.
 *
 * A tentação é reler só as competências afetadas pelo pacote, mas a coluna
 * `competence` é um resultado da apuração, não um fato do evento — e apurar de
 * novo é justamente o que se quer quando a regra muda. Eventos gravados sob a
 * regra antiga ficaram com a competência errada ou nula e sumiriam de uma
 * releitura filtrada. Foi o que aconteceu com os S-2230 de RETORNO de
 * afastamento: sem `dtIniAfast`, foram gravados com competência nula, e
 * enquanto a releitura filtrava por competência nenhum afastamento fechava.
 *
 * Somem-se a isso as dependências que atravessam meses (tabela de rubricas,
 * afastamento que cruza competências) e a conclusão é uma só: a reapuração lê
 * o acervo inteiro.
 *
 * Os retornos de lote ficam de fora — não têm evento, só recibo e ocorrências,
 * e são a maior parte do volume de XML.
 */
export async function readAllEventXml(
  organizationId: string,
): Promise<{ esocial_event_id: string; raw_xml: string; metadata: Record<string, unknown> | null }[]> {
  const out: { esocial_event_id: string; raw_xml: string; metadata: Record<string, unknown> | null }[] = [];
  const PAGE = 500;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await getEsocialServiceClient()
      .from('esocial_events')
      .select('esocial_event_id, raw_xml, metadata')
      .eq('organization_id', organizationId)
      .neq('event_type', 'RETORNO-LOTE')
      .order('esocial_event_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Falha ao reler os eventos: ${error.message}`);
    const rows = (data ?? []) as typeof out;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Preenche nos eventos já ingeridos os sinais de auditoria que só passaram a
 * ser extraídos agora (procedência, fechamento, alvo de exclusão).
 *
 * Sem isto, o painel de Controle eSocial só teria origem e exclusões dos
 * pacotes importados DEPOIS desta versão — o acervo histórico, que é o mais
 * interessante de auditar, apareceria vazio e pareceria um defeito.
 *
 * Agrupa por conteúdo idêntico e emite um UPDATE por grupo: as combinações
 * distintas são poucas (um emissor, meia dúzia de versões de software), então
 * o acervo inteiro cabe em um punhado de statements. Depois da primeira
 * passada não há mais diferença e a função não faz nada.
 */
export async function backfillEventMetadata(
  organizationId: string,
  patches: { esocial_event_id: string; metadata: Record<string, unknown> }[],
): Promise<number> {
  if (patches.length === 0) return 0;
  const db = getEsocialServiceClient();

  const groups = new Map<string, { metadata: Record<string, unknown>; ids: string[] }>();
  for (const patch of patches) {
    const key = JSON.stringify(patch.metadata);
    const group = groups.get(key) ?? { metadata: patch.metadata, ids: [] };
    group.ids.push(patch.esocial_event_id);
    groups.set(key, group);
  }

  let updated = 0;
  const CHUNK = 200;
  for (const group of groups.values()) {
    for (let i = 0; i < group.ids.length; i += CHUNK) {
      const ids = group.ids.slice(i, i + CHUNK);
      const { error } = await db
        .from('esocial_events')
        .update({ metadata: group.metadata })
        .eq('organization_id', organizationId)
        .in('esocial_event_id', ids);
      if (error) {
        // Auditoria é observabilidade: falhar aqui não pode derrubar a
        // reapuração, que é o que alimenta os indicadores de verdade.
        console.warn('[esocial] falha ao preencher metadados de auditoria:', error.message);
        return updated;
      }
      updated += ids.length;
    }
  }
  return updated;
}

export async function markEventsNormalized(organizationId: string, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const { error } = await getEsocialServiceClient()
    .from('esocial_events')
    .update({ status: 'normalized', normalized_at: new Date().toISOString() })
    .eq('organization_id', organizationId)
    .in('esocial_event_id', eventIds);
  if (error) console.warn('[esocial] falha ao marcar eventos normalizados:', error.message);
}

// ── Métricas ────────────────────────────────────────────────────────────────

export async function upsertCompetenceMetrics(rows: CompetenceMetricsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getEsocialServiceClient()
    .from('esocial_competence_metrics')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'organization_id,competence' },
    );
  if (error) throw new Error(`Falha ao gravar métricas por competência: ${error.message}`);
}

export async function upsertAreaMetrics(rows: AreaMetricsRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getEsocialServiceClient()
    .from('esocial_area_metrics')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'organization_id,competence,area_code' },
    );
  if (error) throw new Error(`Falha ao gravar métricas por área: ${error.message}`);
}

/**
 * Remove linhas de agregado que a reapuração não produziu mais.
 *
 * O upsert só sobrescreve o que reaparece; o que some fica para trás com o
 * valor velho. Não é hipótese: ao passar a atribuir o afastamento à lotação do
 * trabalhador, os dias saíram de "sem lotação informada" e foram para as áreas
 * reais — mas a linha antiga continuou no banco com os mesmos 561 dias, e
 * qualquer soma por área passou a contar tudo duas vezes.
 *
 * Roda depois do upsert, nunca antes: assim não existe janela em que o cockpit
 * leia um agregado vazio.
 */
export async function pruneMetrics(
  organizationId: string,
  competences: string[],
  areaKeys: { competence: string; area_code: string }[],
): Promise<void> {
  const db = getEsocialServiceClient();

  // Competências que deixaram de existir por completo.
  if (competences.length > 0) {
    const keep = `(${competences.map((c) => `"${c}"`).join(',')})`;
    // Uma competência sustentada apenas pelo contracheque não pode sumir
    // quando o acervo oficial é reapurado: ela é uma fonte paralela e
    // provisória, não um resíduo de evento removido.
    const { error: competenceError } = await db
      .from('esocial_competence_metrics')
      .delete()
      .eq('organization_id', organizationId)
      .eq('payslip_line_count', 0)
      .not('competence', 'in', keep);
    if (competenceError) console.warn('[esocial] falha ao limpar esocial_competence_metrics:', competenceError.message);

    const { error: areaError } = await db
      .from('esocial_area_metrics')
      .delete()
      .eq('organization_id', organizationId)
      .not('competence', 'in', keep);
    if (areaError) console.warn('[esocial] falha ao limpar esocial_area_metrics:', areaError.message);
  }

  // Áreas que deixaram de existir dentro de uma competência que permanece.
  const byCompetence = new Map<string, string[]>();
  for (const k of areaKeys) {
    byCompetence.set(k.competence, [...(byCompetence.get(k.competence) ?? []), k.area_code]);
  }
  for (const [competence, codes] of byCompetence) {
    const { error } = await db
      .from('esocial_area_metrics')
      .delete()
      .eq('organization_id', organizationId)
      .eq('competence', competence)
      .not('area_code', 'in', `(${codes.map((c) => `"${c}"`).join(',')})`);
    if (error) console.warn('[esocial] falha ao limpar áreas:', error.message);
  }
}

export interface EmploymentUpsert {
  organization_id: string;
  matricula: string;
  worker_cpf_hash: string;
  worker_cpf_mask?: string;
  worker_name?: string;
  admission_date?: string;
  termination_date?: string;
  termination_code?: string;
  cbo_code?: string;
  job_title?: string;
  area_code?: string;
  area_label?: string;
  contract_type?: string;
  status: 'active' | 'terminated';
}

export async function upsertEmployments(rows: EmploymentUpsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getEsocialServiceClient()
    .from('esocial_employments')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'organization_id,matricula' },
    );
  if (error) throw new Error(`Falha ao gravar vínculos: ${error.message}`);
}

/** Métricas já normalizadas — é daqui que o cockpit lê. */
export async function readCompetenceMetrics(
  organizationId: string,
  fromCompetence?: string,
): Promise<CompetenceMetricsRow[]> {
  let query = getEsocialServiceClient()
    .from('esocial_competence_metrics')
    .select('*')
    .eq('organization_id', organizationId)
    .order('competence', { ascending: true });
  if (fromCompetence) query = query.gte('competence', fromCompetence);
  const { data, error } = await query;
  if (error) throw new Error(`Falha ao ler métricas: ${error.message}`);
  return (data as CompetenceMetricsRow[] | null) ?? [];
}

export async function readAreaMetrics(
  organizationId: string,
  fromCompetence?: string,
): Promise<AreaMetricsRow[]> {
  let query = getEsocialServiceClient()
    .from('esocial_area_metrics')
    .select('*')
    .eq('organization_id', organizationId)
    .order('competence', { ascending: true });
  if (fromCompetence) query = query.gte('competence', fromCompetence);
  const { data, error } = await query;
  if (error) throw new Error(`Falha ao ler métricas por área: ${error.message}`);
  return (data as AreaMetricsRow[] | null) ?? [];
}

// ── Auditoria técnica ───────────────────────────────────────────────────────

/** Uma linha do acervo, sem o XML — o que a auditoria precisa e nada além. */
export interface EventIndexRow {
  esocial_event_id: string;
  event_type: string;
  competence: string | null;
  receipt_number: string | null;
  status: string;
  received_at: string;
  metadata: Record<string, unknown> | null;
}

/** Agregados da auditoria, calculados no banco (migration 086). */
export interface EsocialAuditCounts {
  byType: { event_type: string; total: number; competences: number; last_received_at: string | null }[];
  byOrigin: { proc_emi: string | null; ver_proc: string | null; total: number; competences: number }[];
  byCompetence: { competence: string; total: number }[];
}

/**
 * Contagens da auditoria em UMA ida ao banco.
 *
 * `null` quando a função ainda não existe na base — quem chama cai para a
 * contagem em memória, que é correta e só não escala. Uma migration pendente
 * não pode apagar o painel.
 */
export async function readAuditCounts(organizationId: string): Promise<EsocialAuditCounts | null> {
  const { data, error } = await getEsocialServiceClient().rpc('esocial_audit_counts', {
    p_organization_id: organizationId,
  });
  if (error) {
    // 42883 = função inexistente; PGRST202 = não encontrada no schema cache.
    if (error.code === '42883' || error.code === 'PGRST202') return null;
    if (isMissingTable(error)) throw new EsocialSchemaMissingError();
    throw new Error(`Falha ao apurar contagens da auditoria: ${error.message}`);
  }
  return (data as EsocialAuditCounts | null) ?? null;
}

/**
 * Índice do acervo, restrito a alguns tipos de evento.
 *
 * Deliberadamente SEM `raw_xml`: a auditoria classifica eventos, e o XML é a
 * maior parte do volume — trazê-lo transformaria uma consulta de contagem no
 * download do acervo inteiro.
 *
 * O `eventTypes` é o que mantém isto barato. Sem filtro, esta função lê o
 * acervo todo para dentro do Node; com filtro (S-1299 e S-3000, que são
 * dezenas por ano) ela lê o punhado de linhas que o painel precisa mostrar
 * uma a uma. As CONTAGENS vêm de `readAuditCounts`, no banco.
 */
export async function readEventIndex(
  organizationId: string,
  eventTypes?: string[],
): Promise<EventIndexRow[]> {
  const out: EventIndexRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let query = getEsocialServiceClient()
      .from('esocial_events')
      .select('esocial_event_id, event_type, competence, receipt_number, status, received_at, metadata')
      .eq('organization_id', organizationId)
      .order('esocial_event_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (eventTypes && eventTypes.length > 0) query = query.in('event_type', eventTypes);

    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) throw new EsocialSchemaMissingError();
      throw new Error(`Falha ao ler o índice de eventos: ${error.message}`);
    }
    const rows = (data ?? []) as EventIndexRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Recibos existentes entre os informados.
 *
 * Serve ao vínculo exclusão → evento excluído sem precisar do acervo inteiro
 * em memória: pergunta-se apenas pelos recibos que os S-3000 citam.
 */
export async function findExistingReceipts(
  organizationId: string,
  receipts: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  if (receipts.length === 0) return found;
  const CHUNK = 200;
  for (let i = 0; i < receipts.length; i += CHUNK) {
    const { data, error } = await getEsocialServiceClient()
      .from('esocial_events')
      .select('receipt_number')
      .eq('organization_id', organizationId)
      .in('receipt_number', receipts.slice(i, i + CHUNK));
    if (error) break;
    for (const row of (data ?? []) as { receipt_number: string | null }[]) {
      if (row.receipt_number) found.add(row.receipt_number);
    }
  }
  return found;
}

export interface EmploymentRow extends EmploymentUpsert {
  updated_at?: string;
}

/** Vínculos apurados — base do "quem está sem ASO válido". */
export async function readEmployments(
  organizationId: string,
  opts: { status?: 'active' | 'terminated' } = {},
): Promise<EmploymentRow[]> {
  let query = getEsocialServiceClient()
    .from('esocial_employments')
    .select('*')
    .eq('organization_id', organizationId);
  if (opts.status) query = query.eq('status', opts.status);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) throw new EsocialSchemaMissingError();
    throw new Error(`Falha ao ler vínculos: ${error.message}`);
  }
  return (data as EmploymentRow[] | null) ?? [];
}

// ── SST (S-2210 / S-2220 / S-2240) ──────────────────────────────────────────

export async function upsertSstEvents(rows: SstEventRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await getEsocialServiceClient()
    .from('esocial_sst_events')
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: 'organization_id,esocial_event_id' },
    );
  if (error) throw new Error(`Falha ao gravar eventos de SST: ${error.message}`);
}

/**
 * Remove as linhas de SST que a reapuração não produziu mais.
 *
 * Mesma razão de `pruneMetrics`: o upsert não apaga o que sumiu. Aqui o caso
 * concreto é o S-3000 — um evento excluído no eSocial some do pacote seguinte,
 * e sem a poda a CAT excluída continuaria contando para sempre.
 */
export async function pruneSstEvents(organizationId: string, keepIds: string[]): Promise<void> {
  const db = getEsocialServiceClient();
  let query = db.from('esocial_sst_events').delete().eq('organization_id', organizationId);
  if (keepIds.length > 0) {
    query = query.not('esocial_event_id', 'in', `(${keepIds.map((id) => `"${id}"`).join(',')})`);
  }
  const { error } = await query;
  if (error) console.warn('[esocial] falha ao limpar eventos de SST:', error.message);
}

export async function readSstEvents(
  organizationId: string,
  opts: { fromCompetence?: string; eventType?: SstEventRow['event_type'] } = {},
): Promise<SstEventRow[]> {
  let query = getEsocialServiceClient()
    .from('esocial_sst_events')
    .select('*')
    .eq('organization_id', organizationId)
    .order('event_date', { ascending: false, nullsFirst: false });
  if (opts.fromCompetence) query = query.gte('competence', opts.fromCompetence);
  if (opts.eventType) query = query.eq('event_type', opts.eventType);
  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) throw new EsocialSchemaMissingError();
    throw new Error(`Falha ao ler eventos de SST: ${error.message}`);
  }
  return (data as SstEventRow[] | null) ?? [];
}

export async function countActiveEmployments(organizationId: string): Promise<number> {
  const { count, error } = await getEsocialServiceClient()
    .from('esocial_employments')
    .select('matricula', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('status', 'active');
  if (error) throw new Error(`Falha ao contar vínculos ativos: ${error.message}`);
  return count ?? 0;
}

/** Assinatura estrutural usada pelo normalizador para agregar por competência. */
export type NormalizableEvent = ParsedEsocialEvent;
