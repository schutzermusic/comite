'use client';

'use client';

import { useEffect, useRef, useState } from 'react';
import { DeckGL } from '@deck.gl/react';
import { GeoJsonLayer } from '@deck.gl/layers';
import { OrionCard } from '@/components/orion';
import { BrazilStatesOps, StateOps } from '@/lib/dashboard-data';
import { formatCurrency } from '@/lib/dashboard-data';

interface BrazilEnergyOpsMapProps {
  data: BrazilStatesOps;
  className?: string;
  onStateClick?: (state: StateOps) => void;
}

// Simplified Brazil states GeoJSON - in production, load from external file
const BRAZIL_STATES_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { uf: 'SP', name: 'São Paulo' }, geometry: { type: 'Polygon', coordinates: [[[-53.1, -25.3], [-44.0, -25.3], [-44.0, -19.8], [-53.1, -19.8], [-53.1, -25.3]]] } },
    { type: 'Feature', properties: { uf: 'RJ', name: 'Rio de Janeiro' }, geometry: { type: 'Polygon', coordinates: [[[-45.0, -23.4], [-40.9, -23.4], [-40.9, -20.7], [-45.0, -20.7], [-45.0, -23.4]]] } },
    { type: 'Feature', properties: { uf: 'MG', name: 'Minas Gerais' }, geometry: { type: 'Polygon', coordinates: [[[-51.0, -23.0], [-40.3, -23.0], [-40.3, -14.2], [-51.0, -14.2], [-51.0, -23.0]]] } },
    { type: 'Feature', properties: { uf: 'RS', name: 'Rio Grande do Sul' }, geometry: { type: 'Polygon', coordinates: [[[-57.6, -33.7], [-49.7, -33.7], [-49.7, -27.1], [-57.6, -27.1], [-57.6, -33.7]]] } },
    { type: 'Feature', properties: { uf: 'PR', name: 'Paraná' }, geometry: { type: 'Polygon', coordinates: [[[-54.6, -26.7], [-48.4, -26.7], [-48.4, -22.5], [-54.6, -22.5], [-54.6, -26.7]]] } },
    { type: 'Feature', properties: { uf: 'BA', name: 'Bahia' }, geometry: { type: 'Polygon', coordinates: [[[-46.6, -18.3], [-37.9, -18.3], [-37.9, -9.4], [-46.6, -9.4], [-46.6, -18.3]]] } },
    { type: 'Feature', properties: { uf: 'CE', name: 'Ceará' }, geometry: { type: 'Polygon', coordinates: [[[-41.0, -7.2], [-37.2, -7.2], [-37.2, -2.9], [-41.0, -2.9], [-41.0, -7.2]]] } },
    { type: 'Feature', properties: { uf: 'DF', name: 'Distrito Federal' }, geometry: { type: 'Polygon', coordinates: [[[-48.3, -16.0], [-47.3, -16.0], [-47.3, -15.4], [-48.3, -15.4], [-48.3, -16.0]]] } },
    { type: 'Feature', properties: { uf: 'SC', name: 'Santa Catarina' }, geometry: { type: 'Polygon', coordinates: [[[-53.8, -29.4], [-48.6, -29.4], [-48.6, -25.9], [-53.8, -25.9], [-53.8, -29.4]]] } },
    { type: 'Feature', properties: { uf: 'GO', name: 'Goiás' }, geometry: { type: 'Polygon', coordinates: [[[-53.2, -20.9], [-46.0, -20.9], [-46.0, -13.2], [-53.2, -13.2], [-53.2, -20.9]]] } },
  ],
};

// Status color mapping
const STATUS_COLORS = {
  active: [16, 185, 129], // emerald green
  risk: [245, 158, 11], // amber
  completed: [107, 114, 128], // gray
  inactive: [30, 41, 38], // dark green-gray
};

const STATUS_BORDER_COLORS = {
  active: [16, 185, 129, 200],
  risk: [245, 158, 11, 200],
  completed: [107, 114, 128, 150],
  inactive: [60, 80, 70, 100],
};

export function BrazilEnergyOpsMap({ data, className, onStateClick }: BrazilEnergyOpsMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [pulseTime, setPulseTime] = useState(0);
  const animationFrameRef = useRef<number>();

  // Animation loop for pulse effect
  useEffect(() => {
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = (Date.now() - startTime) / 1000;
      setPulseTime(elapsed);
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Create state lookup map
  const stateMap = new Map(data.states.map(s => [s.uf, s]));

  // Calculate pulse opacity (1.8-2.6 second cycle)
  const getPulseOpacity = (status: string) => {
    if (status !== 'active' && status !== 'risk') return 1;
    
    const cycleDuration = status === 'active' ? 2.2 : 2.4;
    const pulse = (Math.sin((pulseTime / cycleDuration) * Math.PI * 2) + 1) / 2;
    return 0.6 + pulse * 0.4; // 0.6 to 1.0
  };

  // Get state color with pulse
  const getStateColor = (state: StateOps) => {
    const baseColor = STATUS_COLORS[state.status];
    const opacity = getPulseOpacity(state.status);
    return [...baseColor, Math.floor(opacity * 255)];
  };

  // Get state border color
  const getStateBorderColor = (state: StateOps) => {
    const baseColor = STATUS_BORDER_COLORS[state.status];
    const isHovered = hoveredState === state.uf;
    const pulse = state.status === 'active' || state.status === 'risk' 
      ? getPulseOpacity(state.status) 
      : 1;
    return [baseColor[0], baseColor[1], baseColor[2], Math.floor(baseColor[3] * (isHovered ? 1.2 : pulse))];
  };

  // Enhanced GeoJSON with state data
  const enhancedGeoJSON = {
    ...BRAZIL_STATES_GEOJSON,
    features: BRAZIL_STATES_GEOJSON.features.map(feature => {
      const state = stateMap.get(feature.properties.uf);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          ...state,
        },
      };
    }),
  };

  const layers = [
    new GeoJsonLayer({
      id: 'brazil-states',
      data: enhancedGeoJSON,
      pickable: true,
      stroked: true,
      filled: true,
      lineWidthMinPixels: 1.5,
      getFillColor: (d: any) => {
        const state = stateMap.get(d.properties.uf);
        return state ? getStateColor(state) : STATUS_COLORS.inactive;
      },
      getLineColor: (d: any) => {
        const state = stateMap.get(d.properties.uf);
        return state ? getStateBorderColor(state) : STATUS_BORDER_COLORS.inactive;
      },
      getLineWidth: 2,
      onHover: (info: any) => {
        setHoveredState(info.object?.properties?.uf || null);
      },
      onClick: (info: any) => {
        const state = stateMap.get(info.object?.properties?.uf);
        if (state && onStateClick) {
          onStateClick(state);
        }
      },
    }),
  ];

  const initialViewState = {
    longitude: -50,
    latitude: -15,
    zoom: 4,
    pitch: 0,
    bearing: 0,
  };

  const hoveredStateData = hoveredState ? stateMap.get(hoveredState) : null;

  return (
    <OrionCard variant="default" className={className}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white orion-section-title">Presença Operacional</h3>
            <p className="text-xs text-orion-text-muted mt-0.5">Estados com manutenção ativa</p>
          </div>
        </div>

        {/* Map Container */}
        <div className="relative w-full h-[280px] bg-gradient-to-br from-emerald-950/20 to-emerald-950/5 rounded-lg overflow-hidden border border-emerald-500/10">
          <DeckGL
            initialViewState={initialViewState}
            controller={true}
            layers={layers}
            style={{ width: '100%', height: '100%' }}
          />

          {/* Tooltip */}
          {hoveredStateData && (
            <div className="absolute top-4 left-4 bg-emerald-950/95 backdrop-blur-xl border border-emerald-500/30 rounded-lg p-3 shadow-xl z-10 min-w-[200px]">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-white">{hoveredStateData.name}</h4>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 uppercase tracking-wider">
                    {hoveredStateData.uf}
                  </span>
                </div>
                <div className="text-xs text-orion-text-muted">
                  Status: <span className="text-white capitalize">{hoveredStateData.status === 'risk' ? 'Em Risco' : hoveredStateData.status === 'active' ? 'Ativo' : hoveredStateData.status === 'completed' ? 'Concluído' : 'Inativo'}</span>
                </div>
                <div className="text-xs text-orion-text-muted">
                  Projetos Ativos: <span className="text-white font-semibold">{hoveredStateData.activeProjects}</span>
                </div>
                {hoveredStateData.portfolioValue && (
                  <div className="text-xs text-orion-text-muted">
                    Valor: <span className="text-white font-semibold">{formatCurrency(hoveredStateData.portfolioValue, 'BRL')}</span>
                  </div>
                )}
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
                animation: 'pulse 2.2s ease-in-out infinite',
              }}
            />
            <span className="text-xs text-orion-text-muted">
              Ativo ({data.summary.active})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full"
              style={{ 
                backgroundColor: `rgb(${STATUS_COLORS.risk.join(',')})`,
                boxShadow: `0 0 6px rgba(${STATUS_COLORS.risk.join(',')}, 0.6)`,
                animation: 'pulse 2.4s ease-in-out infinite',
              }}
            />
            <span className="text-xs text-orion-text-muted">
              Em Risco ({data.summary.risk})
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
              Concluído ({data.summary.completed})
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
        }
      `}</style>
    </OrionCard>
  );
}

