'use client';

/**
 * Acesso à party canônica.
 *
 * ─── A regra que este arquivo existe para sustentar ────────────────────────
 *
 * Deduplicação SÓ determinística. A busca por documento normaliza dos dois
 * lados e compara por igualdade — nada de similaridade, nada de score, nada de
 * "provavelmente é a mesma empresa". Duas linhas que não se PROVAM a mesma
 * pessoa jurídica continuam duas linhas, e quem decide o contrário é gente,
 * olhando para um CNPJ.
 *
 * `searchParties` existe para o humano ACHAR o que já está cadastrado antes de
 * cadastrar de novo. Ela filtra por nome para exibir uma lista — o que é
 * assistência de digitação, não identidade. Nenhum código deste módulo decide
 * sozinho que dois cadastros são o mesmo.
 *
 * O escopo de organização não é passado como argumento em lugar nenhum: a RLS
 * da migration 102 já limita toda leitura e escrita ao inquilino da sessão, e
 * `organization_id` só aparece no INSERT porque a política o exige no
 * WITH CHECK. Reafirmar o filtro no cliente daria a impressão de que ele é a
 * defesa — não é, e nunca foi.
 */

import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import {
  normalizeDocument,
  isDocumentComplete,
  type CreatePartyInput,
  type PartyDocumentType,
  type PartyRoleKey,
  type PartyRoleRow,
  type PartyRow,
} from './types';

const PARTY_COLUMNS =
  'id, organization_id, kind, legal_name, trade_name, document_type, document_number, document_normalized, country_code, active, notes, source_system, external_key, created_by, updated_by, created_at, updated_at';

const PARTY_ROLE_COLUMNS =
  'id, organization_id, party_id, role, active, created_by, created_at, updated_at';

/**
 * Usuário e organização da sessão. Mesmo formato do `getCurrentIdentity()` de
 * `lib/contracts/contract-service.ts` — deliberadamente duplicado e não
 * importado: este módulo não depende do domínio de Contratos, e inverter essa
 * seta por uma função de dez linhas seria pagar caro por pouco.
 */
async function getCurrentIdentity() {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw new Error(`Erro ao carregar usuario autenticado: ${userError.message}`);
  if (!user) throw new Error('Usuario autenticado requerido para contrapartes.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle<{ organization_id: string | null }>();

  if (profileError) throw new Error(`Erro ao carregar organizacao do usuario: ${profileError.message}`);
  if (!profile?.organization_id) throw new Error('Usuario sem organizacao ativa.');

  return { supabase, user, organizationId: profile.organization_id };
}

/** Contrapartes ativas do inquilino da sessão, em ordem de razão social. */
export async function listParties(): Promise<PartyRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('parties')
    .select(PARTY_COLUMNS)
    .eq('active', true)
    .order('legal_name', { ascending: true });

  if (error) throw new Error(`Erro ao carregar contrapartes: ${error.message}`);
  return (data ?? []) as PartyRow[];
}

/**
 * Busca as parties cujo id foi pedido.
 *
 * Uma consulta para N registros, não N consultas — é o que uma listagem inteira
 * usa para resolver a contraparte canônica de cada linha. Ids inexistentes ou
 * invisíveis por RLS simplesmente não voltam: o chamador cai no texto livre, e
 * isso é o comportamento correto, não uma falha silenciosa.
 */
export async function fetchPartiesByIds(ids: readonly string[]): Promise<Map<string, PartyRow>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const supabase = createClient();
  const { data, error } = await supabase.from('parties').select(PARTY_COLUMNS).in('id', unique);

  if (error) throw new Error(`Erro ao carregar contrapartes: ${error.message}`);
  return new Map(((data ?? []) as PartyRow[]).map((party) => [party.id, party]));
}

/**
 * Procura por documento — a ÚNICA identificação determinística admitida.
 *
 * Devolve `null` quando o documento está incompleto, em vez de procurar com o
 * que houver: meio CNPJ não identifica ninguém, e uma consulta com meio CNPJ
 * traria a empresa errada com toda a confiança do mundo.
 */
export async function findPartyByDocument(
  documentType: PartyDocumentType | null | undefined,
  documentNumber: string | null | undefined,
): Promise<PartyRow | null> {
  if (!documentType) return null;
  if (!isDocumentComplete(documentType, documentNumber)) return null;

  const normalized = normalizeDocument(documentType, documentNumber);

  /*
    `foreign` NÃO identifica ninguém deterministicamente, e esta função devolve
    `null` para ele de propósito.

    Quem diz isso é o próprio schema: `uq_parties_org_document` cobre
    (organization_id, document_type, document_normalized) WHERE
    document_normalized IS NOT NULL — e `document_normalized` é NULL para
    documento estrangeiro. Ou seja, o banco declara que não há unicidade ali.

    Comparar o número estrangeiro por igualdade daria uma resposta com cara de
    prova que ninguém garante: dois cadastros com o mesmo texto não provam a
    mesma pessoa jurídica, e formatos estrangeiros não têm normalização
    canônica para arbitrar. Preferir `null` mantém a regra da Fase 1 — sem
    evidência determinística, os registros permanecem distintos — em vez de
    produzir um casamento que o índice não sustenta.
  */
  if (normalized === null) return null;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('parties')
    .select(PARTY_COLUMNS)
    .eq('document_type', documentType)
    .eq('document_normalized', normalized)
    .maybeSingle<PartyRow>();

  if (error) throw new Error(`Erro ao procurar contraparte por documento: ${error.message}`);
  return data ?? null;
}

/**
 * Lista para o seletor da interface.
 *
 * O filtro por nome é ASSISTÊNCIA DE DIGITAÇÃO, e o nome desta função diz
 * "search" por isso — em momento algum o resultado é tratado como identidade.
 * Quem escolhe uma linha desta lista é uma pessoa.
 */
export async function searchParties(term: string, limit = 20): Promise<PartyRow[]> {
  const supabase = createClient();
  const trimmed = term.trim();

  let query = supabase.from('parties').select(PARTY_COLUMNS).eq('active', true);
  if (trimmed) {
    // Caracteres que teriam significado na sintaxe de `or`/`ilike` do PostgREST
    // viram espaço: o usuário digita nome de empresa, não padrão de busca.
    const escaped = trimmed.replace(/[%_,()]/g, ' ');
    query = query.or(`legal_name.ilike.%${escaped}%,trade_name.ilike.%${escaped}%`);
  }

  const { data, error } = await query.order('legal_name', { ascending: true }).limit(limit);
  if (error) throw new Error(`Erro ao procurar contrapartes: ${error.message}`);
  return (data ?? []) as PartyRow[];
}

/**
 * Cria uma contraparte.
 *
 * Se o documento já existir na organização, devolve a linha existente em vez de
 * tentar inserir: o índice único `uq_parties_org_document` recusaria de todo
 * jeito, e devolver a party certa é mais útil do que devolver o erro do banco.
 * Isso NÃO é um merge — é a mesma identidade, provada pelo documento.
 *
 * Sem documento, cria. Duas empresas homônimas sem CNPJ são duas linhas, e está
 * certo: nome não é identidade, e nenhuma linha deste arquivo vai fingir que é.
 */
export async function createParty(input: CreatePartyInput): Promise<PartyRow> {
  const { supabase, user, organizationId } = await getCurrentIdentity();

  const documentType = input.documentType ?? null;
  const documentNumber = input.documentNumber?.trim() || null;

  if (documentType && !isDocumentComplete(documentType, documentNumber)) {
    throw new Error(
      `Documento ${documentType.toUpperCase()} incompleto. Informe-o por inteiro ou deixe-o em branco — contraparte sem documento é cadastro legítimo.`,
    );
  }

  const existing = await findPartyByDocument(documentType, documentNumber);
  if (existing) {
    if (input.roles?.length) await assignPartyRoles(existing.id, input.roles);
    return existing;
  }

  const { data, error } = await supabase
    .from('parties')
    .insert({
      organization_id: organizationId,
      kind: input.kind ?? 'organization',
      legal_name: input.legalName.trim(),
      trade_name: input.tradeName?.trim() || null,
      document_type: documentType,
      document_number: documentNumber,
      country_code: input.countryCode || 'BR',
      notes: input.notes?.trim() || null,
      // A política de INSERT exige created_by = auth.uid(): autoria não é
      // metadado opcional aqui, é condição de gravação.
      created_by: user.id,
      updated_by: user.id,
    })
    .select(PARTY_COLUMNS)
    .single<PartyRow>();

  if (error) throw new Error(`Erro ao criar contraparte: ${error.message}`);
  if (!data) throw new Error('Contraparte criada sem retorno do banco.');

  if (input.roles?.length) await assignPartyRoles(data.id, input.roles);

  await logAuditEvent({
    organizationId,
    action: 'party.created',
    entityType: 'party',
    entityId: data.id,
    metadata: {
      legal_name: data.legal_name,
      document_type: data.document_type,
      // O número do documento NÃO vai para a metadata: auditoria registra que a
      // identidade nasceu, não republica o dado cadastral numa segunda tabela
      // com política de acesso diferente.
      has_document: Boolean(data.document_normalized || data.document_number),
      roles: input.roles ?? [],
    },
  });

  return data;
}

/** Papéis de uma party. Vazio é resposta legítima: identidade não exige papel. */
export async function listPartyRoles(partyId: string): Promise<PartyRoleRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('party_roles')
    .select(PARTY_ROLE_COLUMNS)
    .eq('party_id', partyId)
    .eq('active', true);

  if (error) throw new Error(`Erro ao carregar papéis da contraparte: ${error.message}`);
  return (data ?? []) as PartyRoleRow[];
}

/**
 * Atribui papéis. Idempotente por `uq_party_roles_party_role`.
 *
 * Atribuir não substitui: uma party que já é `supplier` e ganha `customer`
 * passa a ser as duas coisas. Papel é acumulativo porque a realidade é.
 */
export async function assignPartyRoles(
  partyId: string,
  roles: readonly PartyRoleKey[],
): Promise<void> {
  if (roles.length === 0) return;
  const { supabase, user, organizationId } = await getCurrentIdentity();

  const { error } = await supabase.from('party_roles').upsert(
    Array.from(new Set(roles)).map((role) => ({
      organization_id: organizationId,
      party_id: partyId,
      role,
      created_by: user.id,
    })),
    { onConflict: 'party_id,role', ignoreDuplicates: true },
  );

  if (error) throw new Error(`Erro ao atribuir papéis à contraparte: ${error.message}`);
}
