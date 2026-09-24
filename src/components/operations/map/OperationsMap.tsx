'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowUpRight, Globe2 } from 'lucide-react';
import { HudButton } from '@/components/hud';
import type { MapHealth, OperationsMapModel } from '@/lib/operations/map';
import { formatProjectStatus } from '@/lib/projects/status';
import { Filter, GovernanceNote, LiveSep, ResourceState, Segments, StatePill, WorkspaceHeading, day, useOperationsResource, type Tone } from '../ui';
import './operations-map.css';

const OperationsMapCanvas = dynamic(() => import('./OperationsMapCanvas').then((m) => m.OperationsMapCanvas), {
  ssr: false,
  loading: () => <div className="ops-map-loading" role="status">Carregando mapa…</div>,
});

type Payload = OperationsMapModel & { ok: true };
const HEALTH_LABEL: Record<MapHealth, string> = { critical: 'Crítico', attention: 'Atenção', healthy: 'Em dia', unknown: 'Sem cronograma' };
const HEALTH_TONE: Record<MapHealth, Tone> = { critical: 'danger', attention: 'warning', healthy: 'success', unknown: 'neutral' };
const RANK: Record<MapHealth, number> = { critical: 0, attention: 1, unknown: 2, healthy: 3 };

/**
 * MAPA DE OPERAÇÕES — mapa + painel sincronizado.
 *
 * Um pino por projeto no LOCAL CANÔNICO dele (ou no centro da cerca, dito
 * assim); a cor é a saúde derivada e o painel diz o porquê. Equipe só aparece
 * para quem tem alçada de ponto. Clicar leva ao que decide: status, próximo
 * marco, alerta de OS/cronograma/risco/material e o workspace do projeto.
 */
export function OperationsMap() {
  const { data, state, message } = useOperationsResource<Payload>('/api/operations/map');
  const [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState<'active' | 'all' | 'alerts'>('active');
  const [client, setClient] = useState('');
  const [region, setRegion] = useState('');
  const [showSites, setShowSites] = useState(true);
  const [showTeam, setShowTeam] = useState(true);

  const projects = useMemo(() => (data?.projects ?? [])
    .filter((p) => scope === 'all' || (scope === 'active' ? p.active : p.alerts.length > 0))
    .filter((p) => !client || p.client === client)
    .filter((p) => !region || p.stateCode === region)
    .sort((a, b) => RANK[a.health] - RANK[b.health] || a.name.localeCompare(b.name)), [data, scope, client, region]);

  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const clients = Array.from(new Set(data.projects.map((p) => p.client).filter(Boolean))) as string[];
  const regions = Array.from(new Set(data.projects.map((p) => p.stateCode).filter(Boolean))) as string[];
  const current = data.projects.find((p) => p.id === selected) ?? null;
  const located = projects.filter((p) => p.lat !== null);

  return (
    <section className="crm-workspace ops-workspace" aria-label="Mapa de operações" data-testid="operations-map">
      <WorkspaceHeading
        eyebrow="Operações · Mapa"
        title="Onde a operação está, e o que trava cada frente"
        description={<><span><b>{located.length}</b> projeto(s) no mapa</span><LiveSep />
          <span className={projects.some((p) => p.health === 'critical') ? 'crm-tone-danger' : undefined}>
            <b>{projects.filter((p) => p.health === 'critical').length}</b> crítico(s)</span>
          {data.unlocated.length > 0 && <><LiveSep /><span><b>{data.unlocated.length}</b> sem local confirmado</span></>}</>}
        action={<Link href="/projetos/operations-3d"><HudButton variant="ghost" size="sm"><Globe2 size={14} /> Vista 3D</HudButton></Link>}
      />
      <div className="ops-map-layout">
        <div className="ops-map-stage">
          <OperationsMapCanvas projects={projects} team={data.team} selectedId={selected} onSelect={setSelected}
            showSites={showSites} showTeam={showTeam} />
          <div className="ops-map-legend" aria-label="Legenda">
            {(['critical', 'attention', 'healthy', 'unknown'] as MapHealth[]).map((h) => (
              <span key={h}><i data-health={h} aria-hidden />{HEALTH_LABEL[h]}</span>
            ))}
            {data.team && showTeam && <span><i data-team aria-hidden />Equipe (24 h)</span>}
          </div>
        </div>
        <aside className="ops-map-panel" aria-label="Painel do mapa">
          <div className="ops-map-filters">
            <Segments label="Recorte" value={scope} onChange={(v) => setScope(v as typeof scope)}
              options={[{ value: 'active', label: 'Ativos' }, { value: 'alerts', label: 'Com alerta' }, { value: 'all', label: 'Todos' }]} />
            <div className="flex flex-wrap gap-2">
              {clients.length > 1 && <Filter label="Cliente" value={client} onChange={setClient}
                options={[{ value: '', label: 'Todos os clientes' }, ...clients.map((c) => ({ value: c, label: c }))]} />}
              {regions.length > 1 && <Filter label="Região" value={region} onChange={setRegion}
                options={[{ value: '', label: 'Todas as UFs' }, ...regions.map((r) => ({ value: r, label: r }))]} />}
            </div>
            <div className="ops-map-toggles">
              <label><input type="checkbox" checked={showSites} onChange={(e) => setShowSites(e.target.checked)} /> Obras (cercas)</label>
              {data.team ? <label><input type="checkbox" checked={showTeam} onChange={(e) => setShowTeam(e.target.checked)} /> Equipe</label>
                : <span className="crm-muted">Equipe: restrita à alçada de ponto</span>}
              <span className="crm-muted">Estoques: com o domínio de estoque · Veículos: sem domínio de frota</span>
            </div>
          </div>

          {current ? (
            <div className="ops-map-selected" data-testid="map-selected">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><strong>{current.name}</strong><p className="crm-muted">{current.client ?? '—'}
                  {current.siteLabel ? ` · ${current.siteLabel}` : ''}</p></div>
                <StatePill tone={HEALTH_TONE[current.health]}>{HEALTH_LABEL[current.health]}</StatePill>
              </div>
              <dl className="ops-summary-grid">
                <div><dt>Status</dt><dd>{current.status ? formatProjectStatus(current.status) : '—'}</dd></div>
                <div><dt>Próximo marco</dt><dd>{current.nextMilestone ? `${day(current.nextMilestone.date)} · ${current.nextMilestone.title}` : '—'}</dd></div>
                <div><dt>OS</dt><dd>{current.serviceOrders}{current.serviceOrdersBlocked ? ` · ${current.serviceOrdersBlocked} bloqueada(s)` : ''}</dd></div>
                <div><dt>Equipe no local (24 h)</dt><dd>{data.team ? data.team.filter((t) => t.projectId === current.id).length : 'Restrito'}</dd></div>
              </dl>
              {current.alerts.length ? (
                <ul className="ops-map-alerts">{current.alerts.map((a) => <li key={a}>{a}</li>)}</ul>
              ) : <p className="crm-muted">Sem alerta de OS, cronograma, risco ou material.</p>}
              <p className="crm-muted text-ig-caption">Local: {current.precision === 'geofence' ? 'centro da cerca da obra (local canônico não resolvido)'
                : current.precision === 'site' ? 'local canônico da obra' : current.precision === 'municipality' ? 'município (local canônico)' : 'sem local'}</p>
              <Link href={`/projetos/${encodeURIComponent(current.id)}`}>
                <HudButton variant="primary" size="sm">Abrir projeto <ArrowUpRight size={13} /></HudButton>
              </Link>
            </div>
          ) : null}

          <ul className="ops-map-list" aria-label="Projetos">
            {projects.map((p) => (
              <li key={p.id}>
                <button type="button" aria-pressed={p.id === selected} onClick={() => setSelected(p.id === selected ? null : p.id)}>
                  <i data-health={p.health} aria-hidden />
                  <span className="min-w-0"><b>{p.name}</b>
                    <span className="crm-muted">{p.alerts[0] ?? (p.lat === null ? 'Sem local confirmado' : HEALTH_LABEL[p.health])}</span></span>
                </button>
              </li>
            ))}
            {!projects.length && <li className="crm-muted" style={{ padding: 12 }}>Nenhum projeto neste recorte.</li>}
          </ul>
        </aside>
      </div>
      <GovernanceNote>
        Coordenadas vêm do local canônico do projeto e das cercas de ponto — nada é guardado à parte. Projeto sem local
        confirmado aparece na lista, não no mapa. Posição de equipe só para quem tem alçada de ponto.
      </GovernanceNote>
    </section>
  );
}
