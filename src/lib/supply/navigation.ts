/**
 * Navegação do SUPPLY CHAIN — seis destinos, e param aí. Requisição, RFQ,
 * cotação, reserva, transferência e recebimento são abas dentro das telas.
 */
import type { DomainNavItem } from '@/lib/operations/navigation';

export const SUPPLY_NAV: DomainNavItem[] = [
  { id: 'overview', label: 'Visão Geral', href: '/supply', anyPermission: ['supply.view'] },
  { id: 'materialPlanning', label: 'Planejamento de Materiais', href: '/supply/planejamento-materiais',
    anyPermission: ['supply.view'] },
  { id: 'inventory', label: 'Estoque', href: '/supply/estoque', anyPermission: ['inventory.view', 'supply.view'] },
  { id: 'procurement', label: 'Compras', href: '/supply/compras', anyPermission: ['procurement.view', 'supply.view'] },
  { id: 'suppliers', label: 'Fornecedores', href: '/supply/fornecedores', anyPermission: ['suppliers.view', 'procurement.view'] },
  { id: 'receiving', label: 'Recebimentos & Logística', href: '/supply/recebimentos',
    anyPermission: ['receiving.view', 'supply.view', 'procurement.view'] },
];

export const SUPPLY_GROUP_PERMISSIONS = Array.from(new Set(SUPPLY_NAV.flatMap((i) => i.anyPermission)));

export function isSupplyRoute(pathname: string): boolean {
  return pathname === '/supply' || pathname.startsWith('/supply/');
}
