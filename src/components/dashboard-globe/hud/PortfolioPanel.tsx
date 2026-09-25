'use client';

import Link from 'next/link';
import { ArrowUpRight, ChevronRight, Lock, Map as MapIcon, MapPinOff } from 'lucide-react';
import type { DashboardOverview, FlowStage, SiteMarker, SitesModel, SectionState } from '@/lib/dashboard/types';
import { sortSites } from '../presets';
import { Failed, Hex, Restricted, levelLabel, levelTone, nf, sourceShort } from './common';

type Kpi =
  | { state: 'ok'; value: number; label: string; tone: 'danger' | 'warn' | 'accent' | 'ok' | 'neutral'; floor?: boolean; title?: string; href?: string | null }
  | { state: 'restricted' | 'error' | 'nonumber'; label: string; title?: string };

/** Um KPI a partir de uma etapa do fluxo: o número parado, ou o motivo (nunca 0 no lugar de "Restrito"). */
function stageKpi(stages: FlowStage[], id: FlowStage['id'], label: string, tone: 'danger' | 'accent' | 'warn'): Kpi {
  const s = stages.find((x) => x.id === id);
  if (!s || s.state === 'error' || (s.state === 'ok' && s.stuck === null && s.noNumber === 'error')) return { state: 'error', label };
  if (s.state === 'restricted' || (s.state === 'ok' && s.stuck === null && s.noNumber === 'restricted')) return { state: 'restricted', label };
  if (s.state === 'unavailable' || s.stuck === null) return { state: 'nonumber', label, title: s.reason ?? undefined };
  const v = s.stuck.value;
  // O nome do KPI e o substantivo da etapa ("materiais críticos · sem cobertura") — o número diz o que conta.
  return { state: 'ok', value: v, label: s.stuck.noun ? `${label} · ${s.stuck.noun}` : label, tone: v > 0 ? tone : 'neutral', floor: !!s.partial, title: s.definition, href: s.href };
}

/**
 * PORTFÓLIO DE OPERAÇÕES (`.ap-port` do protótipo) com dado real:
 *  • título = a organização;
 *  • 2×2 KPIs — projetos críticos, materiais críticos (etapa Necessidades),
 *    decisões aguardando você (o selo), a faturar (etapa Faturamento);
 *    "Restrito" é o KPI restrito, nunca 0;
 *  • a lista das operações LOCALIZADAS (oficial ou canteiro), da pior para a
 *    melhor — o caminho de teclado para cada marcador do globo;
 *  • "N projetos sem localização apurada" — nunca um ponto inventado.
 */
export function PortfolioPanel({ orgName, orgLoading = false, data, decisionCount, hovered, onHover, onOpenSite }: {
  orgName: string | null;
  /** O contexto da pessoa ainda carregando: o título espera (nunca um nome genérico que depois troca). */
  orgLoading?: boolean;
  data: DashboardOverview;
  decisionCount: number | null;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpenSite: (id: string) => void;
}) {
  const projects = data.projects;
  const kpis: Kpi[] = [
    projects.state === 'ok'
      ? { state: 'ok', value: projects.data.counts.critical, label: projects.data.counts.critical === 1 ? 'projeto crítico' : 'projetos críticos',
        tone: projects.data.counts.critical > 0 ? 'danger' : 'neutral', title: `${nf(projects.data.total)} projetos ativos — a pior trava decide` }
      : { state: projects.state === 'restricted' ? 'restricted' : 'error', label: 'projetos críticos' },
    stageKpi(data.stages, 'necessidades', 'materiais críticos', 'danger'),
    data.decisions.state === 'ok'
      ? { state: 'ok', value: decisionCount ?? data.decisions.data.count, label: 'decisões aguardando você',
        tone: (decisionCount ?? data.decisions.data.count) > 0 ? (data.decisions.data.overdue > 0 ? 'danger' : 'warn') : 'neutral', href: '/decisoes' }
      : { state: data.decisions.state === 'restricted' ? 'restricted' : 'error', label: 'decisões aguardando você' },
    stageKpi(data.stages, 'faturamento', 'a faturar', 'accent'),
  ];

  const sites = data.sites ?? ({ state: 'error', message: 'A leitura das localizações não veio nesta resposta.' } as SectionState<SitesModel>);

  return (
    <section className="dg-panel dg-port" aria-labelledby="dg-port-title" data-testid="dg-portfolio">
      <div className="dg-eyebrow"><MapIcon size={14} aria-hidden className="dg-ico" /><span>Portfólio de operações</span></div>
      <h1 className="dg-title" id="dg-port-title" aria-busy={!orgName && orgLoading ? true : undefined}>
        {orgName ?? (orgLoading
          ? <><span className="dg-title-skel" aria-hidden /><span className="sr-only-ax">Carregando a organização…</span></>
          : 'Sua empresa')}
      </h1>
      <div className="dg-kpis">
        {kpis.map((k, i) => <KpiTile key={i} kpi={k} />)}
      </div>
      {data.hasOperation === false ? <NoOperation /> : <SiteList section={sites} hovered={hovered} onHover={onHover} onOpenSite={onOpenSite} />}
    </section>
  );
}

function KpiTile({ kpi: k }: { kpi: Kpi }) {
  if (k.state !== 'ok') {
    return (
      <div className="dg-kpi" data-state={k.state} title={k.title}>
        {k.state === 'restricted' ? <b className="dg-kpi-muted"><Lock size={13} aria-hidden />Restrito</b>
          : k.state === 'error' ? <b className="dg-kpi-muted">—</b>
            : <b className="dg-kpi-muted">—</b>}
        <span>{k.label}{k.state === 'error' ? ' · não carregou' : k.state === 'nonumber' ? ' · sem número' : ''}</span>
      </div>
    );
  }
  const body = (
    <>
      <b className="num">{k.floor ? '≥ ' : ''}{nf(k.value)}</b>
      <span>{k.label}</span>
    </>
  );
  return k.href
    ? <Link className="dg-kpi" data-tone={k.tone} href={k.href} title={k.title}>{body}</Link>
    : <div className="dg-kpi" data-tone={k.tone} title={k.title}>{body}</div>;
}

function SiteList({ section, hovered, onHover, onOpenSite }: {
  section: SectionState<SitesModel>; hovered: string | null; onHover: (id: string | null) => void; onOpenSite: (id: string) => void;
}) {
  if (section.state === 'restricted') {
    return <div className="dg-list-state"><Restricted>o seu perfil não lê a localização das operações.</Restricted></div>;
  }
  if (section.state === 'error') {
    return <div className="dg-list-state"><Failed what="A localização das operações" message={section.message} /></div>;
  }
  const m = section.data;
  const sorted = sortSites(m.markers);
  return (
    <>
      {sorted.length === 0 ? (
        <p className="dg-empty">
          {m.unlocated > 0
            ? 'Nenhuma operação ativa tem localização apurada — o globo não inventa posição.'
            : 'Nenhuma operação ativa com localização.'}
        </p>
      ) : (
        <ul className="dg-list" aria-label="Operações localizadas no globo">
          {sorted.map((s, i) => <SiteItem key={s.projectId} site={s} main={i === 0} hovered={hovered === s.projectId} onHover={onHover} onOpen={onOpenSite} />)}
        </ul>
      )}
      {m.unlocated > 0 && (
        <Link className="dg-unlocated" href={m.unlocatedHref}>
          <MapPinOff size={14} aria-hidden />
          <span><b className="num">{nf(m.unlocated)}</b> {m.unlocated === 1 ? 'projeto sem localização apurada' : 'projetos sem localização apurada'}</span>
          <ChevronRight size={14} aria-hidden />
        </Link>
      )}
    </>
  );
}

function SiteItem({ site: s, main, hovered, onHover, onOpen }: {
  site: SiteMarker; main: boolean; hovered: boolean; onHover: (id: string | null) => void; onOpen: (id: string) => void;
}) {
  const tone = levelTone(s.level);
  const sub = [s.client, s.position.uf, sourceShort(s.position)].filter(Boolean).join(' · ');
  const status = levelLabel(s.level);
  return (
    <li>
      <button type="button" className="dg-item" data-tone={tone} data-main={main ? '1' : undefined} data-hover={hovered ? '1' : undefined}
        onClick={() => onOpen(s.projectId)} onMouseEnter={() => onHover(s.projectId)} onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(s.projectId)} onBlur={() => onHover(null)}
        aria-label={`${s.name} — ${status}${s.exceptions.total > 0 ? `, ${s.exceptions.total}${s.exceptions.partial ? ' ou mais' : ''} exceções` : ''}. Abrir no globo`}>
        <Hex tone={tone} />
        <span className="dg-item-text">
          <b>{s.name}</b>
          <small>{sub}</small>
        </span>
        {main ? <em>Abrir<ChevronRight size={14} aria-hidden /></em> : <span className="dg-item-status">{status}</span>}
      </button>
    </li>
  );
}

function NoOperation() {
  return (
    <div className="dg-noop" role="status">
      <b>Ainda não há operação</b>
      <p>A operação nasce de uma proposta aceita: autorização → Ordem de Serviço → projeto com cronograma. Quando o primeiro
        projeto entrar em execução, ele aparece aqui e no globo.</p>
      <div className="dg-noop-actions">
        <Link className="dg-link" href="/comercial">Abrir Comercial<ArrowUpRight size={14} aria-hidden /></Link>
        <Link className="dg-link quiet" href="/operacoes/ordens-servico">Ordens de Serviço</Link>
      </div>
    </div>
  );
}
