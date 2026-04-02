'use client';

import { useMemo, useCallback, type ReactNode } from 'react';
import type { GlobeProjectRecord } from '@/data/geo/globe-kpi-data';

interface HubPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface FlowArcDatum {
  source: HubPoint;
  target: GlobeProjectRecord;
  intensity: number;
}

export interface FlowArcLayerConfig {
  arcsData: FlowArcDatum[];
  arcStartLat: (arc: FlowArcDatum) => number;
  arcStartLng: (arc: FlowArcDatum) => number;
  arcEndLat: (arc: FlowArcDatum) => number;
  arcEndLng: (arc: FlowArcDatum) => number;
  arcColor: (arc: FlowArcDatum) => string[];
  arcAltitude: (arc: FlowArcDatum) => number;
  arcStroke: (arc: FlowArcDatum) => number;
  arcDashLength: (arc: FlowArcDatum) => number;
  arcDashGap: (arc: FlowArcDatum) => number;
  arcDashInitialGap: (arc: FlowArcDatum) => number;
  arcDashAnimateTime: (arc: FlowArcDatum) => number;
}

interface FlowArcLayerProps {
  mode: 'executivo' | 'operacional';
  projects: GlobeProjectRecord[];
  selectedUF: string | null;
  lowPerfMode: boolean;
  children: (config: FlowArcLayerConfig) => ReactNode;
}

const HUBS: HubPoint[] = [
  { id: 'hub-sp', name: 'São Paulo Hub', lat: -23.5505, lng: -46.6333 },
  { id: 'hub-df', name: 'Brasília Hub', lat: -15.7939, lng: -47.8828 },
  { id: 'hub-pe', name: 'Recife Hub', lat: -8.0476, lng: -34.877 },
];

function pickHubForProject(project: GlobeProjectRecord): HubPoint {
  if (project.stateUF === 'PE' || project.stateUF === 'BA' || project.stateUF === 'CE') {
    return HUBS[2];
  }
  if (project.stateUF === 'DF' || project.stateUF === 'GO' || project.stateUF === 'MT') {
    return HUBS[1];
  }
  return HUBS[0];
}

function stableGapFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash % 10) * 0.12;
}

export function FlowArcLayer({
  mode,
  projects,
  selectedUF,
  lowPerfMode,
  children,
}: FlowArcLayerProps) {
  const arcsData = useMemo<FlowArcDatum[]>(() => {
    if (mode !== 'operacional') return [];

    const scoped = selectedUF
      ? projects.filter((project) => project.stateUF === selectedUF)
      : projects;
    const withSignals = scoped.filter((project) => project.hasOperationalSignal);
    if (withSignals.length === 0) return [];

    const limited = withSignals
      .slice()
      .sort((a, b) => b.contractTotal - a.contractTotal)
      .slice(0, lowPerfMode ? 8 : 16);

    return limited.map((project, index) => ({
      source: pickHubForProject(project),
      target: project,
      intensity: Math.max(0.2, Math.min(1, project.contractTotal / 30_000_000 + index * 0.01)),
    }));
  }, [lowPerfMode, mode, projects, selectedUF]);

  const arcColor = useCallback((arc: FlowArcDatum) => {
    const alpha = (0.03 + arc.intensity * 0.05).toFixed(3);
    return [`rgba(56,189,248,${alpha})`, `rgba(16,185,129,${alpha})`];
  }, []);

  const config: FlowArcLayerConfig = {
    arcsData,
    arcStartLat: (arc) => arc.source.lat,
    arcStartLng: (arc) => arc.source.lng,
    arcEndLat: (arc) => arc.target.lat,
    arcEndLng: (arc) => arc.target.lon,
    arcColor,
    arcAltitude: (arc) => 0.05 + arc.intensity * 0.11,
    arcStroke: () => 0.17,
    arcDashLength: () => 0.28,
    arcDashGap: () => 3.4,
    arcDashInitialGap: (arc) => stableGapFromId(arc.target.id),
    arcDashAnimateTime: () => 3600,
  };

  return <>{children(config)}</>;
}
