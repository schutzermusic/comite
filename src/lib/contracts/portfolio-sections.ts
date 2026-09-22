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

// ===========================================================================
// PÓS-VENDA: cinco FASES no menu, oito PAINÉIS por dentro
//
// ─── Por que os dois vocabulários convivem ─────────────────────────────────
//
// `SectionId` acima é o vocabulário dos PAINÉIS — as oito telas que já
// existem, funcionam e continuam inteiras. O que muda é a NAVEGAÇÃO: o menu
// deixa de ter um destino por objeto de domínio e passa a ter um destino por
// fase de trabalho.
//
// Apagar as oito e reescrever a carteira num único componente custaria a
// reescrita de 2.700 linhas testadas para entregar a MESMA informação. O que
// estava errado nunca foi o conteúdo dos painéis: era o menu ensinar a
// estrutura interna do sistema a quem só quer saber onde está o contrato.
//
// ─── O agrupamento ─────────────────────────────────────────────────────────
//
// Carteira reúne os cinco painéis que são PROPRIEDADES de um item —
// contratos, renovações, obrigações, riscos e documentos. Dentro da Carteira
// eles aparecem como contexto do item, não como endereços independentes.
// Faturamento e Medições & Aprovações continuam sozinhos porque são fases de
// trabalho com fila própria e dono próprio.
// ===========================================================================

import {
  POST_SALE_SECTION_ORDER, POST_SALE_SECTION_BY_SLUG,
  postSaleSectionLabels, postSaleSectionHref,
  type PostSaleSectionId,
} from '@/lib/commercial/navigation';

export {
  POST_SALE_SECTION_ORDER, POST_SALE_SECTION_BY_SLUG,
  postSaleSectionLabels, postSaleSectionHref,
};
export type { PostSaleSectionId };

/** Quais painéis existentes vivem dentro de cada fase. */
export const PANELS_IN_SECTION: Record<PostSaleSectionId, SectionId[]> = {
  overview: ['overview'],
  carteira: ['contracts', 'renewals', 'obligations', 'risks', 'documents'],
  // Ordens de Serviço ainda não tem painel legado: ele nasce com o módulo de
  // OS interna e é resolvido pela própria página. A lista vazia é a resposta
  // honesta, e a página trata esse caso em vez de cair num painel errado.
  serviceOrders: [],
  measurements: ['aprovacoes'],
  billing: ['faturamento'],
};

/** A fase a que um painel pertence — o caminho inverso, para links antigos. */
export const SECTION_OF_PANEL: Record<SectionId, PostSaleSectionId> = {
  overview: 'overview',
  contracts: 'carteira',
  renewals: 'carteira',
  obligations: 'carteira',
  risks: 'carteira',
  documents: 'carteira',
  aprovacoes: 'measurements',
  faturamento: 'billing',
};

/**
 * Resolve `?view=` aceitando tanto os slugs novos quanto os oito antigos.
 *
 * Um link salvo para `?view=obrigacoes` continua funcionando: ele abre a
 * Carteira já no contexto de obrigações. Redirecionar para a raiz seria
 * "quebrar devagar" — a URL responde, mas leva ao lugar errado.
 */
export function resolvePostSaleView(raw: string | null): {
  section: PostSaleSectionId;
  panel: SectionId;
} {
  const slug = raw ?? '';
  const legacyPanel = SECTION_BY_SLUG[slug];
  if (legacyPanel) return { section: SECTION_OF_PANEL[legacyPanel], panel: legacyPanel };

  const section = POST_SALE_SECTION_BY_SLUG[slug] ?? 'overview';
  const panels = PANELS_IN_SECTION[section];
  return { section, panel: panels[0] ?? 'overview' };
}
