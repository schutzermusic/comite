import { describe, it, expect } from 'vitest';
import { OPERATIONS_NAV, isOperationsRoute } from '@/lib/operations/navigation';

describe('Operações · navegação', () => {
  it('"Mapa de Operações" abre o mapa 3D de sempre, com a mesma alçada de projetos', () => {
    const map = OPERATIONS_NAV.find((i) => i.id === 'map')!;
    expect(map).toMatchObject({ label: 'Mapa de Operações', href: '/projetos/operations-3d' });
    expect(map.anyPermission).toEqual(['projects.view', 'projects.view_all']);
    expect(isOperationsRoute('/projetos/operations-3d')).toBe(true);
  });
  it('não há segundo mapa no menu', () => {
    expect(OPERATIONS_NAV.filter((i) => /mapa|operations-3d/i.test(i.href))).toHaveLength(1);
  });
});
