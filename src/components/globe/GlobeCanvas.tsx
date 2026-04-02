'use client';

import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { FeatureCollection } from 'geojson';
import * as THREE from 'three';
import { getProjects, getProjectsV2 } from '@/lib/services/projects';
import { useWebGLSupport } from '@/hooks/useWebGLSupport';
import {
  aggregateStateKpis,
  buildGlobeProjectRecords,
  type GlobeProjectRecord,
  type StateAggregate,
} from '@/data/geo/globe-kpi-data';
import { StateOverlay } from './StateOverlay';
import { HotspotLayer } from './HotspotLayer';
import { ProjectAnchorLayer } from './ProjectAnchorLayer';
import { FlowArcLayer } from './FlowArcLayer';
import { StateHudPanel } from './StateHudPanel';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import { brStates } from '@/data/geo/br-states';

const Globe = dynamic(() => import('react-globe.gl'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border border-cyan-200/40 border-t-transparent animate-spin" />
    </div>
  ),
});

const BRAZIL_STATES_URL = 'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson';
const BRAZIL_CAMERA = { lat: -14.235, lng: -54.5, altitude: 1.35 };
const INTRO_CAMERA = { lat: 5, lng: -30, altitude: 3.8 };
const INTRO_SPIN_SPEED = 0.9;
const INTRO_SPIN_MS = 1200;
const INTRO_FLY_MS = 2400;

interface GlobeCanvasProps {
  className?: string;
  mode?: 'executivo' | 'operacional';
  showOnlyProjectStates?: boolean;
  onStateSelect?: (state: StateAggregate | null) => void;
  onStateAggregatesChange?: (states: Record<string, StateAggregate>) => void;
  onProjectOpen?: (projectId: string, uf: string) => void;
  onProjectFocusChange?: (active: boolean) => void;
}

export interface GlobeScopeSummary {
  projectCount: number;
  contractTotal: number;
  invoiced: number;
  toInvoice: number;
  riskCount: number;
  decisionCount: number;
}

type HeatMetric = 'revenue' | 'hh' | 'risk';

export function GlobeCanvas({
  className,
  mode = 'executivo',
  showOnlyProjectStates = false,
  onStateSelect,
  onStateAggregatesChange,
  onProjectOpen,
  onProjectFocusChange,
}: GlobeCanvasProps) {
  const globeRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({ width: 1280, height: 760 });
  const [selectedUF, setSelectedUF] = useState<string | null>(null);
  const [hoveredUF, setHoveredUF] = useState<string | null>(null);
  const [heatMetric, setHeatMetric] = useState<HeatMetric>('revenue');
  const [transitioning, setTransitioning] = useState(false);
  const [cameraAltitude, setCameraAltitude] = useState(BRAZIL_CAMERA.altitude);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [focusedProject, setFocusedProject] = useState<{ project: GlobeProjectRecord; uf: string } | null>(null);
  const [brazilGeojson, setBrazilGeojson] = useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const [introPhase, setIntroPhase] = useState<'waiting' | 'spinning' | 'flying' | 'done'>('waiting');
  const introRef = useRef({ cancelled: false });

  const { isSupported, isLoading } = useWebGLSupport();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const lowPerfMode = !isSupported;

  const renderDpr = useMemo(() => {
    if (typeof window === 'undefined') return 1;
    const nativeDpr = window.devicePixelRatio || 1;
    return lowPerfMode ? 1 : Math.min(4, Math.max(2.2, nativeDpr * 2));
  }, [lowPerfMode]);

  const projectRecords = useMemo<GlobeProjectRecord[]>(() => {
    try {
      const projects = getProjects();
      const projectsV2 = getProjectsV2();
      return buildGlobeProjectRecords(projects, projectsV2).filter(
        (project) => project.status === 'em_andamento',
      );
    } catch {
      return [];
    }
  }, []);

  const stateAggregates = useMemo<Record<string, StateAggregate>>(
    () => aggregateStateKpis(projectRecords),
    [projectRecords],
  );

  const metricIntensityByUF = useMemo(() => {
    const states = Object.values(stateAggregates);
    const maxRevenue = Math.max(...states.map((state) => state.contractTotal), 1);
    const maxHeadcount = Math.max(...states.map((state) => state.headcount), 1);
    const maxRisk = Math.max(...states.map((state) => state.riskCount), 1);
    const output: Record<string, number> = {};

    states.forEach((state) => {
      const revenueIntensity = state.contractTotal / maxRevenue;
      const hhIntensity = state.headcount / maxHeadcount;
      const riskIntensity = state.riskCount / maxRisk;
      output[state.uf] = heatMetric === 'revenue'
        ? revenueIntensity
        : heatMetric === 'hh'
          ? hhIntensity
          : riskIntensity;
    });

    return output;
  }, [heatMetric, stateAggregates]);

  useEffect(() => {
    onStateAggregatesChange?.(stateAggregates);
  }, [onStateAggregatesChange, stateAggregates]);

  useEffect(() => {
    onProjectFocusChange?.(Boolean(focusedProject));
  }, [focusedProject, onProjectFocusChange]);

  useEffect(() => {
    if (!focusedProject) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFocusedProject(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedProject]);

  useEffect(() => {
    let mounted = true;
    async function loadBrazilGeojson() {
      try {
        const response = await fetch(BRAZIL_STATES_URL);
        const data = await response.json();
        if (!mounted || !data?.features) return;
        setBrazilGeojson(data as FeatureCollection);
      } catch {
        if (!mounted) return;
        setBrazilGeojson(brStates as FeatureCollection);
      }
    }
    loadBrazilGeojson();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setSize({ width: box.width, height: box.height });
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const renderer = globe.renderer?.();
    if (renderer) {
      renderer.setPixelRatio(renderDpr);
      renderer.setSize(size.width, size.height, false);
    }

    const controls = globe.controls?.();
    if (controls) {
      controls.enablePan = false;
      controls.minDistance = 140;
      controls.maxDistance = 320;
    }
  }, [renderDpr, size.height, size.width]);

  const handleGlobeReady = useCallback(() => {
    const globe = globeRef.current;
    if (!globe || introPhase !== 'waiting') return;

    globe.pointOfView(INTRO_CAMERA, 0);

    const controls = globe.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = INTRO_SPIN_SPEED;
      controls.enableRotate = false;
      controls.enableZoom = false;
    }

    setIntroPhase('spinning');
  }, [introPhase]);

  useEffect(() => {
    if (introPhase !== 'spinning') return;
    const globe = globeRef.current;
    if (!globe) return;
    const ctx = introRef.current;
    ctx.cancelled = false;

    const spinTimer = window.setTimeout(() => {
      if (ctx.cancelled) return;

      const controls = globe.controls?.();
      if (controls) controls.autoRotate = false;

      globe.pointOfView(BRAZIL_CAMERA, INTRO_FLY_MS);
      setIntroPhase('flying');
    }, INTRO_SPIN_MS);

    return () => {
      ctx.cancelled = true;
      window.clearTimeout(spinTimer);
    };
  }, [introPhase]);

  useEffect(() => {
    if (introPhase !== 'flying') return;
    const globe = globeRef.current;
    if (!globe) return;

    const arriveTimer = window.setTimeout(() => {
      const controls = globe.controls?.();
      if (controls) {
        controls.autoRotate = false;
        controls.autoRotateSpeed = 0;
        controls.enableRotate = true;
        controls.enableZoom = true;
      }
      setIntroPhase('done');
    }, INTRO_FLY_MS);

    return () => window.clearTimeout(arriveTimer);
  }, [introPhase]);

  useEffect(() => {
    const controls = globeRef.current?.controls?.();
    if (!controls) return;

    let frame = 0;
    const handleChange = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const pov = globeRef.current?.pointOfView?.();
        if (!pov || typeof pov.altitude !== 'number') return;
        setCameraAltitude(pov.altitude);
      });
    };

    controls.addEventListener('change', handleChange);
    handleChange();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      controls.removeEventListener('change', handleChange);
    };
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const renderer = globe.renderer?.();
    const material = globe.globeMaterial?.();
    if (!renderer || !material) return;

    let cancelled = false;
    const loader = new THREE.TextureLoader();
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8;
    const targetAnisotropy = Math.min(16, maxAnisotropy);
    const loadedTextures: THREE.Texture[] = [];

    const applyTextureSettings = (texture: THREE.Texture, isColor = false) => {
      texture.anisotropy = targetAnisotropy;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      if (isColor) {
        texture.colorSpace = THREE.SRGBColorSpace;
      }
      texture.needsUpdate = true;
      loadedTextures.push(texture);
      return texture;
    };

    Promise.all([
      loader.loadAsync('/textures/earth-blue-marble-4k.jpg'),
      loader.loadAsync('/textures/earth-topology-2k.png'),
      loader.loadAsync('/textures/earth-water-1600.png'),
      loader.loadAsync('/textures/earth-night-2k.jpg'),
    ])
      .then(([, bump, water, night]) => {
        if (cancelled) return;

        applyTextureSettings(bump);
        applyTextureSettings(water);
        applyTextureSettings(night, true);

        material.map = night;
        material.bumpMap = bump;
        material.bumpScale = 0.018;
        material.specularMap = water;
        material.specular = new THREE.Color(0x1e2d3f);
        material.shininess = 8;
        material.emissiveMap = night;
        material.emissive = new THREE.Color(isLight ? 0x4a8f7a : 0x1b7f90);
        material.emissiveIntensity = isLight ? 0.02 : 0.1;
        material.needsUpdate = true;
      })
      .catch(() => {
        // Keep default globe texture if enhanced texture loading fails.
      });

    return () => {
      cancelled = true;
      loadedTextures.forEach((texture) => texture.dispose());
    };
  }, [renderDpr, isLight]);

  const selectedState = selectedUF ? stateAggregates[selectedUF] || null : null;

  const flyToState = useCallback((uf: string) => {
    const target = stateAggregates[uf];
    if (!globeRef.current || !target) return;

    setTransitioning(true);
    globeRef.current.pointOfView({ lat: target.lat, lng: target.lon, altitude: 0.45 }, 1150);
    const controls = globeRef.current.controls?.();
    if (controls) {
      controls.autoRotate = false;
    }

    window.setTimeout(() => {
      setTransitioning(false);
    }, 1200);
  }, [stateAggregates]);

  const flyBackToBrazil = useCallback(() => {
    if (!globeRef.current) return;
    setTransitioning(true);
    globeRef.current.pointOfView(BRAZIL_CAMERA, 900);
    const controls = globeRef.current.controls?.();
    if (controls) {
      controls.autoRotate = false;
    }
    window.setTimeout(() => {
      setTransitioning(false);
    }, 920);
  }, []);

  const handleStateSelect = useCallback(
    (uf: string) => {
      if (transitioning) return;
      const state = stateAggregates[uf];
      if (!state) return;

      setSelectedUF(uf);
      onStateSelect?.(state);
      flyToState(uf);
    },
    [flyToState, onStateSelect, stateAggregates, transitioning],
  );

  const handleBackToBrazil = useCallback(() => {
    setSelectedUF(null);
    setFocusedProject(null);
    onStateSelect?.(null);
    flyBackToBrazil();
  }, [flyBackToBrazil, onStateSelect]);

  const handleProjectOpen = useCallback((projectId: string, uf: string) => {
    onProjectOpen?.(projectId, uf);
  }, [onProjectOpen]);

  const handleProjectSelect = useCallback((project: GlobeProjectRecord, uf: string) => {
    const state = stateAggregates[uf];
    if (!state || !globeRef.current) {
      setFocusedProject({ project, uf });
      return;
    }

    setTransitioning(true);
    globeRef.current.pointOfView({ lat: state.lat, lng: state.lon, altitude: 0.48 }, 820);

    window.setTimeout(() => {
      setTransitioning(false);
      setFocusedProject({ project, uf });
    }, 860);
  }, [stateAggregates]);

  const handleClusterSelect = useCallback((uf: string, lat: number, lng: number) => {
    const state = stateAggregates[uf];
    if (state) {
      setSelectedUF(uf);
      onStateSelect?.(state);
    }
    if (!globeRef.current) return;
    setTransitioning(true);
    globeRef.current.pointOfView({ lat, lng, altitude: 0.52 }, 900);
    window.setTimeout(() => setTransitioning(false), 940);
  }, [onStateSelect, stateAggregates]);

  const formatCompactMoney = useCallback((value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(value);
  }, []);

  if (!isLoading && !isSupported) {
    return (
      <div className={cn('relative w-full h-full', className)} ref={containerRef}>
        <div className="absolute inset-0 grid place-items-center globe-no-webgl bg-[radial-gradient(circle_at_center,rgba(0,255,180,0.09),transparent_55%)]">
          <div className="rounded-xl border border-border bg-background/80 backdrop-blur-sm px-4 py-3 text-sm text-muted-foreground">
            WebGL indisponível neste dispositivo. A visualização 3D foi reduzida.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('relative w-full h-full overflow-hidden', className)}>
      <div className={cn(
        'absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_46%_50%,rgba(13,255,188,0.05),transparent_56%)] transition-opacity duration-300',
        focusedProject && 'opacity-25',
      )} />
      <div className={cn(
        'absolute inset-0 pointer-events-none opacity-30 transition-opacity duration-300',
        focusedProject && 'opacity-0',
      )}>
        <div className="globe-scan-sweep" />
      </div>
      <StateOverlay
        geojson={brazilGeojson}
        selectedUF={selectedUF}
        hoveredUF={hoveredUF}
        statesByUF={stateAggregates}
        metric={heatMetric}
        metricIntensityByUF={metricIntensityByUF}
        showOnlyProjectStates={showOnlyProjectStates}
        onHoverUF={setHoveredUF}
        onSelectUF={handleStateSelect}
      >
        {(stateOverlay) => (
          <HotspotLayer
            statesByUF={stateAggregates}
            metricIntensityByUF={metricIntensityByUF}
            selectedUF={selectedUF}
            lowPerfMode={lowPerfMode}
          >
            {(hotspotLayer) => (
              <ProjectAnchorLayer
                projects={projectRecords}
                cameraAltitude={cameraAltitude}
                selectedUF={selectedUF}
                selectedProjectId={null}
                hoveredProjectId={hoveredProjectId}
                lowPerfMode={lowPerfMode}
                onHoverProject={(projectId, uf) => {
                  setHoveredProjectId(projectId);
                  setHoveredUF(uf);
                }}
                onSelectCluster={handleClusterSelect}
                onSelectProject={(project) => handleProjectSelect(project, project.stateUF)}
              >
                {(projectAnchorLayer) => (
                  <FlowArcLayer
                    mode={mode}
                    projects={projectRecords}
                    selectedUF={selectedUF}
                    lowPerfMode={lowPerfMode}
                  >
                    {(flowArcLayer) => (
                      <Globe
                        ref={globeRef}
                        onGlobeReady={handleGlobeReady}
                        width={size.width}
                        height={size.height}
                        backgroundColor="rgba(0,0,0,0)"
                        rendererConfig={{ antialias: true, alpha: true, powerPreference: 'high-performance', precision: 'highp' } as any}
                        globeImageUrl={isLight ? "/textures/earth-blue-marble-4k.jpg" : "/textures/earth-night-2k.jpg"}
                        atmosphereColor={isLight ? "#4dd0e1" : "#1a8b96"}
                        atmosphereAltitude={0.04}
                        showAtmosphere
                        polygonsTransitionDuration={0}
                        polygonsData={introPhase === 'flying' || introPhase === 'done' ? stateOverlay.polygonsData : []}
                        polygonCapColor={stateOverlay.polygonCapColor as any}
                        polygonSideColor={stateOverlay.polygonSideColor as any}
                        polygonStrokeColor={stateOverlay.polygonStrokeColor as any}
                        polygonAltitude={stateOverlay.polygonAltitude as any}
                        polygonLabel={stateOverlay.polygonLabel as any}
                        onPolygonHover={stateOverlay.onPolygonHover as any}
                        onPolygonClick={stateOverlay.onPolygonClick as any}
                        pathsData={introPhase === 'flying' || introPhase === 'done' ? stateOverlay.pathsData as any : []}
                        pathPoints={stateOverlay.pathPoints as any}
                        pathPointLat={stateOverlay.pathPointLat as any}
                        pathPointLng={stateOverlay.pathPointLng as any}
                        pathColor={stateOverlay.pathColor as any}
                        pathStroke={stateOverlay.pathStroke as any}
                        pathDashLength={stateOverlay.pathDashLength as any}
                        pathDashGap={stateOverlay.pathDashGap as any}
                        pathDashAnimateTime={stateOverlay.pathDashAnimateTime as any}
                        labelsData={introPhase === 'flying' || introPhase === 'done' ? stateOverlay.labelsData as any : []}
                        labelLat={stateOverlay.labelLat as any}
                        labelLng={stateOverlay.labelLng as any}
                        labelText={stateOverlay.labelText as any}
                        labelColor={stateOverlay.labelColor as any}
                        labelSize={stateOverlay.labelSize as any}
                        labelDotRadius={stateOverlay.labelDotRadius as any}
                        labelAltitude={() => 0.015}
                        labelResolution={6}
                        pointsData={introPhase === 'done' ? projectAnchorLayer.pointsData as any : []}
                        pointLat={projectAnchorLayer.pointLat as any}
                        pointLng={projectAnchorLayer.pointLng as any}
                        pointColor={projectAnchorLayer.pointColor as any}
                        pointAltitude={projectAnchorLayer.pointAltitude as any}
                        pointRadius={projectAnchorLayer.pointRadius as any}
                        pointLabel={projectAnchorLayer.pointLabel as any}
                        onPointHover={projectAnchorLayer.onPointHover as any}
                        onPointClick={projectAnchorLayer.onPointClick as any}
                        ringsData={introPhase === 'done' ? hotspotLayer.ringsData as any : []}
                        ringLat={hotspotLayer.ringLat as any}
                        ringLng={hotspotLayer.ringLng as any}
                        ringColor={hotspotLayer.ringColor as any}
                        ringMaxRadius={hotspotLayer.ringMaxRadius as any}
                        ringPropagationSpeed={hotspotLayer.ringPropagationSpeed as any}
                        ringRepeatPeriod={hotspotLayer.ringRepeatPeriod as any}
                        arcsData={introPhase === 'done' ? flowArcLayer.arcsData as any : []}
                        arcStartLat={flowArcLayer.arcStartLat as any}
                        arcStartLng={flowArcLayer.arcStartLng as any}
                        arcEndLat={flowArcLayer.arcEndLat as any}
                        arcEndLng={flowArcLayer.arcEndLng as any}
                        arcColor={flowArcLayer.arcColor as any}
                        arcAltitude={flowArcLayer.arcAltitude as any}
                        arcStroke={flowArcLayer.arcStroke as any}
                        arcDashLength={flowArcLayer.arcDashLength as any}
                        arcDashGap={flowArcLayer.arcDashGap as any}
                        arcDashInitialGap={flowArcLayer.arcDashInitialGap as any}
                        arcDashAnimateTime={flowArcLayer.arcDashAnimateTime as any}
                      />
                    )}
                  </FlowArcLayer>
                )}
              </ProjectAnchorLayer>
            )}
          </HotspotLayer>
        )}
      </StateOverlay>

      <StateHudPanel
        stateData={focusedProject ? null : selectedState}
        onBackToBrazil={handleBackToBrazil}
        onProjectSelect={(project, uf) => handleProjectOpen(project.id, uf)}
        onProjectOpen={handleProjectOpen}
      />

      {focusedProject && (
        <div className="pointer-events-none absolute inset-0 z-[58] flex items-center justify-center px-4">
          {/* Dimmed backdrop to lock focus */}
          <div className="pointer-events-auto absolute inset-0 bg-[#020915]/50 backdrop-blur-[2px] transition-opacity duration-300 z-[-1]" />

          <div className="pointer-events-auto w-[min(560px,calc(100vw-2rem))]">
            <div className="cr-glass-panel globe-focus-panel rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/70 light:text-cyan-800/70">
                    Projeto em foco · {focusedProject.uf}
                  </div>
                  <h4 className="mt-1 truncate text-lg font-semibold hud-text">
                    {focusedProject.project.name}
                  </h4>
                </div>
                <button
                  onClick={handleBackToBrazil}
                  className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                >
                  Close focus
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border globe-kpi-card hud-surface p-2">
                  <div className="text-[9px] uppercase tracking-[0.1em] globe-kpi-label hud-text-muted">Contrato</div>
                  <div className="mt-1 text-sm font-semibold globe-kpi-value hud-text">{formatCompactMoney(focusedProject.project.contractTotal)}</div>
                </div>
                <div className="rounded-lg border globe-kpi-card hud-surface p-2">
                  <div className="text-[9px] uppercase tracking-[0.1em] globe-kpi-label hud-text-muted">Faturado</div>
                  <div className="mt-1 text-sm font-semibold text-emerald-300">{formatCompactMoney(focusedProject.project.invoiced)}</div>
                </div>
                <div className="rounded-lg border globe-kpi-card hud-surface p-2">
                  <div className="text-[9px] uppercase tracking-[0.1em] globe-kpi-label hud-text-muted">Riscos</div>
                  <div className="mt-1 text-sm font-semibold text-amber-300">{focusedProject.project.riskCount}</div>
                </div>
                <div className="rounded-lg border globe-kpi-card hud-surface p-2">
                  <div className="text-[9px] uppercase tracking-[0.1em] globe-kpi-label hud-text-muted">HH</div>
                  <div className="mt-1 text-sm font-semibold text-cyan-200">{focusedProject.project.estimatedHeadcount}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="text-[11px] hud-text-tertiary">
                  Status: <span className="font-medium hud-text-secondary">{focusedProject.project.status.replace(/_/g, ' ')}</span>
                </div>
                <button
                  onClick={() => handleProjectOpen(focusedProject.project.id, focusedProject.uf)}
                  className="rounded-md border border-cyan-300/35 bg-cyan-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-100 hover:bg-cyan-400/20"
                >
                  Open project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GlobeCanvas;
