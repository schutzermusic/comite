/**
 * Mapa de Operações (wave E): o pino resume a saúde com a MESMA leitura do
 * projeto — OS bloqueada, risco material, atraso grave ou material sem
 * cobertura é crítico; sem cronograma é "desconhecido", não "em dia".
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/platform/server-client', () => ({ platformServiceClient: () => ({}) }));
import { mapHealth } from '@/lib/operations/map';
import { OPERATIONS_NAV } from '@/lib/operations/navigation';

const zero = { criticalActivities: 0, overdueActivities: 0, materialRisks: 0, serviceOrdersBlocked: 0, supplyShortages: 0 };

describe('saúde no mapa', () => {
  it('sem sinal: em dia com cronograma; desconhecido sem cronograma', () => {
    expect(mapHealth(zero, true)).toBe('healthy');
    expect(mapHealth(zero, false)).toBe('unknown');
  });
  it('OS bloqueada, risco material, material sem cobertura ou 4+ vencidas: crítico', () => {
    expect(mapHealth({ ...zero, serviceOrdersBlocked: 1 }, true)).toBe('critical');
    expect(mapHealth({ ...zero, materialRisks: 1 }, true)).toBe('critical');
    expect(mapHealth({ ...zero, supplyShortages: 1 }, true)).toBe('critical');
    expect(mapHealth({ ...zero, overdueActivities: 4 }, true)).toBe('critical');
  });
  it('atividade crítica ou até 3 vencidas: atenção', () => {
    expect(mapHealth({ ...zero, criticalActivities: 2 }, true)).toBe('attention');
    expect(mapHealth({ ...zero, overdueActivities: 3 }, true)).toBe('attention');
  });
  it('o menu leva ao mapa de Operações (o globo 3D continua acessível a partir dele)', () => {
    expect(OPERATIONS_NAV.find((i) => i.id === 'map')!.href).toBe('/operacoes/mapa');
  });
});
