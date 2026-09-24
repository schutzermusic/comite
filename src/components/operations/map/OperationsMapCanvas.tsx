'use client';

import { useState } from 'react';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { Map as MapComponent, NavigationControl, useControl } from 'react-map-gl/maplibre';
import type { PickingInfo } from '@deck.gl/core';
import { useTheme } from '@/contexts/ThemeContext';
import type { MapHealth, MapProject, MapTeamPoint, MapWarehouse } from '@/lib/operations/map';
import 'maplibre-gl/dist/maplibre-gl.css';

const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/**
 * deck.gl INTERCALADO no contexto WebGL do maplibre (`MapboxOverlay`), e não
 * num canvas próprio por cima: um contexto só, sem o segundo observador de
 * redimensionamento que, no duplo-mount do React em desenvolvimento, lia os
 * limites de um device já destruído.
 */
function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ ...props, interleaved: true }));
  overlay.setProps(props);
  return null;
}

export const HEALTH_RGB: Record<MapHealth, [number, number, number]> = {
  critical: [220, 38, 38], attention: [217, 119, 6], healthy: [16, 150, 110], unknown: [120, 132, 150],
};

/** Enquadra os pontos com margem; sem pontos, o Brasil. */
function initialView(points: Array<{ lat: number; lng: number }>) {
  if (!points.length) return { latitude: -14.5, longitude: -51.5, zoom: 3.3 };
  const lats = points.map((p) => p.lat); const lngs = points.map((p) => p.lng);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs), 0.05);
  return { latitude: lat, longitude: lng, zoom: Math.max(3, Math.min(13, Math.log2(360 / (span * 2.4)))) };
}

export function OperationsMapCanvas({
  projects, team, warehouses = [], selectedId, onSelect, showSites, showTeam, showWarehouses = true,
}: {
  projects: MapProject[]; team: MapTeamPoint[] | null; warehouses?: MapWarehouse[]; selectedId: string | null;
  onSelect: (id: string | null) => void; showSites: boolean; showTeam: boolean; showWarehouses?: boolean;
}) {
  const { theme } = useTheme();
  const located = projects.filter((p) => p.lat !== null && p.lng !== null) as Array<MapProject & { lat: number; lng: number }>;
  // Enquadramento só na montagem: filtrar a lista depois não arranca o mapa do lugar em que a pessoa o deixou.
  const [view] = useState(() => initialView(located));

  const layers = [
    showSites && new ScatterplotLayer({
      id: 'sites', data: located.flatMap((p) => p.geofences.map((g) => ({ ...g, health: p.health }))),
      getPosition: (d: { lng: number; lat: number }) => [d.lng, d.lat], getRadius: (d: { radius: number }) => d.radius,
      radiusUnits: 'meters', stroked: true, filled: true, lineWidthUnits: 'pixels', getLineWidth: 1.5,
      getFillColor: (d: { health: MapHealth }) => [...HEALTH_RGB[d.health], 28] as [number, number, number, number],
      getLineColor: (d: { health: MapHealth }) => [...HEALTH_RGB[d.health], 160] as [number, number, number, number],
      pickable: false,
    }),
    showTeam && team && new ScatterplotLayer({
      id: 'team', data: team, getPosition: (d: MapTeamPoint) => [d.lng, d.lat], radiusUnits: 'pixels', getRadius: 4,
      getFillColor: (d: MapTeamPoint) => (d.integrity === 'suspicious' ? [220, 38, 38, 220] : [59, 130, 246, 220]),
      stroked: true, getLineColor: [255, 255, 255, 230], lineWidthUnits: 'pixels', getLineWidth: 1, pickable: true,
    }),
    showWarehouses && warehouses.length > 0 && new ScatterplotLayer({
      id: 'warehouses', data: warehouses, getPosition: (d: MapWarehouse) => [d.lng, d.lat], radiusUnits: 'pixels', getRadius: 6,
      getFillColor: (d: MapWarehouse) => (d.kind === 'QUARANTINE' ? [217, 119, 6, 230] : [124, 58, 237, 230]),
      stroked: true, getLineColor: [255, 255, 255, 230], lineWidthUnits: 'pixels', getLineWidth: 1.5, pickable: true,
    }),
    new ScatterplotLayer({
      id: 'projects', data: located, getPosition: (d: MapProject & { lat: number; lng: number }) => [d.lng, d.lat],
      radiusUnits: 'pixels', getRadius: (d: MapProject) => (d.id === selectedId ? 11 : d.active ? 8 : 6),
      getFillColor: (d: MapProject) => [...HEALTH_RGB[d.health], d.active ? 235 : 130] as [number, number, number, number],
      stroked: true, lineWidthUnits: 'pixels', getLineWidth: (d: MapProject) => (d.id === selectedId ? 3 : 1.5),
      getLineColor: theme === 'dark' ? [15, 23, 42, 255] : [255, 255, 255, 255],
      pickable: true, updateTriggers: { getRadius: selectedId, getLineWidth: selectedId },
    }),
  ].filter(Boolean);

  const tooltip = (info: PickingInfo) => {
    const o = info.object as (MapProject | MapTeamPoint | MapWarehouse | undefined);
    if (!o) return null;
    if ('itemsInStock' in o) return { text: `${o.name}\n${o.itemsInStock} item(ns) em estoque` };
    if ('personId' in o) return { text: `${o.name}\nÚltimo registro ${new Date(o.at).toLocaleString('pt-BR')}` };
    return { text: `${o.name}${o.alerts.length ? `\n${o.alerts.join('\n')}` : ''}` };
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <MapComponent
        reuseMaps
        initialViewState={view}
        dragRotate={false}
        mapStyle={theme === 'dark' ? CARTO_DARK : CARTO_LIGHT}
        style={{ width: '100%', height: '100%' }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <DeckOverlay
          layers={layers}
          getTooltip={tooltip}
          onClick={(info) => {
            const o = info.object as MapProject | undefined;
            onSelect(o && 'health' in o ? o.id : null);
          }}
        />
      </MapComponent>
    </div>
  );
}
