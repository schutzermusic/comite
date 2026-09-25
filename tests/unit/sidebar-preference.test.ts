import { describe, expect, it } from 'vitest';
import { initialSidebarOpen, isDashboardRoute, parseSidebarPreference } from '@/components/layout/sidebar-preference';

describe('preferência da sidebar — estado inicial igual no servidor e no cliente', () => {
  it('lê só true/false do cookie', () => {
    expect(parseSidebarPreference('true')).toBe(true);
    expect(parseSidebarPreference('false')).toBe(false);
    for (const v of [undefined, null, '', 'TRUE', '1', 'yes']) expect(parseSidebarPreference(v)).toBeNull();
  });

  it('sem preferência: recolhida só no painel', () => {
    expect(initialSidebarOpen(null, '/dashboard')).toBe(false);
    expect(initialSidebarOpen(null, '/dashboard/financeiro')).toBe(false);
    expect(initialSidebarOpen(null, '/dashboards')).toBe(true);
    expect(initialSidebarOpen(null, '/supply')).toBe(true);
    expect(initialSidebarOpen(null, null)).toBe(true);
    expect(isDashboardRoute(null)).toBe(false);
  });

  it('a preferência salva vence o padrão da rota', () => {
    expect(initialSidebarOpen(true, '/dashboard')).toBe(true);
    expect(initialSidebarOpen(false, '/supply')).toBe(false);
  });
});
