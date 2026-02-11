'use client';

import { useMemo, useState } from 'react';
import { DeckGL } from '@deck.gl/react';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { Map } from 'react-map-gl/maplibre';
import { OrionCard } from '@/components/orion';
import { brazilMaintenancePoints, MaintenancePoint } from '@/data/geo/brazil-maintenance-points';
import 'maplibre-gl/dist/maplibre-gl.css';

interface BrazilEnergyHexMapProps {
  className?: string;
  onPointClick?: (point: MaintenancePoint) => void;
}

// Status color mapping for hexagons
const STATUS_COLORS = {
  active: [16, 185, 129], // emerald green
  risk: [245, 158, 11], // amber
  completed: [107, 114, 128], // gray
};

// Color scale for hexagon elevation (green/teal energy gradient)
const COLOR_SCALE: [number, number, number][] = [
  [10, 15, 13],      // Dark green-black (low)
  [16, 32, 28],      // Dark emerald
  [20, 50, 40],      // Medium dark green
  [16, 185, 129],    // Bright emerald (active)
  [34, 211, 153],    // Light emerald (high activity)
  [6, 182, 212],     // Cyan accent (peak)
];

export function BrazilEnergyHexMap({ className, onPointClick }: BrazilEnergyHexMapProps) {
  const [hoveredObject, setHoveredObject] = useState<any>(null);

  // Calculate summary stats
  const summary = useMemo(() => {
    const active = brazilMaintenancePoints.filter(p => p.status === 'active').length;
    const risk = brazilMaintenancePoints.filter(p => p.status === 'risk').length;
    const completed = brazilMaintenancePoints.filter(p => p.status === 'completed').length;
    return { active, risk, completed };
  }, []);

  // HexagonLayer configuration
  const hexagonLayer = new HexagonLayer<MaintenancePoint>({
    id: 'hexagon-layer',
    data: brazilMaintenancePoints,
    pickable: true,
    extruded: true,
    radius: 55000, // ~55km hexagon radius
    elevationScale: 30,
    elevationRange: [0, 3000],
    coverage: 0.95,
    upperPercentile: 98,
    getPosition: d => d.position,
    getWeight: d => d.weight,
    getColorWeight: d => d.weight,
    colorRange: COLOR_SCALE,
    material: {
      ambient: 0.4,
      diffuse: 0.6,
      shininess: 32,
      specularColor: [60, 60, 60],
    },
    onHover: (info) => {
      setHoveredObject(info.object);
    },
    onClick: (info) => {
      if (info.object && onPointClick) {
        // Find the closest point to the hexagon center
        const hexCenter = info.coordinate;
        const closestPoint = brazilMaintenancePoints.reduce((closest, point) => {
          const dist = Math.sqrt(
            Math.pow(point.position[0] - hexCenter[0], 2) +
            Math.pow(point.position[1] - hexCenter[1], 2)
          );
          const closestDist = Math.sqrt(
            Math.pow(closest.position[0] - hexCenter[0], 2) +
            Math.pow(closest.position[1] - hexCenter[1], 2)
          );
          return dist < closestDist ? point : closest;
        }, brazilMaintenancePoints[0]);
        onPointClick(closestPoint);
      }
    },
  });

  // Brazil-focused viewport
  const initialViewState = {
    longitude: -52,
    latitude: -14,
    zoom: 3.5,
    pitch: 40,
    bearing: -5,
  };

  // Get hovered point data
  const hoveredPoint = useMemo(() => {
    if (!hoveredObject) return null;
    const hexCenter = hoveredObject.position;
    return brazilMaintenancePoints.reduce((closest, point) => {
      const dist = Math.sqrt(
        Math.pow(point.position[0] - hexCenter[0], 2) +
        Math.pow(point.position[1] - hexCenter[1], 2)
      );
      const closestDist = Math.sqrt(
        Math.pow(closest.position[0] - hexCenter[0], 2) +
        Math.pow(closest.position[1] - hexCenter[1], 2)
      );
      return dist < closestDist ? point : closest;
    }, brazilMaintenancePoints[0]);
  }, [hoveredObject]);

  return (
    <OrionCard variant="default" className={className}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white orion-section-title">Presença Operacional</h3>
            <p className="text-xs text-orion-text-muted mt-0.5">Intensidade de manutenção por região</p>
          </div>
        </div>

        {/* Map Container */}
        <div className="relative w-full h-[280px] bg-gradient-to-br from-emerald-950/20 to-emerald-950/5 rounded-lg overflow-hidden border border-emerald-500/10">
          <DeckGL
            initialViewState={initialViewState}
            controller={true}
            layers={[hexagonLayer]}
            style={{ width: '100%', height: '100%' }}
          >
            <Map
              mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
              reuseMaps
            />
          </DeckGL>

          {/* Tooltip */}
          {hoveredPoint && (
            <div className="absolute top-4 left-4 bg-emerald-950/95 backdrop-blur-xl border border-emerald-500/30 rounded-lg p-3 shadow-xl z-10 min-w-[200px]">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white">{hoveredPoint.city}</h4>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 uppercase tracking-wider">
                    {hoveredPoint.uf}
                  </span>
                </div>
                <div className="text-xs text-orion-text-muted">
                  Status: <span className="text-white capitalize">
                    {hoveredPoint.status === 'risk' ? 'Em Risco' : 
                     hoveredPoint.status === 'active' ? 'Ativo' : 
                     'Concluído'}
                  </span>
                </div>
                <div className="text-xs text-orion-text-muted">
                  Intensidade: <span className="text-white font-semibold">{hoveredPoint.weight}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 pt-2 border-t border-white/5">
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full"
              style={{ 
                backgroundColor: `rgb(${STATUS_COLORS.active.join(',')})`,
                boxShadow: `0 0 6px rgba(${STATUS_COLORS.active.join(',')}, 0.6)`,
              }}
            />
            <span className="text-xs text-orion-text-muted">
              Ativo ({summary.active})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full"
              style={{ 
                backgroundColor: `rgb(${STATUS_COLORS.risk.join(',')})`,
                boxShadow: `0 0 6px rgba(${STATUS_COLORS.risk.join(',')}, 0.6)`,
              }}
            />
            <span className="text-xs text-orion-text-muted">
              Em Risco ({summary.risk})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full"
              style={{ 
                backgroundColor: `rgb(${STATUS_COLORS.completed.join(',')})`,
                boxShadow: `0 0 6px rgba(${STATUS_COLORS.completed.join(',')}, 0.3)`,
              }}
            />
            <span className="text-xs text-orion-text-muted">
              Concluído ({summary.completed})
            </span>
          </div>
        </div>
      </div>
    </OrionCard>
  );
}

