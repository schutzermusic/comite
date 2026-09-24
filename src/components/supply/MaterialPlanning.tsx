'use client';

import { useState } from 'react';
import type { MaterialDemandRow } from '@/lib/supply/read-model';
import {
  LiveSep, ResourceState, TabPanel, WorkspaceHeading, WorkspaceTabs, useOperationsResource,
} from '@/components/operations/ui';
import { MaterialDemandTable, type DemandCapabilities } from './MaterialDemandTable';
import { ItemCatalog } from './ItemCatalog';

type Payload = { ok: true; today: string; capabilities: DemandCapabilities; demand: MaterialDemandRow[] };

/** PLANEJAMENTO DE MATERIAIS — a ponte entre o Planejamento do projeto e a execução de Supply. */
export function MaterialPlanning() {
  const { data, state, message } = useOperationsResource<Payload>('/api/supply/material-planning');
  const [tab, setTab] = useState<'demand' | 'catalog'>('demand');
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const short = data.demand.filter((d) => d.coverage.shortage > 0).length;
  return (
    <section className="crm-workspace ops-workspace" aria-label="Planejamento de materiais" data-testid="material-planning">
      <WorkspaceHeading
        eyebrow="Supply Chain · Planejamento de Materiais"
        title="Requisito do projeto → cobertura → estratégia"
        description={<><span><b>{data.demand.length}</b> requisito(s) de material</span><LiveSep />
          <span className={short ? 'crm-tone-warning' : undefined}><b>{short}</b> com falta</span></>}
      />
      <WorkspaceTabs label="Áreas do planejamento de materiais" active={tab} onChange={setTab}
        tabs={[{ id: 'demand', label: 'Demanda & cobertura', count: short, tone: 'warning' }, { id: 'catalog', label: 'Catálogo de itens' }]} />
      {tab === 'demand' && (
        <TabPanel id="demand">
          <MaterialDemandTable demand={data.demand} today={data.today} capabilities={data.capabilities} />
        </TabPanel>
      )}
      {tab === 'catalog' && <TabPanel id="catalog"><ItemCatalog /></TabPanel>}
    </section>
  );
}
