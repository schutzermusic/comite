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
    return startCameraFlight({
      destination: Cesium.Cartesian3.fromDegrees(project.lon, project.lat - 0.6, 250_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-55), roll: 0 },
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

      const fillCss = isSelected
        ? 'rgba(34, 211, 238, 0.28)'
        : hasProjects
          ? 'rgba(34, 211, 238, 0.16)'
          : 'rgba(120, 160, 180, 0.04)';
      const outlineCss = isSelected
        ? 'rgba(125, 235, 255, 0.95)'
        : hasProjects
          ? 'rgba(125, 235, 255, 0.55)'
          : 'rgba(180, 200, 215, 0.30)';
      const fillColor = Cesium.Color.fromCssColorString(fillCss);
      const outlineColor = Cesium.Color.fromCssColorString(outlineCss);

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
        const id = `uf:${uf}:${idx}:${ringIdx}`;
        const entity = viewer.entities.add({
          id,
          name: uf,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(flat)),
            material: fillColor,
            height: 0,
            outline: false,
          },
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray([...flat, outer[0][0], outer[0][1]]),
            width: isSelected ? 2.0 : hasProjects ? 1.4 : 0.9,
            material: outlineColor,
            clampToGround: true,
          },
        });
        stateEntitiesRef.current.set(id, entity);
      });
    });
  }, [geojson, ready, selectedUF, stateAggregates]);

  // Render project hotspots
  useEffect(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | { entities: { add: (o: unknown) => unknown; removeById: (id: string) => boolean } }
      | null;
    if (!Cesium || !viewer || !ready) return;

    projectEntitiesRef.current.forEach((_, id) => viewer.entities.removeById(id));
    projectEntitiesRef.current.clear();

    projectRecords.forEach((p) => {
      const id = `proj:${p.id}`;
      const color =
        p.riskCount >= 4
          ? Cesium.Color.fromCssColorString('#ef4444')
          : p.riskCount >= 2
            ? Cesium.Color.fromCssColorString('#f59e0b')
            : Cesium.Color.fromCssColorString('#22d3ee');
      const entity = viewer.entities.add({
        id,
        name: p.name,
        position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0),
        point: {
          pixelSize: 8,
          color,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      projectEntitiesRef.current.set(id, entity);
    });
  }, [projectRecords, ready]);

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
          className="absolute left-1/2 -translate-x-1/2 top-3 z-20 inline-flex items-center gap-1.5 rounded-full border border-cyan-300/35 bg-black/45 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-100 backdrop-blur-md hover:bg-cyan-400/15"
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
        <aside
          className="pointer-events-auto fixed right-3 top-[72px] bottom-3 z-[60] w-[min(380px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-cyan-300/20 bg-black/55 backdrop-blur-xl shadow-[0_30px_70px_-24px_rgba(0,0,0,0.9)]"
        >
          <div className="px-5 py-4 border-b border-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/70">
                  Projeto em foco · {focusedProject.uf}
                </div>
                <h4 className="mt-1 truncate text-lg font-semibold text-white">
                  {focusedProject.project.name}
                </h4>
              </div>
              <button
                onClick={handleBackToBrazil}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70 hover:text-white hover:bg-white/10"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar ao Brasil
              </button>
            </div>
          </div>

          <div className="p-5 space-y-3 overflow-y-auto h-[calc(100%-82px)]">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <div className="text-[9px] uppercase tracking-[0.1em] text-white/55">Contrato</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(focusedProject.project.contractTotal)}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <div className="text-[9px] uppercase tracking-[0.1em] text-white/55">Faturado</div>
                <div className="mt-1 text-sm font-semibold text-emerald-300">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(focusedProject.project.invoiced)}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <div className="text-[9px] uppercase tracking-[0.1em] text-white/55">Riscos</div>
                <div className="mt-1 text-sm font-semibold text-amber-300">{focusedProject.project.riskCount}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <div className="text-[9px] uppercase tracking-[0.1em] text-white/55">HH</div>
                <div className="mt-1 text-sm font-semibold text-cyan-200">{focusedProject.project.estimatedHeadcount}</div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
              <div className="text-[9px] uppercase tracking-[0.1em] text-white/55">Status</div>
              <div className="mt-1 text-sm font-medium text-white/85">
                {focusedProject.project.status.replace(/_/g, ' ')}
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => handleProjectOpenInternal(focusedProject.project.id, focusedProject.uf)}
                className="w-full rounded-md border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-100 hover:bg-cyan-400/20"
              >
                Abrir projeto
              </button>
              <button
                onClick={() => setFocusedProject(null)}
                className="w-full rounded-md border border-white/12 bg-white/5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/70 hover:text-white hover:bg-white/10"
              >
                Fechar foco
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

export default CesiumDashboardGlobe;
