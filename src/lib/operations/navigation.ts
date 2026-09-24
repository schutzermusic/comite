/**
 * Navegação de OPERAÇÕES e SUPPLY CHAIN — fonte única de rótulo, rota e alçada.
 *
 * Seis destinos por domínio, e param aí. Requisição, cotação, reserva,
 * transferência e recebimento são abas DENTRO das telas, não itens de menu:
 * o menu ensina onde está a decisão, não a estrutura interna do sistema.
 */

export interface DomainNavItem {
  id: string;
  label: string;
  href: string;
  /** Qualquer uma libera o item. */
  anyPermission: string[];
}

export const OPERATIONS_NAV: DomainNavItem[] = [
  { id: 'overview', label: 'Visão Geral', href: '/operacoes', anyPermission: ['operations.view'] },
  { id: 'serviceOrders', label: 'Ordens de Serviço', href: '/operacoes/ordens-servico',
    anyPermission: ['operations.view'] },
  { id: 'projects', label: 'Projetos', href: '/projetos', anyPermission: ['projects.view', 'projects.view_all'] },
  { id: 'map', label: 'Mapa de Operações', href: '/projetos/operations-3d',
    anyPermission: ['projects.view', 'projects.view_all'] },
  { id: 'planning', label: 'Planejamento', href: '/operacoes/planejamento',
    anyPermission: ['operations.planning.view'] },
  { id: 'measurements', label: 'Medições & Evidências', href: '/operacoes/medicoes',
    anyPermission: ['operations.view'] },
];

/** O grupo abre para quem vê QUALQUER destino dele. */
export const OPERATIONS_GROUP_PERMISSIONS = Array.from(new Set(OPERATIONS_NAV.flatMap((i) => i.anyPermission)));

/** Rotas que pertencem ao grupo Operações (o grupo acende nelas). */
export function isOperationsRoute(pathname: string): boolean {
  return pathname === '/operacoes' || pathname.startsWith('/operacoes/')
    || pathname === '/projetos' || pathname.startsWith('/projetos/');
}
