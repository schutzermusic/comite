'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { AxPage, CommandHeader, Dot, Resource, Tabs, dateShort, useResource, useUrlParam } from '@/components/ax';
import { DemandBoardView, demandUrl, type DemandPayload } from './planning/DemandBoard';
import { ItemCatalog } from './ItemCatalog';

/**
 * PLANEJAMENTO DE MATERIAIS — a ponte entre o Planejamento do projeto e a
 * execução do Supply: o que falta, quando é necessário, para qual projeto, se
 * outro local cobre, e se comprar é mesmo necessário.
 */
export function MaterialPlanning() {
  return <AxPage testId="material-planning"><Planning /></AxPage>;
}

function Planning() {
  const [tab, setTab] = useUrlParam<'demand' | 'catalog'>('tab', 'demand');
  const resource = useResource<DemandPayload>(demandUrl());
  const d = resource.data?.demand ?? [];
  const short = d.filter((x) => x.coverage.shortage > 0);
  const critical = d.filter((x) => x.risk === 'critical').length;
  const next = short.map((x) => x.needBy).filter(Boolean).sort()[0] ?? null;
  return (
    <>
      <CommandHeader domain="supply" area="Planejamento de materiais" title="Planejamento de materiais"
        context={resource.data ? <>
          <span><strong>{d.length}</strong> {d.length === 1 ? 'requisito' : 'requisitos'}</span>
          <span><strong>{short.length}</strong> com falta</span>
          {critical > 0 && <span><Dot tone="danger" label="crítico" /><strong>{critical}</strong> {critical === 1 ? 'crítico' : 'críticos'}</span>}
          {next && <span>próxima necessidade em falta: {dateShort(next)}</span>}
        </> : <span>Requisito do projeto → cobertura → estratégia</span>}
        actions={<Link className="ax-btn" href="/operacoes/planejamento">Planejamento de Operações<ArrowUpRight size={14} aria-hidden /></Link>} />
      <Tabs label="Áreas do planejamento de materiais" value={tab} onChange={setTab} tabs={[
        { id: 'demand', label: 'Demanda & cobertura', count: short.length, tone: 'warning' },
        { id: 'catalog', label: 'Catálogo de itens' },
      ]} />
      {tab === 'demand'
        ? <Resource {...resource}>{(data) => <DemandBoardView data={data} testId="material-demand" />}</Resource>
        : <ItemCatalog />}
    </>
  );
}
