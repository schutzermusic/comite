'use client';

// BrazilEnergyHudMap.tsx
// Senior-level, production-ready-ish HUD-style Brazil map for an energy maintenance governance dashboard.
// Tech: React + TypeScript + deck.gl + MapLibre

'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import DeckGL, { PickingInfo, ViewState } from "@deck.gl/react";
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import type { FeatureCollection, Feature } from "geojson";
import { brStates } from "@/data/geo/br-states";
import 'maplibre-gl/dist/maplibre-gl.css';

// -----------------------------
// Types
// -----------------------------
type StateStatus = "active" | "risk" | "stable" | "completed" | "inactive";

type StateProjectMetrics = {
  uf: string;                 // "SP", "RJ"...
  status: StateStatus;
  portfolioValueMi: number;   // value in millions
  riskScore: number;          // 0-100
  completionPct: number;      // 0-100
  activeMaintenances: number; // count
};

// -----------------------------
// Mock metrics (replace with API data)
// -----------------------------
const STATE_METRICS: StateProjectMetrics[] = [
  { uf: "SP", status: "active", portfolioValueMi: 82, riskScore: 22, completionPct: 68, activeMaintenances: 12 },
  { uf: "RJ", status: "risk", portfolioValueMi: 35, riskScore: 71, completionPct: 41, activeMaintenances: 6 },
  { uf: "MG", status: "active", portfolioValueMi: 46, riskScore: 38, completionPct: 57, activeMaintenances: 8 },
  { uf: "BA", status: "stable", portfolioValueMi: 21, riskScore: 26, completionPct: 74, activeMaintenances: 4 },
  { uf: "PR", status: "active", portfolioValueMi: 18, riskScore: 33, completionPct: 62, activeMaintenances: 3 },
  { uf: "RS", status: "stable", portfolioValueMi: 16, riskScore: 29, completionPct: 77, activeMaintenances: 2 },
  { uf: "PE", status: "risk", portfolioValueMi: 12, riskScore: 64, completionPct: 49, activeMaintenances: 2 },
  { uf: "AM", status: "active", portfolioValueMi: 9, riskScore: 44, completionPct: 55, activeMaintenances: 1 },
  { uf: "SC", status: "active", portfolioValueMi: 14, riskScore: 31, completionPct: 65, activeMaintenances: 3 },
  { uf: "GO", status: "stable", portfolioValueMi: 11, riskScore: 28, completionPct: 72, activeMaintenances: 2 },
  { uf: "CE", status: "completed", portfolioValueMi: 8, riskScore: 15, completionPct: 95, activeMaintenances: 1 },
  { uf: "DF", status: "active", portfolioValueMi: 15, riskScore: 35, completionPct: 58, activeMaintenances: 4 },
  { uf: "ES", status: "stable", portfolioValueMi: 7, riskScore: 24, completionPct: 78, activeMaintenances: 1 },
  { uf: "PB", status: "active", portfolioValueMi: 6, riskScore: 32, completionPct: 61, activeMaintenances: 1 },
  { uf: "RN", status: "stable", portfolioValueMi: 5, riskScore: 27, completionPct: 75, activeMaintenances: 1 },
];

// Quick lookup
const metricsByUF = Object.fromEntries(STATE_METRICS.map(m => [m.uf, m]));

// -----------------------------
// View helpers
// -----------------------------
const BRAZIL_VIEW: Partial<ViewState> = {
  longitude: -52.5,
  latitude: -14.5,
  zoom: 3.35,
  pitch: 35,
  bearing: -8,
};

// Minimal, token-free basemap style (Carto Positron Dark-like is usually okay)
const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// -----------------------------
// Color system (HUD green + risk amber/red)
// Returns [r,g,b,a]
// -----------------------------
const HUD = {
  green: [0, 255, 180] as const,
  teal: [0, 200, 255] as const,
  amber: [255, 180, 0] as const,
  red: [255, 80, 90] as const,
  gray: [90, 110, 105] as const,
  ink: [10, 14, 16] as const,
};

// Base fill by status
function statusFill(status: StateStatus, pulse = 0): [number, number, number, number] {
  switch (status) {
    case "active":
      return [0, 220, 160, 95 + pulse];
    case "risk":
      return [255, 140, 0, 90 + pulse];
    case "stable":
      return [0, 170, 120, 70];
    case "completed":
      return [0, 140, 200, 65];
    case "inactive":
    default:
      return [70, 85, 80, 45];
  }
}

// Outline glow by status
function statusLine(status: StateStatus, pulse = 0): [number, number, number, number] {
  switch (status) {
    case "active":
      return [0, 255, 190, 140 + pulse];
    case "risk":
      return [255, 120, 0, 150 + pulse];
    case "stable":
      return [0, 210, 150, 90];
    case "completed":
      return [0, 185, 255, 80];
    case "inactive":
    default:
      return [90, 110, 105, 60];
  }
}

// Risk dot color
function riskDotColor(riskScore: number): [number, number, number, number] {
  if (riskScore >= 70) return [HUD.red[0], HUD.red[1], HUD.red[2], 200];
  if (riskScore >= 50) return [HUD.amber[0], HUD.amber[1], HUD.amber[2], 190];
  return [HUD.green[0], HUD.green[1], HUD.green[2], 180];
}

// -----------------------------
// Geo helpers
// -----------------------------
function getUF(feature: Feature): string | undefined {
  const p: any = feature.properties || {};
  return p.UF || p.sigla || p.SIGLA || p.uf;
}

// Basic centroid (works okay for HUD labels)
function roughCentroid(feature: Feature): [number, number] | null {
  const geom: any = feature.geometry;
  if (!geom) return null;

  // Handle Polygon / MultiPolygon
  const coords = geom.type === "Polygon"
    ? [geom.coordinates]
    : geom.type === "MultiPolygon"
      ? geom.coordinates
      : null;

  if (!coords) return null;

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const poly of coords) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  if (!isFinite(minLng)) return null;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

// -----------------------------
// Tiny hook for smooth pulse
// -----------------------------
function usePulse() {
  const [t, setT] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef<number | null>(null);

  useEffect(() => {
    const loop = (ts: number) => {
      if (start.current == null) start.current = ts;
      const elapsed = (ts - start.current) / 1000;
      setT(elapsed);
      raf.current = requestAnimationFrame(loop);
    };

    raf.current = requestAnimationFrame(loop);

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  // 0..1..0 wave
  const wave = (speed = 1) => (Math.sin(t * speed * Math.PI * 2) + 1) / 2;

  return { t, wave };
}

// -----------------------------
// Component
// -----------------------------
export default function BrazilEnergyHudMap() {
  const { wave } = usePulse();
  const pulseA = Math.floor(wave(0.35) * 40); // subtle alpha pulse
  const pulseB = Math.floor(wave(0.22) * 25);
  const [hoverInfo, setHoverInfo] = useState<PickingInfo<any> | null>(null);

  // Prepare label data
  const labelData = useMemo(() => {
    const fc = brStates as FeatureCollection;
    return (fc.features || [])
      .map((f) => {
        const uf = getUF(f);
        if (!uf) return null;

        const metrics = metricsByUF[uf];
        const pos = roughCentroid(f);
        if (!pos) return null;

        const value = metrics?.portfolioValueMi ?? 0;
        const risk = metrics?.riskScore ?? 0;
        const pct = metrics?.completionPct ?? 0;
        const status = metrics?.status ?? "inactive";

        return {
          uf,
          position: pos,
          status,
          value,
          risk,
          pct,
          text:
            `${uf}  •  R$ ${value.toFixed(0)}mi\n` +
            `Risco ${risk}%  •  ${pct}% concl.`,
        };
      })
      .filter(Boolean) as Array<{
        uf: string;
        position: [number, number];
        status: StateStatus;
        value: number;
        risk: number;
        pct: number;
        text: string;
      }>;
  }, []);

  const layers = useMemo(() => {
    const fc = brStates as FeatureCollection;

    const statesLayer = new GeoJsonLayer({
      id: "br-states-hud",
      data: fc,
      pickable: true,
      autoHighlight: true,
      // Fill
      getFillColor: (f: Feature) => {
        const uf = getUF(f);
        const metrics = uf ? metricsByUF[uf] : undefined;
        const status = metrics?.status ?? "inactive";
        const pulse = (status === "active" || status === "risk") ? pulseA : 0;
        return statusFill(status, pulse);
      },
      // Outline
      stroked: true,
      filled: true,
      getLineColor: (f: Feature) => {
        const uf = getUF(f);
        const metrics = uf ? metricsByUF[uf] : undefined;
        const status = metrics?.status ?? "inactive";
        const pulse = (status === "active" || status === "risk") ? pulseB : 0;
        return statusLine(status, pulse);
      },
      lineWidthMinPixels: 1,
      lineWidthMaxPixels: 3,
      getLineWidth: (f: Feature) => {
        const uf = getUF(f);
        const status = uf ? (metricsByUF[uf]?.status ?? "inactive") : "inactive";
        return status === "active" ? 2 : status === "risk" ? 2 : 1;
      },
      // Hover handler to drive tooltip
      onHover: (info) => setHoverInfo(info?.object ? info : null),
      updateTriggers: {
        getFillColor: [pulseA],
        getLineColor: [pulseB],
      },
    });

    // Optional risk dots at centroids
    const riskDots = new ScatterplotLayer({
      id: "br-risk-dots",
      data: labelData,
      pickable: true,
      autoHighlight: false,
      getPosition: (d) => d.position,
      getRadius: (d) => {
        const base = 22000;
        const bump = Math.min(18000, d.risk * 180);
        return base + bump;
      },
      radiusUnits: "meters",
      getFillColor: (d) => riskDotColor(d.risk),
      opacity: 0.18,
      onHover: (info) => setHoverInfo(info?.object ? info : null),
    });

    const labels = new TextLayer({
      id: "br-hud-labels",
      data: labelData,
      pickable: false,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 12,
      sizeUnits: "pixels",
      sizeMinPixels: 10,
      sizeMaxPixels: 16,
      getColor: (d) => {
        if (d.status === "risk") return [255, 200, 140, 210];
        if (d.status === "active") return [200, 255, 235, 220];
        return [180, 205, 198, 170];
      },
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial",
      background: true,
      getBackgroundColor: [8, 14, 13, 110],
      backgroundPadding: [6, 8],
    });

    return [statesLayer, riskDots, labels];
  }, [labelData, pulseA, pulseB]);

  // Tooltip content (hover on state or dot)
  const tooltip = useMemo(() => {
    if (!hoverInfo?.object) return null;

    // If hovered object is a labelData item
    const maybeUF = (hoverInfo.object.uf as string | undefined);
    if (maybeUF) {
      const m = metricsByUF[maybeUF];
      if (!m) return null;

      return {
        region: maybeUF,
        title: `${maybeUF} • Operação`,
        status: m.status,
        value: m.portfolioValueMi,
        risk: m.riskScore,
        pct: m.completionPct,
        maint: m.activeMaintenances,
      };
    }

    // If hovered object is a GeoJSON feature
    const uf = getUF(hoverInfo.object as Feature);
    if (!uf) return null;

    const m = metricsByUF[uf];
    return {
      region: uf,
      title: `${uf} • Estado`,
      status: m?.status ?? "inactive",
      value: m?.portfolioValueMi ?? 0,
      risk: m?.riskScore ?? 0,
      pct: m?.completionPct ?? 0,
      maint: m?.activeMaintenances ?? 0,
    };
  }, [hoverInfo]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden">
      {/* Subtle HUD overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(1200px 600px at 20% 10%, rgba(0,255,180,0.06), transparent 60%)," +
            "radial-gradient(900px 500px at 85% 25%, rgba(0,160,120,0.08), transparent 65%)," +
            "linear-gradient(180deg, rgba(0,0,0,0.15), rgba(0,0,0,0.0) 50%, rgba(0,0,0,0.25))",
          mixBlendMode: "screen",
        }}
      />

      <DeckGL
        initialViewState={BRAZIL_VIEW}
        controller={false} // dashboard mode
        layers={layers}
        getCursor={() => "default"}
      >
        <Map
          reuseMaps
          mapStyle={BASEMAP}
          attributionControl={true}
          style={{ width: "100%", height: "100%" }}
        />
      </DeckGL>

      {/* HUD tooltip */}
      {tooltip && (
        <div className="absolute left-4 top-4 z-10">
          <div
            className="rounded-xl px-4 py-3 border backdrop-blur-md"
            style={{
              background: "rgba(6, 16, 14, 0.72)",
              borderColor:
                tooltip.status === "risk"
                  ? "rgba(255,140,0,0.35)"
                  : "rgba(0,255,190,0.28)",
              boxShadow:
                tooltip.status === "risk"
                  ? "0 0 24px rgba(255,140,0,0.22), inset 0 0 12px rgba(255,140,0,0.12)"
                  : "0 0 26px rgba(0,255,190,0.22), inset 0 0 12px rgba(0,255,190,0.10)",
            }}
          >
            <div className="text-xs tracking-widest uppercase opacity-70 text-white/80">
              Presença Operacional
            </div>
            <div className="text-base font-semibold text-white">
              {tooltip.title}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-5 gap-y-1 text-sm">
              <div className="text-white/70">Status</div>
              <div className="text-white">
                {tooltip.status === "active" && "Ativo"}
                {tooltip.status === "risk" && "Em risco"}
                {tooltip.status === "stable" && "Estável"}
                {tooltip.status === "completed" && "Concluído"}
                {tooltip.status === "inactive" && "Inativo"}
              </div>
              <div className="text-white/70">Carteira</div>
              <div className="text-white">
                R$ {tooltip.value.toFixed(0)} mi
              </div>
              <div className="text-white/70">Risco</div>
              <div className="text-white">{tooltip.risk}%</div>
              <div className="text-white/70">Conclusão</div>
              <div className="text-white">{tooltip.pct}%</div>
              <div className="text-white/70">Manutenções</div>
              <div className="text-white">{tooltip.maint}</div>
            </div>
          </div>
        </div>
      )}

      {/* Optional corner micro-legend (keep minimal) */}
      <div className="absolute right-3 bottom-3 text-[10px] text-white/50">
        MapLibre © OSM contributors
      </div>
    </div>
  );
}
