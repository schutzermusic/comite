'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DeckGL, { PickingInfo, ViewState } from '@deck.gl/react';
import { ArcLayer, GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map as MapComponent } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import { brStates } from '@/data/geo/br-states';
import 'maplibre-gl/dist/maplibre-gl.css';

type OperationalStateDatum = {
  state: string;
  uf: string;
  contractsCount: number;
  totalContracted: number;
  backlogToBill: number;
  sharePct: number;
  backlogRatio: number;
};

type HoverState = {
  x: number;
  y: number;
  data: OperationalStateDatum;
};

const OPERATIONS_DATA: OperationalStateDatum[] = [
  {
    state: 'MINAS GERAIS',
    uf: 'MG',
    contractsCount: 13,
    totalContracted: 251844926.15,
    backlogToBill: 229418697.6,
    sharePct: 48.53,
    backlogRatio: 0.911,
  },
  {
    state: 'RIO DE JANEIRO',
    uf: 'RJ',
    contractsCount: 6,
    totalContracted: 194510617.35,
    backlogToBill: 175033696.37,
    sharePct: 37.48,
    backlogRatio: 0.9,
  },
  {
    state: 'PARA',
    uf: 'PA',
    contractsCount: 9,
    totalContracted: 39615328.73,
    backlogToBill: 28175671.37,
    sharePct: 7.63,
    backlogRatio: 0.711,
  },
  {
    state: 'MARANHAO',
    uf: 'MA',
    contractsCount: 4,
    totalContracted: 21017204.25,
    backlogToBill: 3552200.0,
    sharePct: 4.05,
    backlogRatio: 0.169,
  },
  {
    state: 'RIO GRANDE DO SUL',
    uf: 'RS',
    contractsCount: 9,
    totalContracted: 4461428.27,
    backlogToBill: 822233.33,
    sharePct: 0.86,
    backlogRatio: 0.184,
  },
  {
    state: 'SANTA CATARINA',
    uf: 'SC',
    contractsCount: 2,
    totalContracted: 3098165.73,
    backlogToBill: 479376.0,
    sharePct: 0.6,
    backlogRatio: 0.155,
  },
  {
    state: 'PARANA',
    uf: 'PR',
    contractsCount: 2,
    totalContracted: 1087944.8,
    backlogToBill: 1087944.8,
    sharePct: 0.21,
    backlogRatio: 1.0,
  },
  {
    state: 'SÃO PAULO',
    uf: 'SP',
    contractsCount: 1,
    totalContracted: 411525.0,
    backlogToBill: 0.0,
    sharePct: 0.08,
    backlogRatio: 0.0,
  },
];

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const BRAZIL_VIEW: Partial<ViewState> = {
  longitude: -52.5,
  latitude: -14.5,
  zoom: 3.5,
  pitch: 35,
  bearing: -7,
};

const COLORS = {
  neoGreen: [0, 255, 180] as const,
  neoCyan: [0, 200, 255] as const,
  mutedGreen: [34, 120, 96] as const,
  slate: [5, 13, 10] as const,
};

function getUF(feature: Feature): string | undefined {
  const props: any = feature.properties || {};
  return props.UF || props.sigla || props.SIGLA || props.uf || props.Uf;
}

function lerpColor(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ];
}

function centroid(feature: Feature): [number, number] | null {
  const geom: any = feature.geometry;
  if (!geom) return null;

  const coords = geom.type === 'Polygon'
    ? [geom.coordinates]
    : geom.type === 'MultiPolygon'
      ? geom.coordinates
      : null;

  if (!coords) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

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

function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

function shareBand(sharePct: number) {
  if (sharePct >= 25) return 'high';
  if (sharePct >= 5) return 'medium';
  return 'low';
}

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

  const wave = (speed = 1, offset = 0) => (Math.sin((t + offset) * speed * Math.PI * 2) + 1) / 2;

  return { t, wave };
}

export function OperationalPresenceMap() {
  const { wave } = usePulse();
  const pulseA = wave(0.32);
  const pulseB = wave(0.48, 0.25);
  const [hover, setHover] = useState<HoverState | null>(null);

  const metricsByUF = useMemo(() => {
    const map = new Map<string, OperationalStateDatum>();
    for (const item of OPERATIONS_DATA) map.set(item.uf, item);
    return map;
  }, []);

  const stateGeo = useMemo(() => {
    const fc = brStates as FeatureCollection;
    return fc.features.map((feature) => {
      const uf = getUF(feature);
      const center = centroid(feature);
      const metrics = uf ? metricsByUF.get(uf) : undefined;
      return { feature, uf, center, metrics };
    });
  }, [metricsByUF]);

  const activeStates = useMemo(
    () => stateGeo.filter((s) => s.metrics && s.center) as Array<{
      feature: Feature;
      uf: string;
      center: [number, number];
      metrics: OperationalStateDatum;
    }>,
    [stateGeo],
  );

  const maxTotal = useMemo(
    () => Math.max(...OPERATIONS_DATA.map((d) => d.totalContracted)),
    [],
  );

  const maxBacklog = useMemo(
    () => Math.max(...OPERATIONS_DATA.map((d) => d.backlogToBill)),
    [],
  );

  const hubUF = useMemo(
    () =>
      OPERATIONS_DATA.reduce((top, curr) =>
        curr.totalContracted > top.totalContracted ? curr : top,
      ).uf,
    [],
  );

  const hubPosition = useMemo(() => {
    const hubState = activeStates.find((s) => s.uf === hubUF);
    return hubState?.center ?? [-47.88, -15.8];
  }, [activeStates, hubUF]);

  const handleHover = useCallback(
    (info: PickingInfo<any> | null) => {
      if (info?.object) {
        const uf = (info.object.uf as string) || getUF(info.object as Feature);
        const data = uf ? metricsByUF.get(uf) : undefined;
        if (data) {
          setHover({
            x: info.x ?? 0,
            y: info.y ?? 0,
            data,
          });
          return;
        }
      }
      setHover(null);
    },
    [metricsByUF],
  );

  const layers = useMemo(() => {
    const stateChoropleth = new GeoJsonLayer({
      id: 'ops-states-choropleth',
      data: brStates as FeatureCollection,
      filled: true,
      stroked: true,
      pickable: true,
      getFillColor: (f: Feature) => {
        const uf = getUF(f);
        const metrics = uf ? metricsByUF.get(uf) : undefined;
        if (!metrics) return [0, 0, 0, 0];
        const intensity = Math.pow(metrics.totalContracted / maxTotal, 0.6);
        const baseColor = lerpColor(COLORS.neoCyan, COLORS.neoGreen, intensity);
        const alpha = 0.08 + intensity * 0.1;
        return [baseColor[0], baseColor[1], baseColor[2], Math.round(alpha * 255)];
      },
      getLineColor: (f: Feature) => {
        const uf = getUF(f);
        const metrics = uf ? metricsByUF.get(uf) : undefined;
        const active = metrics?.contractsCount && metrics.contractsCount > 0;
        const alpha = active ? 110 + pulseA * 50 : 35;
        return [COLORS.neoGreen[0], COLORS.neoGreen[1], COLORS.neoGreen[2], Math.round(alpha)];
      },
      lineWidthMinPixels: 1,
      lineWidthMaxPixels: 2.6,
      getLineWidth: (f: Feature) => {
        const uf = getUF(f);
        const metrics = uf ? metricsByUF.get(uf) : undefined;
        return metrics && metrics.contractsCount > 0 ? 1.6 : 1;
      },
      autoHighlight: true,
      highlightColor: [0, 255, 180, 80],
      onHover: handleHover,
      updateTriggers: {
        getLineColor: [pulseA],
      },
    });

    const centroidHalos = new ScatterplotLayer({
      id: 'ops-centroid-halos',
      data: activeStates,
      pickable: true,
      radiusUnits: 'meters',
      getPosition: (d) => d.center,
      getRadius: (d) => {
        const log = Math.log10(d.metrics.totalContracted + 1);
        const base = 18000;
        const scale = log * 6500;
        const breathing = 4000 * (0.4 + pulseB * 0.6);
        return base + scale + breathing;
      },
      getFillColor: (d) => {
        const band = shareBand(d.metrics.sharePct);
        const base =
          band === 'high' ? COLORS.neoGreen : band === 'medium' ? COLORS.neoCyan : COLORS.mutedGreen;
        const alpha = 140 + pulseB * 80;
        return [base[0], base[1], base[2], Math.round(alpha)];
      },
      getLineColor: (d) => {
        const band = shareBand(d.metrics.sharePct);
        const base =
          band === 'high' ? COLORS.neoGreen : band === 'medium' ? COLORS.neoCyan : COLORS.mutedGreen;
        return [base[0], base[1], base[2], 210];
      },
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1,
      lineWidthMaxPixels: 2.5,
      stroked: true,
      onHover: handleHover,
      updateTriggers: {
        getRadius: [pulseB],
        getFillColor: [pulseB],
      },
    });

    const energyArcs = new ArcLayer({
      id: 'ops-energy-flux',
      data: activeStates
        .filter((d) => d.uf !== hubUF && d.metrics.backlogToBill > 0)
        .map((d) => ({
          source: hubPosition,
          target: d.center,
          backlog: d.metrics.backlogToBill,
        })),
      pickable: false,
      getSourcePosition: (d) => d.source,
      getTargetPosition: (d) => d.target,
      getSourceColor: () => [COLORS.neoCyan[0], COLORS.neoCyan[1], COLORS.neoCyan[2], 40],
      getTargetColor: () => [COLORS.neoGreen[0], COLORS.neoGreen[1], COLORS.neoGreen[2], 120],
      getWidth: (d) => {
        const norm = d.backlog / (maxBacklog || 1);
        return 1.5 + norm * 3.5;
      },
      greatCircle: true,
    });

    return [stateChoropleth, energyArcs, centroidHalos];
  }, [activeStates, handleHover, hubPosition, hubUF, maxBacklog, maxTotal, metricsByUF, pulseA, pulseB]);

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const tooltipLeft = hover ? Math.max(12, Math.min(hover.x + 18, viewportWidth - 260)) : 0;
  const tooltipTop = hover ? hover.y + 14 : 0;

  return (
    <div
      className="relative w-full h-full bg-gradient-to-br from-[#050d0a] via-[#07130e] to-[#050d0a] rounded-2xl overflow-hidden"
      onPointerLeave={() => setHover(null)}
    >
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(900px 400px at 18% 12%, rgba(0,255,180,0.08), transparent 60%),' +
            'radial-gradient(700px 350px at 82% 30%, rgba(0,200,255,0.08), transparent 62%),' +
            'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0) 35%, rgba(0,0,0,0.35))',
          mixBlendMode: 'screen',
        }}
      />

      <DeckGL
        initialViewState={BRAZIL_VIEW}
        controller={false}
        layers={layers}
        getCursor={() => 'default'}
      >
        <MapComponent
          reuseMaps
          mapLib={maplibregl}
          mapStyle={MAP_STYLE}
          attributionControl={false}
          style={{ width: '100%', height: '100%' }}
        />
      </DeckGL>

      {hover && (
        <div
          className="absolute z-10 min-w-[220px] rounded-xl border backdrop-blur-md shadow-xl"
          style={{
            left: tooltipLeft,
            top: tooltipTop,
            background: 'rgba(5, 13, 10, 0.82)',
            borderColor: 'rgba(0, 255, 180, 0.35)',
            boxShadow: '0 20px 60px rgba(0, 255, 180, 0.12)',
          }}
        >
          <div className="px-4 py-3">
            <div className="text-[11px] tracking-[0.12em] uppercase text-white/60">
              Presença Operacional
            </div>
            <div className="text-sm font-semibold text-white flex items-center gap-2">
              {hover.data.state} <span className="text-white/60">({hover.data.uf})</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-white/80">
              <div className="text-white/60">Contratos</div>
              <div className="text-white font-semibold">{hover.data.contractsCount}</div>
              <div className="text-white/60">Carteira</div>
              <div className="text-white font-semibold">{formatBRL(hover.data.totalContracted)}</div>
              <div className="text-white/60">Backlog</div>
              <div className="text-white font-semibold">{formatBRL(hover.data.backlogToBill)}</div>
              <div className="text-white/60">% Participação</div>
              <div className="text-white font-semibold">{hover.data.sharePct.toFixed(2)}%</div>
              <div className="text-white/60">Backlog Ratio</div>
              <div className="text-white font-semibold">{hover.data.backlogRatio.toFixed(2)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="absolute right-3 bottom-3 text-[10px] text-white/40">
        MapLibre • deck.gl HUD
      </div>
    </div>
  );
}

export default OperationalPresenceMap;
