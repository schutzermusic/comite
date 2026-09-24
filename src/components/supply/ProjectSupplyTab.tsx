'use client';

import { ApexFindings, Resource, SignalStrip, useResource } from '@/components/ax';
import { DemandBoardView, demandUrl, type DemandPayload } from './planning/DemandBoard';

/**
 * MATERIAIS & SUPPLY do projeto — a MESMA demanda e a MESMA cobertura do
 * Supply, recortadas para este projeto. Nada é somado à parte: cada número é
 * a contagem das linhas que o quadro mostra.
 */
export function ProjectSupplyTab({ projectId }: { projectId: string }) {
  const resource = useResource<DemandPayload>(demandUrl(projectId));
  return (
    <section className="ax ax-stack" aria-label="Materiais e supply do projeto" data-testid="project-supply">
      <Resource {...resource}>{(data) => {
        const d = data.demand;
        const count = (f: (x: DemandPayload['demand'][number]) => boolean) => d.filter(f).length;
        const short = count((x) => x.coverage.shortage > 0); const critical = count((x) => x.risk === 'critical');
        return (
          <>
            <SignalStrip label="Materiais do projeto" items={[
              { label: 'Materiais requeridos', value: d.length, hint: 'requisitos confirmados no plano' },
              { label: 'Cobertos', value: count((x) => x.coverage.status === 'COVERED'), hint: 'reservado ou consumido', tone: 'success' },
              { label: 'Entrando', value: count((x) => x.coverage.inbound > 0), hint: 'em transferência, pedido ou inspeção' },
              { label: 'Com falta', value: short, hint: 'requerido − coberto − entrando', tone: short ? 'warning' : undefined },
              { label: 'Risco crítico', value: critical, hint: 'falta a 7 dias da necessidade', tone: critical ? 'danger' : undefined },
            ]} />
            <ApexFindings projectId={projectId} limit={3} title="Apex — neste projeto" />
            <DemandBoardView data={data} projectId={projectId} />
          </>
        );
      }}</Resource>
    </section>
  );
}
