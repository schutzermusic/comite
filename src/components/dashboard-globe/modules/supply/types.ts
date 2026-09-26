import type { SiteSupplyData } from '@/lib/dashboard/types';

/** O que toda etapa do fluxo do Supply recebe. */
export interface FlowCtx {
  data: SiteSupplyData;
  /** Hoje em São Paulo (YYYY-MM-DD). */
  today: string;
  projectId: string;
  siteName: string;
  /** Depois de um ato: avisa as leituras abertas, a página relê o local e o módulo relê o Supply. */
  afterAct: () => void;
}
