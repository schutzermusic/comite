'use client';

/**
 * O GLOBO DO DASHBOARD — o palco do protótipo APEX FILM, com Cesium.
 *
 * Componente de apresentação (props = `ApexGlobeProps`, `contract.ts`): a
 * página decide marcadores, arcos, cartões, UFs, a vista e o `dim`; aqui só se
 * desenha e se voa. Sempre montado; cada troca de `view` vira UM voo contínuo
 * a partir da câmera ATUAL (`camera.ts`), a primeira montagem abre com a
 * trilha do filme (`intro.ts`), e o estado do voo sai por `useFlight()`.
 *
 * Cesium como no V1 (`CesiumDashboardGlobe.tsx`) e no filme (`globe.js`):
 * import dinâmico com `CESIUM_BASE_URL` (jsDelivr) definido ANTES, Blue Marble
 * local por baixo da Esri World Imagery, terreno elipsoidal, sem skybox, fundo
 * transparente, MSAA + FXAA, créditos compactos e visíveis. O Cesium não tem
 * laço próprio: UM requestAnimationFrame aplica a câmera, renderiza (modo sob
 * demanda) e desenha as camadas 2D — e para quando nada se move.
 *
 * MOUSE/TOQUE (round 2): o `ScreenSpaceCameraController` do Cesium fica ligado
 * (arrastar gira/move, direito/meio ou Ctrl+esquerdo inclina, roda/pinça
 * aproxima; 250 m–30.000 km; até 75° de inclinação). Dois donos da câmera:
 *  • `auto` — o voo/abertura/respiração/deriva do filme (`applyCamera`);
 *  • `user` — o Cesium, a partir do primeiro arrasto real (> 6 px), da roda
 *    ou da pinça: o voo em curso é cancelado e os painéis pousam
 *    (`flying: false, arrive: 1`); a câmera é LIDA DE VOLTA (`readBackView`)
 *    numa `CameraView` com os mesmos ox/oy. Parado, volta a `auto` na mesma
 *    pose; a respiração só depois de 6 s sem mexer.
 * Época (`viewEpoch`): nova → voa até a vista mesmo que igual; mesma época →
 * uma vista nova só troca o alvo se o usuário mexeu (a câmera não é roubada).
 * Mesma época com o voo em curso e o alvo novo PERTO do atual (o enquadramento
 * mediu o HUD, o tipo de obra chegou) → REAJUSTE: o voo não recomeça, a
 * câmera desliza do voo antigo para o novo até o pouso (`reaimable`).
 *
 * ÁREA LIVRE: a página declara em `--ag-free` ("l t r b", px do palco) onde o
 * HUD deixa o mapa à vista; o motor ainda tira a linha dos créditos. Cartões
 * do modelo, rótulo obrigatório e rótulos do mapa ficam DENTRO dela.
 *
 * Importar na página com `next/dynamic(..., { ssr: false })`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type * as CesiumNS from 'cesium';
import type { ApexGlobeProps, CameraView, ScanPhase } from './contract';
import {
  approach,
  blendView,
  BREATH_MAX_DIST_KM,
  breathOffset,
  cesiumFov,
  clamp,
  createFlight,
  DEG,
  driftOffset,
  flightRoll,
  INTERACTION,
  invLerp,
  lerp,
  offsetAngles,
  readBackView,
  REAIM_MIN_S,
  reaimable,
  reaimWeight,
  retargetAction,
  sampleFlight,
  sanitizeDrift,
  sanitizeView,
  viewsEqual,
  type DriftSpec,
  type Flight,
  type ReadBack,
} from './camera';
import { buildIntroTrack, INTRO_RETARGET_UNTIL, sampleIntro, type IntroTrack } from './intro';
import { publishFlight, settleFlight } from './flight-store';
import { buildUfGeo, effectiveFree, parseFreeRect, Projector, WorldOverlay, type ScreenMark } from './overlay';
import { LabelPool } from './labels';
import { HotspotPool } from './twin/hotspots';
import type { ScreenRect } from './twin/draw';
import './globe.css';

type CesiumModule = typeof import('cesium');
type Status = 'loading' | 'ready' | 'error';
type Interaction = NonNullable<ApexGlobeProps['interaction']>;

const CESIUM_VERSION = '1.138.0';
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
const ESRI_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_CREDIT = 'Imagens de satélite © Esri, Maxar, Earthstar Geographics';
const BLUE_MARBLE_URL = '/textures/earth-blue-marble-4k.jpg';
const BASE_COLOR = '#0c1418';
/** Resolução física máxima do globo (o filme usa 1,6). */
const MAX_PHYSICAL_SCALE = 1.6;
/** Espera máxima (s) pelos primeiros ladrilhos antes de mostrar o palco e abrir o filme. */
const BOOT_TIMEOUT_S = 2.5;
/** Quadros parados (sem ponteiro, sem inércia) até a câmera voltar a `auto`. */
const STILL_FRAMES = 4;
const PHASES: readonly ScanPhase[] = ['rings', 'answering', 'done'];
const HINT_MS = 1600;
/** A área livre é relida a cada tantos quadros (os créditos da Esri chegam depois). */
const FREE_EVERY = 45;

/** Só a causa: a página emoldura ("O globo não carregou — … Os painéis seguem funcionando."). */
const MESSAGES = {
  load: 'Não foi possível carregar o motor do globo 3D.',
  webgl: 'Este navegador não conseguiu iniciar o gráfico 3D (WebGL).',
  contextLost: 'O navegador liberou o contexto gráfico 3D (WebGL).',
  render: 'O globo 3D parou de desenhar.',
} as const;

interface EngineElements {
  root: HTMLDivElement;
  host: HTMLDivElement;
  shade: HTMLDivElement;
  overlay: HTMLCanvasElement;
  labels: HTMLDivElement;
  hot: HTMLDivElement;
  hint: HTMLDivElement;
  credits: HTMLDivElement;
}

type PropsRef = MutableRefObject<ApexGlobeProps>;

/** Contadores de desenvolvimento: quadros do laço, renders reais do Cesium, laço vivo. */
interface GlobeDebug {
  frames: number;
  renders: number;
  loop: boolean;
  /** Média móvel do custo de um quadro do laço (ms de CPU no thread principal). */
  frameMs: number;
  /** Quem dirige a câmera agora. */
  control: 'auto' | 'user';
  /** Maior erro (graus/km) entre a vista aplicada e a lida de volta do Cesium (QA da leitura). */
  readBackError: number;
  /** A vista atual (lida de volta quando o usuário dirige). */
  view: CameraView | null;
  epoch: number;
  /** Marcadores na tela (px do palco) e a área livre em uso — QA do enquadramento. */
  marks: ScreenMark[];
  free: ScreenRect | null;
  /** Quantos reajustes de voo (mesma época) aconteceram. */
  reaims: number;
}

const normInteraction = (v: unknown): Interaction => (v === 'none' || v === 'cooperative' ? v : 'full');

/**
 * O motor imperativo: Cesium + câmera + camadas 2D, fora do ciclo do React.
 * Lê as props do `propsRef` a cada quadro; nunca re-renderiza o componente.
 */
class GlobeEngine {
  private readonly widget: CesiumNS.CesiumWidget;
  private readonly scene: CesiumNS.Scene;
  private readonly camera: CesiumNS.Camera;
  private readonly layers: CesiumNS.ImageryLayer[] = [];
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly projector = new Projector();
  private readonly overlay = new WorldOverlay();
  private readonly labels: LabelPool;
  private readonly hotspots: HotspotPool;
  private readonly cleanups: Array<() => void> = [];
  private readonly tgt: CesiumNS.Cartesian3;
  private readonly hpr: CesiumNS.HeadingPitchRange;
  private readonly axis: CesiumNS.Cartesian3;
  private readonly pv: CesiumNS.Matrix4;
  private readonly pvArr: number[] = new Array<number>(16).fill(0);

  private raf = 0;
  private dead = false;
  private failed = false;
  private W = 0;
  private H = 0;
  private q = 1;
  private sizeDirty = true;

  /** Câmera do voo (sem a respiração nem a deriva). */
  private cam: CameraView;
  private target: CameraView;
  private flight: Flight | null = null;
  /** Reajuste em curso: o voo ANTIGO de onde a câmera desliza até `flight` entre t0 e t1. */
  private reaim: { from: Flight; t0: number; t1: number } | null = null;
  /** A fração do voo publicada nunca volta (os painéis não piscam num reajuste). */
  private arriveFloor = 0;
  /** A área livre do HUD neste palco (px) — cartões e rótulos ficam dentro dela. */
  private free: ScreenRect = { l: 0, t: 0, r: 0, b: 0 };
  private freeDirty = true;
  private freeTick = 0;
  private intro: { track: IntroTrack; t0: number } | null = null;
  private flightId = 1;
  private breathAmp = 0;
  /** Rolagem residual aplicada (graus) — vinda da leitura de volta; o voo a leva a 0. */
  private roll = 0;
  private flightRoll0 = 0;

  /* ── mouse/toque ── */
  private control: 'auto' | 'user' = 'auto';
  private interaction: Interaction = 'full';
  private inputReduced: boolean | null = null;
  /** O usuário mexeu no mapa desde o último voo (mesma época: a câmera não é roubada). */
  private userMoved = false;
  private epoch = 0;
  private forcedScan: string | null = null;
  private pointer: { id: number; x: number; y: number; moved: boolean; type: string } | null = null;
  private readonly touches = new Set<number>();
  private dragged = false;
  private lastInputT = Number.NEGATIVE_INFINITY;
  private stillFrames = 0;
  private readonly lastPose = new Float64Array(6);
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  /* ── deriva ── */
  private drift: { spec: DriftSpec; key: string; t0: number | null; cleared: boolean } | null = null;
  private driftNow = { heading: 0, distMul: 1 };

  private scanEmitted: { id: string; phase: ScanPhase } | null = null;

  private dim = 0;
  private dimReady = false;
  private dimSettled = true;
  private css = { globe: '', overlay: '', labels: '', shade: '' };
  private imageryKey = '';

  private hover: string | null = null;
  private lastT = -1;
  private readyAt = -1;
  private readyFired = false;
  private booting = true;
  private bootStart = -1;
  private bootFrames = 0;
  private promoted = false;
  private software = false;
  private synced: { markers?: unknown; arcs?: unknown; nodes?: unknown; ufs?: unknown; scan?: unknown; twin?: unknown } = {};
  /** Só em desenvolvimento: contadores para QA (`window.__apexGlobe`). */
  private readonly debug: GlobeDebug | null =
    process.env.NODE_ENV !== 'production'
      ? { frames: 0, renders: 0, loop: false, frameMs: 0, control: 'auto', readBackError: 0, view: null, epoch: 0, marks: [], free: null, reaims: 0 }
      : null;

  constructor(
    private readonly C: CesiumModule,
    private readonly els: EngineElements,
    private readonly propsRef: PropsRef,
    private readonly onStatus: (status: Status) => void,
  ) {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    let widget: CesiumNS.CesiumWidget;
    try {
      widget = new C.CesiumWidget(els.host, {
        baseLayer: false,
        terrainProvider: new C.EllipsoidTerrainProvider(),
        skyBox: false,
        skyAtmosphere: new C.SkyAtmosphere(),
        useDefaultRenderLoop: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Number.POSITIVE_INFINITY,
        useBrowserRecommendedResolution: false,
        msaaSamples: 2,
        creditContainer: els.credits,
        shouldAnimate: false,
        showRenderLoopErrors: false,
        blurActiveElementOnCanvasFocus: false,
        contextOptions: { webgl: { alpha: true, powerPreference: 'high-performance' } },
      });
    } catch (err) {
      throw new GlobeInitError(MESSAGES.webgl, err);
    }
    this.widget = widget;
    try {
      this.scene = widget.scene;
      this.camera = widget.scene.camera;
      const scene = this.scene;

      // ── os ajustes do globo do produto (V1) e do filme ──
      scene.backgroundColor = C.Color.TRANSPARENT;
      scene.globe.baseColor = C.Color.fromCssColorString(BASE_COLOR);
      scene.globe.enableLighting = false;
      scene.fog.enabled = true;
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
      if (scene.sun) scene.sun.show = false;
      if (scene.moon) scene.moon.show = false;
      scene.globe.showGroundAtmosphere = true;
      scene.postProcessStages.fxaa.enabled = true;
      scene.globe.tileCacheSize = 400;
      scene.globe.maximumScreenSpaceError = 1.5;
      scene.globe.preloadAncestors = true;
      // quadros leves durante a abertura; a nitidez total entra depois (V1)
      widget.resolutionScale = 1 / dpr;
      // WebGL por software (SwiftShader, llvmpipe — CI, máquina sem GPU): sem MSAA/FXAA,
      // menos ladrilhos e resolução física 1; o palco continua o mesmo, só mais barato
      this.software = isSoftwareRenderer(widget.canvas);
      if (this.software) {
        scene.msaaSamples = 1;
        scene.postProcessStages.fxaa.enabled = false;
        scene.globe.maximumScreenSpaceError = 2.5;
      }

      // ── imagens: Blue Marble local por baixo, Esri por cima ──
      const marble = C.ImageryLayer.fromProviderAsync(C.SingleTileImageryProvider.fromUrl(BLUE_MARBLE_URL), {});
      marble.errorEvent.addEventListener(() => {
        /* sem a base local a Esri continua; nada no console */
      });
      scene.imageryLayers.add(marble);
      const esri = new C.UrlTemplateImageryProvider({
        url: ESRI_URL,
        // a Esri devolve ladrilho cinza "sem dado" além do nível que tem; o Cesium amplia o 17
        maximumLevel: 17,
        credit: new C.Credit(ESRI_CREDIT, true),
      });
      esri.errorEvent.addEventListener((e) => {
        if (e) e.retry = false;
      });
      const esriLayer = scene.imageryLayers.addImageryProvider(esri);
      this.layers.push(marble, esriLayer);

      this.tgt = new C.Cartesian3();
      this.hpr = new C.HeadingPitchRange();
      this.axis = new C.Cartesian3();
      this.pv = new C.Matrix4();
      this.ctx = els.overlay.getContext('2d');
      this.labels = new LabelPool(els.labels);
      this.hotspots = new HotspotPool(els.hot, (id) => this.onHotspot(id));

      // ── câmera inicial: a abertura do filme, ou direto na vista ──
      const p = propsRef.current;
      this.epoch = finiteNum(p.viewEpoch) ? p.viewEpoch : 0;
      this.target = sanitizeView(p.view);
      if (p.intro && !p.reducedMotion) {
        const track = buildIntroTrack(this.target);
        this.intro = { track, t0: Number.NaN };
        this.cam = sampleIntro(track, 0).cam;
      } else {
        this.cam = this.target;
      }
      this.configureInput(p);
      this.syncData(true);
      this.forcedScan = this.overlay.scanId();

      // ── robustez ──
      const canvas = widget.canvas;
      const onLost = () => this.fail(MESSAGES.contextLost);
      canvas.addEventListener('webglcontextlost', onLost);
      this.cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));
      const onRenderError = () => this.fail(MESSAGES.render);
      scene.renderError.addEventListener(onRenderError);
      this.cleanups.push(() => scene.renderError.removeEventListener(onRenderError));
      const debug = this.debug;
      if (debug) {
        const onPostRender = () => {
          debug.renders += 1;
        };
        scene.postRender.addEventListener(onPostRender);
        const w = window as Window & { __apexGlobe?: GlobeDebug };
        w.__apexGlobe = debug;
        this.cleanups.push(() => {
          scene.postRender.removeEventListener(onPostRender);
          if (w.__apexGlobe === debug) delete w.__apexGlobe;
        });
      }
      const onResize = () => {
        this.sizeDirty = true;
        this.kick();
      };
      window.addEventListener('resize', onResize);
      this.cleanups.push(() => window.removeEventListener('resize', onResize));
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(onResize);
        ro.observe(els.root);
        this.cleanups.push(() => ro.disconnect());
      }
      const onVisible = () => {
        if (document.visibilityState === 'visible') this.kick();
      };
      document.addEventListener('visibilitychange', onVisible);
      this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisible));

      // ── entrada: escutas em CAPTURA no palco (antes do Cesium, que escuta no canvas) ──
      const root = els.root;
      const listen = <K extends keyof WindowEventMap>(target: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts: AddEventListenerOptions) => {
        target.addEventListener(type, fn as EventListener, opts);
        this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
      };
      listen(root, 'pointerdown', this.onPointerDown, { capture: true });
      listen(root, 'pointermove', this.onPointerDrag, { capture: true });
      listen(root, 'wheel', this.onWheel, { capture: true, passive: false });
      listen(window, 'pointerup', this.onPointerUp, { capture: true });
      listen(window, 'pointercancel', this.onPointerUp, { capture: true });

      // ── divisas das UFs: módulo local, carregado sob demanda (nenhuma rede de terceiros) ──
      import('./br-uf-geo')
        .then((mod) => {
          if (this.dead) return;
          this.overlay.setGeo(buildUfGeo(mod.UF_ARCS, mod.UF_RINGS));
          this.kick();
        })
        .catch(() => {
          /* sem divisas o globo segue; nada no console */
        });
    } catch (err) {
      this.dead = true;
      for (const fn of this.cleanups.splice(0)) {
        try {
          fn();
        } catch {
          /* segue a limpeza */
        }
      }
      try {
        widget.destroy();
      } catch {
        /* já destruído */
      }
      throw new GlobeInitError(MESSAGES.webgl, err);
    }
    this.kick();
  }

  /** As props mudaram (a página re-renderizou — a área livre pode ter mudado junto). */
  onProps(): void {
    if (this.dead) return;
    this.freeDirty = true;
    this.configureInput(this.propsRef.current);
    this.syncData(false);
    this.kick();
  }

  /** Relê a área livre (`--ag-free` da página + a linha dos créditos). */
  private readFree(): void {
    this.freeDirty = false;
    let declared: ScreenRect | null = null;
    try {
      declared = parseFreeRect(getComputedStyle(this.els.root).getPropertyValue('--ag-free'), this.W, this.H);
    } catch {
      declared = null;
    }
    const c = this.els.credits;
    const credits = c.offsetWidth > 0 && c.offsetHeight > 0
      ? { l: c.offsetLeft, t: c.offsetTop, r: c.offsetLeft + c.offsetWidth, b: c.offsetTop + c.offsetHeight }
      : null;
    this.free = effectiveFree(declared, this.W, this.H, credits);
    if (this.debug) this.debug.free = { ...this.free };
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearTimers();
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* segue a limpeza */
      }
    }
    this.labels.clear();
    this.hotspots.clear();
    this.els.root.style.cursor = '';
    delete this.els.root.dataset.grabbing;
    try {
      if (!this.widget.isDestroyed()) this.widget.destroy();
    } catch {
      /* contexto já perdido */
    }
  }

  /* ── mouse/toque ─────────────────────────────────────────────────────── */

  /** Gestos e limites do Cesium pela interação pedida e pelo movimento reduzido. */
  private configureInput(p: ApexGlobeProps): void {
    const mode = normInteraction(p.interaction);
    const reduced = Boolean(p.reducedMotion);
    if (mode === this.interaction && reduced === this.inputReduced) return;
    this.interaction = mode;
    this.inputReduced = reduced;
    const C = this.C;
    const s = this.scene.screenSpaceCameraController;
    this.syncInputs();
    s.enableLook = false;
    s.enableRotate = true;
    s.enableZoom = true;
    s.enableTilt = true;
    s.minimumZoomDistance = INTERACTION.minZoomM;
    s.maximumZoomDistance = INTERACTION.maxZoomM;
    s.maximumTiltAngle = INTERACTION.maxTiltDeg * DEG;
    s.rotateEventTypes = C.CameraEventType.LEFT_DRAG;
    s.tiltEventTypes = [
      C.CameraEventType.MIDDLE_DRAG,
      C.CameraEventType.RIGHT_DRAG,
      C.CameraEventType.PINCH,
      { eventType: C.CameraEventType.LEFT_DRAG, modifier: C.KeyboardEventModifier.CTRL },
    ];
    // roda (⌘ não é modificador no Cesium: chega como roda simples) e Ctrl+roda (pinça do trackpad)
    s.zoomEventTypes = [
      C.CameraEventType.WHEEL,
      C.CameraEventType.PINCH,
      { eventType: C.CameraEventType.WHEEL, modifier: C.KeyboardEventModifier.CTRL },
    ];
    s.lookEventTypes = undefined;
    // movimento reduzido: sem inércia (≥ 1 desliga no Cesium)
    s.inertiaSpin = reduced ? 1 : 0.9;
    s.inertiaTranslate = reduced ? 1 : 0.9;
    s.inertiaZoom = reduced ? 1 : 0.8;
    if (mode === 'none') {
      this.pointer = null;
      this.touches.clear();
      this.setGrabbing(false);
    }
  }

  /**
   * O Cesium só APLICA a entrada enquanto o usuário dirige: no voo/respiração a
   * câmera é do filme e nenhuma inércia de um arrasto anterior vaza para ela.
   * (Os eventos continuam sendo ouvidos — a roda não rola a página no desktop.)
   */
  private syncInputs(): void {
    const s = this.scene.screenSpaceCameraController;
    const on = this.interaction !== 'none' && this.control === 'user';
    if (s.enableInputs !== on) s.enableInputs = on;
  }

  private inHost(target: EventTarget | null): boolean {
    return target instanceof Node && this.els.host.contains(target);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.dead || this.failed || this.interaction === 'none' || !this.inHost(e.target)) return;
    this.dragged = false;
    if (e.pointerType === 'touch') this.touches.add(e.pointerId);
    // celular: um dedo rola a página (o Cesium não gira); dois dedos aproximam/inclinam
    if (this.interaction === 'cooperative') this.scene.screenSpaceCameraController.enableRotate = e.pointerType !== 'touch';
    if (this.touches.size >= 2) this.takeControl();
    if (!this.pointer) this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, type: e.pointerType };
    this.kick();
  };

  private readonly onPointerDrag = (e: PointerEvent): void => {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > INTERACTION.dragPx) {
      p.moved = true;
      this.dragged = true;
      if (this.interaction === 'cooperative' && p.type === 'touch') {
        if (this.touches.size < 2) this.showHint('touch');
      } else {
        this.takeControl();
        this.setGrabbing(true);
        this.setHover(null);
      }
    }
    if (p.moved && this.control === 'user') this.lastInputT = performance.now() / 1000;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.pointer && e.pointerId === this.pointer.id) {
      this.pointer = null;
      this.setGrabbing(false);
      this.kick();
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.dead || this.failed || this.interaction === 'none' || !this.inHost(e.target)) return;
    if (this.interaction === 'cooperative' && !(e.ctrlKey || e.metaKey)) {
      // cooperativo: a roda rola a página; o Cesium nem vê o evento
      e.stopPropagation();
      this.showHint('wheel');
      return;
    }
    this.takeControl();
  };

  /** O usuário assumiu a câmera: cancela voo/abertura/deriva; o Cesium dirige a partir da pose NA TELA. */
  private takeControl(): void {
    if (this.dead || this.failed || this.interaction === 'none' || this.booting) return;
    this.lastInputT = performance.now() / 1000;
    this.clearIdleTimer();
    this.userMoved = true;
    if (this.drift) this.drift.cleared = true;
    if (this.control !== 'user') {
      this.control = 'user';
      this.flight = null;
      this.reaim = null;
      this.intro = null;
      this.breathAmp = 0;
      this.stillFrames = 0;
      this.lastPose.fill(Number.NaN);
    }
    this.syncInputs();
    this.kick();
  }

  private setGrabbing(on: boolean): void {
    const root = this.els.root;
    if (on) root.dataset.grabbing = '1';
    else delete root.dataset.grabbing;
  }

  private showHint(kind: 'wheel' | 'touch'): void {
    const el = this.els.hint;
    const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
    const text = kind === 'wheel'
      ? `Use ${mac ? '⌘' : 'Ctrl'} + roda do mouse para aproximar o mapa`
      : 'Use dois dedos para aproximar ou inclinar o mapa';
    if (el.textContent !== text) el.textContent = text;
    el.dataset.show = '1';
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      delete el.dataset.show;
      this.hintTimer = null;
    }, HINT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearTimers(): void {
    this.clearIdleTimer();
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
  }

  /** Acorda o laço quando a respiração pode voltar (6 s depois da última entrada). */
  private scheduleIdle(t: number): void {
    if (this.idleTimer || !Number.isFinite(this.lastInputT)) return;
    const wait = (this.lastInputT + INTERACTION.idleBreathS - t) * 1000;
    if (wait <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.kick();
    }, wait + 30);
  }

  /** A pose do Cesium agora, lida como vista (com os ox/oy atuais). */
  private readPose(): ReadBack | null {
    const c = this.camera;
    const pos = c.positionWC;
    const dir = c.directionWC;
    const up = c.upWC;
    const right = c.rightWC;
    return readBackView(
      { position: [pos.x, pos.y, pos.z], direction: [dir.x, dir.y, dir.z], up: [up.x, up.y, up.z], right: [right.x, right.y, right.z] },
      this.cam.ox,
      this.cam.oy,
      this.H,
      this.cam.heading,
    );
  }

  /* ── ponteiro (hover e clique nos marcadores) ── */

  pointerMove(clientX: number, clientY: number, pointerType: string): void {
    if (this.dead || this.failed || pointerType === 'touch') return;
    if (this.pointer?.moved) return; // arrastando: nada de hover
    const r = this.els.root.getBoundingClientRect();
    this.setHover(this.overlay.pick(clientX - r.left, clientY - r.top));
  }

  pointerLeave(): void {
    if (this.dead) return;
    this.setHover(null);
  }

  click(clientX: number, clientY: number): void {
    if (this.dead || this.failed) return;
    // arrasto não é clique (guarda de 6 px): o marcador só abre num clique de verdade
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const r = this.els.root.getBoundingClientRect();
    const id = this.overlay.pick(clientX - r.left, clientY - r.top);
    this.propsRef.current.onSelectMarker?.(id);
  }

  private setHover(id: string | null): void {
    if (id === this.hover) return;
    this.hover = id;
    this.els.root.style.cursor = id ? 'pointer' : '';
    this.propsRef.current.onHoverMarker?.(id);
    this.kick();
  }

  private onHotspot(id: string): void {
    if (this.dead) return;
    const spec = this.propsRef.current.twin;
    const h = spec?.hotspots.find((x) => x.id === id);
    if (h && !h.target) this.overlay.emphasize(id);
    this.propsRef.current.onTwinHotspot?.(id);
    this.kick();
  }

  /* ── laço ── */

  private kick(): void {
    if (this.dead || this.failed || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (ms: number): void => {
    this.raf = 0;
    if (this.dead || this.failed) return;
    const started = performance.now();
    const t = ms / 1000;
    const dt = this.lastT < 0 ? 1 / 60 : clamp(t - this.lastT, 0, 0.1);
    this.lastT = t;
    const p = this.propsRef.current;
    const reduced = Boolean(p.reducedMotion);
    try {
      if (!this.measure()) return; // palco sem tamanho: espera o ResizeObserver
      this.syncView(p, t, reduced);

      // 0 · partida: o palco só aparece (e a abertura só começa) com os primeiros ladrilhos na tela
      if (this.booting) {
        if (this.bootStart < 0) this.bootStart = t;
        this.bootFrames += 1;
        const tiles = this.bootFrames > 3 && this.scene.globe.tilesLoaded;
        if (tiles || t - this.bootStart > BOOT_TIMEOUT_S) this.booting = false;
      }

      // 1 · câmera: abertura, voo ou parada (o usuário dirigindo: o Cesium manda)
      const user = this.control === 'user';
      let flying = false;
      let arrive = 1;
      if (!user && this.intro) {
        if (!this.booting && !Number.isFinite(this.intro.t0)) this.intro.t0 = t;
        if (reduced) {
          this.intro = null;
          this.cam = this.target;
        } else if (this.booting) {
          // parado na Terra, esperando os ladrilhos: o voo "vai começar"
          this.cam = sampleIntro(this.intro.track, 0).cam;
          flying = true;
          arrive = 0;
        } else {
          const s = sampleIntro(this.intro.track, t - this.intro.t0);
          this.cam = s.cam;
          arrive = s.arrive;
          flying = !s.done;
          if (s.done) this.intro = null;
        }
      }
      if (!user && !this.intro && this.flight) {
        if (reduced) {
          this.cam = this.flight.to;
          this.flight = null;
          this.reaim = null;
          this.roll = 0;
        } else {
          const s = sampleFlight(this.flight, t);
          let cam = s.cam;
          let a = s.arrive;
          let done = s.done;
          // reajuste: desliza do voo antigo para o novo (peso suave até o pouso)
          const r = this.reaim;
          if (r) {
            const w = reaimWeight(t, r.t0, r.t1);
            if (w >= 1) {
              this.reaim = null;
            } else {
              const o = sampleFlight(r.from, t);
              cam = blendView(o.cam, s.cam, w);
              a = lerp(o.arrive, s.arrive, w);
              done = false;
            }
          }
          this.cam = cam;
          this.roll = flightRoll(this.flightRoll0, s.u);
          arrive = Math.max(this.arriveFloor, clamp(a));
          this.arriveFloor = arrive;
          flying = !done;
          if (done) {
            this.cam = { ...this.flight.to, heading: this.flight.from.heading + this.flight.dh };
            this.flight = null;
            this.roll = 0;
            arrive = 1;
          }
        }
      }

      // 2 · respiração: parado, perto do chão e 6 s depois da última entrada; entra suave
      const idle = t - this.lastInputT >= INTERACTION.idleBreathS;
      const wantsBreath = Boolean(p.idleBreath) && !reduced && !flying && !user && this.cam.dist < BREATH_MAX_DIST_KM;
      const breathe = wantsBreath && idle;
      if (wantsBreath && !idle) this.scheduleIdle(t);
      this.breathAmp = approach(this.breathAmp, breathe ? 1 : 0, dt, 1.2);
      if (!breathe && this.breathAmp < 1e-3) this.breathAmp = 0;
      // 2b · deriva depois do pouso (aditiva)
      const drifting = this.stepDrift(p, t, flying, reduced);
      if (!user) {
        this.applyCamera({
          ...this.cam,
          heading: this.cam.heading + this.breathAmp * breathOffset(t) + this.driftNow.heading,
          dist: this.cam.dist * this.driftNow.distMul,
        }, this.roll);
      } else {
        this.applyFov();
      }

      // 3 · o mundo recua atrás do HUD; imagens regraduadas pela altitude; sombra do horizonte
      this.applyImagery(this.cam.dist);
      this.applyStage(p, dt, reduced);

      // 4 · globo (o modo sob demanda do Cesium pula o quadro se nada mudou; o controlador do mouse roda aqui)
      this.widget.render();

      // 4b · usuário dirigindo: lê a câmera de volta; parado → devolve ao filme na mesma pose
      const userMoving = user ? this.followUser(t) : false;
      if (!user && this.debug && (this.debug.frames & 63) === 0) this.checkReadBack();

      // 5 · camadas 2D + rótulos + hotspots do modelo
      const moving = this.overlay.step({ dt, flying, arrive, reducedMotion: reduced });
      this.drawOverlay(t, reduced, flying, arrive);
      this.emitScanPhase(p);

      publishFlight({ flying, arrive, dist: this.cam.dist, flightId: this.flightId });

      if (!this.readyFired && !this.booting) {
        this.readyFired = true;
        this.readyAt = t;
        this.onStatus('ready');
        p.onReady?.();
      }
      if (!this.promoted && this.readyFired && !this.intro && t - this.readyAt > 0.8) this.promote();

      const keep =
        this.booting ||
        flying ||
        this.intro !== null ||
        this.flight !== null ||
        breathe ||
        this.breathAmp > 0 ||
        drifting ||
        this.control === 'user' ||
        this.pointer !== null ||
        userMoving ||
        moving ||
        this.overlay.motion ||
        !this.dimSettled ||
        !this.promoted ||
        this.sizeDirty ||
        !this.scene.globe.tilesLoaded;
      if (this.debug) {
        this.debug.frames += 1;
        this.debug.loop = keep;
        this.debug.frameMs = this.debug.frameMs * 0.9 + (performance.now() - started) * 0.1;
        this.debug.control = this.control;
        this.debug.view = { ...this.cam };
        this.debug.epoch = this.epoch;
      }
      if (keep) this.kick();
    } catch {
      this.fail(MESSAGES.render);
    }
  };

  /**
   * A câmera do usuário neste quadro: lê de volta (vista + rolagem) e detecta se
   * ainda se move (arrasto ou inércia). Parada por alguns quadros e sem ponteiro:
   * volta a `auto` na MESMA pose (a respiração espera os 6 s).
   */
  private followUser(t: number): boolean {
    const rb = this.readPose();
    if (rb) {
      this.cam = rb.view;
      this.roll = rb.rollDeg;
    }
    const c = this.camera;
    const sig = [c.positionWC.x, c.positionWC.y, c.positionWC.z, c.directionWC.x, c.directionWC.y, c.directionWC.z];
    let changed = false;
    for (let i = 0; i < 6; i += 1) {
      const tol = i < 3 ? 1e-3 : 1e-9;
      if (!(Math.abs(sig[i] - this.lastPose[i]) <= tol)) changed = true;
      this.lastPose[i] = sig[i];
    }
    if (changed) this.stillFrames = 0;
    else this.stillFrames += 1;
    if (!this.pointer && this.touches.size === 0 && this.stillFrames >= STILL_FRAMES) {
      this.control = 'auto';
      this.syncInputs();
      this.scheduleIdle(t);
      return false;
    }
    return changed;
  }

  /** QA (só dev): a vista aplicada, lida de volta do Cesium, bate com a pretendida? */
  private checkReadBack(): void {
    if (!this.debug || this.breathAmp > 0 || this.driftNow.heading !== 0) return;
    const rb = this.readPose();
    if (!rb) return;
    const a = rb.view;
    const b = this.cam;
    const err = Math.max(Math.abs(a.lat - b.lat), Math.abs(a.lng - b.lng), Math.abs(a.pitch - b.pitch),
      Math.abs(((a.heading - b.heading + 540) % 360) - 180), Math.abs(a.dist - b.dist) / Math.max(1e-6, b.dist), Math.abs(rb.rollDeg - this.roll));
    this.debug.readBackError = Math.max(this.debug.readBackError * 0.5, err);
  }

  /** Avisa a página de cada fase nova da varredura, em ordem (rings → answering → done). */
  private emitScanPhase(p: ApexGlobeProps): void {
    const sp = this.overlay.scanPhase;
    if (!sp) return;
    const prev = this.scanEmitted && this.scanEmitted.id === sp.id ? PHASES.indexOf(this.scanEmitted.phase) : -1;
    const to = PHASES.indexOf(sp.phase);
    if (to <= prev) return;
    this.scanEmitted = { id: sp.id, phase: sp.phase };
    for (let i = prev + 1; i <= to; i += 1) {
      try {
        p.onScanPhase?.(sp.id, PHASES[i]);
      } catch {
        /* a página decide; o globo segue */
      }
    }
  }

  /** A deriva da camada: começa no pouso, soma rumo/distância, some com qualquer entrada. */
  private stepDrift(p: ApexGlobeProps, t: number, flying: boolean, reduced: boolean): boolean {
    const spec = reduced ? null : sanitizeDrift(p.drift);
    const zero = () => {
      this.driftNow = { heading: 0, distMul: 1 };
    };
    if (!spec) {
      // a camada tirou a deriva: o que já estava aplicado fica (sem salto)
      if (this.drift && this.control === 'auto' && (this.driftNow.heading !== 0 || this.driftNow.distMul !== 1)) {
        this.cam = { ...this.cam, heading: this.cam.heading + this.driftNow.heading, dist: this.cam.dist * this.driftNow.distMul };
      }
      this.drift = null;
      zero();
      return false;
    }
    const key = `${spec.headingDeg}|${spec.distK}|${spec.seconds}`;
    if (!this.drift || this.drift.key !== key) this.drift = { spec, key, t0: null, cleared: false };
    const d = this.drift;
    if (d.cleared || this.control === 'user') {
      zero();
      return false;
    }
    if (flying || this.flight || this.intro) {
      d.t0 = null;
      zero();
      return false;
    }
    if (d.t0 === null) d.t0 = t;
    const off = driftOffset(spec, t - d.t0);
    this.driftNow = { heading: off.heading, distMul: off.distMul };
    return !off.done;
  }

  private fail(message: string): void {
    if (this.dead || this.failed) return;
    this.failed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clearTimers();
    this.labels.clear();
    this.hotspots.clear();
    this.els.root.style.cursor = '';
    settleFlight();
    this.onStatus('error');
    this.propsRef.current.onError?.(message);
  }

  /* ── passos do quadro ── */

  /** Tamanho do palco; `false` enquanto ele não tiver área. */
  private measure(): boolean {
    const W = this.els.root.clientWidth;
    const H = this.els.root.clientHeight;
    if (W < 2 || H < 2) return false;
    const dpr = window.devicePixelRatio || 1;
    const q = clamp(dpr, 1, 2);
    if (this.sizeDirty || W !== this.W || H !== this.H || q !== this.q) {
      this.W = W;
      this.H = H;
      this.q = q;
      const cw = Math.max(1, Math.round(W * q));
      const ch = Math.max(1, Math.round(H * q));
      if (this.els.overlay.width !== cw) this.els.overlay.width = cw;
      if (this.els.overlay.height !== ch) this.els.overlay.height = ch;
      if (this.promoted && !this.software) this.widget.resolutionScale = Math.min(dpr, MAX_PHYSICAL_SCALE) / dpr;
      this.scene.requestRender();
      this.freeDirty = true;
    }
    this.sizeDirty = false;
    this.widget.resize();
    return true;
  }

  private promote(): void {
    this.promoted = true;
    if (this.software) return; // sem GPU, fica na resolução física 1
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(dpr, MAX_PHYSICAL_SCALE) / dpr;
    if (Math.abs(this.widget.resolutionScale - scale) > 1e-3) {
      this.widget.resolutionScale = scale;
      this.scene.requestRender();
    }
  }

  /**
   * Nova `view`/época/varredura → voo a partir da câmera NA TELA; mesma época
   * com o usuário tendo mexido → só troca o alvo (a câmera não é roubada).
   */
  private syncView(p: ApexGlobeProps, t: number, reduced: boolean): void {
    const epoch = finiteNum(p.viewEpoch) ? p.viewEpoch : 0;
    const newEpoch = epoch !== this.epoch;
    this.epoch = epoch;
    const scanId = this.overlay.scanId();
    const newScan = scanId !== null && scanId !== this.forcedScan;
    this.forcedScan = scanId;
    const next = sanitizeView(p.view, this.target);
    const settledAuto = this.control === 'auto' && !this.flight && !this.intro;
    const offTarget = this.control === 'user' || (settledAuto && !viewsEqual(this.cam, this.target)) ||
      this.driftNow.heading !== 0 || this.driftNow.distMul !== 1;
    const action = retargetAction({ sameView: viewsEqual(next, this.target), newEpoch: newEpoch || newScan, userMoved: this.userMoved, offTarget });
    if (action === 'none') return;
    this.target = next;
    if (action === 'target') return;
    this.userMoved = false;
    if (this.intro && this.control === 'auto') {
      const it = Number.isFinite(this.intro.t0) ? t - this.intro.t0 : 0;
      if (!reduced && it < INTRO_RETARGET_UNTIL) {
        // o trecho já percorrido não depende do destino: a câmera não salta
        this.intro.track = buildIntroTrack(next);
        return;
      }
      this.intro = null;
    }
    // REAJUSTE: mesma época, voo em curso e o alvo novo perto do atual (o enquadramento
    // mediu o HUD, o tipo de obra chegou) — o voo não recomeça nem troca de id
    const cur = this.flight;
    if (cur && !newEpoch && !newScan && !reduced && !this.booting && this.control === 'auto' && reaimable(cur.to, next)) {
      const nf = createFlight(cur.from, next, cur.t0);
      const r = this.reaim;
      // reajuste sobre reajuste: parte do voo que domina a mistura agora (salto ≤ metade da diferença)
      const from = r && reaimWeight(t, r.t0, r.t1) < 0.5 ? r.from : cur;
      this.reaim = { from, t0: t, t1: Math.max(t + REAIM_MIN_S, nf.t0 + nf.dur) };
      this.flight = nf;
      if (this.debug) this.debug.reaims += 1;
      return;
    }
    // voo novo: parte da câmera NA TELA (com a mistura de um reajuste em curso, se houver)
    const live = this.liveFlightCam(t);
    this.reaim = null;
    this.arriveFloor = 0;
    this.flightId += 1;
    // parte do que está NA TELA (respiração, deriva, rolagem; ou a câmera do usuário)
    let from: CameraView;
    let roll0 = this.roll;
    if (this.control === 'user') {
      const rb = this.readPose();
      from = rb ? rb.view : this.cam;
      roll0 = rb ? rb.rollDeg : this.roll;
    } else {
      const current = live ?? this.cam;
      from = {
        ...current,
        heading: current.heading + this.breathAmp * breathOffset(t) + this.driftNow.heading,
        dist: current.dist * this.driftNow.distMul,
      };
    }
    this.control = 'auto';
    this.syncInputs();
    this.breathAmp = 0;
    this.driftNow = { heading: 0, distMul: 1 };
    if (this.drift) this.drift.t0 = null;
    if (reduced || this.booting) {
      // sem movimento pedido, ou palco ainda invisível: vai direto
      this.flight = null;
      this.cam = next;
      this.roll = 0;
      return;
    }
    this.flight = createFlight(from, next, t);
    this.flightRoll0 = roll0;
    this.roll = roll0;
  }

  /** A câmera do voo em `t` (com a mistura do reajuste), ou `null` sem voo. */
  private liveFlightCam(t: number): CameraView | null {
    if (!this.flight) return null;
    const s = sampleFlight(this.flight, t).cam;
    const r = this.reaim;
    if (!r) return s;
    const w = reaimWeight(t, r.t0, r.t1);
    return w >= 1 ? s : blendView(sampleFlight(r.from, t).cam, s, w);
  }

  private applyFov(): void {
    const frustum = this.camera.frustum as CesiumNS.PerspectiveFrustum;
    const fov = cesiumFov(this.W, this.H);
    if (frustum.fov !== fov) frustum.fov = fov;
  }

  private applyCamera(c: CameraView, rollDeg: number): void {
    const C = this.C;
    const cam = this.camera;
    C.Cartesian3.fromDegrees(c.lng, c.lat, 0, C.Ellipsoid.WGS84, this.tgt);
    this.hpr.heading = c.heading * DEG;
    this.hpr.pitch = -Math.min(c.pitch, 89.9) * DEG;
    this.hpr.range = c.dist * 1000;
    cam.lookAt(this.tgt, this.hpr);
    cam.lookAtTransform(C.Matrix4.IDENTITY);
    this.applyFov();
    // rolagem residual (da câmera do usuário) em torno da direção; o voo a leva a 0
    if (rollDeg && Number.isFinite(rollDeg)) cam.look(C.Cartesian3.clone(cam.direction, this.axis), -rollDeg * DEG);
    // enquadramento fora do centro: gira a câmera para o alvo cair em (ox, oy)
    const { yaw, pitch } = offsetAngles(c.ox, c.oy, this.H);
    if (yaw) cam.look(C.Cartesian3.clone(cam.up, this.axis), -yaw);
    if (pitch) cam.look(C.Cartesian3.clone(cam.right, this.axis), -pitch);
  }

  /** Regradua as imagens pela altitude (`app.js:500-501`), só quando muda. */
  private applyImagery(dist: number): void {
    const siteLook = clamp((30 - dist) / 26);
    const b = lerp(0.95, 0.8, siteLook);
    const s = lerp(0.85, 0.62, siteLook);
    const c = lerp(1.05, 1.1, siteLook);
    const key = `${b.toFixed(3)}|${s.toFixed(3)}|${c.toFixed(3)}`;
    if (key === this.imageryKey) return;
    this.imageryKey = key;
    for (const layer of this.layers) {
      layer.brightness = b;
      layer.saturation = s;
      layer.contrast = c;
      layer.gamma = 1;
    }
    this.scene.requestRender();
  }

  /** `dim` (brilho/saturação do globo e das camadas), rótulos e sombra do horizonte. */
  private applyStage(p: ApexGlobeProps, dt: number, reduced: boolean): void {
    const target = clamp(typeof p.dim === 'number' && Number.isFinite(p.dim) ? p.dim : 0);
    if (!this.dimReady) {
      this.dim = target;
      this.dimReady = true;
    } else {
      this.dim = approach(this.dim, target, dt, reduced ? 25 : 4);
      if (Math.abs(this.dim - target) < 1e-3) this.dim = target;
    }
    this.dimSettled = this.dim === target;
    const d = this.dim;
    const globe = d > 0.001 ? `brightness(${(1 - d * 0.62).toFixed(3)}) saturate(${(1 - d * 0.35).toFixed(3)})` : 'none';
    const overlay = d > 0.001 ? `brightness(${(1 - d * 0.62).toFixed(3)})` : 'none';
    const labels = (1 - d * 0.85).toFixed(3);
    const pitch = this.cam.pitch;
    const shadeK = (pitch < 80 ? invLerp(80, 45, pitch) : 0) * (p.theme === 'light' ? 0.6 : 1);
    const shade = shadeK.toFixed(3);
    if (globe !== this.css.globe) {
      this.els.host.style.filter = globe;
      this.css.globe = globe;
    }
    if (overlay !== this.css.overlay) {
      this.els.overlay.style.filter = overlay;
      this.css.overlay = overlay;
    }
    if (labels !== this.css.labels) {
      this.els.labels.style.opacity = labels;
      // os hotspots do modelo recuam menos (seguem clicáveis e legíveis)
      this.els.hot.style.opacity = Math.max(0.72, Number(labels)).toFixed(3);
      this.css.labels = labels;
    }
    if (shade !== this.css.shade) {
      this.els.shade.style.opacity = shade;
      this.css.shade = shade;
    }
  }

  private drawOverlay(t: number, reduced: boolean, flying: boolean, arrive: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const C = this.C;
    const cam = this.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.els.overlay.width, this.els.overlay.height);
    ctx.setTransform(this.q, 0, 0, this.q, 0, 0);
    C.Matrix4.multiply(cam.frustum.projectionMatrix, cam.viewMatrix, this.pv);
    C.Matrix4.toArray(this.pv, this.pvArr);
    this.projector.set(this.pvArr, this.W, this.H, cam.positionWC);
    // a área livre do HUD: relida quando a página/tamanho mudam e, de tempos em tempos, pelos créditos
    this.freeTick += 1;
    if (this.freeDirty || this.freeTick >= FREE_EVERY) {
      this.freeTick = 0;
      this.readFree();
    }
    // os cartões do modelo: conteúdo e TAMANHO reais antes de escolher o lugar
    const spec = this.overlay.twinSpec();
    const sized = this.hotspots.prepare(spec?.hotspots ?? [], spec ? spec.label : null, this.W, this.freeTick === 0);
    const specs = this.overlay.draw(ctx, this.projector, {
      t,
      dist: this.cam.dist,
      reducedMotion: reduced,
      hoverId: this.hover,
      flying,
      arrive,
      twinPlace: { free: this.free, sizes: sized.sizes, note: sized.note },
    });
    this.labels.apply(specs, this.W, this.H, this.free, this.freeTick === 0);
    const tw = this.overlay.twinOut;
    this.hotspots.apply(tw ? tw.cards : new Map(), tw ? tw.note : null, tw ? tw.alpha : 0);
    if (this.debug && (this.debug.frames & 15) === 0) this.debug.marks = this.overlay.screenMarks();
  }

  /** Marcadores, arcos, cartões, UFs, varredura e modelo: diff por id, só quando a referência muda. */
  private syncData(force: boolean): void {
    const p = this.propsRef.current;
    const s = this.synced;
    if (!force && s.markers === p.markers && s.arcs === p.arcs && s.nodes === p.nodes && s.ufs === p.highlightUfs &&
      s.scan === p.scan && s.twin === p.twin) return;
    this.synced = { markers: p.markers, arcs: p.arcs, nodes: p.nodes, ufs: p.highlightUfs, scan: p.scan, twin: p.twin };
    this.overlay.sync(p.markers, p.arcs, p.nodes, p.highlightUfs);
    this.overlay.syncScan(p.scan ?? null);
    this.overlay.syncTwin(p.twin ?? null);
    if (this.hover && !(p.markers ?? []).some((m) => m && m.id === this.hover)) this.setHover(null);
  }
}

class GlobeInitError extends Error {
  constructor(message: string, readonly reason: unknown) {
    super(message);
    this.name = 'GlobeInitError';
  }
}

const finiteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** WebGL emulado na CPU? (SwiftShader, llvmpipe…) — lê o contexto que o Cesium já criou. */
function isSoftwareRenderer(canvas: HTMLCanvasElement): boolean {
  try {
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

function messageFor(err: unknown): string {
  return err instanceof GlobeInitError ? err.message : MESSAGES.load;
}

export function ApexGlobe(props: ApexGlobeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const hotRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef<ApexGlobeProps>(props);
  const engineRef = useRef<GlobeEngine | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  // as props mais novas para o motor (lidas a cada quadro, nunca no render)
  useLayoutEffect(() => {
    propsRef.current = props;
    engineRef.current?.onProps();
  });

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    const shade = shadeRef.current;
    const overlay = overlayRef.current;
    const labels = labelsRef.current;
    const hot = hotRef.current;
    const hint = hintRef.current;
    const credits = creditsRef.current;
    if (!root || !host || !shade || !overlay || !labels || !hot || !hint || !credits) return undefined;
    let disposed = false;
    let engine: GlobeEngine | null = null;
    // os Workers/Assets do Cesium vêm do CDN: a base precisa existir ANTES do import
    (window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE;
    import('cesium')
      .then((C) => {
        if (disposed) return;
        try {
          engine = new GlobeEngine(C, { root, host, shade, overlay, labels, hot, hint, credits }, propsRef, setStatus);
          engineRef.current = engine;
        } catch (err) {
          setStatus('error');
          propsRef.current.onError?.(messageFor(err));
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        setStatus('error');
        propsRef.current.onError?.(messageFor(err));
      });
    return () => {
      disposed = true;
      engine?.destroy();
      engineRef.current = null;
      settleFlight();
    };
  }, []);

  const theme = props.theme === 'light' ? 'light' : 'dark';
  const interaction = normInteraction(props.interaction);

  return (
    <div
      ref={rootRef}
      className={props.className ? `ag-root ${props.className}` : 'ag-root'}
      data-testid="ag-stage"
      data-status={status}
      data-theme={theme}
      data-interaction={interaction}
      data-reduced={props.reducedMotion ? '1' : undefined}
      onPointerMove={(e) => engineRef.current?.pointerMove(e.clientX, e.clientY, e.pointerType)}
      onPointerLeave={() => engineRef.current?.pointerLeave()}
      onClick={(e) => engineRef.current?.click(e.clientX, e.clientY)}
    >
      <div className="ag-layer ag-backdrop" aria-hidden="true">
        <div className="ag-aurora" />
        <div className="ag-grid" />
      </div>
      <div ref={hostRef} className="ag-layer ag-globe" aria-hidden="true" />
      <div ref={shadeRef} className="ag-layer ag-shade" aria-hidden="true" />
      <div className="ag-layer ag-world" aria-hidden="true">
        <canvas ref={overlayRef} className="ag-layer ag-overlay" />
        <div ref={labelsRef} className="ag-layer ag-labels" />
      </div>
      {/* os pontos do modelo esquemático: interativos, FORA da camada aria-hidden */}
      <div ref={hotRef} className="ag-layer ag-hot" role="group" aria-label="Pontos do modelo esquemático da obra" data-testid="ag-hotspots" />
      <div className="ag-layer ag-vignette" aria-hidden="true" />
      <div ref={hintRef} className="ag-coop-hint" role="status" aria-live="polite" />
      {/* falha: o palco fica no fundo (aurora + grade) e a página avisa via `onError` */}
      <div ref={creditsRef} className="ag-credits" />
    </div>
  );
}

export default ApexGlobe;
