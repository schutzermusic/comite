"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MlMap, type StyleSpecification } from "maplibre-gl";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Layers,
  MapPin,
  Radar,
  RotateCcw,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import "maplibre-gl/dist/maplibre-gl.css";

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

const BRAZIL_VIEW = { center: [-52.5, -14.5] as [number, number], zoom: 3.4, pitch: 28, bearing: -6 };

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

const TYPE_LABEL: Record<HotspotType, string> = {
  projeto: "Projeto",
  servico: "Serviço",
  equipe: "Equipe",
};

type FilterKey = "projetos" | "servicos" | "criticos" | "equipes";

const FILTERS: { key: FilterKey; label: string; icon: React.ComponentType<{ className?: string }>; tint: string }[] = [
  { key: "projetos", label: "Projetos", icon: Layers, tint: "var(--ig-accent)" },
  { key: "servicos", label: "Serviços", icon: Wrench, tint: "var(--ig-success)" },
  { key: "criticos", label: "Críticos", icon: AlertTriangle, tint: "var(--ig-danger)" },
  { key: "equipes", label: "Equipes", icon: Users, tint: "var(--ig-warning)" },
];

function buildStyle(theme: "dark" | "light"): StyleSpecification {
  const dark = theme === "dark";
  const land = dark ? "#0c1418" : "#e7ecef";
  const water = dark ? "#06090c" : "#cbd5da";
  const border = dark ? "#1c2a31" : "#9ca8af";
  return {
    version: 8,
    name: "ig-operations-3d",
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      "carto-basemap": {
        type: "raster",
        tiles: [
          dark
            ? "https://basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}@2x.png"
            : "https://basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors © CARTO",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": water } },
      { id: "carto", type: "raster", source: "carto-basemap", paint: { "raster-opacity": dark ? 0.78 : 0.92, "raster-contrast": dark ? 0.05 : 0, "raster-saturation": dark ? -0.25 : -0.1 } },
    ],
    // light helpers (unused but kept for reference in future)
    metadata: { "ig:land": land, "ig:border": border },
  } as StyleSpecification;
}

export function Operations3DMap() {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Hotspot | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({
    projetos: true,
    servicos: true,
    criticos: true,
    equipes: true,
  });

  const visibleHotspots = useMemo(() => {
    return HOTSPOTS.filter((h) => {
      if (h.status === "critical" && !filters.criticos) return false;
      if (h.type === "projeto" && !filters.projetos) return false;
      if (h.type === "servico" && !filters.servicos) return false;
      if (h.type === "equipe" && !filters.equipes) return false;
      return true;
    });
  }, [filters]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(theme),
      center: BRAZIL_VIEW.center,
      zoom: BRAZIL_VIEW.zoom,
      pitch: BRAZIL_VIEW.pitch,
      bearing: BRAZIL_VIEW.bearing,
      attributionControl: false,
      maxZoom: 12,
      minZoom: 2.5,
      dragRotate: true,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => setReady(true));
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setStyle(buildStyle(theme));
  }, [theme, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    visibleHotspots.forEach((h) => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `${h.name} — ${STATUS_LABEL[h.status]}`);
      el.style.cssText = `
        position: relative;
        width: 22px; height: 22px;
        border-radius: 9999px;
        border: 1.5px solid ${STATUS_TOKEN[h.status]};
        background: color-mix(in oklab, ${STATUS_TOKEN[h.status]} 22%, var(--ig-bg-raised));
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 0 4px color-mix(in oklab, ${STATUS_TOKEN[h.status]} 14%, transparent);
        transition: transform 160ms ease, box-shadow 160ms ease;
      `;
      const dot = document.createElement("span");
      dot.style.cssText = `
        width: 8px; height: 8px; border-radius: 9999px;
        background: ${STATUS_TOKEN[h.status]};
        ${h.status === "critical" || h.status === "attention" ? "animation: ig-ops3d-pulse 1.8s ease-out infinite;" : ""}
      `;
      el.appendChild(dot);
      el.addEventListener("mouseenter", () => {
        el.style.transform = "scale(1.18)";
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "scale(1)";
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(h);
        const m = mapRef.current;
        if (!m) return;
        m.easeTo({ center: [h.lng, h.lat], zoom: Math.max(m.getZoom(), 6.2), duration: 900, pitch: 38 });
      });

      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([h.lng, h.lat])
        .addTo(map);
      markersRef.current.push(marker);
    });
  }, [visibleHotspots, ready]);

  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setSelected(null);
    map.easeTo({
      center: BRAZIL_VIEW.center,
      zoom: BRAZIL_VIEW.zoom,
      pitch: BRAZIL_VIEW.pitch,
      bearing: BRAZIL_VIEW.bearing,
      duration: 900,
    });
  }, []);

  const toggleFilter = (k: FilterKey) =>
    setFilters((prev) => ({ ...prev, [k]: !prev[k] }));

  const counts = useMemo(() => {
    const total = HOTSPOTS.length;
    const critical = HOTSPOTS.filter((h) => h.status === "critical").length;
    const active = HOTSPOTS.filter((h) => h.status === "active").length;
    return { total, critical, active };
  }, []);

  return (
    <div className="relative h-[560px] w-full overflow-hidden rounded-xl border border-ig-border-subtle bg-ig-panel/45">
      <style jsx global>{`
        @keyframes ig-ops3d-pulse {
          0% { box-shadow: 0 0 0 0 color-mix(in oklab, currentColor 50%, transparent); }
          80% { box-shadow: 0 0 0 12px color-mix(in oklab, currentColor 0%, transparent); }
          100% { box-shadow: 0 0 0 0 color-mix(in oklab, currentColor 0%, transparent); }
        }
        .maplibregl-ctrl-attrib {
          background: color-mix(in oklab, var(--ig-panel) 70%, transparent) !important;
          color: var(--ig-fg-muted) !important;
          border: 1px solid var(--ig-border-subtle) !important;
          border-radius: 9999px !important;
          font-size: 10px !important;
        }
        .maplibregl-ctrl-attrib a { color: var(--ig-fg-muted) !important; }
      `}</style>

      <div ref={containerRef} className="absolute inset-0" />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 42%, transparent 38%, color-mix(in oklab, var(--ig-bg-canvas) 65%, transparent) 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 ring-1 ring-inset"
        style={{ boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--ig-accent) 12%, transparent)" }}
      />

      {/* Top-left: status header */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 md:left-4 md:top-4">
        <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/80 px-3 py-1.5 text-ig-label text-ig-fg-muted backdrop-blur">
          <Radar className="h-3.5 w-3.5 text-ig-accent" />
          Console operacional
        </span>
        <span className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/80 px-3 py-1.5 text-ig-label text-ig-fg-muted backdrop-blur">
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

      {/* Top-right: filter bar */}
      <div className="absolute right-3 top-3 z-10 flex flex-wrap items-center gap-1.5 md:right-4 md:top-4">
        {FILTERS.map((f) => {
          const Icon = f.icon;
          const active = filters[f.key];
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleFilter(f.key)}
              aria-pressed={active}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-ig-label backdrop-blur transition-colors"
              style={{
                borderColor: active
                  ? "color-mix(in oklab, " + f.tint + " 50%, var(--ig-border-subtle))"
                  : "var(--ig-border-subtle)",
                background: active
                  ? "color-mix(in oklab, " + f.tint + " 14%, var(--ig-panel))"
                  : "color-mix(in oklab, var(--ig-panel) 78%, transparent)",
                color: active ? f.tint : "var(--ig-fg-muted)",
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {f.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={resetView}
          className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-ig-border-subtle bg-ig-panel/80 px-3 py-1.5 text-ig-label text-ig-fg-muted backdrop-blur transition-colors hover:text-ig-fg-strong"
        >
          <RotateCcw className="h-3.5 w-3.5 text-ig-accent" />
          Voltar para Brasil
        </button>
      </div>

      {/* Bottom-left: legend */}
      <div className="absolute bottom-3 left-3 z-10 hidden flex-col gap-1 rounded-lg border border-ig-border-subtle bg-ig-panel/80 px-3 py-2 backdrop-blur md:left-4 md:bottom-4 md:flex">
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

      {/* Bottom-right: telemetry note */}
      <div className="absolute bottom-3 right-3 z-10 hidden items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/80 px-3 py-1.5 text-ig-caption text-ig-fg-muted backdrop-blur md:bottom-4 md:right-4 md:flex">
        <Activity className="h-3.5 w-3.5 text-ig-accent" />
        Telemetria simulada • mock data
      </div>

      {/* Selected hotspot panel */}
      {selected && (
        <div className="absolute left-3 top-16 z-20 w-[300px] max-w-[calc(100%-1.5rem)] rounded-xl border border-ig-border-subtle bg-ig-panel/92 p-4 shadow-xl backdrop-blur md:left-4 md:top-20">
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
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ig-panel/60 backdrop-blur">
          <span className="inline-flex items-center gap-2 rounded-full border border-ig-border-subtle bg-ig-panel/80 px-3 py-1.5 text-ig-label text-ig-fg-muted">
            <Radar className="h-3.5 w-3.5 animate-pulse text-ig-accent" />
            Inicializando malha operacional…
          </span>
        </div>
      )}
    </div>
  );
}

export default Operations3DMap;
