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
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

type HotspotStatus = "active" | "attention" | "critical" | "completed";
type HotspotType = "projeto" | "servico" | "equipe";

type Hotspot = {
  id: string;
  name: string;
  city: string;
  uf: string;
  lng: number;
  lat: number;
  status: HotspotStatus;
  type: HotspotType;
  lastUpdate: string;
};

const HOTSPOTS: Hotspot[] = [
  { id: "sp-01", name: "Subestação Pirituba", city: "São Paulo", uf: "SP", lng: -46.7167, lat: -23.4856, status: "active", type: "projeto", lastUpdate: "Hoje 09:12" },
  { id: "rj-01", name: "Terminal Portuário Açu", city: "São João da Barra", uf: "RJ", lng: -41.0125, lat: -21.8358, status: "attention", type: "servico", lastUpdate: "Hoje 08:47" },
  { id: "mg-01", name: "Mineração Itabira", city: "Itabira", uf: "MG", lng: -43.2278, lat: -19.6181, status: "active", type: "projeto", lastUpdate: "Hoje 07:55" },
  { id: "ba-01", name: "Polo Camaçari", city: "Camaçari", uf: "BA", lng: -38.3239, lat: -12.6975, status: "critical", type: "servico", lastUpdate: "Hoje 06:31" },
  { id: "pe-01", name: "Suape Energia", city: "Ipojuca", uf: "PE", lng: -34.9608, lat: -8.4036, status: "attention", type: "projeto", lastUpdate: "Ontem 22:10" },
  { id: "pa-01", name: "Frente Norte Carajás", city: "Parauapebas", uf: "PA", lng: -49.9472, lat: -6.0717, status: "active", type: "equipe", lastUpdate: "Hoje 05:48" },
  { id: "rs-01", name: "Eólica Campo Sul", city: "Santa Vitória do Palmar", uf: "RS", lng: -53.3508, lat: -33.5239, status: "completed", type: "projeto", lastUpdate: "Há 2 dias" },
  { id: "go-01", name: "Distribuição Centro-Oeste", city: "Goiânia", uf: "GO", lng: -49.2532, lat: -16.6869, status: "active", type: "servico", lastUpdate: "Hoje 09:01" },
  { id: "am-01", name: "Operação Amazônia", city: "Manaus", uf: "AM", lng: -60.0212, lat: -3.1019, status: "attention", type: "equipe", lastUpdate: "Hoje 04:22" },
  { id: "ce-01", name: "Pecém Logística", city: "São Gonçalo do Amarante", uf: "CE", lng: -38.8506, lat: -3.5503, status: "completed", type: "servico", lastUpdate: "Há 3 dias" },
  { id: "pr-01", name: "Itaipu Manutenção", city: "Foz do Iguaçu", uf: "PR", lng: -54.5897, lat: -25.5083, status: "active", type: "projeto", lastUpdate: "Hoje 08:05" },
  { id: "mt-01", name: "Corredor Norte BR-163", city: "Sinop", uf: "MT", lng: -55.5028, lat: -11.8643, status: "critical", type: "equipe", lastUpdate: "Hoje 03:14" },
];

const STATUS_LABEL: Record<HotspotStatus, string> = {
  active: "Ativo",
  attention: "Atenção",
  critical: "Crítico",
  completed: "Concluído",
};

const STATUS_TOKEN: Record<HotspotStatus, string> = {
  active: "var(--ig-success)",
  attention: "var(--ig-warning)",
  critical: "var(--ig-danger)",
  completed: "var(--ig-accent)",
};

const STATUS_HEX: Record<HotspotStatus, string> = {
  active: "#22c55e",
  attention: "#f59e0b",
  critical: "#ef4444",
  completed: "#22d3ee",
};

const TYPE_LABEL: Record<HotspotType, string> = {
  projeto: "Projeto",
  servico: "Serviço",
  equipe: "Equipe",
};

const CESIUM_VERSION = "1.138.0";
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
const CESIUM_CSS = `${CESIUM_BASE}Widgets/widgets.css`;

// Bias the camera so Brazil sits in the lower-left of the canvas (the open area
// to the left of the floating glass panels on the right).
const BRAZIL_VIEW = {
  destination: { lng: -32, lat: -8, height: 11_500_000 },
  orientation: { headingDeg: 12, pitchDeg: -75 },
  duration: 1.8,
};

// Esri World Imagery: real satellite tiles, no API key required.
// This gives an immediate Google-Earth-ish realism upgrade over flat raster basemaps,
// without pulling in Cesium Ion or Google Photorealistic 3D Tiles (token-gated).
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

export function CesiumOperationsMap() {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<unknown>(null);
  const cesiumModRef = useRef<typeof import("cesium") | null>(null);
  const handlerRef = useRef<unknown>(null);
  const entitiesByIdRef = useRef<Map<string, unknown>>(new Map());
  const tilesetRef = useRef<{ show: boolean } | null>(null);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [terrainActive, setTerrainActive] = useState(false);
  const [photoTilesActive, setPhotoTilesActive] = useState(false);
  const [buildings3DVisible, setBuildings3DVisible] = useState(true);

  const counts = useMemo(() => {
    const total = HOTSPOTS.length;
    const critical = HOTSPOTS.filter((h) => h.status === "critical").length;
    return { total, critical };
  }, []);

  const flyToBrazil = useCallback(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as { camera: { flyTo: (opts: unknown) => void } } | null;
    if (!Cesium || !viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        BRAZIL_VIEW.destination.lng,
        BRAZIL_VIEW.destination.lat,
        BRAZIL_VIEW.destination.height,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(BRAZIL_VIEW.orientation.headingDeg),
        pitch: Cesium.Math.toRadians(BRAZIL_VIEW.orientation.pitchDeg),
        roll: 0,
      },
      duration: BRAZIL_VIEW.duration,
    });
  }, []);

  const handleReset = useCallback(() => {
    setSelected(null);
    flyToBrazil();
  }, [flyToBrazil]);

  const toggleBuildings3D = useCallback(() => {
    if (!tilesetRef.current) return;
    setBuildings3DVisible((prev) => {
      const next = !prev;
      tilesetRef.current!.show = next;
      return next;
    });
  }, []);

  const flyToHotspot = useCallback((h: Hotspot) => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as { camera: { flyTo: (opts: unknown) => void } } | null;
    if (!Cesium || !viewer) return;
    // Oblique "Google Earth swoop" — ~5 km altitude, pitched -35°, offset SW
    // so the marker lands in the upper third of frame as the camera tilts in.
    const heading = Cesium.Math.toRadians(35);
    const pitch = Cesium.Math.toRadians(-35);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(h.lng - 0.025, h.lat - 0.04, 5000),
      orientation: { heading, pitch, roll: 0 },
      duration: 2.0,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (typeof window === "undefined" || !containerRef.current) return;
      try {
        // CESIUM_BASE_URL must be set BEFORE the cesium module evaluates
        // any code that builds worker/asset URLs.
        (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE;
        ensureCesiumCss();

        const Cesium = await import("cesium");
        if (cancelled || !containerRef.current) return;
        cesiumModRef.current = Cesium;

        // No Ion token by default — read from env var only.
        const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        if (ionToken) {
          Cesium.Ion.defaultAccessToken = ionToken;
        }
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
          // Default to flat ellipsoid; promote to real terrain below if a token is present.
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        });

        // Optional realism upgrades — only activated when proper tokens are present.
        // Cesium World Terrain (real elevation): requires Ion token.
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
        // Google Photorealistic 3D Tiles (real 3D buildings/cities): requires Google Maps key.
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
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(
          theme === "dark" ? "#0c1418" : "#e7ecef",
        );
        // Hide the Cesium credits container (we keep attribution in our own UI).
        const credits = (viewer as unknown as {
          cesiumWidget: { creditContainer: HTMLElement };
        }).cesiumWidget.creditContainer;
        if (credits && credits.style) credits.style.display = "none";

        // Add hotspot entities
        const entities = entitiesByIdRef.current;
        entities.clear();
        HOTSPOTS.forEach((h) => {
          const color = Cesium.Color.fromCssColorString(STATUS_HEX[h.status]);
          const e = viewer.entities.add({
            id: h.id,
            name: h.name,
            position: Cesium.Cartesian3.fromDegrees(h.lng, h.lat, 0),
            point: {
              pixelSize: 10,
              color,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
              outlineWidth: 2,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
          });
          entities.set(h.id, e);
        });

        // Click handler
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((event: { position: { x: number; y: number } }) => {
          const pos = new Cesium.Cartesian2(event.position.x, event.position.y);
          const picked = viewer.scene.pick(pos);
          if (picked && picked.id && typeof picked.id.id === "string") {
            const hotspot = HOTSPOTS.find((x) => x.id === picked.id.id);
            if (hotspot) {
              setSelected(hotspot);
              // Pan to a mid-altitude oblique view first; the explicit
              // "Ir para local do serviço" button performs the city-level swoop.
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(hotspot.lng, hotspot.lat - 0.5, 90_000),
                orientation: {
                  heading: 0,
                  pitch: Cesium.Math.toRadians(-45),
                  roll: 0,
                },
                duration: 1.4,
              });
              return;
            }
          }
          setSelected(null);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        handlerRef.current = handler;

        viewerRef.current = viewer;

        // Initial framing on Brazil
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            BRAZIL_VIEW.destination.lng,
            BRAZIL_VIEW.destination.lat,
            BRAZIL_VIEW.destination.height,
          ),
          orientation: {
            heading: Cesium.Math.toRadians(BRAZIL_VIEW.orientation.headingDeg),
            pitch: Cesium.Math.toRadians(BRAZIL_VIEW.orientation.pitchDeg),
            roll: 0,
          },
        });

        if (!cancelled) setReady(true);
      } catch (err) {
        console.error("[CesiumOperationsMap] init failed", err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Falha ao carregar Cesium");
      }
    }

    init();

    return () => {
      cancelled = true;
      const handler = handlerRef.current as { destroy: () => void } | null;
      if (handler) {
        try { handler.destroy(); } catch {}
      }
      const viewer = viewerRef.current as { destroy: () => void; isDestroyed: () => boolean } | null;
      if (viewer && !viewer.isDestroyed()) {
        try { viewer.destroy(); } catch {}
      }
      viewerRef.current = null;
      handlerRef.current = null;
      entitiesByIdRef.current.clear();
    };
    // intentionally exclude `theme` — theme switch handled via setStyle equivalent below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap imagery layer when theme changes
  useEffect(() => {
    const Cesium = cesiumModRef.current;
    const viewer = viewerRef.current as
      | {
          imageryLayers: { removeAll: () => void; addImageryProvider: (p: unknown) => unknown };
          scene: {
            backgroundColor: unknown;
            globe: { baseColor: unknown };
          };
        }
      | null;
    if (!Cesium || !viewer || !ready) return;

    // Satellite imagery is the same in dark/light; only the surrounding chrome shifts tone.
    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(buildImageryProvider(Cesium));
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(
      theme === "dark" ? "#06090c" : "#cbd5da",
    );
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(
      theme === "dark" ? "#0c1418" : "#e7ecef",
    );
  }, [theme, ready]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
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

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, transparent 42%, color-mix(in oklab, var(--ig-bg-canvas) 60%, transparent) 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--ig-accent) 14%, transparent)" }}
      />

      {/* Top-left status header */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 md:left-4 md:top-4">
        <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/55 px-3 py-1.5 text-ig-label text-ig-fg-muted backdrop-blur-md">
          <Radar className="h-3.5 w-3.5 text-ig-accent" />
          Cesium Globe
          {photoTilesActive && (
            <span
              className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: "color-mix(in oklab, var(--ig-success) 22%, transparent)",
                color: "var(--ig-success)",
              }}
            >
              Photoreal 3D
            </span>
          )}
          {terrainActive && !photoTilesActive && (
            <span
              className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: "color-mix(in oklab, var(--ig-accent) 22%, transparent)",
                color: "var(--ig-accent)",
              }}
            >
              World Terrain
            </span>
          )}
          {!terrainActive && !photoTilesActive && (
            <span
              className="ml-1 rounded-full px-1.5 py-0.5 text-[10px]"
              style={{
                background: "color-mix(in oklab, var(--ig-fg-muted) 18%, transparent)",
                color: "var(--ig-fg-muted)",
              }}
            >
              Satélite
            </span>
          )}
        </span>
        <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/55 px-3 py-1.5 text-ig-label text-ig-fg-muted backdrop-blur-md">
          <MapPin className="h-3.5 w-3.5 text-ig-accent" />
          Brasil • {counts.total} pontos
        </span>
        {counts.critical > 0 && (
          <span
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border bg-ig-panel/80 px-3 py-1.5 text-ig-label backdrop-blur"
            style={{
              borderColor: "color-mix(in oklab, var(--ig-danger) 38%, var(--ig-border-subtle))",
              color: "var(--ig-danger)",
            }}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {counts.critical} crítico{counts.critical > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Top-left controls — below the status chips, avoids collision with right-side glass panels */}
      <div className="absolute left-3 top-12 z-40 flex flex-wrap items-center gap-1.5 md:left-4 md:top-14">
        {photoTilesActive && (
          <button
            type="button"
            onClick={toggleBuildings3D}
            aria-pressed={buildings3DVisible}
            title={buildings3DVisible ? "Ocultar prédios 3D" : "Exibir prédios 3D"}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-ig-label backdrop-blur-md transition-colors"
            style={{
              borderColor: buildings3DVisible
                ? "color-mix(in oklab, var(--ig-accent) 50%, var(--ig-border-subtle))"
                : "var(--ig-border-subtle)",
              background: buildings3DVisible
                ? "color-mix(in oklab, var(--ig-accent) 16%, var(--ig-panel))"
                : "color-mix(in oklab, var(--ig-panel) 55%, transparent)",
              color: buildings3DVisible ? "var(--ig-accent)" : "var(--ig-fg-muted)",
            }}
          >
            <Building2 className="h-3.5 w-3.5" />
            {buildings3DVisible ? "Prédios 3D" : "Prédios off"}
          </button>
        )}
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1.5 rounded-full border border-ig-border-subtle bg-ig-panel/55 px-3 py-1.5 text-ig-label text-ig-fg-muted backdrop-blur-md transition-colors hover:text-ig-fg-strong"
        >
          <RotateCcw className="h-3.5 w-3.5 text-ig-accent" />
          Voltar para Brasil
        </button>
      </div>

      {/* Bottom-left legend */}
      <div className="absolute bottom-3 left-3 z-10 hidden flex-col gap-1 rounded-lg border border-ig-border-subtle bg-ig-panel/55 px-3 py-2 backdrop-blur-md md:bottom-4 md:left-4 md:flex">
        <span className="mb-1 text-ig-caption text-ig-fg-muted">Legenda</span>
        {(Object.keys(STATUS_LABEL) as HotspotStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-2 text-ig-caption text-ig-fg-muted">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                background: STATUS_TOKEN[s],
                boxShadow: `0 0 0 3px color-mix(in oklab, ${STATUS_TOKEN[s]} 18%, transparent)`,
              }}
            />
            {STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {/* Bottom-right note */}
      <div className="absolute bottom-3 right-3 z-10 hidden items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/55 px-3 py-1.5 text-ig-caption text-ig-fg-muted backdrop-blur-md md:bottom-4 md:right-4 md:flex">
        <Activity className="h-3.5 w-3.5 text-ig-accent" />
        Telemetria simulada • mock data
      </div>

      {/* Selected card */}
      {selected && (
        <div className="absolute left-3 bottom-20 z-20 w-[300px] max-w-[calc(100%-1.5rem)] rounded-xl border border-ig-border-subtle/60 bg-ig-panel/65 p-4 shadow-xl backdrop-blur-xl md:left-4 md:bottom-24">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex h-2 w-2 rounded-full"
                  style={{ background: STATUS_TOKEN[selected.status] }}
                />
                <span
                  className="text-ig-caption uppercase tracking-wider"
                  style={{ color: STATUS_TOKEN[selected.status] }}
                >
                  {STATUS_LABEL[selected.status]} • {TYPE_LABEL[selected.type]}
                </span>
              </div>
              <h3 className="mt-1 truncate text-ig-label text-ig-fg-strong">{selected.name}</h3>
              <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
                {selected.city} — {selected.uf}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Fechar"
              className="rounded-md border border-ig-border-subtle bg-ig-panel/60 p-1 text-ig-fg-muted transition-colors hover:text-ig-fg-strong"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-2.5 py-2">
              <span className="block text-ig-caption text-ig-fg-muted">Tipo</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-ig-label text-ig-fg-strong">
                {selected.type === "projeto" && <Layers className="h-3.5 w-3.5 text-ig-accent" />}
                {selected.type === "servico" && <Wrench className="h-3.5 w-3.5 text-ig-accent" />}
                {selected.type === "equipe" && <Users className="h-3.5 w-3.5 text-ig-accent" />}
                {TYPE_LABEL[selected.type]}
              </span>
            </div>
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-2.5 py-2">
              <span className="block text-ig-caption text-ig-fg-muted">Status</span>
              <span
                className="mt-0.5 flex items-center gap-1.5 text-ig-label"
                style={{ color: STATUS_TOKEN[selected.status] }}
              >
                {selected.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : selected.status === "critical" ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                {STATUS_LABEL[selected.status]}
              </span>
            </div>
            <div className="col-span-2 rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-2.5 py-2">
              <span className="block text-ig-caption text-ig-fg-muted">Última atualização</span>
              <span className="mt-0.5 block text-ig-label text-ig-fg-strong">
                {selected.lastUpdate}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => flyToHotspot(selected)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-ig-label transition-colors"
            style={{
              borderColor: "color-mix(in oklab, var(--ig-accent) 45%, var(--ig-border-subtle))",
              background: "color-mix(in oklab, var(--ig-accent) 14%, var(--ig-panel))",
              color: "var(--ig-accent)",
            }}
          >
            <Navigation className="h-3.5 w-3.5" />
            Ir para local do serviço
          </button>
        </div>
      )}

      {!ready && !loadError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ig-panel/60 backdrop-blur">
          <span className="inline-flex items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/80 px-3 py-1.5 text-ig-label text-ig-fg-muted">
            <Radar className="h-3.5 w-3.5 animate-pulse text-ig-accent" />
            Carregando globo Cesium…
          </span>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ig-panel/70 p-6 backdrop-blur">
          <div className="max-w-md rounded-xl border border-ig-border-subtle bg-ig-panel/90 p-4 text-center">
            <AlertTriangle
              className="mx-auto h-5 w-5"
              style={{ color: "var(--ig-danger)" }}
            />
            <p className="mt-2 text-ig-label text-ig-fg-strong">Falha ao carregar Cesium</p>
            <p className="mt-1 text-ig-caption text-ig-fg-muted">{loadError}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default CesiumOperationsMap;
