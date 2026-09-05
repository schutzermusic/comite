/**
 * Áreas da carteira de contratos — a fonte única de nome e rota.
 *
 * A sidebar da aplicação e a página da carteira leem daqui. Enquanto a área
 * era estado local da página, a sidebar não tinha para onde apontar e não
 * havia link para uma área; com o slug público, o mesmo par (id, slug) serve
 * ao menu, à URL e ao estado ativo.
 *
 * Query param em vez de segmento de rota: `/contratos/[id]` já ocupa o
 * segmento seguinte, e `/contratos/obrigacoes` competiria com o dossiê de um
 * contrato pelo mesmo lugar na árvore de rotas.
 */

export type SectionId =
  | 'overview'
  | 'contracts'
  | 'renewals'
  | 'obligations'
  | 'faturamento'
  | 'aprovacoes'
  | 'risks'
  | 'documents';

export const sectionLabels: Record<SectionId, string> = {
  overview: 'Visão Geral',
  contracts: 'Contratos',
  renewals: 'Renovações',
  obligations: 'Obrigações',
  faturamento: 'Faturamentos',
  aprovacoes: 'Aprovações',
  risks: 'Riscos & Cláusulas',
  documents: 'Documentos',
};

/** Slug público e estável: o rótulo visível muda sem quebrar link salvo. */
export const SECTION_SLUGS: Record<SectionId, string> = {
  overview: 'visao-geral',
  contracts: 'contratos',
  renewals: 'renovacoes',
  obligations: 'obrigacoes',
  faturamento: 'faturamentos',
  aprovacoes: 'aprovacoes',
  risks: 'riscos-clausulas',
  documents: 'documentos',
};

export const SECTION_BY_SLUG = Object.fromEntries(
  Object.entries(SECTION_SLUGS).map(([id, slug]) => [slug, id as SectionId]),
) as Record<string, SectionId>;

/** Ordem de exibição no menu — a mesma da carteira. */
export const SECTION_ORDER: SectionId[] = [
  'overview',
  'contracts',
  'renewals',
  'obligations',
  'faturamento',
  'aprovacoes',
  'risks',
  'documents',
];

/**
 * URL de uma área. `overview` é a raiz: a carteira aberta sem parâmetro já
 * está na visão geral, e um `?view=visao-geral` redundante só faria duas URLs
 * significarem a mesma página.
 */
export function sectionHref(id: SectionId): string {
  return id === 'overview' ? '/contratos' : `/contratos?view=${SECTION_SLUGS[id]}`;
}
