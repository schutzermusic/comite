'use client';

/**
 * PunchLocationMap — onde a marcação de ponto foi batida.
 *
 * Plota o fix de GPS do colaborador contra a cerca do projeto (centro + raio
 * reais, em metros) para que o gestor da Revisão de Ponto decida com a
 * evidência geográfica à vista, e não só com o número da distância. Mesmo
 * motor dos mapas do app (deck.gl + maplibre); alterna entre basemap vetorial
 * e imagem de satélite, que é o que resolve "ele estava na obra ou na rua?".
 */

import { useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { Map as MapComponent } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import { useTheme } from '@/contexts/ThemeContext';
import 'maplibre-gl/dist/maplibre-gl.css';

const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const CARTO_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

/** Satélite Esri como raster puro — sem token, mesmo tile do globo de geofences. */
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
};

export interface PunchLocationMapProps {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
  geofenceLat?: number | null;
  geofenceLng?: number | null;
  geofenceRadiusMeters?: number | null;
  className?: string;
  height?: number;
}

/** Zoom que enquadra `spanMeters` de raio na altura do painel. */
function zoomForSpan(spanMeters: number, latitude: number, heightPx: number): number {
  const metersPerPixelAtZ0 = 156543.03392 * Math.cos((latitude * Math.PI) / 180);
  const targetMetersPerPixel = (spanMeters * 2.6) / heightPx;
  const z = Math.log2(metersPerPixelAtZ0 / targetMetersPerPixel);
  return Math.max(2, Math.min(19, z));
}

export function PunchLocationMap({
  latitude,
  longitude,
  accuracyMeters,
  geofenceLat,
  geofenceLng,
  geofenceRadiusMeters,
  className,
  height = 340,
}: PunchLocationMapProps) {
  const { theme } = useTheme();
  const [satellite, setSatellite] = useState(true);

  const hasFence = geofenceLat != null && geofenceLng != null && geofenceRadiusMeters != null;

  const initialViewState = useMemo(() => {
    const centerLat = hasFence ? (latitude + geofenceLat!) / 2 : latitude;
    const centerLng = hasFence ? (longitude + geofenceLng!) / 2 : longitude;
    // metros a enquadrar: cobre a cerca inteira + a separação até o fix
    const latDelta = hasFence ? Math.abs(latitude - geofenceLat!) * 111_320 : 0;
    const lngDelta = hasFence
      ? Math.abs(longitude - geofenceLng!) * 111_320 * Math.cos((latitude * Math.PI) / 180)
      : 0;
    const separation = Math.hypot(latDelta, lngDelta) / 2;
    const span = Math.max(
      60,
      separation + (geofenceRadiusMeters ?? 0),
      accuracyMeters ?? 0,
      hasFence ? geofenceRadiusMeters! : 0,
    );
    return {
      latitude: centerLat,
      longitude: centerLng,
      zoom: zoomForSpan(span, centerLat, height),
      pitch: 0,
      bearing: 0,
    };
  }, [latitude, longitude, geofenceLat, geofenceLng, geofenceRadiusMeters, accuracyMeters, hasFence, height]);

  const layers = useMemo(() => {
    const built = [];

    if (hasFence) {
      built.push(
        new ScatterplotLayer({
          id: 'punch-geofence',
          data: [{ position: [geofenceLng!, geofenceLat!], radius: geofenceRadiusMeters! }],
          getPosition: (d: { position: [number, number] }) => d.position,
          getRadius: (d: { radius: number }) => d.radius,
          radiusUnits: 'meters',
          filled: true,
          stroked: true,
          getFillColor: [45, 212, 191, 32],
          getLineColor: [45, 212, 191, 210],
          lineWidthMinPixels: 2,
        }),
        new ScatterplotLayer({
          id: 'punch-geofence-center',
          data: [{ position: [geofenceLng!, geofenceLat!] }],
          getPosition: (d: { position: [number, number] }) => d.position,
          getRadius: 4,
          radiusUnits: 'pixels',
          getFillColor: [45, 212, 191, 255],
        }),
        new LineLayer({
          id: 'punch-distance',
          data: [{ from: [geofenceLng!, geofenceLat!], to: [longitude, latitude] }],
          getSourcePosition: (d: { from: [number, number] }) => d.from,
          getTargetPosition: (d: { to: [number, number] }) => d.to,
          getColor: [248, 113, 113, 190],
          getWidth: 2,
        }),
      );
    }

    if (accuracyMeters != null && accuracyMeters > 0) {
      built.push(
        new ScatterplotLayer({
          id: 'punch-accuracy',
          data: [{ position: [longitude, latitude], radius: accuracyMeters }],
          getPosition: (d: { position: [number, number] }) => d.position,
          getRadius: (d: { radius: number }) => d.radius,
          radiusUnits: 'meters',
          filled: true,
          stroked: true,
          getFillColor: [248, 113, 113, 26],
          getLineColor: [248, 113, 113, 120],
          lineWidthMinPixels: 1,
        }),
      );
    }

    built.push(
      new ScatterplotLayer({
        id: 'punch-point',
        data: [{ position: [longitude, latitude] }],
        getPosition: (d: { position: [number, number] }) => d.position,
        getRadius: 7,
        radiusUnits: 'pixels',
        stroked: true,
        getFillColor: [248, 113, 113, 255],
        getLineColor: [255, 255, 255, 230],
        lineWidthMinPixels: 2,
      }),
    );

    return built;
  }, [latitude, longitude, accuracyMeters, geofenceLat, geofenceLng, geofenceRadiusMeters, hasFence]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-ig-border-subtle bg-ig-panel-hover ${className ?? ''}`}
      style={{ height }}
    >
      <DeckGL initialViewState={initialViewState} controller={{ dragRotate: false }} layers={layers}>
        <MapComponent
          reuseMaps
          mapStyle={satellite ? SATELLITE_STYLE : theme === 'light' ? CARTO_LIGHT : CARTO_DARK}
          style={{ width: '100%', height: '100%' }}
        />
      </DeckGL>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2">
        <div className="pointer-events-auto flex gap-1 rounded-lg border border-ig-border-subtle bg-ig-panel/85 p-0.5 backdrop-blur">
          {(['Satélite', 'Mapa'] as const).map((label) => {
            const isSat = label === 'Satélite';
            const active = satellite === isSat;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setSatellite(isSat)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  active ? 'bg-ig-accent/20 text-ig-fg-strong' : 'text-ig-fg-muted hover:text-ig-fg-strong'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="pointer-events-none flex flex-col items-end gap-1 text-[10px]">
          <span className="rounded-md bg-ig-panel/85 px-2 py-1 text-ig-fg-muted backdrop-blur">
            <span className="text-[#f87171]">●</span> marcação
            {hasFence && <> · <span className="text-[#2dd4bf]">●</span> cerca ({Math.round(geofenceRadiusMeters!)} m)</>}
          </span>
        </div>
      </div>
    </div>
  );
}
