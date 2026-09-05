/**
 * Party canônica — tipos de plataforma.
 *
 * ─── O que esta camada é, e o que ela não é ────────────────────────────────
 *
 * `PartyRow` é IDENTIDADE: quem é esta pessoa jurídica ou natural. Nada além
 * disso. Papel vive em `PartyRoleRow`; endereço, inscrição municipal e dados de
 * emissão fiscal vivem nas extensões de domínio, e não aqui.
 *
 * A separação não é estética. ACME Energia S.A. que é cliente e fornecedora é
 * UMA identidade com dois papéis — se papel fosse campo de `PartyRow`, seriam
 * dois cadastros da mesma empresa, e toda pergunta do tipo "quanto essa empresa
 * nos deve, somando tudo" passaria a exigir um casamento por nome. Que é
 * exatamente o que não se pode fazer.
 *
 * Espelha as migrations 102/103. Sem React, sem I/O.
 */

/** Pessoa jurídica ou natural. NÃO é papel. */
export type PartyKind = 'organization' | 'person';

/**
 * Tipo de documento. `foreign` cobre a contraparte sem CNPJ/CPF — que existe, e
 * cujo cadastro não pode ser impedido por isso.
 */
export type PartyDocumentType = 'cnpj' | 'cpf' | 'foreign';

/**
 * Vocabulário canônico de `party_roles.role`.
 *
 * Espelha EXATAMENTE `party_role_vocabulary()` na migration 102 e o CHECK
 * `party_roles_role_check`. Mudar um lado sem o outro quebra — que é o ponto.
 *
 * São DOIS porque são dois os que têm lastro no banco de hoje:
 *
 *   customer  tabela `client`, projects.project->>'cliente'
 *   supplier  tabela `supplier`
 *
 * "Contratada" e "contratante" NÃO estão aqui, e a ausência é deliberada: elas
 * descrevem a posição de uma party dentro de um contrato específico, não uma
 * verdade sobre a party. A mesma empresa é contratada num instrumento e
 * contratante noutro, simultaneamente — guardar isso em cadastro mestre
 * obrigaria a tabela a afirmar algo que ela não tem como qualificar. Essa
 * relação pertence à modelagem do domínio de Contratos, numa fase posterior.
 *
 * Subcontratada, seguradora, banco e fiscalizadora também ficaram de fora:
 * nenhum tem hoje linha, tela ou regra que o exija. Ampliar depois é uma linha
 * nesta lista, uma na função SQL e uma no CHECK.
 */
export type PartyRoleKey = 'customer' | 'supplier';

export const PARTY_ROLE_VOCABULARY: readonly PartyRoleKey[] = ['customer', 'supplier'] as const;

export function isPartyRoleKey(value: unknown): value is PartyRoleKey {
  return typeof value === 'string' && (PARTY_ROLE_VOCABULARY as readonly string[]).includes(value);
}

/** Rótulos em português para a interface. O vocabulário armazenado segue em inglês. */
export const PARTY_ROLE_LABEL: Record<PartyRoleKey, string> = {
  customer: 'Cliente',
  supplier: 'Fornecedor',
};

export const PARTY_KIND_LABEL: Record<PartyKind, string> = {
  organization: 'Pessoa jurídica',
  person: 'Pessoa física',
};

/** Linha de `public.parties`. */
export type PartyRow = {
  id: string;
  organization_id: string;
  kind: PartyKind;
  legal_name: string;
  trade_name: string | null;
  document_type: PartyDocumentType | null;
  document_number: string | null;
  /** Coluna GERADA: só dígitos. Nunca escrever — o banco a calcula. */
  document_normalized: string | null;
  country_code: string;
  active: boolean;
  notes: string | null;
  source_system: string;
  external_key: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Linha de `public.party_roles`. */
export type PartyRoleRow = {
  id: string;
  organization_id: string;
  party_id: string;
  role: PartyRoleKey;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreatePartyInput = {
  legalName: string;
  kind?: PartyKind;
  tradeName?: string | null;
  documentType?: PartyDocumentType | null;
  documentNumber?: string | null;
  countryCode?: string;
  notes?: string | null;
  /** Papéis a atribuir na criação. Vazio é legítimo: identidade não exige papel. */
  roles?: readonly PartyRoleKey[];
};

/**
 * Documento reduzido a dígitos.
 *
 * Espelha a coluna gerada `parties.document_normalized`. Existe do lado do
 * cliente para uma coisa só: procurar antes de criar, de modo que
 * '12.345.678/0001-95' encontre a linha gravada como '12345678000195' em vez de
 * criar uma segunda empresa.
 *
 * Só se aplica a cnpj/cpf. Documento estrangeiro não tem formato canônico para
 * normalizar, e fingir que tem produziria falsos encontros.
 */
export function normalizeDocument(
  documentType: PartyDocumentType | null | undefined,
  documentNumber: string | null | undefined,
): string | null {
  if (documentType !== 'cnpj' && documentType !== 'cpf') return null;
  const digits = (documentNumber ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

/** Comprimento exigido pelos CHECKs `parties_cnpj_len` / `parties_cpf_len`. */
export const DOCUMENT_LENGTH: Record<'cnpj' | 'cpf', number> = { cnpj: 14, cpf: 11 };

/**
 * O documento está completo o bastante para o banco aceitar?
 *
 * Deliberadamente NÃO valida dígito verificador. O banco também não: um CNPJ
 * com DV inválido é um erro de digitação a ser corrigido, não uma identidade a
 * ser recusada no cadastro — e recusá-la aqui empurraria o usuário de volta ao
 * texto livre, que é o problema que esta fase existe para reduzir.
 */
export function isDocumentComplete(
  documentType: PartyDocumentType | null | undefined,
  documentNumber: string | null | undefined,
): boolean {
  if (!documentType) return true;
  if (documentType === 'foreign') return Boolean(documentNumber && documentNumber.trim());
  const normalized = normalizeDocument(documentType, documentNumber);
  return normalized !== null && normalized.length === DOCUMENT_LENGTH[documentType];
}

/** Nome de exibição: fantasia quando existe, razão social como base sempre. */
export function partyDisplayName(party: Pick<PartyRow, 'legal_name' | 'trade_name'>): string {
  return party.trade_name?.trim() || party.legal_name;
}
