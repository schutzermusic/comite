'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, FileUp, Sparkles } from 'lucide-react';
import type { ServiceOrderListRow } from '@/lib/operations/service-orders/types';
import type { NextAction } from '@/lib/operations/service-orders/next-action';
import { originLabels, serviceOrderStatusLabels } from '@/lib/operations/service-orders/labels';
import {
  AxPage, Chain, CommandHeader, Dot, EmptyState, Filters, Plane, Resource, SearchBox, SignalStrip, dateShort, href, money, plural,
  useResource, useUrlParam, type ChainNode, type Tone,
} from '@/components/ax';
import { GenerateFromPackageModal } from './GenerateFromPackageModal';
import { ImportServiceOrderModal } from './ImportServiceOrderModal';

type Row = ServiceOrderListRow & { nextAction: NextAction };
type Payload = { ok: true; serviceOrders: Row[]; capabilities: { manage: boolean; ingest: boolean } };
type FilterId = 'all' | 'awaiting' | 'draft' | 'review' | 'blocked' | 'unlinked' | 'linked';

const awaiting = (r: Row) => r.status === 'DRAFT' || r.status === 'PENDING_CONFIRMATION';
const FILTERS: Record<FilterId, (r: Row) => boolean> = {
  all: () => true,
  awaiting,
  draft: (r) => r.status === 'DRAFT',
  review: (r) => r.status === 'PENDING_CONFIRMATION',
  blocked: (r) => awaiting(r) && (r.counts.blockingOpen > 0 || r.counts.unreviewedItems > 0),
  unlinked: (r) => (r.status === 'ISSUED' || r.status === 'IN_EXECUTION') && !r.projectId,
  linked: (r) => (r.status === 'ISSUED' || r.status === 'IN_EXECUTION') && Boolean(r.projectId),
};
const NEXT_TONE: Record<string, Tone> = { danger: 'danger', warning: 'warning', accent: 'accent', success: 'success', neutral: 'neutral' };
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * ORDENS DE SERVIÇO — a ponte entre o Comercial e a Operação.
 *
 * Cada linha mostra a travessia inteira: o pacote PT + PC que o cliente
 * aceitou, o valor autorizado, o estado da OS (com o que a segura) e o
 * projeto — e a próxima ação, derivada dos mesmos portões do banco. Duas
 * portas, e só duas: gerar do pacote aceito, ou importar uma OS já emitida.
 */
export function ServiceOrdersList() {
  const resource = useResource<Payload>('/api/operations/service-orders');
  return <AxPage testId="service-orders"><Resource {...resource}>{(data) => <List data={data} refresh={resource.refresh} />}</Resource></AxPage>;
}

function List({ data, refresh }: { data: Payload; refresh: () => void }) {
  const [filter, setFilter] = useUrlParam<FilterId>('filter', 'all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'generate' | 'import' | null>(null);
  const all = data.serviceOrders;
  const count = (f: FilterId) => all.filter(FILTERS[f]).length;
  const rows = useMemo(() => all.filter(FILTERS[filter] ?? FILTERS.all)
    .filter((r) => !search || norm([r.osNumber, r.title, r.customer, r.packageLabel, r.projectName].filter(Boolean).join(' ')).includes(norm(search)))
    .sort((a, b) => (a.nextAction.needsDecision === b.nextAction.needsDecision ? 0 : a.nextAction.needsDecision ? -1 : 1)
      || (b.counts.blockingOpen - a.counts.blockingOpen) || b.createdAt.localeCompare(a.createdAt)),
  [all, filter, search]);
  const router = useRouter();
  const open = (id: string) => router.push(href.serviceOrder(id));

  return (
    <>
      <CommandHeader domain="operations" area="Ordens de Serviço" title="Ordens de Serviço internas"
        context={<>
          <span><strong>{count('awaiting')}</strong> aguardando emissão</span>
          {count('blocked') > 0 && <span><Dot tone="danger" label="travada" /><strong>{count('blocked')}</strong> {count('blocked') === 1 ? 'travada' : 'travadas'}</span>}
          <span><strong>{count('unlinked')}</strong> emitidas sem projeto</span>
        </>}
        actions={data.capabilities.manage ? <>
          <button type="button" className="ax-btn" onClick={() => setModal('import')}><FileUp size={15} aria-hidden />Importar OS</button>
          <button type="button" className="ax-btn primary" onClick={() => setModal('generate')}><Sparkles size={15} aria-hidden />Gerar a partir de proposta</button>
        </> : undefined} />

      <SignalStrip label="Sinais das ordens de serviço" items={[
        { label: 'Rascunho', value: count('draft'), hint: 'conteúdo em montagem', onClick: () => setFilter('draft') },
        { label: 'Em revisão', value: count('review'), hint: `${plural(count('blocked'), 'travada', 'travadas')} por linha ou divergência`,
          tone: count('blocked') ? 'danger' : undefined, onClick: () => setFilter('review') },
        { label: 'Emitidas sem projeto', value: count('unlinked'), hint: 'autorizadas, sem contexto de execução', tone: count('unlinked') ? 'warning' : undefined,
          onClick: () => setFilter('unlinked') },
        { label: 'Em execução', value: count('linked'), hint: 'com projeto vinculado', onClick: () => setFilter('linked') },
        { label: 'Valor autorizado', value: money(all.filter((r) => !['CANCELLED', 'CLOSED'].includes(r.status)).reduce((a, r) => a + Number(r.authorizedValue ?? 0), 0), 'BRL', { compact: true }),
          hint: 'OS vigentes' },
      ]} />

      <Plane flush title="Da proposta aceita à obra" count={rows.length}
        subtitle="Pacote PT + PC aceito → valor autorizado → OS → projeto. A próxima ação é a do portão que falta."
        bar={<div className="ax-toolbar">
          <Filters<FilterId> label="Filtrar ordens" value={filter} onChange={setFilter} options={[
            { id: 'all', label: 'Todas', count: all.length },
            { id: 'awaiting', label: 'Aguardando emissão', count: count('awaiting') },
            { id: 'blocked', label: 'Travadas', count: count('blocked') },
            { id: 'unlinked', label: 'Sem projeto', count: count('unlinked') },
            { id: 'linked', label: 'Em execução', count: count('linked') },
            ...(filter === 'draft' || filter === 'review' ? [{ id: filter, label: filter === 'draft' ? 'Rascunho' : 'Em revisão', count: count(filter) }] : []),
          ]} />
          <SearchBox value={search} onChange={setSearch} placeholder="OS, cliente, proposta ou projeto" label="Buscar ordem" />
        </div>}>
        {rows.length === 0 ? (
          <EmptyState title={all.length ? 'Nenhuma OS neste recorte' : 'Nenhuma Ordem de Serviço interna'}
            action={data.capabilities.manage && !all.length ? <button type="button" className="ax-btn primary sm" onClick={() => setModal('generate')}>Gerar a partir de proposta</button> : undefined}>
            {all.length ? 'Mude o filtro ou a busca.' : 'A OS nasce do pacote PT + PC aceito pelo cliente, ou da importação de uma OS já emitida.'}
          </EmptyState>
        ) : (
          <div className="ax-queue">
            {rows.map((r) => {
              const tone = NEXT_TONE[r.nextAction.tone] ?? 'neutral';
              const bridge: ChainNode[] = [
                { label: r.packageLabel ?? 'sem pacote de proposta' },
                { label: r.authorizedValue ? `autorizado ${money(Number(r.authorizedValue), r.currency ?? 'BRL', { compact: true })}` : 'sem valor autorizado' },
                { label: `OS ${serviceOrderStatusLabels[r.status].toLowerCase()}${r.counts.blockingOpen ? ` · ${plural(r.counts.blockingOpen, 'bloqueante', 'bloqueantes')}`
                  : r.counts.openDivergences ? ` · ${plural(r.counts.openDivergences, 'aviso', 'avisos')}` : ''}`, end: r.counts.blockingOpen > 0 },
                r.projectId ? { label: r.projectName ?? 'projeto', href: href.project(r.projectId) } : { label: 'sem projeto' },
              ];
              return (
                <div key={r.id} className="ax-row no-owner" data-tone={tone === 'success' ? 'neutral' : tone} data-testid="os-row">
                  <div className="ax-row-main">
                    <span className="ax-row-eyebrow"><span className="ax-kind">{originLabels[r.origin]}</span>
                      <span className="ax-row-where">{r.customer ?? 'cliente não informado'}{r.ownerName ? ` · ${r.ownerName}` : ''}</span></span>
                    <Link className="ax-row-object ax-link" style={{ color: 'var(--ax-fg-strong)' }} href={href.serviceOrder(r.id)}>
                      {r.osNumber}<span className="ax-subtle"> · {r.title}</span></Link>
                    <span className="ax-row-issue">Próxima ação: <strong>{r.nextAction.label}</strong></span>
                  </div>
                  <div className="ax-cellstack">
                    <span className="ax-row-due">{r.plannedStart ? dateShort(r.plannedStart) : 'sem início'}</span>
                    <small>início planejado</small>
                  </div>
                  <div className="ax-row-actions">
                    <button type="button" className={r.nextAction.needsDecision ? 'ax-btn primary sm' : 'ax-btn sm'} onClick={() => open(r.id)}>
                      {r.nextAction.needsDecision ? 'Resolver' : 'Abrir'}<ArrowUpRight size={13} aria-hidden /></button>
                  </div>
                  <div className="ax-row-detail"><Chain nodes={bridge} label={`Ponte da ${r.osNumber}`} /></div>
                </div>
              );
            })}
          </div>
        )}
      </Plane>
      <p className="ax-note">A OS interna é a autorização operacional da Insight — não é o pedido do cliente, a OS do cliente nem o contrato: esses são
        fontes de autorização. Emissão com divergência bloqueante só por exceção nomeada e registrada.</p>

      {modal === 'generate' && <GenerateFromPackageModal onClose={() => setModal(null)} onGenerated={(id) => { setModal(null); refresh(); open(id); }} />}
      {modal === 'import' && <ImportServiceOrderModal canRead={data.capabilities.ingest} onClose={() => setModal(null)}
        onImported={(id) => { setModal(null); refresh(); open(id); }} />}
    </>
  );
}
