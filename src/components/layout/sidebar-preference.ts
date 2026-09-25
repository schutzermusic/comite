/**
 * Preferência de sidebar aberta/recolhida — compartilhada entre o layout do
 * SERVIDOR e o `SidebarShell` do cliente (por isso sem "use client").
 *
 * Mora num cookie, não no localStorage: o servidor precisa renderizar o
 * mesmo estado que o cliente vai hidratar. Com a preferência só no navegador,
 * o shell renderizava "aberta" e trocava depois de montar — e a `AppSidebar`,
 * que hidrata mais tarde dentro de um limite de Suspense, hidratava já com o
 * estado trocado contra o HTML antigo (React #418 no /dashboard).
 */
export const SIDEBAR_PREFERENCE_COOKIE = 'ig-sidebar-open';
export const SIDEBAR_PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseSidebarPreference(value: string | null | undefined): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export const isDashboardRoute = (pathname: string | null) =>
  Boolean(pathname) && (pathname === '/dashboard' || pathname!.startsWith('/dashboard/'));

/** Estado inicial determinístico: a preferência salva; sem ela, recolhida só no painel. */
export function initialSidebarOpen(preference: boolean | null, pathname: string | null): boolean {
  return preference ?? !isDashboardRoute(pathname);
}
