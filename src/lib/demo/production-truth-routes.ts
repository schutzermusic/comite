const MOCK_ONLY_PREFIXES = [
  '/comites', '/membros', '/roles', '/workflows', '/historico', '/relatorios',
  '/votacoes', '/organograma', '/pautas/nova',
];

const LEGACY_FINANCE_PREFIXES = [
  '/financeiro/alocacao', '/financeiro/analise-custos', '/financeiro/bancos',
  '/financeiro/centros-custo', '/financeiro/contas', '/financeiro/contas-pagar-receber',
  '/financeiro/contratos-receita',
  '/financeiro/control-room', '/financeiro/dre-gerencial', '/financeiro/fechamento',
  '/financeiro/folha', '/financeiro/folha-alocacao', '/financeiro/forecast-cenarios',
  '/financeiro/lancamentos',
  '/financeiro/orcado-realizado', '/financeiro/projetos-margens',
  '/financeiro/relatorios-diretoria',
];

export function isMockOnlyRoute(pathname: string): boolean {
  if (pathname === '/financeiro') return true;
  if (LEGACY_FINANCE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  if (MOCK_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  return /^\/projetos\/[^/]+\/analytics(?:\/|$)/.test(pathname);
}
