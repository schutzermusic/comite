import type { RoleKey } from './types';

export const ROLE_PRIORITY: RoleKey[] = [
  'owner_admin',
  'ceo_diretoria',
  'financeiro',
  'gestor_projetos',
  'juridico_contratos',
  'rh',
  'engenharia_pcp',
];

export const ROLE_LABELS: Record<string, string> = {
  owner_admin: 'Owner / Admin',
  ceo_diretoria: 'CEO / Diretoria',
  financeiro: 'Financeiro',
  gestor_projetos: 'Gestor de Projetos',
  juridico_contratos: 'Juridico / Contratos',
  rh: 'RH',
  engenharia_pcp: 'Engenharia / PCP',
};

export function getHighestPriorityRole(roleKeys: RoleKey[]) {
  return ROLE_PRIORITY.find((roleKey) => roleKeys.includes(roleKey)) ?? roleKeys[0] ?? null;
}

export function getDefaultRouteForRole(roleKey: RoleKey | null | undefined) {
  switch (roleKey) {
    case 'owner_admin':
    case 'ceo_diretoria':
    case 'financeiro':
      return '/dashboard';
    case 'gestor_projetos':
      return '/projetos';
    case 'juridico_contratos':
      return '/contratos';
    case 'rh':
      return '/workforce-cost';
    case 'engenharia_pcp':
      return '/projetos?view=planejamento';
    default:
      return '/dashboard';
  }
}
