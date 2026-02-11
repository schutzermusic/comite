"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { Map } from "react-map-gl/maplibre";
import type { MapViewState, PickingInfo } from "@deck.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * HUD map for Insight Energy - Operational Presence
 * - Subtle state-centric points instead of blocky shapes
 * - Glow + pulse ring to convey "energized maintenance"
 * - Tooltip controlled to avoid "stuck hover" bugs
 */

type RiskLevel = "active" | "at_risk" | "critical";

type StateOps = {
  uf: string;
  name: string;
  // Money in BRL
  contractsValue: number;   // valor total em contratos
  toBillValue: number;      // valor total a faturar
  contractsCount: number;
  risk: RiskLevel;
  completionPct: number;    // 0..100
};

const STATE_CENTROIDS: Record<string, { lng: number; lat: number }> = {
  PA: { lng: -48.5039, lat: -1.4558 },   // Belém
  SC: { lng: -48.5482, lat: -27.5949 },  // Florianópolis
  MG: { lng: -43.9386, lat: -19.9191 },  // Belo Horizonte
  RJ: { lng: -43.1729, lat: -22.9068 },  // Rio de Janeiro
  RS: { lng: -51.2300, lat: -30.0346 },  // Porto Alegre
  PR: { lng: -49.2733, lat: -25.4284 },  // Curitiba
  MA: { lng: -44.3028, lat: -2.5307 },   // São Luís
  SP: { lng: -46.6333, lat: -23.5505 },  // São Paulo
};

// Dataset inicial baseado no que aparece na sua foto.
// Ajuste valores conforme sua planilha real quando conectar API.
const INITIAL_DATA: StateOps[] = [
  { uf: "PA", name: "Pará", contractsValue: 31196749.41 + 1368159.75 + 4965143.38 + 2085276.19, toBillValue: 22587452.58 + 971514.75 + 4136704.04 + 0, contractsCount: 4 + 1 + 1 + 3, risk: "active", completionPct: 62 },
  { uf: "SC", name: "Santa Catarina", contractsValue: 665800 + 2432365.73, toBillValue: 479376 + 0, contractsCount: 1 + 1, risk: "active", completionPct: 70 },
  { uf: "MG", name: "Minas Gerais", contractsValue: 48947600.14 + 198827691.78 + 1053612 + 2371635.72 + 3563986.93, toBillValue: 40557869.08 + 188474062 + 297435.6 + 350000 + 0, contractsCount: 6 + 1 + 3 + 2 + 1, risk: "at_risk", completionPct: 55 },
  { uf: "RJ", name: "Rio de Janeiro", contractsValue: 194131396.52 + 379220.83, toBillValue: 174654475.54 + 379220.83, contractsCount: 5 + 1, risk: "at_risk", completionPct: 48 },
  { uf: "RS", name: "Rio Grande do Sul", contractsValue: 2755977.06 + 1705451.21, toBillValue: 107276.22 + 714957.11, contractsCount: 7 + 2, risk: "active", completionPct: 66 },
  { uf: "PR", name: "Paraná", contractsValue: 137944.8 + 950000, toBillValue: 137944.8 + 950000, contractsCount: 1 + 1, risk: "active", completionPct: 72 },
  { uf: "MA", name: "Maranhão", contractsValue: 21017204.25, toBillValue: 3552200, contractsCount: 4, risk: "critical", completionPct: 34 },
  { uf: "SP", name: "São Paulo", contractsValue: 411525, toBillValue: 0, contractsCount: 1, risk: "active", completionPct: 80 },
];

function formatBRLShort(value: number) {
  if (!Number.isFinite(value)) return "R$ 0";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `R$ ${(value / 1e9).toFixed(1)} bi`;
  if (abs >= 1e6) return `R$ ${(value / 1e6).toFixed(1)} mi`;
  if (abs >= 1e3) return `R$ ${(value / 1e3).toFixed(1)} mil`;
  return `R$ ${value.toFixed(0)}`;
}

function riskColor(risk: RiskLevel) {
  // RGB
  switch (risk) {
    case "critical": return [255, 80, 90];
    case "at_risk": return [255, 170, 60];
    default: return [0, 220, 160];
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export default function OperationalPresenceMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [hovered, setHovered] = useState<StateOps | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  // simple animation clock for pulse rings
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 100000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const data = useMemo(() => {
    return INITIAL_DATA
      .map((d) => ({
        ...d,
        position: STATE_CENTROIDS[d.uf] ?? { lng: -47.9, lat: -15.8 }, // fallback Brasília-ish
      }));
  }, []);

  const maxToBill = useMemo(
    () => Math.max(...data.map((d) => d.toBillValue || 0), 1),
    [data]
  );

  const initialViewState: MapViewState = {
    longitude: -52.5,
    latitude: -14.5,
    zoom: 3.6,
    minZoom: 3,
    maxZoom: 8,
    pitch: 35,
    bearing: -8,
  };

  const layers = useMemo(() => {
    // Base point size scaled by "toBillValue"
    const basePointLayer = new ScatterplotLayer<any>({
      id: "state-points",
      data,
      pickable: true,
      autoHighlight: false,
      getPosition: (d) => [d.position.lng, d.position.lat],
      getRadius: (d) => {
        // radius in meters
        const norm = Math.min((d.toBillValue || 0) / maxToBill, 1);
        return lerp(18000, 52000, Math.sqrt(norm));
      },
      radiusUnits: "meters",
      getFillColor: (d) => {
        const c = riskColor(d.risk);
        // slightly soften fill to let glow do the premium job
        return [c[0], c[1], c[2], 160];
      },
      getLineColor: (d) => {
        const c = riskColor(d.risk);
        return [c[0], c[1], c[2], 220];
      },
      lineWidthUnits: "pixels",
      getLineWidth: 1.6,
      updateTriggers: {
        getRadius: [maxToBill],
      },
      onHover: (info: PickingInfo) => {
        if (info?.object) {
          setHovered(info.object as StateOps);
          if (info.x != null && info.y != null) setMouse({ x: info.x, y: info.y });
        } else {
          setHovered(null);
          setMouse(null);
        }
      },
    });

    // Pulse ring layer: same positions, animated radius
    const pulseLayer = new ScatterplotLayer<any>({
      id: "state-pulse",
      data,
      pickable: false,
      getPosition: (d) => [d.position.lng, d.position.lat],
      getRadius: (d) => {
        const norm = Math.min((d.toBillValue || 0) / maxToBill, 1);
        const base = lerp(24000, 62000, Math.sqrt(norm));
        // pulse phase per state to avoid synchronized blinking
        const seed = d.uf.charCodeAt(0) + d.uf.charCodeAt(1);
        const phase = ((tick + seed * 37) % 240) / 240;
        const pulse = 1 + phase * 0.55;
        return base * pulse;
      },
      radiusUnits: "meters",
      stroked: true,
      filled: false,
      getLineColor: (d) => {
        const c = riskColor(d.risk);
        const seed = d.uf.charCodeAt(0) + d.uf.charCodeAt(1);
        const phase = ((tick + seed * 37) % 240) / 240;
        const alpha = Math.floor(lerp(0, 140, 1 - phase));
        return [c[0], c[1], c[2], alpha];
      },
      lineWidthUnits: "pixels",
      getLineWidth: 2.2,
      updateTriggers: {
        getRadius: [tick, maxToBill],
        getLineColor: [tick],
      },
    });

    // Minimal HUD labels
    const labelLayer = new TextLayer<any>({
      id: "state-labels",
      data,
      pickable: false,
      getPosition: (d) => [d.position.lng, d.position.lat],
      getText: (d) => `${d.uf}\n${formatBRLShort(d.toBillValue)}`,
      getSize: 12,
      sizeUnits: "pixels",
      getColor: (d) => {
        const c = riskColor(d.risk);
        return [c[0], c[1], c[2], 220];
      },
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      background: false,
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, sans-serif",
    });

    return [pulseLayer, basePointLayer, labelLayer];
  }, [data, maxToBill, tick]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[320px] rounded-2xl overflow-hidden"
      style={{
        background:
          "radial-gradient(1200px 600px at 20% 20%, rgba(0,255,180,0.12), transparent 55%)," +
          "radial-gradient(900px 500px at 80% 70%, rgba(0,180,255,0.10), transparent 60%)," +
          "linear-gradient(135deg, rgba(4,12,10,1), rgba(5,20,16,1) 40%, rgba(2,10,8,1))",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow:
          "inset 0 0 0 1px rgba(0,255,180,0.04), 0 0 24px rgba(0,255,180,0.08)",
      }}
    >
      {/* Subtle grid overlay to feel "control room", but not quadriculado pesado */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "36px 36px, 36px 36px",
          maskImage:
            "radial-gradient(circle at 50% 40%, black 35%, transparent 70%)",
        }}
      />

      {/* Title */}
      <div className="absolute z-10 left-4 top-3 flex items-center gap-2">
        <div
          className="h-2.5 w-2.5 rounded-full"
          style={{
            background: "rgba(0,255,180,0.9)",
            boxShadow: "0 0 10px rgba(0,255,180,0.9)",
          }}
        />
        <span className="text-xs tracking-widest uppercase text-white/70">
          Presença Operacional • Intensidade por Estado
        </span>
      </div>

      <DeckGL
        layers={layers}
        initialViewState={initialViewState}
        controller={{
          dragPan: true,
          dragRotate: true,
          scrollZoom: true,
          touchZoom: true,
          touchRotate: true,
        }}
      >
        <Map
          reuseMaps
          // Use a dark basemap that lets your HUD glow stand out.
          // You can swap to your own MapLibre style later.
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          attributionControl
        />
      </DeckGL>

      {/* Tooltip HUD */}
      {hovered && mouse && (
        <div
          className="absolute z-20 min-w-[220px] rounded-xl px-3 py-2 backdrop-blur-md"
          style={{
            left: mouse.x + 12,
            top: mouse.y + 12,
            background:
              "linear-gradient(135deg, rgba(3,25,20,0.92), rgba(2,14,12,0.92))",
            border: "1px solid rgba(0,255,180,0.18)",
            boxShadow:
              "0 0 18px rgba(0,255,180,0.18), inset 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-white">
              {hovered.name} <span className="text-white/50">({hovered.uf})</span>
            </div>
            <span
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{
                color:
                  hovered.risk === "critical"
                    ? "rgb(255,120,130)"
                    : hovered.risk === "at_risk"
                    ? "rgb(255,190,90)"
                    : "rgb(120,255,210)",
                background:
                  hovered.risk === "critical"
                    ? "rgba(255,80,90,0.12)"
                    : hovered.risk === "at_risk"
                    ? "rgba(255,170,60,0.12)"
                    : "rgba(0,220,160,0.12)",
                border:
                  hovered.risk === "critical"
                    ? "1px solid rgba(255,80,90,0.25)"
                    : hovered.risk === "at_risk"
                    ? "1px solid rgba(255,170,60,0.25)"
                    : "1px solid rgba(0,220,160,0.25)",
              }}
            >
              {hovered.risk === "critical"
                ? "Crítico"
                : hovered.risk === "at_risk"
                ? "Em risco"
                : "Ativo"}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div className="text-white/60">Total contratos</div>
            <div className="text-white text-right">
              {formatBRLShort(hovered.contractsValue)}
            </div>

            <div className="text-white/60">A faturar</div>
            <div className="text-white text-right">
              {formatBRLShort(hovered.toBillValue)}
            </div>

            <div className="text-white/60">Qtd. contratos</div>
            <div className="text-white text-right">
              {hovered.contractsCount}
            </div>

            <div className="text-white/60">Conclusão</div>
            <div className="text-white text-right">
              {hovered.completionPct}%
            </div>
          </div>

          {/* Mini progress bar */}
          <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${hovered.completionPct}%`,
                background:
                  "linear-gradient(90deg, rgba(0,255,180,0.9), rgba(0,180,255,0.9))",
                boxShadow: "0 0 10px rgba(0,255,180,0.7)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
