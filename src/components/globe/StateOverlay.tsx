'use client';

import { useMemo, useCallback, type ReactNode } from 'react';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { StateAggregate } from '@/data/geo/globe-kpi-data';

interface BoundaryPath {
  kind: 'halo' | 'stroke';
  points: Array<{ lat: number; lng: number }>;
}

interface StateLabel {
  id: string;
  lat: number;
  lng: number;
  text: string;
  active: boolean;
  selected: boolean;
  hovered: boolean;
}

export interface StateOverlayConfig {
  polygonsData: Feature<Geometry>[];
  polygonCapColor: (feature: Feature<Geometry>) => string;
  polygonSideColor: () => string;
  polygonStrokeColor: (feature: Feature<Geometry>) => string;
  polygonAltitude: (feature: Feature<Geometry>) => number;
  polygonLabel: (feature: Feature<Geometry>) => string;
  onPolygonHover: (feature: Feature<Geometry> | null) => void;
  onPolygonClick: (feature: Feature<Geometry>) => void;
  pathsData: BoundaryPath[];
  pathPoints: (path: BoundaryPath) => Array<{ lat: number; lng: number }>;
  pathPointLat: (point: { lat: number; lng: number }) => number;
  pathPointLng: (point: { lat: number; lng: number }) => number;
  pathColor: (path: BoundaryPath) => string;
  pathStroke: (path: BoundaryPath) => number;
  pathDashLength: () => number;
  pathDashGap: () => number;
  pathDashAnimateTime: () => number;
  labelsData: StateLabel[];
  labelLat: (label: StateLabel) => number;
  labelLng: (label: StateLabel) => number;
  labelText: (label: StateLabel) => string;
  labelColor: (label: StateLabel) => string;
  labelSize: (label: StateLabel) => number;
  labelDotRadius: (label: StateLabel) => number;
}

interface StateOverlayProps {
  geojson: FeatureCollection;
  selectedUF: string | null;
  hoveredUF: string | null;
  statesByUF: Record<string, StateAggregate>;
  metric: 'revenue' | 'hh' | 'risk';
  metricIntensityByUF: Record<string, number>;
  showOnlyProjectStates?: boolean;
  onHoverUF: (uf: string | null) => void;
  onSelectUF: (uf: string) => void;
  children: (config: StateOverlayConfig) => ReactNode;
}

function getUF(feature: Feature<Geometry>): string | null {
  const props = feature.properties || {};
  const sigla = (props.sigla || props.UF || props.uf || props.SIGLA || '') as string;
  if (sigla) return sigla.toUpperCase();
  return null;
}

function formatMoney(value: number): string {
  if (value >= 1_000_000_000) return `R$ ${(value / 1_000_000_000).toFixed(1)} bi`;
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)} mi`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)} mil`;
  return `R$ ${Math.round(value)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function buildBoundaryPaths(features: Feature<Geometry>[]): BoundaryPath[] {
  const paths: BoundaryPath[] = [];

  features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return;

    if (geometry.type === 'Polygon') {
      geometry.coordinates.forEach((ring) => {
        const points = ring.map(([lng, lat]) => ({ lat, lng }));
        paths.push({ kind: 'halo', points });
        paths.push({ kind: 'stroke', points });
      });
      return;
    }

    if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach((polygon) => {
        polygon.forEach((ring) => {
          const points = ring.map(([lng, lat]) => ({ lat, lng }));
          paths.push({ kind: 'halo', points });
          paths.push({ kind: 'stroke', points });
        });
      });
    }
  });

  return paths;
}

function computeFeatureCentroid(feature: Feature<Geometry>): { lat: number; lng: number } | null {
  const geometry = feature.geometry;
  if (!geometry) return null;

  const points: Array<{ lat: number; lng: number }> = [];

  if (geometry.type === 'Polygon') {
    geometry.coordinates[0]?.forEach(([lng, lat]) => points.push({ lat, lng }));
  }

  if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach((polygon) => {
      polygon[0]?.forEach(([lng, lat]) => points.push({ lat, lng }));
    });
  }

  if (points.length === 0) return null;
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
  return { lat, lng };
}

function heatColor(intensity: number, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, intensity));
  // Corporate hydro palette: deep teal -> energy cyan (muted enterprise)
  const hue = Math.round(174 + clamped * 14);
  const sat = Math.round(48 + clamped * 18);
  const light = Math.round(36 + clamped * 14);
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}

export function StateOverlay({
  geojson,
  selectedUF,
  hoveredUF,
  statesByUF,
  metric,
  metricIntensityByUF,
  showOnlyProjectStates = false,
  onHoverUF,
  onSelectUF,
  children,
}: StateOverlayProps) {
  const polygonsData = useMemo(() => {
    const allFeatures = geojson.features as Feature<Geometry>[];
    if (!showOnlyProjectStates) return allFeatures;

    return allFeatures.filter((feature) => {
      const uf = getUF(feature);
      return !!uf && !!statesByUF[uf];
    });
  }, [geojson.features, showOnlyProjectStates, statesByUF]);
  const pathsData = useMemo(() => buildBoundaryPaths(polygonsData), [polygonsData]);
  const labelsData = useMemo<StateLabel[]>(() => {
    return polygonsData
      .map((feature) => {
        const uf = getUF(feature);
        if (!uf) return null;
        const centroid = computeFeatureCentroid(feature);
        if (!centroid) return null;
        const stateName = uf;
        return {
          id: uf,
          lat: centroid.lat,
          lng: centroid.lng,
          text: stateName,
          active: Boolean(statesByUF[uf]),
          selected: selectedUF === uf,
          hovered: hoveredUF === uf,
        } satisfies StateLabel;
      })
      .filter((label): label is StateLabel => Boolean(label));
  }, [hoveredUF, polygonsData, selectedUF, statesByUF]);

  const polygonCapColor = useCallback(
    (feature: Feature<Geometry>) => {
      const uf = getUF(feature);
      if (!uf) return 'rgba(6, 12, 16, 0.06)';

      const state = statesByUF[uf];
      if (!state) return 'rgba(6, 12, 16, 0.03)';
      const metricIntensity = metricIntensityByUF[uf] ?? state.intensity;

      // Selected: radial-heat style — higher alpha for centre, edges fade via globe curvature
      if (selectedUF === uf) {
        const alpha = 0.38 + metricIntensity * 0.25;
        return heatColor(metricIntensity, Number(alpha.toFixed(3)));
      }
      if (hoveredUF === uf) {
        const alpha = 0.22 + metricIntensity * 0.18;
        return heatColor(metricIntensity, Number(alpha.toFixed(3)));
      }

      const baseOpacity = 0.08 + metricIntensity * 0.14;
      return heatColor(metricIntensity, Number(baseOpacity.toFixed(3)));
    },
    [hoveredUF, metricIntensityByUF, selectedUF, statesByUF],
  );

  const polygonSideColor = useCallback(() => 'rgba(4, 10, 14, 0.18)', []);

  const polygonStrokeColor = useCallback(
    (feature: Feature<Geometry>) => {
      const uf = getUF(feature);
      if (!uf) return 'rgba(140, 180, 200, 0.06)';
      if (selectedUF === uf) return 'rgba(94, 234, 212, 0.92)';
      if (hoveredUF === uf) return 'rgba(94, 234, 212, 0.65)';
      if (statesByUF[uf]) return 'rgba(120, 190, 210, 0.42)';
      return 'rgba(100, 150, 175, 0.16)';
    },
    [hoveredUF, selectedUF, statesByUF],
  );

  const polygonAltitude = useCallback(
    (feature: Feature<Geometry>) => {
      const uf = getUF(feature);
      if (!uf || !statesByUF[uf]) return 0.0003;

      const state = statesByUF[uf];
      const metricIntensity = metricIntensityByUF[uf] ?? state.intensity;
      if (selectedUF === uf) return 0.0008 + metricIntensity * 0.0006;
      return 0.0004 + metricIntensity * 0.0004;
    },
    [metricIntensityByUF, selectedUF, statesByUF],
  );

  const polygonLabel = useCallback(
    (feature: Feature<Geometry>) => {
      const uf = getUF(feature);
      if (!uf) return '';

      const state = statesByUF[uf];
      const name = ((feature.properties?.name || state?.stateName || uf) as string);
      if (!state) {
        return `<div style="background:rgba(8,14,20,0.72);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.05);border-radius:6px;padding:10px 14px;min-width:140px;font-family:var(--font-gilroy);box-shadow:0 12px 40px -12px rgba(0,0,0,0.55);">
          <div style="color:rgba(255,255,255,0.85);font-size:13px;font-weight:400;letter-spacing:0.01em;">${name}</div>
          <div style="margin-top:4px;color:rgba(255,255,255,0.22);font-size:10px;letter-spacing:0.06em;text-transform:uppercase;">Sem projetos ativos</div>
        </div>`;
      }

      const metricLabel = metric === 'revenue' ? 'Receita' : metric === 'hh' ? 'HH' : 'Riscos';
      const metricValue = metric === 'revenue'
        ? formatMoney(state.contractTotal)
        : metric === 'hh'
          ? `${state.headcount}`
          : `${state.riskCount}`;

      return `<div style="background:rgba(8,14,20,0.78);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:12px 16px;min-width:180px;font-family:var(--font-gilroy);box-shadow:0 12px 40px -12px rgba(0,0,0,0.6);">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
          <span style="font-size:14px;font-weight:500;color:#fff;letter-spacing:-0.01em;">${uf}</span>
          <span style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.06em;">${name}</span>
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.05);">
            <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.08em;font-weight:500;">Projetos</div>
            <div style="margin-top:3px;font-size:16px;font-weight:500;color:#fff;font-variant-numeric:tabular-nums;">${state.projectCount}</div>
          </div>
          <div style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.05);">
            <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.08em;font-weight:500;">${metricLabel}</div>
            <div style="margin-top:3px;font-size:16px;font-weight:500;color:#fff;font-variant-numeric:tabular-nums;">${metricValue}</div>
          </div>
        </div>
      </div>`;
    },
    [metric, statesByUF],
  );

  const onPolygonHover = useCallback(
    (feature: Feature<Geometry> | null) => {
      if (!feature) {
        onHoverUF(null);
        return;
      }
      onHoverUF(getUF(feature));
    },
    [onHoverUF],
  );

  const onPolygonClick = useCallback(
    (feature: Feature<Geometry>) => {
      const uf = getUF(feature);
      if (!uf || !statesByUF[uf]) return;
      onSelectUF(uf);
    },
    [onSelectUF, statesByUF],
  );

  const config: StateOverlayConfig = {
    polygonsData,
    polygonCapColor,
    polygonSideColor,
    polygonStrokeColor,
    polygonAltitude,
    polygonLabel,
    onPolygonHover,
    onPolygonClick,
    pathsData,
    pathPoints: (path) => path.points,
    pathPointLat: (point) => point.lat,
    pathPointLng: (point) => point.lng,
    // 2-layer boundary: soft glow (halo) + crisp base (stroke)
    pathColor: (path) => (path.kind === 'halo' ? 'rgba(94, 234, 212, 0.22)' : 'rgba(180, 220, 235, 0.55)'),
    pathStroke: (path) => (path.kind === 'halo' ? 1.2 : 0.6),
    pathDashLength: () => 0,
    pathDashGap: () => 0,
    pathDashAnimateTime: () => 0,
    labelsData,
    labelLat: (label) => label.lat,
    labelLng: (label) => label.lng,
    labelText: (label) => label.text,
    labelColor: (label) => {
      if (label.selected) return 'rgba(255, 255, 255, 0.95)';
      if (label.hovered) return 'rgba(255, 255, 255, 0.8)';
      return label.active ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.12)';
    },
    labelSize: (label) => {
      if (label.selected) return 1.05;
      if (label.hovered) return 0.9;
      return label.active ? 0.72 : 0.55;
    },
    labelDotRadius: (label) => {
      if (label.selected) return 0.14;
      if (label.hovered) return 0.1;
      return label.active ? 0.065 : 0;
    },
  };

  return <>{children(config)}</>;
}
