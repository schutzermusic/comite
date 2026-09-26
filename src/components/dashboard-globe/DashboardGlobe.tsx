'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useResource } from '@/components/ax';
import { dateTime, todayIso } from '@/components/ax/format';
import { ExplainPanel } from '@/components/dashboard-v2/ExplainPanel';
import '@/components/dashboard-v2/dashboard-v2.css';
import { useCurrentUser } from '@/hooks/use-current-user';
import { refreshDecisionBadge, useDecisionBadgeState } from '@/hooks/use-decision-badge';
import type { DashboardOverview, SiteHud, SiteHudResponse, SiteMarker, SitePosition } from '@/lib/dashboard/types';
import type { CameraView, GlobeArc, GlobeNode, MapLayer, ModuleId, ModuleProps, ScanPhase } from './contract';
import { BillingModule, PlanModule, SupplyModule } from './modules';
import { TWIN_AZIMUTH_DEG, VIEW_DIM, freeRect, markersFor, validLatLng, viewFor, type DashView, type HudGrid, type StageFrame } from './presets';
import { twinSpecFor } from './twin/spec';
import { AttentionPanel } from './hud/AttentionPanel';
import { CalendarPanel } from './hud/CalendarPanel';
import { SkeletonLines } from './hud/common';
import { DecisionsPanel } from './hud/DecisionsPanel';
import { Dock } from './hud/Dock';
import { FlowPanel } from './hud/FlowPanel';
import { useAppTheme, useElementWidth, useJson, useMedia } from './hud/hooks';
import { Arrival, currentFlightId, enterStyle, useEnter } from './hud/motion';
import { PortfolioPanel } from './hud/PortfolioPanel';
import { SiteFacts, SitePanel } from './hud/SitePanel';
import { Toast, useToast } from './hud/Toast';
import { TopBar, type Crumb } from './hud/TopBar';
import './dashboard-globe.css';

/** O palco: Cesium só no navegador (nada de WebGL no servidor). */
const ApexGlobe = dynamic(() => import('./ApexGlobe').then((m) => m.ApexGlobe), { ssr: false, loading: () => null });

const SITE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const MODULES: ModuleId[] = ['overview', 'plan', 'supply', 'billing'];
const MODULE_LABEL: Record<ModuleId, string> = { overview: 'Visão geral', plan: 'Planejar', supply: 'Supply Chain', billing: 'Faturamento' };
const MODULE_COMPONENT: Record<Exclude<ModuleId, 'overview'>, ComponentType<ModuleProps>> = {
  plan: PlanModule, supply: SupplyModule, billing: BillingModule,
};
/** A dica do protótipo (`.ap-hint`) — só no portfólio: nas vistas do local o dock ocupa a base. */
const HINT: Partial<Record<DashView, ReactNode>> = {
  portfolio: <>Clique numa operação <b>no mapa ou na lista</b> para aproximar</>,
};
/** Tempo mínimo entre releituras automáticas ao voltar para a aba. */
const REFOCUS_MS = 120_000;
const EMPTY_SITES: SiteMarker[] = [];
const EMPTY_ARCS: GlobeArc[] = [];
const EMPTY_NODES: GlobeNode[] = [];
const EMPTY_UFS: string[] = [];
const INVALID_SITE: SiteHudResponse = { ok: false, reason: 'invalid', message: 'Endereço de projeto inválido.' };

const parseModule = (v: string | null): ModuleId => (MODULES as string[]).includes(v ?? '') ? (v as ModuleId) : 'overview';

type TaggedLayer = { tag: string; layer: MapLayer; json: string };

/**
 * As operações no mapa, a partir das leituras: os marcadores do overview e,
 * quando o local em foco não tem marcador ali (a seção de locais falhou) mas
 * o HUD do local trouxe uma posição válida, o próprio local — dado real, do
 * mesmo servidor. Nunca uma posição estimada.
 */
function deriveGeo(data: DashboardOverview | null, siteData: SiteHudResponse | null, siteId: string | null) {
  const sitesModel = data?.sites?.state === 'ok' ? data.sites.data : null;
  const siteMarkers = sitesModel?.markers ?? EMPTY_SITES;
  const focusMarker = siteId ? siteMarkers.find((m) => m.projectId === siteId) ?? null : null;
  const hud = siteId && siteData && siteData.ok ? siteData : null;
  const hudPosition: SitePosition | null = hud && hud.location.state === 'ok' && validLatLng(hud.location.data.position) ? hud.location.data.position : null;
  const focusPosition: SitePosition | null = focusMarker?.position ?? hudPosition;
  let allSites = siteMarkers;
  if (siteId && !focusMarker && hud && hudPosition) {
    allSites = [...siteMarkers, {
      projectId: siteId, name: hud.project.name, client: hud.project.client, code: hud.project.code, position: hudPosition,
      level: hud.now.state === 'ok' ? hud.now.data.health?.level ?? null : null, reasons: [], nextMilestone: null,
      exceptions: { total: 0, critical: 0, partial: false }, topIssue: null, href: hud.project.href,
    }];
  }
  return {
    siteMarkers,
    allSites,
    focusMarker,
    focusPosition,
    ufs: sitesModel ? sitesModel.states.map((s) => s.uf) : EMPTY_UFS,
    locatedIds: new Set(allSites.map((s) => s.projectId)),
  };
}

/**
 * O DASHBOARD — o globo do APEX FILM com o dado real da empresa.
 *
 * O globo é o palco e fica montado em todas as vistas; cada vista é uma
 * câmera (presets.ts) e um conjunto de painéis:
 *  • portfólio — esquerda: Portfólio (organização, KPIs, operações
 *    localizadas) e Atenção agora; direita: Decisões, Fluxo do negócio,
 *    Próximos 30 dias;
 *  • local (Visão geral) — Projeto em foco; Atenção e Decisões do local;
 *  • módulos — Planejar, Supply Chain, Faturamento (cada um lê o seu endpoint
 *    e devolve a camada do mapa).
 *
 * Estado na URL: `?site=<id>&m=overview|plan|supply|billing` (recarregar cai
 * no mesmo lugar; Voltar funciona) e `?x=` abre "Entender". Teclado: Esc volta
 * ao INÍCIO do mapa (o portfólio, mesmo depois de arrastar), 1–4 trocam de
 * módulo, F tela cheia — nunca com campo ou diálogo em foco.
 *
 * O mapa é arrastável (mouse/toque; no celular, cooperativo). A "época" da
 * vista (`viewEpoch`) sobe a cada navegação de verdade (Esc, dock, outro
 * local, outro módulo): o globo então voa mesmo que a vista seja igual; dentro
 * da mesma época, se a pessoa mexeu no mapa, a câmera não é roubada.
 */
export function DashboardGlobe() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawSite = params.get('site');
  const siteId = rawSite && rawSite.length > 0 ? rawSite : null;
  const siteValid = !!siteId && SITE_ID.test(siteId);
  const mod = parseModule(params.get('m'));
  const view: DashView = siteId ? mod : 'portfolio';
  const explainRef = params.get('x') ?? '';

  /* ── Navegação (URL) ─────────────────────────────────────────────────── */
  /*
    A vista muda pela API de histórico do navegador — integrada ao roteador do
    Next (useSearchParams acompanha; Voltar/Avançar funcionam) e SEM ida ao
    servidor: o voo começa no mesmo quadro do clique. Sem `history` (nunca no
    navegador), cai no roteador.
  */
  const go = useCallback((patch: Record<string, string | null>, mode: 'push' | 'replace' = 'push') => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) q.delete(k); else q.set(k, v); }
    const s = q.toString();
    const url = s ? `${pathname}?${s}` : pathname;
    if (typeof window !== 'undefined' && window.history) {
      if (mode === 'push') window.history.pushState(null, '', url); else window.history.replaceState(null, '', url);
      return;
    }
    if (mode === 'push') router.push(url, { scroll: false }); else router.replace(url, { scroll: false });
  }, [params, pathname, router]);
  const openSite = useCallback((id: string) => go({ site: id, m: null, x: null }), [go]);
  const openModule = useCallback((m: ModuleId) => go({ m: m === 'overview' ? null : m, x: null }), [go]);
  const toPortfolio = useCallback(() => go({ site: null, m: null, x: null }), [go]);
  const setExplain = useCallback((ref: string | null) => go({ x: ref }, 'replace'), [go]);

  /*
    Época da vista: sobe a cada navegação de verdade (vista/local mudou) e a
    cada "início" pedido (Esc, dock "Portfólio", migalha) — o globo voa para
    o enquadramento do portfólio mesmo que a pessoa tenha arrastado o mapa.
    Saindo de um local, quem sobe a época é a PRÓPRIA troca de vista (navKey),
    no mesmo render em que a câmera-alvo vira o portfólio: subir antes (a URL
    muda numa transição) daria um render com época nova e a vista ANTIGA — o
    globo voaria de volta para o local antes de virar para o portfólio.
  */
  const navKey = `${view}|${siteId ?? ''}`;
  const [epoch, setEpoch] = useState(() => ({ key: navKey, n: 0 }));
  if (epoch.key !== navKey) setEpoch({ key: navKey, n: epoch.n + 1 });
  const goHome = useCallback(() => {
    if (siteId) {
      toPortfolio();
      return;
    }
    // já no portfólio: a vista não muda — a época nova é o "voltar ao início" depois de arrastar
    setEpoch((e) => ({ key: e.key, n: e.n + 1 }));
    if (params.get('m') || params.get('x')) toPortfolio();
  }, [siteId, params, toPortfolio]);

  /* ── Dados ───────────────────────────────────────────────────────────── */
  const overview = useResource<DashboardOverview>('/api/dashboard/overview');
  const { refresh: refreshOverview } = overview;
  const data = overview.data;
  const siteRes = useJson<SiteHudResponse>(siteValid ? `/api/dashboard/site/${encodeURIComponent(siteId as string)}` : null);
  const { refresh: refreshSite } = siteRes;
  const siteState = siteId && !siteValid ? { status: 'ready' as const, data: INVALID_SITE, message: null } : siteRes;
  const hud: SiteHud | null = siteState.data && siteState.data.ok ? siteState.data : null;
  const today = data?.today ?? hud?.today ?? todayIso();

  const { organization, loading: orgLoading } = useCurrentUser();
  const badge = useDecisionBadgeState();
  const decisionCount = data?.decisions.state === 'ok' ? (badge.known ? badge.count : data.decisions.data.count) : null;

  // Recarga manual: o "recarregando" vale do pedido até o dado mostrado mudar de identidade.
  const shown = useRef<DashboardOverview | null>(null);
  const lastLoad = useRef(0);
  const [reloadOf, setReloadOf] = useState<DashboardOverview | null>(null);
  const reloading = reloadOf !== null && reloadOf === data;
  useEffect(() => {
    shown.current = data;
    if (data) lastLoad.current = Date.now();
  }, [data]);
  const reread = useCallback((withBadge: boolean) => {
    setReloadOf(shown.current);
    refreshOverview();
    refreshSite();
    if (withBadge) refreshDecisionBadge();
  }, [refreshOverview, refreshSite]);
  const reload = useCallback(() => reread(true), [reread]);
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (!lastLoad.current || Date.now() - lastLoad.current <= REFOCUS_MS) return;
      lastLoad.current = Date.now();
      reread(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reread]);

  /* ── Ambiente ────────────────────────────────────────────────────────── */
  const mobile = useMedia('(max-width: 767px)');
  const tablet = useMedia('(min-width: 768px) and (max-width: 1179px)');
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const theme = useAppTheme();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [world, setWorld] = useState<HTMLDivElement | null>(null);
  const width = useElementWidth(root);
  const scale = width ? Math.round(Math.min(1, width / 1920) * 20) / 20 : 1;
  const [rightOpen, setRightOpen] = useState(false);
  const stage = useStageGrid(root, world);
  const ganttTop = useGanttTop(root, world, view === 'plan' && !mobile);
  const toast = useToast();
  const { show: showToast } = toast;

  /* ── Globo ───────────────────────────────────────────────────────────── */
  const [hovered, setHovered] = useState<string | null>(null);
  const [globeError, setGlobeError] = useState<string | null>(null);
  /*
    O palco monta DEPOIS do `load` da página (ou em 2,5 s, o que vier antes):
    o bloco do Cesium é grande e, pedido antes, seguraria o `load` — o HUD e
    os dados chegam primeiro, sobre o fundo do palco, e o globo abre em seguida.
  */
  const [stageOn, setStageOn] = useState(false);
  useEffect(() => {
    let raf = 0;
    const on = () => { raf = requestAnimationFrame(() => setStageOn(true)); };
    if (document.readyState === 'complete') { on(); return () => cancelAnimationFrame(raf); }
    const cap = setTimeout(on, 2500);
    window.addEventListener('load', on, { once: true });
    return () => {
      clearTimeout(cap);
      window.removeEventListener('load', on);
      cancelAnimationFrame(raf);
    };
  }, []);
  const geo = useMemo(() => deriveGeo(data, siteRes.data, siteId), [data, siteRes.data, siteId]);
  const focusMarker = geo.focusMarker;

  // Camada do módulo ativo (arcos, cartões, enquadramento), marcada com o módulo e o local que a publicaram.
  const [layer, setLayer] = useState<TaggedLayer | null>(null);
  const layerTag = `${mod}|${siteId ?? ''}`;
  const onMapLayer = useCallback((l: MapLayer | null) => {
    const json = l ? JSON.stringify(l) : '';
    setLayer((prev) => {
      if (!l) return prev && prev.tag === layerTag ? null : prev;
      return prev && prev.tag === layerTag && prev.json === json ? prev : { tag: layerTag, layer: l, json };
    });
  }, [layerTag]);
  const activeLayer = view !== 'portfolio' && view !== 'overview' && layer && layer.tag === layerTag ? layer.layer : null;

  // O modelo esquemático da obra (Visão geral/Planejar, só com posição de canteiro).
  const hudHere = hud && siteId && hud.project.id === siteId ? hud : null;
  const twin = useMemo(() => twinSpecFor({
    projectId: siteId ?? '', hud: hudHere, position: geo.focusPosition, view, azimuthDeg: TWIN_AZIMUTH_DEG,
  }), [siteId, hudHere, geo.focusPosition, view]);
  const onTwinHotspot = useCallback((id: string) => {
    const h = twin?.hotspots.find((x) => x.id === id);
    if (h?.target) openModule(h.target);
  }, [twin, openModule]);
  const twinKind = twin?.kind ?? null;

  /*
    A área livre desta vista (entre as colunas, abaixo da barra, acima da
    dica/dock/Gantt; no celular, o bloco do globo menos a barra, a folha e os
    créditos): a câmera ENQUADRA o assunto nela e o globo mantém cartões e
    rótulos dentro dela (`--ag-free`).
  */
  const frame = useMemo<StageFrame | null>(() => {
    if (!stage) return null;
    const grid: HudGrid = { ...stage, mobile, tablet, rightClosed: tablet && view === 'portfolio' && !rightOpen, ganttTop };
    const free = freeRect(view, grid);
    return free ? { W: stage.W, H: stage.H, free } : null;
  }, [stage, mobile, tablet, view, rightOpen, ganttTop]);
  const freeVar = useMemo(() => (frame
    ? ({ '--ag-free': `${frame.free.l} ${frame.free.t} ${frame.free.r} ${frame.free.b}` } as CSSProperties)
    : undefined), [frame]);

  // A câmera-alvo por VALOR: a mesma vista com os mesmos números nunca vira um voo novo.
  const cameraKey = useMemo(() => JSON.stringify(viewFor(view, {
    markers: geo.siteMarkers.map((m) => m.position),
    site: geo.focusPosition,
    nodes: activeLayer?.nodes ?? [],
    layerView: activeLayer?.view ?? null,
    twinKind,
  }, { mobile, scale, frame })), [view, geo, activeLayer, mobile, scale, frame, twinKind]);
  const camera = useMemo(() => JSON.parse(cameraKey) as CameraView, [cameraKey]);
  const globeMarkers = useMemo(() => markersFor(geo.allSites, { view, focused: siteId, hovered }), [geo, view, siteId, hovered]);
  const highlightUfs = view === 'portfolio' || view === 'supply' ? geo.ufs : EMPTY_UFS;

  const onSelectMarker = useCallback((id: string | null) => { if (id && id !== siteId) openSite(id); }, [openSite, siteId]);
  const onGlobeError = useCallback((message: string) => setGlobeError(message || 'O globo não carregou.'), [setGlobeError]);

  // Varredura da rede (Supply): a fase vem do globo e volta para o módulo que a pediu.
  const activeScan = activeLayer?.scan ?? null;
  const [scanPhase, setScanPhase] = useState<{ id: string; phase: ScanPhase } | null>(null);
  const onScanPhase = useCallback((id: string, phase: ScanPhase) => setScanPhase({ id, phase }), []);
  const moduleScanPhase = scanPhase && activeScan && activeScan.id === scanPhase.id ? scanPhase : null;

  /* ── Movimento: os painéis do local esperam a câmera ─────────────────── */
  const trackKey = `${view}|${siteId ?? ''}`;
  const [track, setTrack] = useState(() => ({ key: trackKey, base: currentFlightId() }));
  if (track.key !== trackKey) setTrack({ key: trackKey, base: currentFlightId() });
  const immediate = reduced || globeError !== null;
  const arrival = useMemo(() => new Arrival(track.base, immediate), [track, immediate]);

  // Celular: abrir um local leva ao topo (o globo mostra o voo; o painel vem logo abaixo).
  useEffect(() => {
    if (!mobile || !root) return;
    const main = root.closest('main');
    if (main && main.scrollTop > 0) main.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [trackKey, mobile, root, reduced]);

  /* ── Teclado ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.isContentEditable || t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]'))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.key === 'Escape') {
        // Esc = o início do mapa (portfólio), de qualquer vista — inclusive depois de arrastar
        e.preventDefault();
        goHome();
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        const doc = document.documentElement;
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
        else void doc.requestFullscreen?.().catch(() => undefined);
        return;
      }
      if (siteId && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        openModule(MODULES[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [siteId, goHome, openModule]);

  /* ── Depois de um ato no módulo: relê tudo ───────────────────────────── */
  const onChanged = useCallback(() => {
    refreshOverview();
    refreshSite();
    refreshDecisionBadge();
    showToast('Situação atualizada', 'o globo e os painéis refletem o ato');
  }, [refreshOverview, refreshSite, showToast]);

  /* ── Barra superior ──────────────────────────────────────────────────── */
  const siteName = hud?.project.name ?? focusMarker?.name ?? (siteState.status === 'loading' ? 'Carregando…' : 'Projeto');
  const crumbs: Crumb[] = [{ label: 'Portfólio', onClick: siteId ? goHome : undefined, current: !siteId }];
  if (siteId) crumbs.push({ label: siteName, onClick: mod !== 'overview' ? () => openModule('overview') : undefined, current: mod === 'overview' });
  if (siteId && mod !== 'overview') crumbs.push({ label: MODULE_LABEL[mod], current: true });
  const updated = data ? updatedText(data.generatedAt, data.today) : null;

  /* ── Painéis ─────────────────────────────────────────────────────────── */
  const portfolioLeft = data ? (
    <>
      <PortfolioPanel orgName={organization?.name ?? null} orgLoading={orgLoading} data={data} decisionCount={decisionCount}
        hovered={hovered} onHover={setHovered} onOpenSite={openSite} />
      <AttentionPanel section={data.feed} today={data.today} title="Atenção agora" limit={5} hasOperation={data.hasOperation}
        apex={data.apex} onExplain={setExplain} onOpenSite={openSite} locatedIds={geo.locatedIds} onReload={reload} />
    </>
  ) : overview.state === 'error' ? (
    <section className="dg-panel dg-fail" role="alert" aria-label="Não foi possível carregar">
      <div className="dg-eyebrow"><TriangleAlert size={14} aria-hidden className="dg-ico warn" /><span>Visão da empresa</span></div>
      <h1 className="dg-title">Não foi possível carregar</h1>
      <p className="dg-sub">{overview.message ?? 'O servidor não respondeu. Nada foi alterado.'}</p>
      <button type="button" className="dg-btn" onClick={reload}><RefreshCw size={15} aria-hidden />Tentar de novo</button>
    </section>
  ) : (
    <section className="dg-panel dg-port" role="status" aria-label="Carregando a situação da empresa…" data-testid="dg-loading">
      <SkeletonLines lines={3} />
      <div className="dg-kpis dg-skel-kpis" aria-hidden><i /><i /><i /><i /></div>
      <SkeletonLines lines={5} />
    </section>
  );
  const portfolioRight = data ? (
    <>
      <DecisionsPanel section={data.decisions} count={decisionCount} today={data.today} />
      <FlowPanel stages={data.stages} hasOperation={data.hasOperation} />
      <CalendarPanel section={data.calendar} today={data.today} />
    </>
  ) : overview.state === 'error' ? null : (
    <section className="dg-panel" aria-hidden><SkeletonLines lines={4} /><SkeletonLines lines={6} /></section>
  );

  const siteLeft = siteId ? (
    <SitePanel state={siteState} marker={focusMarker} onNavigate={openModule} onRetry={refreshSite} onBack={goHome} />
  ) : null;
  const siteRight = hud ? (
    <>
      <section className="dg-panel dg-facts" aria-label="Neste local">
        <div className="dg-eyebrow"><span>Neste local</span></div>
        <SiteFacts hud={hud} />
      </section>
      <AttentionPanel section={hud.attention} today={hud.today} title="Atenção neste local" limit={6} hasOperation={true}
        onExplain={setExplain} scope="site" testId="dg-site-attention" onReload={refreshSite} />
      <DecisionsPanel section={hud.decisions} today={hud.today} title="Decisões deste local" scope="site" testId="dg-site-decisions" />
    </>
  ) : null;

  const moduleProps: Omit<ModuleProps, 'enter'> | null = siteId && siteValid && view !== 'portfolio' && view !== 'overview' ? {
    projectId: siteId, siteName: hud?.project.name ?? focusMarker?.name ?? '', today,
    onMapLayer, onNavigate: openModule, onExplain: setExplain, onChanged, scanPhase: moduleScanPhase,
  } : null;

  // A dica só convida a clicar quando há o que clicar.
  const hint = geo.allSites.length > 0 ? HINT[view] : undefined;
  return (
    <div ref={setRoot} className="dg" data-testid="dashboard-globe" data-view={view} data-right-open={rightOpen ? '1' : undefined}
      data-reduced={reduced ? '1' : undefined} aria-busy={reloading || undefined}>
      <div ref={setWorld} className="dg-world" data-testid="dg-globe" style={freeVar}>
        <div className="dg-backdrop" aria-hidden><i className="dg-aurora" /><i className="dg-bgrid" /></div>
        {stageOn && <ApexGlobe
          className="dg-globe"
          markers={globeMarkers}
          arcs={activeLayer?.arcs ?? EMPTY_ARCS}
          nodes={activeLayer?.nodes ?? EMPTY_NODES}
          highlightUfs={highlightUfs}
          view={camera}
          viewEpoch={epoch.n}
          dim={VIEW_DIM[view]}
          intro
          idleBreath={!reduced && (view === 'overview' || view === 'plan')}
          reducedMotion={reduced}
          theme={theme}
          interaction={mobile ? 'cooperative' : 'full'}
          scan={activeScan}
          onScanPhase={onScanPhase}
          drift={activeLayer?.drift ?? null}
          twin={twin}
          onTwinHotspot={onTwinHotspot}
          onSelectMarker={onSelectMarker}
          onHoverMarker={setHovered}
          onError={onGlobeError}
        />}
      </div>

      <div className="dg-hud">
        <TopBar crumbs={crumbs} updated={updated} onReload={reload} reloading={reloading}
          panelToggle={tablet && view === 'portfolio' ? { open: rightOpen, onToggle: () => setRightOpen((o) => !o) } : null} />

        {globeError && (
          <p className="dg-globe-fail" role="status"><TriangleAlert size={14} aria-hidden />
            <span><b>O globo não carregou</b> — {globeError} Os painéis seguem funcionando.</span>
          </p>
        )}

        <Layer active={view === 'portfolio'} arrival={null} reduced={reduced} className="dg-group-portfolio" label="Portfólio">
          <div className="dg-col dg-col-left">{portfolioLeft}</div>
          <div className="dg-col dg-col-right">{portfolioRight}</div>
        </Layer>

        {siteId && view === 'overview' && (
          <Layer key={`site:${siteId}`} active arrival={arrival} reduced={reduced} className="dg-group-site" label="Local em foco">
            <div className="dg-col dg-col-left">{siteLeft}</div>
            <div className="dg-col dg-col-right">{siteRight}</div>
          </Layer>
        )}

        {moduleProps && view !== 'portfolio' && view !== 'overview' && (
          <ModuleHost key={`${view}:${siteId}`} id={view}arrival={arrival} reduced={reduced} props={moduleProps} />
        )}

        <Dock show={view !== 'portfolio'} active={mod} onSelect={openModule} onPortfolio={goHome} />
        {hint && !mobile && <p className="dg-hint">{hint}</p>}
        <Toast msg={toast.msg} shown={toast.shown} />
      </div>

      {explainRef && <ExplainPanel reference={explainRef} today={today} onClose={() => setExplain(null)} />}
    </div>
  );
}

type StageGrid = Pick<HudGrid, 'W' | 'H' | 'safe' | 'top' | 'topH' | 'leftW' | 'rightW'>;
const GRID_KEYS: ReadonlyArray<keyof StageGrid> = ['W', 'H', 'safe', 'top', 'topH', 'leftW', 'rightW'];

/**
 * O palco (px) e a grade do HUD — as variáveis CSS do Dashboard (`--dg-safe`,
 * `--dg-top`, `--dg-top-h`, `--dg-left-w`, `--dg-right-w`, que mudam nos
 * pontos de quebra) — relidos a cada mudança de tamanho.
 */
function useStageGrid(root: HTMLElement | null, world: HTMLElement | null): StageGrid | null {
  const [grid, setGrid] = useState<StageGrid | null>(null);
  useEffect(() => {
    if (!root || !world || typeof ResizeObserver === 'undefined') return undefined;
    // o ResizeObserver chama logo ao observar: a primeira leitura vem dele
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(root);
      const px = (name: string, d: number) => {
        const v = parseFloat(cs.getPropertyValue(name));
        return Number.isFinite(v) ? v : d;
      };
      const next: StageGrid = {
        W: Math.round(world.clientWidth),
        H: Math.round(world.clientHeight),
        safe: px('--dg-safe', 24),
        top: px('--dg-top', 14),
        topH: px('--dg-top-h', 44),
        leftW: px('--dg-left-w', 440),
        rightW: px('--dg-right-w', 400),
      };
      if (!(next.W > 1 && next.H > 1)) return;
      setGrid((prev) => (prev && GRID_KEYS.every((k) => prev[k] === next[k]) ? prev : next));
    });
    ro.observe(root);
    ro.observe(world);
    return () => ro.disconnect();
  }, [root, world]);
  return grid;
}

/**
 * O topo do cronograma do Planejar em px do palco (arredondado a 8 px) — a
 * faixa de cima é a área livre do modelo. Medido quando o Gantt carrega (o
 * esqueleto não conta) e a cada mudança de altura; `null` fora do Planejar.
 * Uma medida nova no meio do voo vira um REAJUSTE do mesmo voo (ApexGlobe).
 */
function useGanttTop(root: HTMLElement | null, world: HTMLElement | null, on: boolean): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (!on || !root || !world || typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    let target: Element | null = null;
    let raf = 0;
    const ro = new ResizeObserver(() => measure());
    const mo = new MutationObserver(() => measure());
    function measure() {
      const g = root?.querySelector('.dgm-gantt') ?? null;
      if (g !== target) {
        if (target) ro.unobserve(target);
        target = g;
        if (g) ro.observe(g);
      }
      // o esqueleto (carregando) tem outra altura: medir só o cronograma de verdade (ou a nota de vazio/erro)
      if (!g || !world || g.querySelector('.dgm-skel')) return;
      const wr = world.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      if (gr.height < 48 || wr.height < 2) return;
      const v = Math.round((gr.top - wr.top) / 8) * 8;
      setTop((p) => (p === v ? p : v));
    }
    mo.observe(root.querySelector('.dg-hud') ?? root, { childList: true, subtree: true });
    raf = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro.disconnect();
    };
  }, [on, root, world]);
  return on ? top : null;
}

/** "Atualizado às 14:31" (hoje em São Paulo) ou "Atualizado em 24/09 18:02". */
function updatedText(generatedAt: string, today: string): string {
  const when = dateTime(generatedAt);
  const day = todayIso(new Date(generatedAt));
  const time = when.includes(' ') ? when.split(' ').pop() : when;
  return day === today ? `Atualizado às ${time}` : `Atualizado em ${when}`;
}

/**
 * Um grupo de painéis de uma vista. O portfólio entra/sai já (fade de taxa
 * 6, −18 px); o local espera a câmera (`settle`). Os filhos chegam prontos
 * do pai — o quadro a quadro do fade não re-renderiza o conteúdo.
 */
function Layer({ active, arrival, reduced, className, label, children }: {
  active: boolean; arrival: Arrival | null; reduced: boolean; className: string; label: string; children: ReactNode;
}) {
  const a = useEnter(active ? 1 : 0, arrival, reduced);
  const k = Math.min(1, Math.max(0, a));
  return (
    <div className={`dg-group ${className}`} aria-label={label} role="region" aria-hidden={active ? undefined : true}
      data-gone={k <= 0.001 ? '1' : undefined} data-inert={k <= 0.6 ? '1' : undefined} style={enterStyle(k, reduced)}>
      {children}
    </div>
  );
}

/** O módulo ativo, com o fator de entrada da câmera (`enter`) quadro a quadro. */
function ModuleHost({ id, arrival, reduced, props }: {
  id: Exclude<ModuleId, 'overview'>; arrival: Arrival; reduced: boolean; props: Omit<ModuleProps, 'enter'>;
}) {
  const enter = useEnter(1, arrival, reduced);
  const Comp = MODULE_COMPONENT[id];
  return (
    <div className="dg-module" data-module={id}>
      <Comp {...props} enter={enter} />
    </div>
  );
}
