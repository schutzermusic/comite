/**
 * Navegação do Comercial e do PÓS-VENDA.
 *
 * ─── Por que o pós-venda encolheu ────────────────────────────────────────
 *
 * A carteira expunha OITO áreas no menu — Contratos, Renovações, Obrigações,
 * Faturamentos, Aprovações, Riscos & Cláusulas, Documentos, Visão Geral —
 * como se cada objeto de domínio merecesse um destino. O efeito prático é que
 * a pessoa precisa saber a ORGANIZAÇÃO INTERNA do sistema para achar a
 * obrigação de um contrato: ela abre "Obrigações", filtra pelo contrato, e
 * reconstrói na cabeça o dossiê que o sistema já tem.
 *
 * As cinco áreas abaixo são FASES DE TRABALHO, não objetos. Contrato,
 * proposta, pedido, obrigação, aditivo, renovação, risco e documento
 * continuam existindo inteiros — dentro do item da carteira, que é onde a
 * pergunta sobre eles nasce.
 *
 * ─── Compatibilidade de link ─────────────────────────────────────────────
 *
 * Os slugs antigos continuam resolvendo (ver `LEGACY_SECTION_REDIRECTS`), e
 * por isso link salvo, favorito e permissão de rota não quebram.
 */

export type PostSaleSectionId =
  | 'overview' | 'carteira' | 'serviceOrders' | 'measurements' | 'billing';

export const postSaleSectionLabels: Record<PostSaleSectionId, string> = {
  overview: 'Visão Geral',
  carteira: 'Carteira',
  serviceOrders: 'Ordens de Serviço',
  measurements: 'Medições & Aprovações',
  billing: 'Faturamento',
};

export const POST_SALE_SECTION_SLUGS: Record<PostSaleSectionId, string> = {
  overview: 'visao-geral',
  carteira: 'carteira',
  serviceOrders: 'ordens-de-servico',
  measurements: 'medicoes',
  billing: 'faturamento',
};

export const POST_SALE_SECTION_ORDER: PostSaleSectionId[] =
  ['overview', 'carteira', 'serviceOrders', 'measurements', 'billing'];

/**
 * Para onde vão os slugs das oito áreas antigas.
 *
 * Nada some: cada um cai na FASE que responde à mesma pergunta. Contratos,
 * renovações, obrigações, riscos e documentos são propriedades de um item da
 * carteira — vão para Carteira, e o dossiê do item abre a seção certa.
 */
export const LEGACY_SECTION_REDIRECTS: Record<string, PostSaleSectionId> = {
  'visao-geral': 'overview',
  contratos: 'carteira',
  renovacoes: 'carteira',
  obrigacoes: 'carteira',
  'riscos-clausulas': 'carteira',
  documentos: 'carteira',
  faturamentos: 'billing',
  aprovacoes: 'measurements',
};

export const POST_SALE_SECTION_BY_SLUG: Record<string, PostSaleSectionId> = {
  ...LEGACY_SECTION_REDIRECTS,
  ...Object.fromEntries(
    Object.entries(POST_SALE_SECTION_SLUGS).map(([id, slug]) => [slug, id as PostSaleSectionId]),
  ),
};

export function postSaleSectionHref(id: PostSaleSectionId): string {
  return id === 'overview' ? '/contratos' : `/contratos?view=${POST_SALE_SECTION_SLUGS[id]}`;
}

/**
 * Comercial (pré-venda). Seis áreas, e para de crescer aí: o escopo é
 * explícito em não querer um CRM completo.
 */
export type CommercialSectionId =
  | 'overview' | 'accounts' | 'opportunities' | 'followups' | 'proposals' | 'forecast';

export const commercialSectionLabels: Record<CommercialSectionId, string> = {
  overview: 'Visão Geral',
  accounts: 'Contas & Contatos',
  opportunities: 'Oportunidades',
  followups: 'Follow-ups',
  proposals: 'Propostas',
  forecast: 'Forecast',
};

export const COMMERCIAL_SECTION_SLUGS: Record<CommercialSectionId, string> = {
  overview: 'visao-geral',
  accounts: 'contas',
  opportunities: 'oportunidades',
  followups: 'follow-ups',
  proposals: 'propostas',
  forecast: 'forecast',
};

export const COMMERCIAL_SECTION_ORDER: CommercialSectionId[] =
  ['overview', 'accounts', 'opportunities', 'followups', 'proposals', 'forecast'];

export const COMMERCIAL_SECTION_BY_SLUG = Object.fromEntries(
  Object.entries(COMMERCIAL_SECTION_SLUGS).map(([id, slug]) => [slug, id as CommercialSectionId]),
) as Record<string, CommercialSectionId>;

export function commercialSectionHref(id: CommercialSectionId): string {
  return id === 'overview' ? '/comercial' : `/comercial?view=${COMMERCIAL_SECTION_SLUGS[id]}`;
}

/** As quatro portas do "+ Adicionar" da Carteira. */
export const CARTEIRA_INTAKE_OPTIONS = [
  { id: 'contract', label: 'Novo contrato para análise',
    hint: 'Sobe o PDF e lê com a mesma extração de sempre. Fica Em análise até alguém revisar.' },
  { id: 'proposal', label: 'Importar proposta aprovada',
    hint: 'Traz a revisão ACEITA como fonte de autorização. Não cria contrato nenhum.' },
  { id: 'purchase_order', label: 'Registrar pedido/autorização',
    hint: 'Pedido de compra ou autorização formal do cliente, com o documento anexado.' },
  { id: 'manual', label: 'Criar manualmente',
    hint: 'Para trabalho autorizado cuja papelada chega depois. Nasce Em análise, fora dos KPIs.' },
] as const;

export type CarteiraIntakeOption = (typeof CARTEIRA_INTAKE_OPTIONS)[number]['id'];
