/**
 * Primitivas de casca do módulo de Contratos.
 *
 * Construídas uma vez e reusadas — a alternativa (um componente sob medida por
 * tela) foi justamente o que produziu o excesso de molduras que este trabalho
 * desfaz.
 */
export { SectionHeader, type SectionHeaderProps } from './SectionHeader';
export { MetricRow, type MetricRowProps, type MetricRowItem } from './MetricRow';
export { InlineEmpty, type InlineEmptyProps } from './InlineEmpty';
export { StatusRow, type StatusRowProps } from './StatusRow';
export { AuditTimeline, type AuditTimelineProps } from './AuditTimeline';
export { HistoryDrawer, type HistoryDrawerProps } from './HistoryDrawer';
export { DossierNav, type DossierNavProps, type DossierNavItem } from './DossierNav';
export { MetricStrip, type MetricStripProps, type MetricStripItem } from './MetricStrip';
export { PortfolioContextStrip, type PortfolioContextStripProps } from './PortfolioContextStrip';
/**
 * `PortfolioKpiCards` segue exportado para o dossiê de um contrato, que ainda
 * lê a carteira inteira como contexto. A CARTEIRA passou a usar
 * `ContractsKpiStrip`, cujos indicadores são definidos por área em
 * `trust/section-kpis.ts` — uma tira idêntica acima de oito áreas diferentes
 * era a razão de ninguém olhar para nenhuma delas.
 */
export { PortfolioKpiCards, type PortfolioKpiCardsProps } from './PortfolioKpiCards';
export { ContractsKpiStrip, type ContractsKpiStripProps } from './ContractsKpiStrip';
/**
 * Distribuição + filtro. Substituiu as grades de cartões que repetiam, dentro
 * do painel, os mesmos indicadores da tira executiva da área.
 */
export {
  DistributionRail,
  type DistributionRailProps,
  type DistributionSegment,
  type DistributionTone,
} from './DistributionRail';
