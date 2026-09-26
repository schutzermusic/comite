'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Package } from 'lucide-react';
import { notifyChanged, useResource } from '@/components/ax';
import type { SiteSupplyResponse } from '@/lib/dashboard/types';
import type { MapLayer, ModuleProps } from '../contract';
import { SCAN_FALLBACK_MS, normalizeSupply, sitePoint, supplyFlowLayer, type Corridor, type SupplyStage } from './model';
import { Eyebrow, ModulePanel, SkeletonLines, StateNote, siteApi, usePublishLayer } from './shared';
import { SupplyFlowPanel } from './supply/FlowPanel';
import { NeedPanel } from './supply/NeedPanel';
import type { FlowCtx } from './supply/types';
import '@/components/decisions/decisions.css';
import './modules.css';
import './supply.css';

type SupplyOk = Extract<SiteSupplyResponse, { ok: true }>;

const MOBILE = '(max-width: 767px)';
const isMobile = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(MOBILE).matches);

/** Celular: o globo inteiro é o vão, menos a trilha de navegação por cima (topo) e os créditos do mapa (pé). */
const MOBILE_STAGE_INSET = { side: 6, top: 56, bottom: 26 } as const;

/**
 * O vão livre entre os dois painéis, medido na tela: o palco é o próprio
 * módulo (`.dgm`, sobre o canvas do globo) e o vão é a sonda `.dgs-corridor`
 * (posicionada pelas MESMAS variáveis de coluna dos painéis). Celular: os
 * painéis viram folhas ABAIXO do globo — o vão é o próprio globo. Sem medida → `null` (enquadramento fixo).
 */
function measureCorridor(root: HTMLElement | null, probe: HTMLElement | null): Corridor | null {
  if (isMobile()) {
    const g = document.querySelector('[data-testid="dg-globe"]')?.getBoundingClientRect();
    if (!g || !(g.width > 0 && g.height > 0)) return null;
    const i = MOBILE_STAGE_INSET;
    // O celular zera o deslocamento de tela (o alvo fica no centro do globo): `centered` move o alvo em vez disso.
    return {
      width: Math.round(g.width), height: Math.round(g.height),
      left: Math.round(-g.width / 2 + i.side), right: Math.round(g.width / 2 - i.side),
      top: Math.round(-g.height / 2 + i.top), bottom: Math.round(g.height / 2 - i.bottom), centered: true,
    };
  }
  if (!root || !probe) return null;
  const r = root.getBoundingClientRect();
  const p = probe.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0 && p.width > 0 && p.height > 0)) return null;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return {
    width: Math.round(r.width), height: Math.round(r.height),
    left: Math.round(p.left - cx), right: Math.round(p.right - cx), top: Math.round(p.top - cy), bottom: Math.round(p.bottom - cy),
  };
}

/** O ancestral que ROLA de verdade (no celular a página rola num contêiner, não na janela). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (/(auto|scroll|overlay)/.test(oy) && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/**
 * Celular: leva a pessoa até o globo para ver a varredura. Rola o contêiner
 * certo DIRETO (sem `scrollIntoView` suave, que a troca do botão para
 * "analisando" interrompe no meio): a posição do globo é medida e o
 * contêiner vai até ela; se o layout mexer, confere de novo no quadro seguinte.
 */
function bringGlobeIntoView(): void {
  const globe = document.querySelector<HTMLElement>('[data-testid="dg-globe"]');
  if (!globe) return;
  const go = () => {
    const sc = scrollParent(globe);
    if (!sc) return;
    const base = sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
    const rel = globe.getBoundingClientRect().top - base;
    if (Math.abs(rel) <= 4) return;
    // 'instant': nem um `scroll-behavior: smooth` da página transforma o salto numa rolagem interrompível.
    sc.scrollTo({ top: Math.max(0, sc.scrollTop + rel), behavior: 'instant' as ScrollBehavior });
  };
  go();
  window.requestAnimationFrame(() => { go(); window.setTimeout(go, 120); });
}

/**
 * A varredura em curso: a etapa, o id (o do `GlobeScan`), a leitura de ANTES do clique, se é imediata
 * (movimento reduzido / sem origem) e se o plano JÁ foi visto (uma nova varredura não fecha o painel da direita).
 */
type ScanState = { stage: SupplyStage; id: string | null; baseline: SupplyOk | null; instant: boolean; seen: boolean };

/**
 * SUPPLY CHAIN — o fluxo guiado do filme (cena 3), com dado real:
 *
 *  1 NECESSIDADE (esquerda): o material em foco, a origem (cronograma / OS),
 *    o balanço da cobertura viva e "Analisar a rede de estoque".
 *  2 VARREDURA: no clique, relê o Supply e publica a camada com o `scan` —
 *    a câmera recua do canteiro para a rede, os anéis saem do canteiro e cada
 *    local responde ("250 m disponíveis" / "sem saldo disponível") quando o
 *    anel o alcança E a releitura voltou. Antes do clique: perto do canteiro,
 *    sem nós nem arcos.
 *  3–6 (direita, quando o globo avisa o fim — `scanPhase: 'done'`): o plano do
 *    Apex (reservar → transferir → comprar), a solicitação de compra, os
 *    fornecedores (homologados + internet) e a comparação A × B com o ato de
 *    quem decide e de quem aprova.
 *
 * Todo ato é a ROTA GOVERNADA que já existe; depois dele: `notifyChanged()`,
 * `onChanged()` (a página relê o local) e a releitura deste módulo.
 */
export function SupplyModule({ projectId, siteName, today, enter, onMapLayer, onExplain, onChanged, scanPhase }: ModuleProps) {
  const res = useResource<SupplyOk>(siteApi(projectId, 'supply'));
  const { refresh } = res;
  const payload = res.data;
  const supply = payload?.supply;
  const raw = supply?.state === 'ok' ? supply.data : null;
  const data = useMemo(() => (raw ? normalizeSupply(raw) : null), [raw]);

  const [scan, setScan] = useState<ScanState>({ stage: 'idle', id: null, baseline: null, instant: false, seen: false });
  const [timedOut, setTimedOut] = useState<string | null>(null);
  // O vão entre os painéis, medido no clique (e de novo se a janela mudar): o enquadramento depois da varredura cabe NELE.
  const rootRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [corridor, setCorridor] = useState<Corridor | null>(null);
  const remeasure = useCallback(() => {
    const c = measureCorridor(rootRef.current, probeRef.current);
    setCorridor((prev) => (prev && c && JSON.stringify(prev) === JSON.stringify(c) ? prev : c));
  }, []);
  // A releitura voltou: o dado na tela já não é o de antes do clique.
  const fresh = scan.stage !== 'idle' && payload !== null && payload !== scan.baseline;
  const globeDone = scanPhase != null && scan.id !== null && scanPhase.id === scan.id && scanPhase.phase === 'done';
  const canReveal = scan.stage === 'scanning' && fresh && (scan.instant || globeDone || timedOut === scan.id);
  // O plano revelado FICA revelado (ajuste de estado no render, sem efeito): uma fase posterior do globo não o esconde.
  if (canReveal) setScan({ ...scan, stage: 'revealed', seen: true });
  const stage: SupplyStage = canReveal ? 'revealed' : scan.stage;

  // Sem o aviso do globo (sem WebGL, motor sem varredura), o plano aparece assim mesmo.
  useEffect(() => {
    if (scan.stage !== 'scanning' || !fresh || !scan.id || scan.instant) return undefined;
    const id = scan.id;
    const t = window.setTimeout(() => setTimedOut(id), SCAN_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [scan.stage, scan.id, scan.instant, fresh]);

  const startScan = useCallback(() => {
    const reduced = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    // Sem o palco (WebGL indisponível, globo que não carregou) não há varredura a esperar: o plano vem com a releitura.
    const noStage = typeof document !== 'undefined'
      && (!document.querySelector('[data-testid="dg-globe"] .ag-globe canvas') || Boolean(document.querySelector('.dg-globe-fail')));
    remeasure();
    setScan((prev) => ({
      stage: 'scanning', id: `scan:${projectId}:${Date.now().toString(36)}`, baseline: payload,
      instant: reduced || noStage || !data || sitePoint(data) === null,
      seen: prev.seen || prev.stage === 'revealed' || prev.stage === 'direct',
    }));
    refresh();
  }, [projectId, payload, data, refresh, remeasure]);
  const goDirect = useCallback(() => {
    remeasure();
    setScan({ stage: 'direct', id: null, baseline: payload, instant: true, seen: true });
  }, [payload, remeasure]);

  // Celular: o globo fica no alto da página — a varredura leva a pessoa até ele, DEPOIS que o botão virou
  // "analisando" (a troca mexe no layout e interrompia a rolagem suave do clique).
  useEffect(() => {
    if (scan.stage !== 'scanning' || !scan.id || !isMobile()) return undefined;
    const raf = window.requestAnimationFrame(bringGlobeIntoView);
    return () => window.cancelAnimationFrame(raf);
  }, [scan.stage, scan.id]);

  // A janela mudou de tamanho com o plano à vista: o vão mudou, o enquadramento acompanha.
  const framed = scan.stage !== 'idle';
  useEffect(() => {
    if (!framed) return undefined;
    let t = 0;
    const onResize = () => { window.clearTimeout(t); t = window.setTimeout(remeasure, 250); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); window.clearTimeout(t); };
  }, [framed, remeasure]);

  // Identidade estável enquanto o CONTEÚDO da camada não muda: uma releitura igual não refaz o voo nem a varredura.
  const layerJson = useMemo(
    () => (data ? JSON.stringify(supplyFlowLayer(data, { stage, scanId: scan.id, fresh, corridor })) : null),
    [data, stage, scan.id, fresh, corridor],
  );
  const layer = useMemo(() => (layerJson ? (JSON.parse(layerJson) as MapLayer) : null), [layerJson]);
  usePublishLayer(onMapLayer, layer);

  const afterAct = useCallback(() => {
    notifyChanged();
    onChanged();
    refresh();
  }, [onChanged, refresh]);

  const day = payload?.today ?? today;
  const loading = !payload && res.state === 'loading';
  const ctx: FlowCtx | null = useMemo(
    () => (data ? { data, today: day, projectId, siteName, afterAct } : null),
    [data, day, projectId, siteName, afterAct],
  );

  let left: ReactNode;
  if (loading) {
    left = <><Eyebrow icon={<Package size={16} />}>Necessidade</Eyebrow><SkeletonLines lines={7} label="Carregando o material…" /></>;
  } else if (!payload) {
    left = <StateNote kind="error" title="O Supply Chain não carregou" onRetry={refresh}>{res.message ?? 'O servidor não respondeu. Tente de novo em instantes.'}</StateNote>;
  } else if (supply?.state === 'restricted') {
    left = <><Eyebrow icon={<Package size={16} />}>Necessidade</Eyebrow><StateNote kind="restricted" title="Restrito">Seu perfil não lê a cobertura de materiais deste projeto.</StateNote></>;
  } else if (supply?.state === 'error') {
    left = <><Eyebrow icon={<Package size={16} />}>Necessidade</Eyebrow><StateNote kind="error" title="A cobertura de materiais não carregou" onRetry={refresh}>{supply.message}</StateNote></>;
  } else if (data) {
    left = <NeedPanel data={data} today={day} stage={stage} onScan={startScan} onDirect={goDirect} onExplain={onExplain} />;
  }

  const showFlow = Boolean(ctx && data?.focus && (stage === 'revealed' || stage === 'direct' || scan.seen));
  return (
    <div className="dgm dgm-supply" data-testid="dg-supply" data-stage={stage} ref={rootRef}>
      <span className="dgs-corridor" ref={probeRef} aria-hidden />
      <ModulePanel enter={enter} className="dgm-mat dgs-need" label="Necessidade" testId="dg-supply-material">
        {left}
      </ModulePanel>
      {showFlow && ctx && (
        <ModulePanel enter={enter} className="dgm-plan-panel dgs-flow" label="Plano do Apex e compra" testId="dg-supply-plan">
          <SupplyFlowPanel ctx={ctx} entry={stage === 'direct' ? 'direct' : 'scan'} />
        </ModulePanel>
      )}
    </div>
  );
}
