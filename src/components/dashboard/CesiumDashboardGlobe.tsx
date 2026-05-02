'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, Feature, Polygon, MultiPolygon } from 'geojson';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import { getProjects, getProjectsV2 } from '@/lib/services/projects';
import {
  aggregateStateKpis,
  buildGlobeProjectRecords,
  type GlobeProjectRecord,
  type StateAggregate,
} from '@/data/geo/globe-kpi-data';
import { brStates } from '@/data/geo/br-states';
import { StateHudPanel } from '@/components/globe/StateHudPanel';

const CESIUM_VERSION = '1.138.0';
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
const CESIUM_CSS = `${CESIUM_BASE}Widgets/widgets.css`;

const BRAZIL_VIEW = {
  lon: -54.5,
  lat: -14.235,
  height: 9_500_000,
  headingDeg: 0,
  pitchDeg: -89.9,
};

const GLOBAL_INTRO_VIEW = {
  lon: -38,
  lat: 4,
  height: 28_000_000,
  headingDeg: 342,
  pitchDeg: -89.9,
};

type IntroPhase = 'boot' | 'intro-rotate' | 'fly-to-brazil' | 'ready';

type CameraFlyToOptions = {
  destination: unknown;
  orientation?: {
    heading: number;
    pitch: number;
    roll: number;
  };
  duration?: number;
  complete?: () => void;
  cancel?: () => void;
};

const BRAZIL_STATES_URL =
  'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson';

interface CesiumDashboardGlobeProps {
  className?: string;
  mode?: 'executivo' | 'operacional';
  onStateSelect?: (state: StateAggregate | null) => void;
  onStateAggregatesChange?: (states: Record<string, StateAggregate>) => void;
  onProjectOpen?: (projectId: string, uf: string) => void;
  onProjectFocusChange?: (active: boolean) => void;
}

function ensureCesiumCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ig-cesium-css')) return;
  const link = document.createElement('link');
  link.id = 'ig-cesium-css';
  link.rel = 'stylesheet';
  link.href = CESIUM_CSS;
  document.head.appendChild(link);
}

function buildImageryProvider(Cesium: typeof import('cesium')) {
  return new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
    maximumLevel: 19,
  });
}

function applyBrazilOverviewView(
  Cesium: typeof import('cesium'),
  viewer: import('cesium').Viewer,
) {
  const target = Cesium.Cartesian3.fromDegrees(BRAZIL_VIEW.lon, BRAZIL_VIEW.lat, 0);
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(BRAZIL_VIEW.headingDeg),
      Cesium.Math.toRadians(BRAZIL_VIEW.pitchDeg),
      BRAZIL_VIEW.height,
    ),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

type MarkerStatus = 'healthy' | 'attention' | 'critical' | 'completed';
type MarkerState = 'default' | 'hover' | 'selected';

const MARKER_PALETTE: Record<MarkerStatus, { core: string; ring: string; halo: string }> = {
  healthy:    { core: '#22D3EE', ring: '#7DEBFF', halo: 'rgba(34,211,238,0.28)' },
  attention:  { core: '#F5A524', ring: '#FFD27A', halo: 'rgba(245,165,36,0.32)' },
  critical:   { core: '#EF4B55', ring: '#FF8A8F', halo: 'rgba(239,75,85,0.34)' },
  completed:  { core: '#10B981', ring: '#86EFAC', halo: 'rgba(16,185,129,0.28)' },
};

function classifyProjectStatus(project: GlobeProjectRecord): MarkerStatus {
  if (project.status === 'concluido') return 'completed';
  if (project.riskCount >= 4) return 'critical';
  if (project.riskCount >= 2) return 'attention';
  return 'healthy';
}

const markerImageCache = new Map<string, string>();

// Trace a flat-top hexagon centered at (cx,cy) with circumradius r.
function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    // Pointy-top hexagon: angles at -90°, -30°, 30°, 90°, 150°, 210°
    const angle = (-Math.PI / 2) + i * (Math.PI / 3);
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function buildMarkerImage(status: MarkerStatus, state: MarkerState): string {
  const key = `${status}:${state}`;
  const cached = markerImageCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return '';

  const palette = MARKER_PALETTE[status];
  const size = 96;
  // Supersample at >= 3x so the texture stays crisp when Cesium downsamples it
  // onto retina canvases. Capped at 4 to avoid wasted memory on extreme DPRs.
  const dpr = Math.min(
    4,
    Math.max(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 2),
  );
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(dpr, dpr);

  const cx = size / 2;
  const cy = size / 2;

  // ── Layer 1: soft atmospheric halo (radial glow) ──
  const haloRadius = state === 'selected' ? 36 : state === 'hover' ? 28 : 22;
  const halo = ctx.createRadialGradient(cx, cy, 2, cx, cy, haloRadius);
  halo.addColorStop(0, palette.halo);
  halo.addColorStop(0.55, palette.halo.replace(/[\d.]+\)$/, '0.10)'));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
  ctx.fill();

  // ── Layer 2: outer hex bracket (always present, defines silhouette over imagery) ──
  const outerR = state === 'selected' ? 18 : state === 'hover' ? 15 : 13;
  ctx.strokeStyle = palette.ring;
  ctx.globalAlpha = state === 'selected' ? 0.9 : state === 'hover' ? 0.7 : 0.42;
  ctx.lineWidth = state === 'selected' ? 1.4 : 1.1;
  ctx.lineJoin = 'miter';
  hexPath(ctx, cx, cy, outerR);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Bracket gap segments at vertices for "tactical" feel (only hover/selected)
  if (state !== 'default') {
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = state === 'selected' ? 3 : 2.2;
    ctx.lineCap = 'butt';
    for (let i = 0; i < 6; i += 1) {
      const angle = (-Math.PI / 2) + i * (Math.PI / 3);
      const x = cx + outerR * Math.cos(angle);
      const y = cy + outerR * Math.sin(angle);
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Layer 3: hex body — dark base for contrast on satellite imagery ──
  const bodyR = state === 'selected' ? 11 : state === 'hover' ? 10 : 9;
  // Subtle dark backplate so the colored body doesn't disappear over bright land
  ctx.fillStyle = 'rgba(8, 14, 20, 0.55)';
  hexPath(ctx, cx, cy, bodyR + 1.2);
  ctx.fill();

  // Body gradient — top-light, bottom-shadow for jewel-like depth
  const bodyGrad = ctx.createLinearGradient(cx, cy - bodyR, cx, cy + bodyR);
  bodyGrad.addColorStop(0, mixHex(palette.core, '#FFFFFF', 0.42));
  bodyGrad.addColorStop(0.5, palette.core);
  bodyGrad.addColorStop(1, mixHex(palette.core, '#000000', 0.45));
  ctx.fillStyle = bodyGrad;
  ctx.lineJoin = 'miter';
  hexPath(ctx, cx, cy, bodyR);
  ctx.fill();

  // ── Layer 4: crisp body stroke ──
  ctx.strokeStyle = mixHex(palette.ring, '#FFFFFF', 0.15);
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'miter';
  hexPath(ctx, cx, cy, bodyR);
  ctx.stroke();

  // ── Layer 5: specular highlight clipped inside the hex ──
  ctx.save();
  hexPath(ctx, cx, cy, bodyR);
  ctx.clip();
  const spec = ctx.createLinearGradient(cx - bodyR, cy - bodyR, cx + bodyR * 0.2, cy + bodyR * 0.4);
  spec.addColorStop(0, 'rgba(255,255,255,0.65)');
  spec.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.fillRect(cx - bodyR, cy - bodyR, bodyR * 2, bodyR * 1.4);
  ctx.restore();

  // ── Layer 6: inner micro-hex (HUD core) ──
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 0.8;
  hexPath(ctx, cx, cy, bodyR * 0.5);
  ctx.stroke();

  // ── Layer 7 (selected only): outer reticle ring with tick marks ──
  if (state === 'selected') {
    const bracketR = 24;
    ctx.strokeStyle = palette.ring;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 0.9;
    hexPath(ctx, cx, cy, bracketR);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Radial tick marks at each vertex
    ctx.strokeStyle = palette.ring;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i += 1) {
      const angle = (-Math.PI / 2) + i * (Math.PI / 3);
      const x1 = cx + (bracketR + 1) * Math.cos(angle);
      const y1 = cy + (bracketR + 1) * Math.sin(angle);
      const x2 = cx + (bracketR + 4) * Math.cos(angle);
      const y2 = cy + (bracketR + 4) * Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const url = canvas.toDataURL('image/png');
  markerImageCache.set(key, url);
  return url;
}

// Mix two hex colors in sRGB. `t` ∈ [0,1]: 0 = a, 1 = b.
function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [v[0] || 0, v[1] || 0, v[2] || 0];
}

function getFeatureUF(feature: Feature): string | null {
  const props = (feature.properties || {}) as Record<string, unknown>;
  const candidates = ['UF', 'sigla', 'SIGLA_UF', 'uf', 'CD_UF', 'postal'];
  for (const key of candidates) {
    const v = props[key];
    if (typeof v === 'string' && v.length <= 3) return v.toUpperCase();
  }
  // Fallback: try to map by name to UF
  const NAME_TO_UF: Record<string, string> = {
    'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM', 'Bahia': 'BA',
    'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES', 'Goiás': 'GO',
    'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG',
    'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE', 'Piauí': 'PI',
    'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS',
    'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC', 'São Paulo': 'SP',
    'Sergipe': 'SE', 'Tocantins': 'TO',
  };
  const name = (props.name || props.NAME || props.nome) as string | undefined;
  if (name && NAME_TO_UF[name]) return NAME_TO_UF[name];
  return null;
}

export function CesiumDashboardGlobe({
  className,
  onStateSelect,
  onStateAggregatesChange,
  onProjectOpen,
  onProjectFocusChange,
}: CesiumDashboardGlobeProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<unknown>(null);
  const cesiumModRef = useRef<typeof import('cesium') | null>(null);
  const handlerRef = useRef<unknown>(null);
  const stateEntitiesRef = useRef<Map<string, unknown>>(new Map());
  const projectEntitiesRef = useRef<Map<string, unknown>>(new Map());
  const stopIntroSpinRef = useRef<(() => void) | null>(null);
  const introTimersRef = useRef<number[]>([]);
  const interactionReadyRef = useRef(false);
  const cameraBusyRef = useRef(false);
  const cameraFlightIdRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [introPhase, setIntroPhase] = useState<IntroPhase>('boot');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedUF, setSelectedUF] = useState<string | null>(null);
  const [focusedProject, setFocusedProject] = useState<{ project: GlobeProjectRecord; uf: string } | null>(null);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [geojson, setGeojson] = useState<FeatureCollection>(brStates);

  // ── Data (mirrors the Globe.GL flow) ────────────────────────────────
  const projectRecords = useMemo<GlobeProjectRecord[]>(() => {
    try {
      const projects = getProjects();
      const projectsV2 = getProjectsV2();
      return buildGlobeProjectRecords(projects, projectsV2).filter(
        (p) => p.status === 'em_andamento',
      );
    } catch {
      return [];
    }
  }, []);

  const stateAggregates = useMemo(
    () => aggregateStateKpis(projectRecords),
    [projectRecords],
  );

  useEffect(() => {
    onStateAggregatesChange?.(stateAggregates);
  }, [onStateAggregatesChange, stateAggregates]);

  useEffect(() => {
    onProjectFocusChange?.(Boolean(focusedProject));
  }, [focusedProject, onProjectFocusChange]);

  useEffect(() => {
    interactionReadyRef.current = ready && introPhase === 'ready';
  }, [introPhase, ready]);

  // After the intro flight settles, promote the viewer to retina resolution.
  // Deferring this keeps the heavy initial frames fluid while still landing
  // on a crisp final picture for the user. requestIdleCallback (or a small
  // timeout fallback) ensures we never compete with the fly-to animation.
  useEffect(() => {
    if (!ready || introPhase !== 'ready') return;
    const viewer = viewerRef.current as
      | { resolutionScale: number; scene: { requestRender?: () => void } }
      | null;
    if (!viewer) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const target = Math.min(dpr, 1.75);
    if (target <= 1.01) return;
    const promote = () => {
      try {
        viewer.resolutionScale = target;
        viewer.scene.requestRender?.();
      } catch {}
    };
    const win = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(promote, { timeout: 800 });
      return () => win.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(promote, 250);
    return () => window.clearTimeout(t);
  }, [introPhase, ready]);

  const clearIntroTimers = useCallback(() => {
    introTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    introTimersRef.current = [];
  }, []);

  const stopIntroSpin = useCallback(() => {
    stopIntroSpinRef.current?.();
    stopIntroSpinRef.current = null;
  }, []);

  // Try fetching higher-resolution Brazil boundaries; fall back to bundled brStates.
  useEffect(() => {
    let mounted = true;
    fetch(BRAZIL_STATES_URL)
      .then((r) => r.json())
      .then((data) => {
        if (!mounted || !data?.features) return;
        setGeojson(data as FeatureCollection);
      })
      .catch(() => {
        // keep bundled fallback
      });
    return () => {
      mounted = false;
    };
  }, []);

  const startCameraFlight = useCallback((options: CameraFlyToOptions, interrupt = false) => {
    if (cameraBusyRef.current && !interrupt) return false;
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | { camera: { flyTo: (o: unknown) => void; cancelFlight?: () => void } }
      | null;
    if (!Cesium || !viewer) return;
    const flightId = cameraFlightIdRef.current + 1;
    cameraFlightIdRef.current = flightId;
    cameraBusyRef.current = true;
    if (interrupt) viewer.camera.cancelFlight?.();
    viewer.camera.flyTo({
      ...options,
      complete: () => {
        if (cameraFlightIdRef.current === flightId) cameraBusyRef.current = false;
        options.complete?.();
      },
      cancel: () => {
        if (cameraFlightIdRef.current === flightId) cameraBusyRef.current = false;
        options.cancel?.();
      },
    });
    return true;
  }, []);

  const flyToBrazil = useCallback((interrupt = true, duration = 1.4) => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | import('cesium').Viewer
      | null;
    if (!Cesium) return false;
    stopIntroSpin();
    return startCameraFlight({
      destination: Cesium.Cartesian3.fromDegrees(BRAZIL_VIEW.lon, BRAZIL_VIEW.lat, BRAZIL_VIEW.height),
      orientation: {
        heading: Cesium.Math.toRadians(BRAZIL_VIEW.headingDeg),
        pitch: Cesium.Math.toRadians(BRAZIL_VIEW.pitchDeg),
        roll: 0,
      },
      duration,
      complete: () => {
        if (viewer) applyBrazilOverviewView(Cesium, viewer);
      },
    }, interrupt);
  }, [startCameraFlight, stopIntroSpin]);

  const flyToState = useCallback((uf: string) => {
    const Cesium = cesiumModRef.current;
    const target = stateAggregates[uf];
    if (!Cesium || !target) return false;
    return startCameraFlight({
      destination: Cesium.Cartesian3.fromDegrees(target.lon, target.lat, 1_400_000),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-75),
        roll: 0,
      },
      duration: 1.2,
    });
  }, [startCameraFlight, stateAggregates]);

  const flyToProject = useCallback((project: GlobeProjectRecord) => {
    const Cesium = cesiumModRef.current;
    if (!Cesium) return false;
    // Top-down centered framing on the project hex.
    return startCameraFlight({
      destination: Cesium.Cartesian3.fromDegrees(project.lon, project.lat, 220_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89.9), roll: 0 },
      duration: 1.2,
    });
  }, [startCameraFlight]);

  const handleBackToBrazil = useCallback(() => {
    clearIntroTimers();
    stopIntroSpin();
    cameraBusyRef.current = false;
    setSelectedUF(null);
    setFocusedProject(null);
    setIntroPhase('ready');
    onStateSelect?.(null);
    interactionReadyRef.current = true;
    flyToBrazil(true);
  }, [clearIntroTimers, flyToBrazil, onStateSelect, stopIntroSpin]);

  const handleStateSelect = useCallback((uf: string) => {
    if (!interactionReadyRef.current || cameraBusyRef.current) return;
    const state = stateAggregates[uf];
    if (!state) return;
    if (flyToState(uf) === false) return;
    setFocusedProject(null);
    setSelectedUF(uf);
    onStateSelect?.(state);
  }, [flyToState, onStateSelect, stateAggregates]);

  const handleProjectFocus = useCallback((project: GlobeProjectRecord, uf: string) => {
    if (!interactionReadyRef.current || cameraBusyRef.current) return;
    if (flyToProject(project) === false) return;
    setSelectedUF(null);
    onStateSelect?.(null);
    setFocusedProject({ project, uf });
  }, [flyToProject, onStateSelect]);

  // ── Cesium init ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (typeof window === 'undefined' || !containerRef.current) return;
      try {
        (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE;
        ensureCesiumCss();

        const Cesium = await import('cesium');
        if (cancelled || !containerRef.current) return;
        cesiumModRef.current = Cesium;

        const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

        const viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: Cesium.ImageryLayer.fromProviderAsync(
            Promise.resolve(buildImageryProvider(Cesium)),
            {},
          ),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          selectionIndicator: false,
          infoBox: false,
          shouldAnimate: false,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        });

        viewer.scene.globe.enableLighting = false;
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;

        // ── Anti-alias pipeline (cheap during intro) ──
        // Keep MSAA modest (2 samples) and FXAA on — both are essentially
        // free on modern GPUs and clean up polyline edges. The expensive
        // bit (high-DPR resolutionScale) is deferred until after the intro
        // flight finishes so the first frames stay fluid.
        try {
          (viewer as unknown as { useBrowserRecommendedResolution: boolean })
            .useBrowserRecommendedResolution = false;
          (viewer as unknown as { resolutionScale: number }).resolutionScale = 1;
        } catch {}
        try {
          (viewer.scene as unknown as { msaaSamples: number }).msaaSamples = 2;
        } catch {}
        try {
          if (viewer.scene.postProcessStages?.fxaa) {
            viewer.scene.postProcessStages.fxaa.enabled = true;
          }
        } catch {}
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(
          theme === 'dark' ? '#0c1418' : '#e7ecef',
        );
        const credits = (viewer as unknown as { cesiumWidget: { creditContainer: HTMLElement } })
          .cesiumWidget.creditContainer;
        if (credits && credits.style) credits.style.display = 'none';

        viewerRef.current = viewer;

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        // Intro starts from a distant global framing, then settles back into the
        // approved Brazil overview before interactions are enabled.
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            GLOBAL_INTRO_VIEW.lon,
            GLOBAL_INTRO_VIEW.lat,
            GLOBAL_INTRO_VIEW.height,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(GLOBAL_INTRO_VIEW.headingDeg),
            pitch: Cesium.Math.toRadians(GLOBAL_INTRO_VIEW.pitchDeg),
            roll: 0,
          },
        });

        // Click handler — picks state polygon or project point.
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((event: { position: { x: number; y: number } }) => {
          const pos = new Cesium.Cartesian2(event.position.x, event.position.y);
          const picked = viewer.scene.pick(pos);
          if (picked && picked.id && typeof picked.id.id === 'string') {
            const id = picked.id.id as string;
            if (id.startsWith('proj:')) {
              const projectId = id.slice(5);
              const project = projectRecords.find((p) => p.id === projectId);
              if (project) {
                handleProjectFocus(project, project.stateUF);
                return;
              }
            }
            if (id.startsWith('uf:')) {
              const uf = id.split(':')[1];
              handleStateSelect(uf);
              return;
            }
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handlerRef.current = handler;

        if (!cancelled) {
          setReady(true);

          if (prefersReducedMotion) {
            setIntroPhase('ready');
            interactionReadyRef.current = true;
            applyBrazilOverviewView(Cesium, viewer);
          } else {
            setIntroPhase('intro-rotate');
            const rotate = () => {
              viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00009);
            };
            viewer.scene.preRender.addEventListener(rotate);
            stopIntroSpinRef.current = () => {
              viewer.scene.preRender.removeEventListener(rotate);
            };

            const introTimer = window.setTimeout(() => {
              stopIntroSpin();
              setIntroPhase('fly-to-brazil');
              startCameraFlight({
                destination: Cesium.Cartesian3.fromDegrees(BRAZIL_VIEW.lon, BRAZIL_VIEW.lat, BRAZIL_VIEW.height),
                orientation: {
                  heading: Cesium.Math.toRadians(BRAZIL_VIEW.headingDeg),
                  pitch: Cesium.Math.toRadians(BRAZIL_VIEW.pitchDeg),
                  roll: 0,
                },
                duration: 3.2,
                complete: () => {
                  applyBrazilOverviewView(Cesium, viewer);
                  setIntroPhase('ready');
                  interactionReadyRef.current = true;
                },
              }, true);
            }, 1200);
            introTimersRef.current.push(introTimer);
          }
        }
      } catch (err) {
        console.error('[CesiumDashboardGlobe] init failed', err);
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Falha ao carregar Cesium');
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      const handler = handlerRef.current as { destroy: () => void } | null;
      if (handler) {
        try { handler.destroy(); } catch {}
      }
      clearIntroTimers();
      stopIntroSpin();
      const viewer = viewerRef.current as
        | { destroy: () => void; isDestroyed: () => boolean }
        | null;
      if (viewer && !viewer.isDestroyed()) {
        try { viewer.destroy(); } catch {}
      }
      viewerRef.current = null;
      handlerRef.current = null;
      stateEntitiesRef.current.clear();
      projectEntitiesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render state polygons whenever data or selection changes.
  useEffect(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | { entities: { add: (o: unknown) => unknown; removeById: (id: string) => boolean } }
      | null;
    if (!Cesium || !viewer || !ready) return;

    // Wipe prior state entities
    stateEntitiesRef.current.forEach((_, id) => viewer.entities.removeById(id));
    stateEntitiesRef.current.clear();

    const features = (geojson.features || []) as Feature<Polygon | MultiPolygon>[];
    features.forEach((feature, idx) => {
      const uf = getFeatureUF(feature);
      if (!uf) return;
      const aggregate = stateAggregates[uf];
      const hasProjects = !!aggregate && aggregate.projectCount > 0;
      const isSelected = selectedUF === uf;

      // Fill — subtle teal wash on states with projects, near-invisible elsewhere.
      const fillCss = isSelected
        ? 'rgba(34, 211, 238, 0.22)'
        : hasProjects
          ? 'rgba(34, 211, 238, 0.10)'
          : 'rgba(120, 160, 180, 0.025)';
      const fillColor = Cesium.Color.fromCssColorString(fillCss);

      // Outline palette — premium HUD: outer glow + crisp inner line.
      const glowCss = isSelected
        ? 'rgba(140, 240, 255, 0.95)'
        : hasProjects
          ? 'rgba(125, 235, 255, 0.65)'
          : 'rgba(190, 215, 225, 0.30)';
      const innerCss = isSelected
        ? 'rgba(220, 250, 255, 1.0)'
        : hasProjects
          ? 'rgba(200, 245, 255, 0.85)'
          : 'rgba(220, 235, 245, 0.55)';
      const glowColor = Cesium.Color.fromCssColorString(glowCss);
      const innerColor = Cesium.Color.fromCssColorString(innerCss);

      const polygons: number[][][][] =
        feature.geometry.type === 'Polygon'
          ? [feature.geometry.coordinates as number[][][]]
          : (feature.geometry.coordinates as number[][][][]);

      polygons.forEach((rings, ringIdx) => {
        const outer = rings[0];
        if (!outer || outer.length < 3) return;
        const flat: number[] = [];
        outer.forEach(([lon, lat]) => {
          flat.push(lon, lat);
        });
        const closed = [...flat, outer[0][0], outer[0][1]];

        // 1) Filled polygon
        const fillId = `uf:${uf}:${idx}:${ringIdx}`;
        const fillEntity = viewer.entities.add({
          id: fillId,
          name: uf,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
            material: fillColor,
            height: 0,
            outline: false,
          },
        });
        stateEntitiesRef.current.set(fillId, fillEntity);

        // 2) Outer glow line — wider, soft halo (only for project/selected states)
        // Tighter glow power keeps the falloff close to the line so the inner
        // crisp stroke remains the dominant edge instead of being washed out.
        if (hasProjects || isSelected) {
          const glowId = `uf:${uf}:${idx}:${ringIdx}:glow`;
          const glowEntity = viewer.entities.add({
            id: glowId,
            name: uf,
            polyline: {
              positions: Cesium.Cartesian3.fromDegreesArray(closed),
              width: isSelected ? 6 : 4,
              material: new Cesium.PolylineGlowMaterialProperty({
                color: glowColor,
                glowPower: isSelected ? 0.28 : 0.22,
                taperPower: 1.0,
              }),
              clampToGround: true,
            },
          });
          stateEntitiesRef.current.set(glowId, glowEntity);
        }

        // 3) Crisp inner line — sharp definition on top of the glow.
        // Minimum width of 1.0 keeps the stroke from dropping below a pixel
        // at low resolution scale; at retina (resolutionScale=2) this becomes
        // a clean 2-device-pixel hairline.
        const lineId = `uf:${uf}:${idx}:${ringIdx}:line`;
        const lineEntity = viewer.entities.add({
          id: lineId,
          name: uf,
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(closed),
            width: isSelected ? 1.8 : hasProjects ? 1.3 : 1.0,
            material: innerColor,
            clampToGround: true,
          },
        });
        stateEntitiesRef.current.set(lineId, lineEntity);
      });
    });
  }, [geojson, ready, selectedUF, stateAggregates]);

  // Render project hotspots — premium HUD billboards
  useEffect(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | { entities: { add: (o: unknown) => unknown; removeById: (id: string) => boolean } }
      | null;
    if (!Cesium || !viewer || !ready) return;

    projectEntitiesRef.current.forEach((_, id) => viewer.entities.removeById(id));
    projectEntitiesRef.current.clear();

    const focusedId = focusedProject?.project.id ?? null;

    projectRecords.forEach((p) => {
      const id = `proj:${p.id}`;
      const status = classifyProjectStatus(p);
      const state: MarkerState = focusedId === p.id
        ? 'selected'
        : hoveredProjectId === p.id
          ? 'hover'
          : 'default';
      const image = buildMarkerImage(status, state);
      // Source canvas is now 96px (was 80px) supersampled at >=3× DPR, so we
      // scale down slightly more aggressively to preserve the original on-
      // screen footprint while gaining sharpness from the larger source.
      const baseScale = state === 'selected' ? 0.52 : state === 'hover' ? 0.47 : 0.42;

      const entity = viewer.entities.add({
        id,
        name: p.name,
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
        billboard: {
          image,
          scale: baseScale,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          // soft scale-by-distance keeps markers from getting tiny when zoomed out
          scaleByDistance: new Cesium.NearFarScalar(2.0e5, baseScale * 1.05, 1.5e7, baseScale * 0.85),
        },
      });
      projectEntitiesRef.current.set(id, entity);
    });
  }, [projectRecords, ready, hoveredProjectId, focusedProject]);

  // Hover detection: update hovered marker + cursor
  useEffect(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | { scene: { canvas: HTMLCanvasElement; pick: (p: unknown) => unknown } }
      | null;
    if (!Cesium || !viewer || !ready) return;
    const canvas = viewer.scene.canvas;
    const handler = new Cesium.ScreenSpaceEventHandler(canvas);
    handler.setInputAction((event: { endPosition: { x: number; y: number } }) => {
      const pos = new Cesium.Cartesian2(event.endPosition.x, event.endPosition.y);
      const picked = viewer.scene.pick(pos) as { id?: { id?: string } } | undefined;
      const pickedId = picked?.id?.id;
      let nextHover: string | null = null;
      let cursor = '';
      if (typeof pickedId === 'string' && pickedId.startsWith('proj:')) {
        nextHover = pickedId.slice(5);
        cursor = 'pointer';
      } else if (typeof pickedId === 'string' && pickedId.startsWith('uf:')) {
        cursor = 'pointer';
      }
      canvas.style.cursor = cursor;
      setHoveredProjectId((prev) => (prev === nextHover ? prev : nextHover));
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    return () => {
      try { handler.destroy(); } catch {}
      canvas.style.cursor = '';
    };
  }, [ready]);

  // Theme reactions
  useEffect(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | { scene: { backgroundColor: unknown; globe: { baseColor: unknown } } }
      | null;
    if (!Cesium || !viewer || !ready) return;
    viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(
      theme === 'dark' ? '#0c1418' : '#e7ecef',
    );
  }, [theme, ready]);

  const handleProjectOpenInternal = useCallback(
    (projectId: string, uf: string) => {
      onProjectOpen?.(projectId, uf);
    },
    [onProjectOpen],
  );

  const selectedState = selectedUF ? stateAggregates[selectedUF] || null : null;

  return (
    <div className={cn('relative w-full h-full overflow-hidden', className)}>
      <style jsx global>{`
        .ig-cesium-host .cesium-viewer-bottom,
        .ig-cesium-host .cesium-viewer-toolbar,
        .ig-cesium-host .cesium-credit-lightbox-overlay,
        .ig-cesium-host .cesium-widget-credits {
          display: none !important;
        }
        .ig-cesium-host .cesium-viewer,
        .ig-cesium-host .cesium-widget,
        .ig-cesium-host .cesium-widget canvas {
          background: transparent !important;
        }
      `}</style>

      <div ref={containerRef} className="ig-cesium-host absolute inset-0" />

      {/* Voltar ao Brasil — visible whenever zoomed/focused */}
      {(selectedUF || focusedProject) && (
        <button
          type="button"
          onClick={handleBackToBrazil}
          className="absolute left-1/2 -translate-x-1/2 top-3 z-20 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] backdrop-blur-md transition-colors"
          style={{
            background: 'var(--ig-glass-e2)',
            border: '1px solid color-mix(in oklab, var(--ig-border-strong) 80%, transparent)',
            color: 'var(--ig-fg-strong)',
            boxShadow: 'var(--ig-shadow-e1)',
          }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar ao Brasil
        </button>
      )}

      {!ready && !loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="w-10 h-10 rounded-full border border-cyan-200/40 border-t-transparent animate-spin" />
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center px-6 text-center">
          <div className="rounded-xl border border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground backdrop-blur">
            Falha ao carregar Cesium: {loadError}
          </div>
        </div>
      )}

      {/* Reuse the existing dashboard side panel verbatim */}
      <StateHudPanel
        stateData={focusedProject ? null : selectedState}
        onBackToBrazil={handleBackToBrazil}
        onProjectSelect={handleProjectFocus}
        onProjectOpen={handleProjectOpenInternal}
      />

      {focusedProject && (
        <ProjectFocusPanel
          project={focusedProject.project}
          uf={focusedProject.uf}
          onClose={handleBackToBrazil}
          onOpenProject={() => handleProjectOpenInternal(focusedProject.project.id, focusedProject.uf)}
        />
      )}
    </div>
  );
}

export default CesiumDashboardGlobe;

// ─────────────────────────────────────────────────────────────────
// ProjectFocusPanel — premium HUD inspector for a focused project
// ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<GlobeProjectRecord['status'], string> = {
  planejamento: 'Planejamento',
  em_andamento: 'Em andamento',
  pausado: 'Pausado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

function statusTone(status: GlobeProjectRecord['status']): { label: string; varName: string } {
  switch (status) {
    case 'em_andamento': return { label: STATUS_LABEL[status], varName: '--ig-info' };
    case 'concluido':    return { label: STATUS_LABEL[status], varName: '--ig-success' };
    case 'pausado':      return { label: STATUS_LABEL[status], varName: '--ig-warning' };
    case 'cancelado':    return { label: STATUS_LABEL[status], varName: '--ig-danger' };
    default:             return { label: STATUS_LABEL[status] || status, varName: '--ig-fg-muted' };
  }
}

function fmtBRLCompact(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
  }).format(value || 0);
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildInsight(p: GlobeProjectRecord): string {
  const billedRatio = p.contractTotal > 0 ? (p.invoiced / p.contractTotal) : 0;
  const billedPct = Math.round(billedRatio * 100);
  const risks = p.riskCount;
  if (risks >= 4) {
    return `Projeto com ${risks} riscos críticos em aberto e faturamento em ${billedPct}% do contrato.`;
  }
  if (risks >= 2) {
    return `Projeto em andamento com ${risks} riscos em monitoramento e faturamento em ${billedPct}%.`;
  }
  if (billedRatio < 0.25 && p.status === 'em_andamento') {
    return `Projeto saudável, porém faturamento ainda em ${billedPct}% do contrato.`;
  }
  return `Projeto saudável — faturamento em ${billedPct}% do contrato e nenhum risco crítico em aberto.`;
}

interface ProjectFocusPanelProps {
  project: GlobeProjectRecord;
  uf: string;
  onClose: () => void;
  onOpenProject: () => void;
}

function ProjectFocusPanel({ project, uf, onClose, onOpenProject }: ProjectFocusPanelProps) {
  const tone = statusTone(project.status);
  const markerStatus = classifyProjectStatus(project);
  const markerColor = MARKER_PALETTE[markerStatus].core;
  const billedPct = project.contractTotal > 0
    ? Math.min(100, Math.round((project.invoiced / project.contractTotal) * 100))
    : 0;
  const progress = typeof project.progressPercent === 'number'
    ? Math.max(0, Math.min(100, Math.round(project.progressPercent)))
    : billedPct;

  return (
    <aside
      role="dialog"
      aria-label={`Detalhes do projeto ${project.name}`}
      className="pointer-events-auto fixed right-3 top-[72px] bottom-3 z-[60] flex w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl"
      style={{
        background: 'var(--ig-glass-e3)',
        backdropFilter: 'var(--ig-blur-e3)',
        WebkitBackdropFilter: 'var(--ig-blur-e3)',
        border: '1px solid color-mix(in oklab, var(--ig-border-strong) 80%, transparent)',
        boxShadow: 'var(--ig-shadow-e4)',
        color: 'var(--ig-fg-default)',
      }}
    >
      {/* Header */}
      <div
        className="px-5 pt-4 pb-3"
        style={{ borderBottom: '1px solid color-mix(in oklab, var(--ig-border-default) 80%, transparent)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div
              className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: 'var(--ig-fg-subtle)' }}
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2"
                style={{
                  background: markerColor,
                  boxShadow: `0 0 8px ${markerColor}`,
                  clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
                }}
              />
              Projeto em foco · {uf}
            </div>
            <h4
              className="mt-1.5 truncate text-[17px] font-semibold leading-tight"
              style={{ color: 'var(--ig-fg-strong)' }}
              title={project.name}
            >
              {project.name}
            </h4>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  background: `color-mix(in oklab, var(${tone.varName}) 16%, transparent)`,
                  color: `var(${tone.varName})`,
                  border: `1px solid color-mix(in oklab, var(${tone.varName}) 38%, transparent)`,
                }}
              >
                {tone.label}
              </span>
              {project.type && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]"
                  style={{
                    background: 'color-mix(in oklab, var(--ig-bg-panel-hover) 60%, transparent)',
                    color: 'var(--ig-fg-muted)',
                    border: '1px solid color-mix(in oklab, var(--ig-border-default) 80%, transparent)',
                  }}
                >
                  {project.type}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar foco"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
            style={{
              border: '1px solid color-mix(in oklab, var(--ig-border-default) 80%, transparent)',
              background: 'color-mix(in oklab, var(--ig-bg-panel-hover) 50%, transparent)',
              color: 'var(--ig-fg-muted)',
            }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Executive summary grid */}
        <section>
          <SectionLabel>Resumo executivo</SectionLabel>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Metric label="Contrato" value={fmtBRLCompact(project.contractTotal)} />
            <Metric label="Faturado" value={fmtBRLCompact(project.invoiced)} accentVar="--ig-success" />
            <Metric label="A faturar" value={fmtBRLCompact(project.toInvoice)} accentVar="--ig-info" />
            <Metric
              label="Riscos abertos"
              value={String(project.riskCount)}
              accentVar={project.riskCount >= 4 ? '--ig-danger' : project.riskCount >= 2 ? '--ig-warning' : '--ig-fg-strong'}
            />
            <Metric label="HH / equipe" value={String(project.estimatedHeadcount)} />
            <Metric label="Decisões" value={String(project.decisionCount)} />
          </div>
        </section>

        {/* Progress / billing bar */}
        <section>
          <SectionLabel>Avanço</SectionLabel>
          <div className="mt-2 space-y-2">
            <ProgressRow label="Faturamento" value={billedPct} colorVar="--ig-success" />
            <ProgressRow label="Progresso" value={progress} colorVar="--ig-accent" />
          </div>
        </section>

        {/* Secondary info */}
        <section>
          <SectionLabel>Identificação</SectionLabel>
          <div
            className="mt-2 rounded-xl p-3 text-[12px]"
            style={{
              background: 'color-mix(in oklab, var(--ig-bg-panel) 70%, transparent)',
              border: '1px solid color-mix(in oklab, var(--ig-border-default) 70%, transparent)',
            }}
          >
            <InfoRow label="Cliente" value={project.client || '—'} />
            <InfoRow label="Código" value={project.code || project.id.slice(0, 8)} mono />
            <InfoRow label="UF" value={uf} />
            <InfoRow label="Última atualização" value={fmtDate(project.updatedAt)} />
          </div>
        </section>

        {/* Insight */}
        <section
          className="rounded-xl p-3"
          style={{
            background: 'color-mix(in oklab, var(--ig-accent-weak) 70%, transparent)',
            border: '1px solid color-mix(in oklab, var(--ig-border-focus) 28%, transparent)',
          }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: 'var(--ig-accent)' }}
          >
            Insight
          </div>
          <p
            className="mt-1.5 text-[12.5px] leading-snug"
            style={{ color: 'var(--ig-fg-default)' }}
          >
            {buildInsight(project)}
          </p>
        </section>
      </div>

      {/* Footer actions */}
      <div
        className="px-5 py-3 flex flex-col gap-2"
        style={{
          borderTop: '1px solid color-mix(in oklab, var(--ig-border-default) 80%, transparent)',
          background: 'color-mix(in oklab, var(--ig-bg-panel) 40%, transparent)',
        }}
      >
        <button
          type="button"
          onClick={onOpenProject}
          className="w-full rounded-lg px-3 py-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] transition-all hover:brightness-110 active:translate-y-px"
          style={{
            background: 'linear-gradient(180deg, var(--ig-accent) 0%, var(--ig-accent-strong) 100%)',
            color: '#FFFFFF',
            boxShadow: 'var(--ig-focus-ring-outer)',
            border: '1px solid color-mix(in oklab, var(--ig-accent-strong) 80%, transparent)',
          }}
        >
          Abrir projeto →
        </button>
        <button
          type="button"
          onClick={onClose}
          className="w-full rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors"
          style={{
            background: 'color-mix(in oklab, var(--ig-bg-panel-hover) 55%, transparent)',
            color: 'var(--ig-fg-muted)',
            border: '1px solid color-mix(in oklab, var(--ig-border-default) 80%, transparent)',
          }}
        >
          Voltar ao Brasil
        </button>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: 'var(--ig-fg-subtle)' }}
    >
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  accentVar,
}: { label: string; value: string; accentVar?: string }) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{
        background: 'color-mix(in oklab, var(--ig-bg-panel) 70%, transparent)',
        border: '1px solid color-mix(in oklab, var(--ig-border-default) 70%, transparent)',
      }}
    >
      <div
        className="text-[9.5px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: 'var(--ig-fg-subtle)' }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-[14px] font-semibold ig-tabular leading-none"
        style={{ color: accentVar ? `var(${accentVar})` : 'var(--ig-fg-strong)' }}
      >
        {value}
      </div>
    </div>
  );
}

function ProgressRow({ label, value, colorVar }: { label: string; value: number; colorVar: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span style={{ color: 'var(--ig-fg-muted)' }}>{label}</span>
        <span
          className="ig-tabular font-semibold"
          style={{ color: 'var(--ig-fg-strong)' }}
        >
          {value}%
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'color-mix(in oklab, var(--ig-border-strong) 60%, transparent)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${value}%`,
            background: `linear-gradient(90deg, color-mix(in oklab, var(${colorVar}) 70%, transparent), var(${colorVar}))`,
            boxShadow: `0 0 10px color-mix(in oklab, var(${colorVar}) 45%, transparent)`,
          }}
        />
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 first:pt-0 last:pb-0">
      <span
        className="text-[11px] uppercase tracking-[0.08em]"
        style={{ color: 'var(--ig-fg-subtle)' }}
      >
        {label}
      </span>
      <span
        className={cn('truncate text-right text-[12px]', mono && 'ig-tabular')}
        style={{ color: 'var(--ig-fg-strong)' }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
