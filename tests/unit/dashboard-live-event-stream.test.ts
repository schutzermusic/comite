import { describe, it, expect } from 'vitest';
import { buildLiveEventStream } from '@/lib/dashboard-live';
import type { ExtendedRisk } from '@/components/risks/risk-types';
import type { DeliberationItem } from '@/lib/types';

describe('buildLiveEventStream', () => {
  it('não inventa eventos quando as fontes estão vazias', () => {
    expect(buildLiveEventStream({})).toEqual([]);
  });

  it('inclui só riscos abertos e deliberações ativas', () => {
    const risks = [
      {
        id: 'r1',
        title: 'Atraso de medição',
        status: 'open',
        severity: 'critical',
        updatedAt: new Date('2026-09-18T14:30:00Z'),
        createdAt: new Date('2026-09-18T12:00:00Z'),
      },
      {
        id: 'r2',
        title: 'Já resolvido',
        status: 'resolved',
        severity: 'high',
        updatedAt: new Date('2026-09-17T10:00:00Z'),
        createdAt: new Date('2026-09-16T10:00:00Z'),
      },
    ] as unknown as ExtendedRisk[];

    const deliberations = [
      {
        id: 'd1',
        title: 'Votação aditivo',
        deliberationStatus: 'in_voting',
        priority: 'high',
        updatedAt: new Date('2026-09-18T15:00:00Z'),
        createdAt: new Date('2026-09-18T09:00:00Z'),
      },
      {
        id: 'd2',
        title: 'Encerrada',
        deliberationStatus: 'closed',
        priority: 'medium',
        updatedAt: new Date('2026-09-10T15:00:00Z'),
        createdAt: new Date('2026-09-01T09:00:00Z'),
      },
    ] as unknown as DeliberationItem[];

    const stream = buildLiveEventStream({ risks, deliberations });
    expect(stream.map((e) => e.id)).toEqual(['delib:d1', 'risk:r1']);
    expect(stream.every((e) => e.label.length > 0)).toBe(true);
  });
});
