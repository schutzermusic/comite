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
 * Importar na página com `next/dynamic(..., { ssr: false })`.
 */
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type * as CesiumNS from 'cesium';
import type { ApexGlobeProps, CameraView } from './contract';
import {
  approach,
  BREATH_MAX_DIST_KM,
  breathOffset,
  cesiumFov,
  clamp,
  createFlight,
  DEG,
  invLerp,
  lerp,
  offsetAngles,
  sampleFlight,
  sanitizeView,
  viewsEqual,
  type Flight,
} from './camera';
import { buildIntroTrack, INTRO_RETARGET_UNTIL, sampleIntro, type IntroTrack } from './intro';
import { publishFlight, settleFlight } from './flight-store';
import { buildUfGeo, Projector, WorldOverlay } from './overlay';
import { LabelPool } from './labels';
import './globe.css';

type CesiumModule = typeof import('cesium');
type Status = 'loading' | 'ready' | 'error';

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
}

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

  /** Câmera do voo (sem a respiração). */
  private cam: CameraView;
  private target: CameraView;
  private flight: Flight | null = null;
  private intro: { track: IntroTrack; t0: number } | null = null;
  private flightId = 1;
  private breathAmp = 0;

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
  private synced: { markers?: unknown; arcs?: unknown; nodes?: unknown; ufs?: unknown } = {};
  /** Só em desenvolvimento: contadores para QA (`window.__apexGlobe`). */
  private readonly debug: GlobeDebug | null =
    process.env.NODE_ENV !== 'production' ? { frames: 0, renders: 0, loop: false, frameMs: 0 } : null;

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
      scene.screenSpaceCameraController.enableInputs = false;
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

      // ── câmera inicial: a abertura do filme, ou direto na vista ──
      const p = propsRef.current;
      this.target = sanitizeView(p.view);
      if (p.intro && !p.reducedMotion) {
        const track = buildIntroTrack(this.target);
        this.intro = { track, t0: Number.NaN };
        this.cam = sampleIntro(track, 0).cam;
      } else {
        this.cam = this.target;
      }
      this.syncData(true);

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

  /** As props mudaram (a página re-renderizou). */
  onProps(): void {
    if (this.dead) return;
    this.syncData(false);
    this.kick();
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const fn of this.cleanups.splice(0)) {
      try {
        fn();
      } catch {
        /* segue a limpeza */
      }
    }
    this.labels.clear();
    this.els.root.style.cursor = '';
    try {
      if (!this.widget.isDestroyed()) this.widget.destroy();
    } catch {
      /* contexto já perdido */
    }
  }

  /* ── ponteiro (o palco recebe; o canvas do Cesium não tem entrada) ── */

  pointerMove(clientX: number, clientY: number, pointerType: string): void {
    if (this.dead || this.failed || pointerType === 'touch') return;
    const r = this.els.root.getBoundingClientRect();
    this.setHover(this.overlay.pick(clientX - r.left, clientY - r.top));
  }

  pointerLeave(): void {
    if (this.dead) return;
    this.setHover(null);
  }

  click(clientX: number, clientY: number): void {
    if (this.dead || this.failed) return;
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

      // 1 · câmera: abertura, voo ou parada
      let flying = false;
      let arrive = 1;
      if (this.intro) {
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
      if (!this.intro && this.flight) {
        if (reduced) {
          this.cam = this.flight.to;
          this.flight = null;
        } else {
          const s = sampleFlight(this.flight, t);
          this.cam = s.cam;
          arrive = s.arrive;
          flying = !s.done;
          if (s.done) {
            this.cam = { ...this.flight.to, heading: this.flight.from.heading + this.flight.dh };
            this.flight = null;
          }
        }
      }

      // 2 · respiração: só parado e perto do chão; a amplitude entra suave (sem salto no pouso)
      const breathe = Boolean(p.idleBreath) && !reduced && !flying && this.cam.dist < BREATH_MAX_DIST_KM;
      this.breathAmp = approach(this.breathAmp, breathe ? 1 : 0, dt, 1.2);
      if (!breathe && this.breathAmp < 1e-3) this.breathAmp = 0;
      this.applyCamera({ ...this.cam, heading: this.cam.heading + this.breathAmp * breathOffset(t) });

      // 3 · o mundo recua atrás do HUD; imagens regraduadas pela altitude; sombra do horizonte
      this.applyImagery(this.cam.dist);
      this.applyStage(p, dt, reduced);

      // 4 · globo (o modo sob demanda do Cesium pula o quadro se nada mudou)
      this.widget.render();

      // 5 · camadas 2D + rótulos
      const moving = this.overlay.step({ dt, flying, arrive, reducedMotion: reduced });
      this.drawOverlay(t, reduced);

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
      }
      if (keep) this.kick();
    } catch {
      this.fail(MESSAGES.render);
    }
  };

  private fail(message: string): void {
    if (this.dead || this.failed) return;
    this.failed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.labels.clear();
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

  /** Nova `view` → voo a partir da câmera ATUAL (ou troca do destino da abertura). */
  private syncView(p: ApexGlobeProps, t: number, reduced: boolean): void {
    const next = sanitizeView(p.view, this.target);
    if (viewsEqual(next, this.target)) return;
    this.target = next;
    if (this.intro) {
      const it = Number.isFinite(this.intro.t0) ? t - this.intro.t0 : 0;
      if (!reduced && it < INTRO_RETARGET_UNTIL) {
        // o trecho já percorrido não depende do destino: a câmera não salta
        this.intro.track = buildIntroTrack(next);
        return;
      }
      this.intro = null;
    }
    this.flightId += 1;
    if (reduced || this.booting) {
      // sem movimento pedido, ou palco ainda invisível: vai direto
      this.flight = null;
      this.cam = next;
      this.breathAmp = 0;
      return;
    }
    // parte do que está NA TELA (inclui a respiração), mesmo no meio de outro voo
    const current = this.flight ? sampleFlight(this.flight, t).cam : this.cam;
    const from = { ...current, heading: current.heading + this.breathAmp * breathOffset(t) };
    this.breathAmp = 0;
    this.flight = createFlight(from, next, t);
  }

  private applyCamera(c: CameraView): void {
    const C = this.C;
    const cam = this.camera;
    C.Cartesian3.fromDegrees(c.lng, c.lat, 0, C.Ellipsoid.WGS84, this.tgt);
    this.hpr.heading = c.heading * DEG;
    this.hpr.pitch = -Math.min(c.pitch, 89.9) * DEG;
    this.hpr.range = c.dist * 1000;
    cam.lookAt(this.tgt, this.hpr);
    cam.lookAtTransform(C.Matrix4.IDENTITY);
    const frustum = cam.frustum as CesiumNS.PerspectiveFrustum;
    const fov = cesiumFov(this.W, this.H);
    if (frustum.fov !== fov) frustum.fov = fov;
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
      this.css.labels = labels;
    }
    if (shade !== this.css.shade) {
      this.els.shade.style.opacity = shade;
      this.css.shade = shade;
    }
  }

  private drawOverlay(t: number, reduced: boolean): void {
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
    const specs = this.overlay.draw(ctx, this.projector, {
      t,
      dist: this.cam.dist,
      reducedMotion: reduced,
      hoverId: this.hover,
    });
    this.labels.apply(specs, this.W, this.H);
  }

  /** Marcadores, arcos, cartões e UFs: diff por id, só quando a referência muda. */
  private syncData(force: boolean): void {
    const p = this.propsRef.current;
    const s = this.synced;
    if (!force && s.markers === p.markers && s.arcs === p.arcs && s.nodes === p.nodes && s.ufs === p.highlightUfs) return;
    this.synced = { markers: p.markers, arcs: p.arcs, nodes: p.nodes, ufs: p.highlightUfs };
    this.overlay.sync(p.markers, p.arcs, p.nodes, p.highlightUfs);
    if (this.hover && !(p.markers ?? []).some((m) => m && m.id === this.hover)) this.setHover(null);
  }
}

class GlobeInitError extends Error {
  constructor(message: string, readonly reason: unknown) {
    super(message);
    this.name = 'GlobeInitError';
  }
}

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
    const credits = creditsRef.current;
    if (!root || !host || !shade || !overlay || !labels || !credits) return undefined;
    let disposed = false;
    let engine: GlobeEngine | null = null;
    // os Workers/Assets do Cesium vêm do CDN: a base precisa existir ANTES do import
    (window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE;
    import('cesium')
      .then((C) => {
        if (disposed) return;
        try {
          engine = new GlobeEngine(C, { root, host, shade, overlay, labels, credits }, propsRef, setStatus);
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

  return (
    <div
      ref={rootRef}
      className={props.className ? `ag-root ${props.className}` : 'ag-root'}
      data-testid="ag-stage"
      data-status={status}
      data-theme={theme}
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
      <div className="ag-layer ag-vignette" aria-hidden="true" />
      {/* falha: o palco fica no fundo (aurora + grade) e a página avisa via `onError` */}
      <div ref={creditsRef} className="ag-credits" />
    </div>
  );
}

export default ApexGlobe;
