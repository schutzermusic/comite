import { describe, it, expect } from 'vitest';
import { buildGlobeProjectRecords } from '@/data/geo/globe-kpi-data';
import type { Project } from '@/lib/types';

const enelProject = {
  id: 'proj-3a445bb5-c576-445d-bb49-adcddd52dc1d',
  codigo: '2774.08/2025',
  nome: 'ENEL GREEN POWER CACHOEIRA DOURADA S.A.',
  cliente: 'ENEL GREEN POWER CACHOEIRA DOURADA S.A.',
  status: undefined,
  valor_total: 0,
  valor_executado: 0,
  progresso_percentual: 0,
} as unknown as Project;

describe('buildGlobeProjectRecords — UF da Enel / Cachoeira Dourada', () => {
  it('com state_code canônico MG, NÃO atribui PE nem SP', () => {
    const [row] = buildGlobeProjectRecords(
      [enelProject],
      [],
      [{
        projectId: enelProject.id,
        latitude: -18.5022993,
        longitude: -49.4912546,
        stateCode: 'MG',
      }],
    );
    expect(row.stateUF).toBe('MG');
    expect(row.coordinateSource).toBe('canonical');
  });

  it('sem state_code mas com project_v2.uf=MG, usa MG', () => {
    const [row] = buildGlobeProjectRecords(
      [enelProject],
      [{ ...enelProject, schemaVersion: 2 as const, uf: 'MG' } as never],
      [{
        projectId: enelProject.id,
        latitude: -18.5022993,
        longitude: -49.4912546,
        stateCode: null,
      }],
    );
    expect(row.stateUF).toBe('MG');
  });

  it('sem state_code mas com coordenada canônica, NÃO cai no default SP', () => {
    const [row] = buildGlobeProjectRecords(
      [enelProject],
      [],
      [{
        projectId: enelProject.id,
        latitude: -18.5022993,
        longitude: -49.4912546,
        stateCode: null,
      }],
    );
    // Cachoeira Dourada fica na fronteira MG/GO; sem state_code o centroide
    // mais próximo é GO — o essencial é não inventar SP/PE.
    expect(row.stateUF).toBe('GO');
    expect(row.coordinateSource).toBe('canonical');
  });

  it('sem fato geográfico, heurística de cliente NÃO força PE para ENEL', () => {
    const [row] = buildGlobeProjectRecords([enelProject], [], []);
    expect(row.stateUF).not.toBe('PE');
  });
});
