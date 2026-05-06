"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  Layers,
  MapPin,
  Navigation,
  Radar,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Zap,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  formatOperationsMoney,
  getOperationsStatusLabel,
  type OperationsProjectRecord,
  type OperationsProjectStatus,
} from "@/components/operations-3d/operations-projects";

type FilterKey = "all" | OperationsProjectStatus;

interface CesiumOperationsMapProps {
  projects: OperationsProjectRecord[];
  selectedProjectId?: string | null;
  onSelectProject: (project: OperationsProjectRecord | null) => void;
  children?: React.ReactNode;
}

type TooltipState = {
  project: OperationsProjectRecord;
  x: number;
  y: number;
} | null;

const STATUS_TOKEN: Record<OperationsProjectStatus, string> = {
  active: "var(--ig-success)",
  attention: "var(--ig-warning)",
  critical: "var(--ig-danger)",
  completed: "var(--ig-accent)",
};

const STATUS_HEX: Record<OperationsProjectStatus, string> = {
  active: "#22c55e",
  attention: "#f59e0b",
  critical: "#ef4444",
  completed: "#22d3ee",
};

const FILTERS: Array<{ key: FilterKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "all", label: "Todos", icon: Layers },
  { key: "active", label: "Ativos", icon: Zap },
  { key: "attention", label: "Atenção", icon: Activity },
  { key: "critical", label: "Críticos", icon: AlertTriangle },
  { key: "completed", label: "Concluídos", icon: CheckCircle2 },
];

const CESIUM_VERSION = "1.138.0";
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
const CESIUM_CSS = `${CESIUM_BASE}Widgets/widgets.css`;

const BRAZIL_INTRO_VIEW = {
  destination: { lng: -54.5, lat: -14.2, height: 14_800_000 },
  orientation: { headingDeg: 0, pitchDeg: -88 },
};

const BRAZIL_FOCUS_VIEW = {
  destination: { lng: -54.6, lat: -14.8, height: 6_900_000 },
  orientation: { headingDeg: 0, pitchDeg: -88 },
  duration: 2.1,
};

function buildImageryProvider(Cesium: typeof import("cesium")) {
  return new Cesium.UrlTemplateImageryProvider({
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    credit: "Imagery © Esri, Maxar, Earthstar Geographics",
    maximumLevel: 19,
  });
}

function ensureCesiumCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById("ig-cesium-css")) return;
  const link = document.createElement("link");
  link.id = "ig-cesium-css";
  link.rel = "stylesheet";
  link.href = CESIUM_CSS;
  document.head.appendChild(link);
}

function formatLastSync(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Hoje";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function visibleByFilters(project: OperationsProjectRecord, filters: Record<FilterKey, boolean>) {
  return filters.all || filters[project.status];
}

const markerCache = new Map<string, string>();

function buildHexMarkerImage(status: OperationsProjectStatus, selected = false, hovered = false): string {
  const key = `${status}-${selected ? "selected" : "base"}-${hovered ? "hover" : "idle"}`;
  const cached = markerCache.get(key);
  if (cached) return cached;
  if (typeof document === "undefined") return "";

  const color = STATUS_HEX[status];
  const size = 96;
  const center = size / 2;
  const radius = selected ? 25 : hovered ? 23 : 21;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const hexPoints = (r: number) => {
    return Array.from({ length: 6 }, (_, index) => {
      const angle = (Math.PI / 3) * index - Math.PI / 6;
      return [center + Math.cos(angle) * r, center + Math.sin(angle) * r] as const;
    });
  };

  const drawHex = (r: number) => {
    const points = hexPoints(r);
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };

  ctx.clearRect(0, 0, size, size);

  ctx.shadowColor = color;
  ctx.shadowBlur = selected ? 24 : hovered ? 18 : 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = selected ? 3.2 : 2.2;
  drawHex(radius + 12);
  ctx.stroke();

  ctx.shadowBlur = selected ? 18 : hovered ? 14 : 8;
  drawHex(radius);
  const gradient = ctx.createLinearGradient(28, 22, 68, 76);
  gradient.addColorStop(0, "rgba(255,255,255,0.84)");
  gradient.addColorStop(0.18, `${color}cc`);
  gradient.addColorStop(1, "rgba(5,14,18,0.88)");
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.82)";
  ctx.lineWidth = 1.15;
  ctx.stroke();

  ctx.shadowBlur = 0;
  drawHex(radius - 7);
  ctx.fillStyle = "rgba(2,10,14,0.76)";
  ctx.fill();
  ctx.strokeStyle = `${color}ee`;
  ctx.lineWidth = 1.3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(center, center, selected ? 5.4 : 4.4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fill();

  ctx.shadowBlur = 0;
  const dataUrl = canvas.toDataURL("image/png");
  markerCache.set(key, dataUrl);
  return dataUrl;
}

export function CesiumOperationsMap({
  projects,
  selectedProjectId = null,
  onSelectProject,
  children,
}: CesiumOperationsMapProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<unknown>(null);
  const cesiumModRef = useRef<typeof import("cesium") | null>(null);
  const handlerRef = useRef<unknown>(null);
  const entitiesByIdRef = useRef<Map<string, unknown>>(new Map());
  const tilesetRef = useRef<{ show: boolean } | null>(null);
  const projectsRef = useRef(projects);
  const selectedProjectIdRef = useRef<string | null>(selectedProjectId);
  const previousSelectedProjectIdRef = useRef<string | null>(selectedProjectId);
  const onSelectProjectRef = useRef(onSelectProject);
  const hoveredProjectIdRef = useRef<string | null>(null);
  const filtersRef = useRef<Record<FilterKey, boolean>>({
    all: true,
    active: true,
    attention: true,
    critical: true,
    completed: true,
  });

  const [ready, setReady] = useState(false);
  const [bootOverlayVisible, setBootOverlayVisible] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [terrainActive, setTerrainActive] = useState(false);
  const [photoTilesActive, setPhotoTilesActive] = useState(false);
  const [buildings3DVisible, setBuildings3DVisible] = useState(true);
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    all: true,
    active: true,
    attention: true,
    critical: true,
    completed: true,
  });

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    onSelectProjectRef.current = onSelectProject;
  }, [onSelectProject]);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const counts = useMemo(() => {
    return {
      total: projects.length,
      critical: projects.filter((project) => project.status === "critical").length,
      visible: projects.filter((project) => visibleByFilters(project, filters)).length,
    };
  }, [filters, projects]);

  const flyToBrazil = useCallback(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as { camera: { cancelFlight?: () => void; flyTo: (opts: unknown) => void } } | null;
    if (!Cesium || !viewer) return;
    viewer.camera.cancelFlight?.();
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        BRAZIL_FOCUS_VIEW.destination.lng,
        BRAZIL_FOCUS_VIEW.destination.lat,
        BRAZIL_FOCUS_VIEW.destination.height,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(BRAZIL_FOCUS_VIEW.orientation.headingDeg),
        pitch: Cesium.Math.toRadians(BRAZIL_FOCUS_VIEW.orientation.pitchDeg),
        roll: 0,
      },
      duration: 1.35,
    });
  }, []);

  const handleReset = useCallback(() => {
    setTooltip(null);
    onSelectProject(null);
    flyToBrazil();
  }, [flyToBrazil, onSelectProject]);

  useEffect(() => {
    const previous = previousSelectedProjectIdRef.current;
    selectedProjectIdRef.current = selectedProjectId;
    if (previous && !selectedProjectId) {
      setTooltip(null);
      flyToBrazil();
    }
    previousSelectedProjectIdRef.current = selectedProjectId;
  }, [flyToBrazil, selectedProjectId]);

  const toggleBuildings3D = useCallback(() => {
    if (!tilesetRef.current) return;
    setBuildings3DVisible((prev) => {
      const next = !prev;
      tilesetRef.current!.show = next;
      return next;
    });
  }, []);

  const flyToProject = useCallback((project: OperationsProjectRecord, close = false) => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as { camera: { cancelFlight?: () => void; flyTo: (opts: unknown) => void } } | null;
    if (!Cesium || !viewer) return;
    viewer.camera.cancelFlight?.();
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        project.lng,
        project.lat,
        close ? 96_000 : 280_000,
      ),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-89.2),
        roll: 0,
      },
      duration: close ? 1.45 : 1.2,
    });
  }, []);

  const applyEntityVisualState = useCallback(() => {
    const Cesium = cesiumModRef.current;
    if (!Cesium) return;
    entitiesByIdRef.current.forEach((entityLike, id) => {
      const entity = entityLike as {
        billboard?: { image?: string; scale?: number; color?: unknown; disableDepthTestDistance?: number };
        show?: boolean;
      };
      const project = projectsRef.current.find((item) => item.id === id);
      if (!project) return;
      const selected = selectedProjectIdRef.current === id;
      const hovered = hoveredProjectIdRef.current === id;
      const visible = visibleByFilters(project, filtersRef.current);
      entity.show = visible;
      if (entity.billboard) {
        entity.billboard.image = buildHexMarkerImage(project.status, selected, hovered);
        entity.billboard.scale = selected ? 0.62 : hovered ? 0.56 : project.status === "critical" ? 0.52 : 0.48;
        entity.billboard.color = Cesium.Color.WHITE.withAlpha(visible ? 1 : 0);
      }
    });
  }, [theme]);

  useEffect(() => {
    applyEntityVisualState();
  }, [applyEntityVisualState, filters, selectedProjectId]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (typeof window === "undefined" || !containerRef.current) return;
      try {
        (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE;
        ensureCesiumCss();

        const Cesium = await import("cesium");
        if (cancelled || !containerRef.current) return;
        cesiumModRef.current = Cesium;

        const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;
        const googleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

        const imageryProvider = buildImageryProvider(Cesium);
        const viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: Cesium.ImageryLayer.fromProviderAsync(
            Promise.resolve(imageryProvider) as unknown as Promise<typeof imageryProvider>,
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
          requestRenderMode: true,
          maximumRenderTimeChange: 0.5,
        });

        (viewer as unknown as { useBrowserRecommendedResolution: boolean }).useBrowserRecommendedResolution = false;
        (viewer as unknown as { resolutionScale: number }).resolutionScale = Math.min(
          typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
          1.35,
        );
        try {
          (viewer.scene as unknown as { msaaSamples: number }).msaaSamples = 4;
          if (viewer.scene.postProcessStages?.fxaa) viewer.scene.postProcessStages.fxaa.enabled = true;
        } catch {}

        if (ionToken) {
          try {
            const terrain = await Cesium.createWorldTerrainAsync({
              requestVertexNormals: true,
              requestWaterMask: true,
            });
            if (!cancelled && !viewer.isDestroyed()) {
              viewer.terrainProvider = terrain;
              setTerrainActive(true);
            }
          } catch (terrainErr) {
            console.warn("[CesiumOperationsMap] world terrain unavailable", terrainErr);
          }
        }

        if (googleKey) {
          try {
            const tileset = await Cesium.Cesium3DTileset.fromUrl(
              `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(googleKey)}`,
              { showCreditsOnScreen: false },
            );
            if (!cancelled && !viewer.isDestroyed()) {
              viewer.scene.primitives.add(tileset);
              tilesetRef.current = tileset;
              setPhotoTilesActive(true);
            }
          } catch (tilesetErr) {
            console.warn("[CesiumOperationsMap] photorealistic 3D tiles unavailable", tilesetErr);
          }
        }

        viewer.scene.globe.enableLighting = false;
        (viewer.scene.globe as unknown as {
          maximumScreenSpaceError?: number;
          preloadAncestors?: boolean;
          preloadSiblings?: boolean;
          tileCacheSize?: number;
        }).maximumScreenSpaceError = 1.5;
        (viewer.scene.globe as unknown as { preloadAncestors?: boolean }).preloadAncestors = true;
        (viewer.scene.globe as unknown as { preloadSiblings?: boolean }).preloadSiblings = true;
        (viewer.scene.globe as unknown as { tileCacheSize?: number }).tileCacheSize = 512;
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(
          theme === "dark" ? "#071116" : "#e8eef0",
        );

        const credits = (viewer as unknown as {
          cesiumWidget: { creditContainer: HTMLElement };
        }).cesiumWidget.creditContainer;
        if (credits?.style) credits.style.display = "none";

        const entities = entitiesByIdRef.current;
        entities.clear();
        projectsRef.current.forEach((project) => {
          const entity = viewer.entities.add({
            id: project.id,
            name: project.name,
            position: Cesium.Cartesian3.fromDegrees(project.lng, project.lat, 0),
            billboard: {
              image: buildHexMarkerImage(project.status),
              scale: project.status === "critical" ? 0.52 : 0.48,
              verticalOrigin: Cesium.VerticalOrigin.CENTER,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1.08, 7.5e6, 0.7),
            },
          });
          entities.set(project.id, entity);
        });

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((event: { position: { x: number; y: number } }) => {
          const picked = viewer.scene.pick(new Cesium.Cartesian2(event.position.x, event.position.y));
          if (picked?.id?.id && typeof picked.id.id === "string") {
            const project = projectsRef.current.find((item) => item.id === picked.id.id);
            if (project) {
              onSelectProjectRef.current(project);
              flyToProject(project);
              return;
            }
          }
          onSelectProjectRef.current(null);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        handler.setInputAction((event: { endPosition: { x: number; y: number } }) => {
          const picked = viewer.scene.pick(new Cesium.Cartesian2(event.endPosition.x, event.endPosition.y));
          if (picked?.id?.id && typeof picked.id.id === "string") {
            const project = projectsRef.current.find((item) => item.id === picked.id.id);
            if (project && visibleByFilters(project, filtersRef.current)) {
              viewer.scene.canvas.style.cursor = "pointer";
              if (hoveredProjectIdRef.current !== project.id) {
                hoveredProjectIdRef.current = project.id;
                applyEntityVisualState();
              }
              setTooltip({ project, x: event.endPosition.x, y: event.endPosition.y });
              return;
            }
          }
          viewer.scene.canvas.style.cursor = "";
          if (hoveredProjectIdRef.current) {
            hoveredProjectIdRef.current = null;
            applyEntityVisualState();
          }
          setTooltip(null);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        handlerRef.current = handler;
        viewerRef.current = viewer;

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            BRAZIL_INTRO_VIEW.destination.lng,
            BRAZIL_INTRO_VIEW.destination.lat,
            BRAZIL_INTRO_VIEW.destination.height,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(BRAZIL_INTRO_VIEW.orientation.headingDeg),
            pitch: Cesium.Math.toRadians(BRAZIL_INTRO_VIEW.orientation.pitchDeg),
            roll: 0,
          },
        });

        if (!cancelled) {
          const cleanIntro = () => {
            if (!cancelled) {
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(
                  BRAZIL_FOCUS_VIEW.destination.lng,
                  BRAZIL_FOCUS_VIEW.destination.lat,
                  BRAZIL_FOCUS_VIEW.destination.height,
                ),
                orientation: {
                  heading: Cesium.Math.toRadians(BRAZIL_FOCUS_VIEW.orientation.headingDeg),
                  pitch: Cesium.Math.toRadians(BRAZIL_FOCUS_VIEW.orientation.pitchDeg),
                  roll: 0,
                },
                duration: BRAZIL_FOCUS_VIEW.duration,
                complete: () => {
                  if (!cancelled) {
                    (viewer as unknown as { resolutionScale: number }).resolutionScale = Math.min(
                      window.devicePixelRatio || 1,
                      1.5,
                    );
                    viewer.scene.requestRender?.();
                    window.setTimeout(() => {
                      setReady(true);
                      window.setTimeout(() => setBootOverlayVisible(false), 520);
                    }, 180);
                  }
                },
              });
            }
          };
          let flightStarted = false;
          const removeTileListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener((remaining: number) => {
            if (flightStarted || remaining > 2) return;
            flightStarted = true;
            removeTileListener();
            cleanIntro();
          });
          window.setTimeout(() => {
            if (flightStarted || cancelled) return;
            flightStarted = true;
            removeTileListener();
            cleanIntro();
          }, 1200);
        }
      } catch (err) {
        console.error("[CesiumOperationsMap] init failed", err);
        if (!cancelled) {
          setBootOverlayVisible(false);
          setLoadError(err instanceof Error ? err.message : "Falha ao carregar Cesium");
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      const handler = handlerRef.current as { destroy: () => void } | null;
      if (handler) {
        try {
          handler.destroy();
        } catch {}
      }
      const viewer = viewerRef.current as { destroy: () => void; isDestroyed: () => boolean } | null;
      if (viewer && !viewer.isDestroyed()) {
        try {
          viewer.destroy();
        } catch {}
      }
      viewerRef.current = null;
      handlerRef.current = null;
      entitiesByIdRef.current.clear();
    };
    // Initial Cesium construction is intentionally one-shot; refs keep project callbacks current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | {
          imageryLayers: { removeAll: () => void; addImageryProvider: (p: unknown) => unknown };
          scene: {
            backgroundColor: unknown;
            globe: { baseColor: unknown };
            requestRender?: () => void;
          };
        }
      | null;
    if (!Cesium || !viewer || !ready) return;

    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(buildImageryProvider(Cesium));
    viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(
      theme === "dark" ? "#071116" : "#e8eef0",
    );
    viewer.scene.requestRender?.();
    applyEntityVisualState();
  }, [applyEntityVisualState, ready, theme]);

  const toggleFilter = (key: FilterKey) => {
    setFilters((prev) => {
      if (key === "all") {
        const next = !prev.all;
        return { all: next, active: next, attention: next, critical: next, completed: next };
      }
      const next = { ...prev, all: false, [key]: !prev[key] };
      if (next.active && next.attention && next.critical && next.completed) next.all = true;
      return next;
    });
  };

  return (
    <div className="ig-ops-map relative h-full w-full overflow-hidden bg-transparent">
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
          image-rendering: auto;
        }
        .ig-ops-map .ig-ops-hud-surface,
        .ig-ops-map .ig-ops-hud-chip {
          border-color: color-mix(in oklab, var(--ig-border-subtle) 78%, transparent);
          background: linear-gradient(
            145deg,
            color-mix(in oklab, var(--ig-panel) 84%, transparent),
            color-mix(in oklab, var(--ig-bg-raised) 70%, transparent)
          );
          box-shadow:
            0 18px 46px -30px rgba(0, 0, 0, 0.72),
            inset 0 1px 0 color-mix(in oklab, white 16%, transparent),
            inset 0 0 0 1px color-mix(in oklab, var(--ig-accent) 8%, transparent);
          backdrop-filter: blur(18px) saturate(150%);
          -webkit-backdrop-filter: blur(18px) saturate(150%);
        }
        html.light .ig-ops-map .ig-ops-hud-surface,
        html.light .ig-ops-map .ig-ops-hud-chip {
          border-color: rgba(255, 255, 255, 0.28);
          background:
            radial-gradient(circle at 16% 0%, rgba(255, 255, 255, 0.18), transparent 34%),
            linear-gradient(145deg, rgba(5, 20, 28, 0.68), rgba(7, 31, 42, 0.52) 54%, rgba(2, 10, 16, 0.58));
          box-shadow:
            0 22px 52px -28px rgba(0, 0, 0, 0.52),
            0 2px 12px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.36),
            inset 0 0 0 1px rgba(255, 255, 255, 0.13);
          color: rgba(255, 255, 255, 0.94) !important;
        }
        html.light .ig-ops-map .ig-ops-hud-surface {
          border-color: rgba(255, 255, 255, 0.28) !important;
          background:
            radial-gradient(circle at 16% 0%, rgba(255, 255, 255, 0.18), transparent 34%),
            linear-gradient(145deg, rgba(5, 20, 28, 0.68), rgba(7, 31, 42, 0.52) 54%, rgba(2, 10, 16, 0.58)) !important;
          box-shadow:
            0 22px 52px -28px rgba(0, 0, 0, 0.52),
            0 2px 12px rgba(0, 0, 0, 0.2),
            inset 0 1px 0 rgba(255, 255, 255, 0.36),
            inset 0 0 0 1px rgba(255, 255, 255, 0.13) !important;
        }
        html.light .ig-ops-map .ig-ops-hud-surface .text-ig-fg-strong,
        html.light .ig-ops-map .ig-ops-hud-chip .text-ig-fg-strong {
          color: rgba(255, 255, 255, 0.98) !important;
        }
        html.light .ig-ops-map .ig-ops-hud-surface .text-ig-fg-muted,
        html.light .ig-ops-map .ig-ops-hud-chip,
        html.light .ig-ops-map .ig-ops-hud-chip .text-ig-fg-muted {
          color: rgba(226, 244, 248, 0.84) !important;
        }
        html.light .ig-ops-map .ig-ops-hud-surface .text-ig-caption,
        html.light .ig-ops-map .ig-ops-hud-inner .text-ig-caption {
          color: rgba(226, 244, 248, 0.78) !important;
        }
        html.light .ig-ops-map .ig-ops-hud-inner {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          border-color: rgba(255, 255, 255, 0.2) !important;
          background:
            radial-gradient(circle at 14% 0%, rgba(255, 255, 255, 0.16), transparent 36%),
            linear-gradient(148deg, rgba(255, 255, 255, 0.13), rgba(10, 45, 58, 0.36) 48%, rgba(2, 10, 16, 0.22)) !important;
          box-shadow:
            0 14px 30px -22px rgba(0, 0, 0, 0.5),
            0 2px 8px rgba(0, 0, 0, 0.14),
            inset 0 1px 0 rgba(255, 255, 255, 0.28),
            inset 0 -1px 0 rgba(255, 255, 255, 0.08),
            inset 0 0 0 1px rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(16px) saturate(155%);
          -webkit-backdrop-filter: blur(16px) saturate(155%);
          transform: translateZ(0);
        }
        html.light .ig-ops-map .ig-ops-hud-inner::before {
          content: "";
          pointer-events: none;
          position: absolute;
          inset: 0;
          z-index: -1;
          background:
            linear-gradient(120deg, rgba(255, 255, 255, 0.22), transparent 36%),
            linear-gradient(180deg, rgba(20, 184, 166, 0.1), transparent 62%);
        }
        html.light .ig-ops-map .ig-ops-hud-inner::after {
          content: "";
          pointer-events: none;
          position: absolute;
          inset: 1px;
          z-index: -1;
          border-radius: inherit;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.18),
            inset 0 12px 22px rgba(255, 255, 255, 0.08);
        }
        html.dark .ig-ops-map .ig-ops-hud-inner {
          background: color-mix(in oklab, var(--ig-panel) 48%, transparent) !important;
        }
      `}</style>

      <div ref={containerRef} className="ig-cesium-host absolute inset-0" />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 46% 42%, transparent 38%, color-mix(in oklab, var(--ig-bg-canvas) 58%, transparent) 100%)",
        }}
      />

      <div className="pointer-events-none absolute inset-0 z-20">{children}</div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          boxShadow:
            "inset 0 0 0 1px color-mix(in oklab, var(--ig-accent) 16%, transparent), inset 0 0 80px color-mix(in oklab, var(--ig-accent) 8%, transparent)",
        }}
      />

      <div className="pointer-events-none absolute left-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 md:left-4 md:top-4 md:max-w-[calc(100%-27rem)]">
        <span className="ig-ops-hud-chip pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/70 px-3 py-1.5 text-ig-label text-ig-fg-muted shadow-lg backdrop-blur-md">
          <Radar className="h-3.5 w-3.5 text-ig-accent" />
          Digital twin Brasil
          <span
            className="ml-1 rounded-full px-1.5 py-0.5 text-[10px]"
            style={{
              background: "color-mix(in oklab, var(--ig-accent) 18%, transparent)",
              color: "var(--ig-accent)",
            }}
          >
            {photoTilesActive ? "Photoreal 3D" : terrainActive ? "Terrain" : "Satélite"}
          </span>
        </span>
        <span className="ig-ops-hud-chip pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/70 px-3 py-1.5 text-ig-label text-ig-fg-muted shadow-lg backdrop-blur-md">
          <MapPin className="h-3.5 w-3.5 text-ig-accent" />
          {counts.visible}/{counts.total} projetos
        </span>
        {counts.critical > 0 && (
          <span
            className="ig-ops-hud-chip pointer-events-auto inline-flex items-center gap-2 rounded-full border bg-ig-panel/80 px-3 py-1.5 text-ig-label shadow-lg backdrop-blur-md"
            style={{
              borderColor: "color-mix(in oklab, var(--ig-danger) 42%, var(--ig-border-subtle))",
              color: "var(--ig-danger)",
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {counts.critical} crítico{counts.critical > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="absolute left-3 top-[4.1rem] z-40 flex max-w-[min(760px,calc(100%-1.5rem))] flex-wrap items-center gap-1.5 md:left-4 md:top-[4.35rem] md:max-w-[min(760px,calc(100%-27rem))]">
        <span className="ig-ops-hud-chip inline-flex h-8 items-center gap-1.5 rounded-full border border-ig-border-subtle bg-ig-panel/65 px-2.5 text-ig-caption text-ig-fg-muted shadow-lg backdrop-blur-md">
          <SlidersHorizontal className="h-3.5 w-3.5 text-ig-accent" />
          Filtros
        </span>
        {FILTERS.map((filter) => {
          const Icon = filter.icon;
          const active = filters[filter.key];
          const tint = filter.key === "all" ? "var(--ig-accent)" : STATUS_TOKEN[filter.key];
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => toggleFilter(filter.key)}
              aria-pressed={active}
              className="ig-ops-hud-chip inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-ig-caption shadow-lg backdrop-blur-md transition-colors"
              style={{
                borderColor: active
                  ? `color-mix(in oklab, ${tint} 48%, var(--ig-border-subtle))`
                  : "var(--ig-border-subtle)",
                background: active
                  ? `color-mix(in oklab, ${tint} 15%, var(--ig-panel))`
                  : "color-mix(in oklab, var(--ig-panel) 68%, transparent)",
                color: active ? tint : "var(--ig-fg-muted)",
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {filter.label}
            </button>
          );
        })}
        {photoTilesActive && (
          <button
            type="button"
            onClick={toggleBuildings3D}
            aria-pressed={buildings3DVisible}
            title={buildings3DVisible ? "Ocultar prédios 3D" : "Exibir prédios 3D"}
            className="ig-ops-hud-chip inline-flex h-8 items-center gap-1.5 rounded-full border border-ig-border-subtle bg-ig-panel/65 px-2.5 text-ig-caption text-ig-fg-muted shadow-lg backdrop-blur-md transition-colors hover:text-ig-fg-strong"
          >
            <Building2 className="h-3.5 w-3.5 text-ig-accent" />
            {buildings3DVisible ? "3D on" : "3D off"}
          </button>
        )}
        <button
          type="button"
          onClick={handleReset}
          className="ig-ops-hud-chip inline-flex h-8 items-center gap-1.5 rounded-full border border-ig-border-subtle bg-ig-panel/65 px-2.5 text-ig-caption text-ig-fg-muted shadow-lg backdrop-blur-md transition-colors hover:text-ig-fg-strong"
        >
          <RotateCcw className="h-3.5 w-3.5 text-ig-accent" />
          Voltar para Brasil
        </button>
      </div>

      <div className="ig-ops-hud-surface absolute bottom-3 left-3 z-30 hidden flex-col gap-1 rounded-lg border border-ig-border-subtle bg-ig-panel/70 px-3 py-2 shadow-xl backdrop-blur-md md:bottom-4 md:left-4 md:flex">
        <span className="mb-1 text-ig-caption text-ig-fg-muted">Status dos marcadores</span>
        {(Object.keys(STATUS_TOKEN) as OperationsProjectStatus[]).map((status) => (
          <span key={status} className="flex items-center gap-2 text-ig-caption text-ig-fg-muted">
            <span
              className="h-3 w-3"
              style={{
                clipPath: "polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0 50%)",
                background: STATUS_TOKEN[status],
                boxShadow: `0 0 0 3px color-mix(in oklab, ${STATUS_TOKEN[status]} 18%, transparent), 0 0 16px ${STATUS_TOKEN[status]}`,
              }}
            />
            {getOperationsStatusLabel(status)}
          </span>
        ))}
      </div>

      <div className="ig-ops-hud-chip absolute bottom-3 right-3 z-30 hidden items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/70 px-3 py-1.5 text-ig-caption text-ig-fg-muted shadow-xl backdrop-blur-md md:bottom-4 md:right-4 md:flex">
        <Target className="h-3.5 w-3.5 text-ig-accent" />
        Foco inicial: Brasil • sync {projects[0] ? formatLastSync(projects[0].lastUpdate) : "agora"}
      </div>

      {tooltip && (
        <div
          className="ig-ops-hud-surface pointer-events-none absolute z-50 w-[260px] rounded-xl border border-ig-border-subtle bg-ig-panel/90 p-3 text-left shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.min(tooltip.x + 16, Math.max(16, (containerRef.current?.clientWidth || 320) - 276)),
            top: Math.min(tooltip.y + 16, Math.max(16, (containerRef.current?.clientHeight || 260) - 176)),
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-ig-label text-ig-fg-strong">{tooltip.project.name}</p>
              <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{tooltip.project.locationLabel}</p>
            </div>
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{
                background: `color-mix(in oklab, ${STATUS_TOKEN[tooltip.project.status]} 16%, transparent)`,
                color: STATUS_TOKEN[tooltip.project.status],
              }}
            >
              {getOperationsStatusLabel(tooltip.project.status)}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-ig-caption">
            <span className="text-ig-fg-muted">Progresso</span>
            <span className="text-right font-semibold text-ig-fg-strong">{tooltip.project.progress}%</span>
            <span className="text-ig-fg-muted">Área/cliente</span>
            <span className="truncate text-right font-semibold text-ig-fg-strong">{tooltip.project.client}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ig-panel">
            <div
              className="h-full rounded-full"
              style={{
                width: `${tooltip.project.progress}%`,
                background: STATUS_TOKEN[tooltip.project.status],
              }}
            />
          </div>
        </div>
      )}

      {bootOverlayVisible && !loadError && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-ig-panel/72 backdrop-blur-md transition-opacity duration-500"
          style={{ opacity: ready ? 0 : 1 }}
        >
          <div className="ig-ops-hud-surface rounded-2xl border border-ig-border-subtle/70 bg-ig-panel/85 px-5 py-4 text-center shadow-2xl backdrop-blur-2xl">
            <Radar className="mx-auto h-5 w-5 animate-pulse text-ig-accent" />
            <p className="mt-2 text-ig-label text-ig-fg-strong">Sincronizando cena orbital</p>
            <p className="mt-1 text-ig-caption text-ig-fg-muted">Carregando imagem, terreno e marcadores hexagonais</p>
          </div>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ig-panel/75 p-6 backdrop-blur">
          <div className="ig-ops-hud-surface max-w-md rounded-xl border border-ig-border-subtle bg-ig-panel/95 p-4 text-center">
            <AlertTriangle className="mx-auto h-5 w-5" style={{ color: "var(--ig-danger)" }} />
            <p className="mt-2 text-ig-label text-ig-fg-strong">Falha ao carregar Cesium</p>
            <p className="mt-1 text-ig-caption text-ig-fg-muted">{loadError}</p>
          </div>
        </div>
      )}

      {selectedProjectId && (
        <button
          type="button"
          onClick={() => {
            const project = projects.find((item) => item.id === selectedProjectId);
            if (project) flyToProject(project, true);
          }}
          className="ig-ops-hud-chip absolute bottom-16 right-3 z-30 hidden items-center gap-2 rounded-full border px-3 py-2 text-ig-label shadow-xl backdrop-blur-md md:right-[27rem] md:flex xl:right-[29rem]"
          style={{
            borderColor: "color-mix(in oklab, var(--ig-accent) 42%, var(--ig-border-subtle))",
            background: "color-mix(in oklab, var(--ig-accent) 14%, var(--ig-panel))",
            color: "var(--ig-accent)",
          }}
        >
          <Navigation className="h-3.5 w-3.5" />
          Aproximar marcador
        </button>
      )}
    </div>
  );
}

export default CesiumOperationsMap;
