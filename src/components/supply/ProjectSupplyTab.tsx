'use client';

import type { MaterialDemandRow } from '@/lib/supply/read-model';
import { Metrics, ResourceState, useOperationsResource } from '@/components/operations/ui';
import { MaterialDemandTable, type DemandCapabilities } from './MaterialDemandTable';

type Payload = { ok: true; today: string; capabilities: DemandCapabilities; demand: MaterialDemandRow[] };

/**
 * MATERIAIS & SUPPLY do projeto — a MESMA demanda e a MESMA cobertura do
 * Supply, recortadas para este projeto. Nada é somado à parte: cada número é
 * a soma das linhas que a tabela mostra.
 */
export function ProjectSupplyTab({ projectId }: { projectId: string }) {
  const { data, state, message, refresh } = useOperationsResource<Payload>(`/api/supply/material-planning?project=${encodeURIComponent(projectId)}`);
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const d = data.demand;
  const count = (f: (x: MaterialDemandRow) => boolean) => d.filter(f).length;
  return (
    <section className="crm-workspace ops-workspace" aria-label="Materiais e supply do projeto" data-testid="project-supply">
      <Metrics items={[
        { label: 'Materiais requeridos', value: d.length, hint: 'Requisitos confirmados no plano', accent: true },
        { label: 'Cobertos', value: count((x) => x.coverage.status === 'COVERED'), tone: 'success', hint: 'Reservado ou consumido' },
        { label: 'Entrando', value: count((x) => x.coverage.inbound > 0), tone: 'info', hint: 'Em trânsito ou em pedido' },
        { label: 'Com falta', value: count((x) => x.coverage.shortage > 0), tone: count((x) => x.coverage.shortage > 0) ? 'warning' : 'neutral',
          hint: 'Requerido − coberto − entrando' },
        { label: 'Risco crítico', value: count((x) => x.risk === 'critical'), tone: count((x) => x.risk === 'critical') ? 'danger' : 'neutral',
          hint: 'Falta a 7 dias da necessidade' },
      ]} />
      <MaterialDemandTable demand={d} today={data.today} capabilities={data.capabilities} showProject={false} onChanged={refresh} />
    </section>
  );
}
