'use client';

import { AlertTriangle } from 'lucide-react';
import { INVENTORY_EXCEPTION_LABEL } from '@/lib/supply/inventory';
import {
  AxPage, CommandHeader, Plane, Resource, SignalStrip, Tabs, plural, useResource, useUrlParam, useUrlParams,
} from '@/components/ax';
import { PositionView } from './PositionView';
import { ReservationsView } from './ReservationsView';
import { LedgerView } from './LedgerView';
import { TransfersView } from './TransfersView';
import { CountsView } from './CountsView';
import { LocationsView } from './LocationsView';
import type { InventoryModel } from './shared';

type View = 'posicao' | 'reservas' | 'livro' | 'transferencias' | 'contagens' | 'locais';
type Payload = InventoryModel & { ok: true };
const EXCEPTION_VIEW: Record<string, View> = {
  RESERVED_ABOVE_ON_HAND: 'posicao', RESERVATION_WITHOUT_DEMAND: 'reservas', RESERVATION_ABOVE_NEED: 'reservas',
  TRANSFER_OVERDUE: 'transferencias', COUNT_OPEN_LONG: 'contagens',
};

/**
 * ESTOQUE — o livro é a verdade: posição, disponibilidade, reservas por
 * projeto, transferências, contagens e locais são leituras dele, e todo ato
 * passa por uma função governada que refaz a conta no banco. Exceção primeiro.
 *
 * Endereçável: `?view=`, `?item=` (posição aberta no item), `?transfer=`, `?count=`.
 */
export function InventoryWorkspace() {
  const resource = useResource<Payload>('/api/supply/inventory');
  return (
    <AxPage testId="inventory-workspace">
      <Resource {...resource}>{(data) => <Workspace data={data} refresh={resource.refresh} />}</Resource>
    </AxPage>
  );
}

function Workspace({ data, refresh }: { data: Payload; refresh: () => void }) {
  const [view, setView] = useUrlParam<View>('view', 'posicao');
  const patch = useUrlParams();
  const activeRes = data.reservations.filter((r) => r.status === 'ACTIVE');
  const moving = data.transfers.filter((t) => t.status === 'IN_TRANSIT' || t.status === 'PARTIALLY_RECEIVED');
  const pendingTransfers = data.transfers.filter((t) => ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(t.status));
  const items = new Set(data.position.filter((p) => p.onHand > 0 && p.locationKind !== 'QUARANTINE').map((p) => p.itemId));
  const free = new Set(data.position.filter((p) => p.available > 0 && p.locationKind !== 'QUARANTINE').map((p) => p.itemId));
  const quarantine = data.position.filter((p) => p.locationKind === 'QUARANTINE' && p.onHand > 0);
  const projects = new Set(activeRes.map((r) => r.projectId));
  const openCounts = data.counts.filter((c) => c.status === 'OPEN');

  return (
    <>
      <CommandHeader domain="supply" area="Estoque" title="Estoque"
        context={<>
          <span><strong>{items.size}</strong> {items.size === 1 ? 'item com saldo' : 'itens com saldo'} em {plural(data.locations.filter((l) => l.active).length, 'local', 'locais')}</span>
          <span><strong>{activeRes.length}</strong> {activeRes.length === 1 ? 'reserva ativa' : 'reservas ativas'} para {plural(projects.size, 'projeto', 'projetos')}</span>
          {moving.length > 0 && <span><strong>{moving.length}</strong> em trânsito</span>}
        </>} />

      <SignalStrip label="Sinais do estoque" items={[
        { label: 'Itens com saldo', value: items.size, hint: `${free.size} com saldo livre`, onClick: () => setView('posicao') },
        { label: 'Reservas ativas', value: activeRes.length, hint: `segurando material para ${plural(projects.size, 'projeto', 'projetos')}`, onClick: () => setView('reservas') },
        { label: 'Em trânsito', value: moving.length, hint: `${pendingTransfers.length - moving.length} a despachar ou aprovar`, onClick: () => setView('transferencias') },
        { label: 'Em quarentena', value: quarantine.length, hint: 'linhas esperando inspeção — não cobrem demanda',
          tone: quarantine.length ? 'warning' : undefined, href: '/supply/recebimentos?queue=inspection' },
        { label: 'Contagens abertas', value: openCounts.length, hint: 'fotografia do livro à espera do físico', onClick: () => setView('contagens') },
        { label: 'Exceções', value: data.exceptions.length, hint: data.exceptions.length ? 'pedem uma pessoa' : 'livro consistente',
          tone: data.exceptions.length ? 'danger' : undefined },
      ]} />

      {data.exceptions.length > 0 && (
        <Plane title="Exceções do estoque" count={data.exceptions.length} countTone="danger" flush testId="inventory-exceptions"
          subtitle="Derivadas do livro, das reservas e das transferências — cada uma diz o que fazer">
          <div className="ax-queue">
            {data.exceptions.slice(0, 6).map((e) => (
              <div key={`${e.kind}:${e.ref}`} className="ax-row no-owner" data-tone="warning">
                <div className="ax-row-main">
                  <span className="ax-row-eyebrow"><span className="ax-kind"><AlertTriangle size={11} aria-hidden /> {INVENTORY_EXCEPTION_LABEL[e.kind]}</span></span>
                  <span className="ax-row-object">{e.title}</span>
                  <span className="ax-row-issue">{e.detail}</span>
                </div>
                <span />
                <div className="ax-row-actions">
                  <button type="button" className="ax-btn sm" onClick={() => patch({ view: EXCEPTION_VIEW[e.kind] ?? 'posicao' })}>Abrir</button>
                </div>
              </div>
            ))}
          </div>
        </Plane>
      )}

      <Tabs<View> label="Áreas do estoque" value={view} onChange={setView} tabs={[
        { id: 'posicao', label: 'Posição' },
        { id: 'reservas', label: 'Reservas por projeto', count: activeRes.length },
        { id: 'livro', label: 'Movimentações (livro)' },
        { id: 'transferencias', label: 'Transferências', count: pendingTransfers.length },
        { id: 'contagens', label: 'Inventário (contagens)', count: openCounts.length, tone: 'warning' },
        { id: 'locais', label: 'Locais' },
      ]} />

      <div role="tabpanel" aria-labelledby={`ax-tab-${view}`} className="ax-stack">
        {view === 'posicao' && <PositionView data={data} onChanged={refresh} />}
        {view === 'reservas' && <ReservationsView data={data} onChanged={refresh} />}
        {view === 'livro' && <LedgerView data={data} />}
        {view === 'transferencias' && <TransfersView data={data} onChanged={refresh} />}
        {view === 'contagens' && <CountsView data={data} onChanged={refresh} />}
        {view === 'locais' && <LocationsView data={data} onChanged={refresh} />}
      </div>
    </>
  );
}
