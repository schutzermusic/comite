/**
 * Quadro informado manualmente por competência.
 *
 * Existe porque o pacote do eSocial Download nem sempre traz o detalhe por
 * trabalhador. Em 2025 vieram as guias consolidadas e um único S-1200: o
 * headcount apurado sai como 1 onde havia ~250, e tudo o que divide por pessoa
 * explode (custo médio de R$ 871.670/colaborador).
 *
 * Não confundir com os dados de demonstração que este módulo deixou de ter. A
 * diferença é PROCEDÊNCIA: aqui um administrador afirma um número a partir de
 * um documento, e essa afirmação fica registrada com autor, data e origem. Um
 * mock é um número que o sistema inventa e ninguém assina.
 *
 * Vive fora de `esocial_competence_metrics` de propósito — aquela tabela é
 * reescrita inteira a cada reapuração, e o valor manual sumiria na próxima
 * importação.
 */
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/workforce/manual-headcount.ts não pode ser importado no browser');
}

export interface ManualHeadcountRow {
  competence: string;
  headcount: number;
  source_note: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ManualHeadcountInput {
  competence: string;
  headcount: number;
  sourceNote: string;
}

/** 'AAAA-MM' mensal. O 13º (AAAA-13) não tem quadro próprio. */
const COMPETENCE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class ManualHeadcountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualHeadcountValidationError';
  }
}

/**
 * Valida o lançamento antes de tocar o banco.
 *
 * A origem é obrigatória por decisão de produto, não por capricho do schema:
 * sem ela o número vira folclore em poucos meses, e ninguém consegue dizer se
 * veio da folha analítica ou de uma lembrança.
 */
export function validateManualHeadcount(input: ManualHeadcountInput): ManualHeadcountInput {
  const competence = String(input.competence ?? '').trim();
  if (!COMPETENCE_RE.test(competence)) {
    throw new ManualHeadcountValidationError('Competência inválida — use o formato AAAA-MM.');
  }
  if (!Number.isInteger(input.headcount) || input.headcount < 0) {
    throw new ManualHeadcountValidationError('Informe a quantidade de colaboradores como número inteiro.');
  }
  if (input.headcount > 1_000_000) {
    throw new ManualHeadcountValidationError('Quantidade de colaboradores fora de qualquer faixa plausível.');
  }
  const sourceNote = String(input.sourceNote ?? '').trim();
  if (sourceNote.length < 3) {
    throw new ManualHeadcountValidationError(
      'Informe a origem do número (ex.: "folha analítica Domínio, jan/2025").',
    );
  }
  return { competence, headcount: input.headcount, sourceNote: sourceNote.slice(0, 500) };
}

let _client: SupabaseClient | null = null;

function serviceClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado para ajustes manuais de quadro.');
  _client = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _client;
}

export async function listManualHeadcount(organizationId: string): Promise<ManualHeadcountRow[]> {
  const { data, error } = await serviceClient()
    .from('workforce_manual_headcount')
    .select('competence, headcount, source_note, updated_at, updated_by')
    .eq('organization_id', organizationId)
    .order('competence', { ascending: true });
  if (error) throw new Error(`Falha ao ler ajustes de quadro: ${error.message}`);
  return (data as ManualHeadcountRow[] | null) ?? [];
}

export async function saveManualHeadcount(
  organizationId: string,
  userId: string,
  input: ManualHeadcountInput,
): Promise<void> {
  const valid = validateManualHeadcount(input);
  const { error } = await serviceClient()
    .from('workforce_manual_headcount')
    .upsert(
      {
        organization_id: organizationId,
        competence: valid.competence,
        headcount: valid.headcount,
        source_note: valid.sourceNote,
        created_by: userId,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,competence' },
    );
  if (error) throw new Error(`Falha ao gravar ajuste de quadro: ${error.message}`);
}

export async function deleteManualHeadcount(
  organizationId: string,
  competence: string,
): Promise<void> {
  const { error } = await serviceClient()
    .from('workforce_manual_headcount')
    .delete()
    .eq('organization_id', organizationId)
    .eq('competence', competence);
  if (error) throw new Error(`Falha ao remover ajuste de quadro: ${error.message}`);
}
