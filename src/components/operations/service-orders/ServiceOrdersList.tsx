'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileUp, Sparkles } from 'lucide-react';
import { HudButton } from '@/components/hud';
import type { ServiceOrderListRow } from '@/lib/operations/service-orders/types';
import type { NextAction } from '@/lib/operations/service-orders/next-action';
import { originLabels, serviceOrderStatusLabels } from '@/lib/operations/service-orders/labels';
import {
  DataTable, EmptyNote, GovernanceNote, LiveSep, ResourceState, Segments, StatePill, Toolbar, WorkspaceHeading,
  brl, day, matches, useOperationsResource, type Tone,
} from '../ui';
import { GenerateFromPackageModal } from './GenerateFromPackageModal';
import { ImportServiceOrderModal } from './ImportServiceOrderModal';

type Row = ServiceOrderListRow & { nextAction: NextAction };
type Payload = { ok: true; serviceOrders: Row[]; capabilities: { manage: boolean; ingest: boolean } };

type FilterId = 'all' | 'awaiting' | 'blocked' | 'no_project' | 'executing';

const FILTERS: Record<FilterId, (r: Row) => boolean> = {
  all: () => true,
  awaiting: (r) => r.status === 'DRAFT' || r.status === 'PENDING_CONFIRMATION',
  blocked: (r) => (r.status === 'DRAFT' || r.status === 'PENDING_CONFIRMATION')
    && (r.counts.blockingOpen > 0 || r.counts.unreviewedItems > 0),
  no_project: (r) => (r.status === 'ISSUED' || r.status === 'IN_EXECUTION') && !r.projectId,
  executing: (r) => r.status === 'IN_EXECUTION' || (r.status === 'ISSUED' && !!r.projectId),
};

const statusTone = (r: Row): Tone =>
  r.status === 'PENDING_CONFIRMATION' ? 'warning'
    : r.status === 'ISSUED' || r.status === 'IN_EXECUTION' ? 'success'
      : r.status === 'CANCELLED' || r.status === 'SUSPENDED' ? 'danger' : 'neutral';

/**
 * ORDENS DE SERVIÇO — a fila de Operações.
 *
 * Duas portas, e só duas: "Gerar a partir de proposta" (do pacote que o
 * cliente aceitou) e "Importar OS" (PDF já emitido). A próxima ação de cada
 * linha é derivada dos mesmos portões do banco — a tela não sugere emitir o
 * que o gatilho recusaria.
 */
export function ServiceOrdersList() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, state, message, refresh } = useOperationsResource<Payload>('/api/operations/service-orders');
  const [filter, setFilter] = useState<FilterId>(params.get('filtro') === 'aguardando' ? 'awaiting' : 'all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'generate' | 'import' | null>(null);

  const rows = useMemo(() => (data?.serviceOrders ?? [])
    .filter(FILTERS[filter])
    .filter((r) => !search || matches(search, r.osNumber, r.title, r.customer, r.packageLabel, r.projectName)),
  [data, filter, search]);

  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const all = data.serviceOrders;
  const count = (f: FilterId) => all.filter(FILTERS[f]).length;
  const openOrder = (id: string) => router.push(`/operacoes/ordens-servico/${id}`);

  return (
    <section className="crm-workspace ops-workspace" aria-label="Ordens de Serviço">
      <WorkspaceHeading
        eyebrow="Operações · Ordens de Serviço"
        title="Ordens de Serviço internas"
        description={
          <>
            <span><b>{count('awaiting')}</b> aguardando emissão</span>
            <LiveSep />
            <span className={count('blocked') ? 'crm-tone-danger' : undefined}><b>{count('blocked')}</b> travada(s)</span>
            <LiveSep />
            <span><b>{count('no_project')}</b> emitida(s) sem projeto</span>
          </>
        }
        action={data.capabilities.manage ? (
          <>
            <HudButton variant="secondary" size="sm" onClick={() => setModal('import')}>
              <FileUp size={14} /> Importar OS
            </HudButton>
            <HudButton variant="primary" size="sm" onClick={() => setModal('generate')}>
              <Sparkles size={14} /> Gerar a partir de proposta
            </HudButton>
          </>
        ) : undefined}
      />

      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar OS, cliente, proposta ou projeto">
        <Segments
          label="Filtrar ordens"
          value={filter}
          onChange={(v) => setFilter(v as FilterId)}
          options={[
            { value: 'all', label: 'Todas', count: all.length },
            { value: 'awaiting', label: 'Aguardando emissão', count: count('awaiting') },
            { value: 'blocked', label: 'Travadas', count: count('blocked') },
            { value: 'no_project', label: 'Sem projeto', count: count('no_project') },
            { value: 'executing', label: 'Em execução', count: count('executing') },
          ]}
        />
      </Toolbar>

      <DataTable
        label="Ordens de Serviço internas"
        columns={['OS', 'Cliente / trabalho', 'Pacote de origem', 'Projeto', 'Responsável', 'Estado', 'Próxima ação']}
        count={rows.length}
        footer="OS internas canônicas — mesma fonte do pós-venda e do projeto"
        empty={
          <EmptyNote
            title={all.length ? 'Nenhuma OS neste recorte' : 'Nenhuma Ordem de Serviço interna'}
            description={all.length ? 'Mude o filtro ou a busca.'
              : 'A OS nasce do pacote PT + PC aceito pelo cliente, ou da importação de uma OS já emitida.'}
            action={data.capabilities.manage && !all.length ? (
              <HudButton variant="primary" size="sm" onClick={() => setModal('generate')}>Gerar a partir de proposta</HudButton>
            ) : undefined}
          />
        }
      >
        {rows.map((r) => (
          <tr key={r.id} className="crm-row-open-row">
            <td>
              <Link href={`/operacoes/ordens-servico/${r.id}`} className="crm-row-open">{r.osNumber}</Link>
              <p className="crm-muted">{originLabels[r.origin]} · {day(r.createdAt)}</p>
            </td>
            <td>
              <p>{r.customer ?? '—'}</p>
              <p className="crm-muted">{r.title}</p>
            </td>
            <td>
              <p className="text-ig-caption">{r.packageLabel ?? 'Sem pacote de proposta'}</p>
              <p className="crm-muted tabular-nums">{brl(r.authorizedValue, r.currency ?? 'BRL')}</p>
            </td>
            <td>
              {r.projectId
                ? <Link href={`/projetos/${encodeURIComponent(r.projectId)}`}>{r.projectName}</Link>
                : <span className="crm-muted">—</span>}
            </td>
            <td>{r.ownerName ?? <span className="crm-muted">—</span>}</td>
            <td>
              <StatePill tone={statusTone(r)}>{serviceOrderStatusLabels[r.status]}</StatePill>
              {(r.counts.blockingOpen > 0 || r.counts.openDivergences > 0) && (
                <p className={r.counts.blockingOpen ? 'crm-tone-danger text-ig-caption' : 'crm-tone-warning text-ig-caption'}>
                  {r.counts.blockingOpen ? `${r.counts.blockingOpen} bloqueante(s)` : `${r.counts.openDivergences} aviso(s)`}
                </p>
              )}
            </td>
            <td>
              <button type="button" className="crm-row-open" onClick={() => openOrder(r.id)}>
                <StatePill tone={r.nextAction.tone === 'danger' ? 'danger' : r.nextAction.tone === 'warning' ? 'warning'
                  : r.nextAction.tone === 'success' ? 'success' : r.nextAction.tone === 'accent' ? 'accent' : 'neutral'} dot={false}>
                  {r.nextAction.label}
                </StatePill>
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      <GovernanceNote>
        A OS interna é a autorização operacional da Insight. Ela não é o pedido de compra do cliente, a OS do cliente nem o
        contrato — esses são fontes de autorização. Emissão com divergência bloqueante só por exceção nomeada e registrada.
      </GovernanceNote>

      {modal === 'generate' && (
        <GenerateFromPackageModal
          onClose={() => setModal(null)}
          onGenerated={(id) => { setModal(null); refresh(); openOrder(id); }}
        />
      )}
      {modal === 'import' && (
        <ImportServiceOrderModal
          canRead={data.capabilities.ingest}
          onClose={() => setModal(null)}
          onImported={(id) => { setModal(null); refresh(); openOrder(id); }}
        />
      )}
    </section>
  );
}
