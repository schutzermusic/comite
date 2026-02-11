'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Globe as GlobeIcon, Maximize2 } from 'lucide-react';
import {
  STATE_PROJECT_DATA,
  StateProjectData,
  BRAZIL_CENTER,
  RISK_COLORS,
  formatCompact,
  getMaxContractValue,
} from '@/data/geo/brazil-operational-data';
import { ProjectHUDPanel } from './ProjectHUDPanel';
import { cn } from '@/lib/utils';

// Dynamic import Globe.gl to avoid SSR issues
const Globe = dynamic(() => import('react-globe.gl'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-2 border-emerald-500/30 rounded-full" />
        <div className="absolute inset-0 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  ),
});

type ViewMode = 'global' | 'brazil';

// Lightweight Brazil states GeoJSON
const BRAZIL_STATES_URL = 'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson';

interface BrazilOperationalGlobeProps {
  className?: string;
  onStateSelect?: (state: StateProjectData | null) => void;
  /** Called when view mode changes between global and brazil */
  onViewModeChange?: (mode: 'global' | 'brazil') => void;
  /** When true, renders as a cinematic background layer with minimal UI */
  contextMode?: boolean;
}

export function BrazilOperationalGlobe({ 
  className, 
  onStateSelect, 
  onViewModeChange,
  contextMode = false 
}: BrazilOperationalGlobeProps) {
  const globeRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('global');
  const [selectedState, setSelectedState] = useState<StateProjectData | null>(null);
  const [hoveredState, setHoveredState] = useState<StateProjectData | null>(null);
  const [isRotating, setIsRotating] = useState(true);
  const [dimensions, setDimensions] = useState({ width: 400, height: 300 });
  const [brazilStates, setBrazilStates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const maxValue = useMemo(() => getMaxContractValue(), []);

  // Load Brazil states GeoJSON
  useEffect(() => {
    let mounted = true;

    async function loadBrazilStates() {
      try {
        const res = await fetch(BRAZIL_STATES_URL);
        const data = await res.json();

        if (mounted && data.features) {
          setBrazilStates(data.features);
        }
      } catch (error) {
        console.error('Error loading Brazil states:', error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadBrazilStates();
    return () => { mounted = false; };
  }, []);

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Initial globe setup
  useEffect(() => {
    if (!globeRef.current) return;

    const globe = globeRef.current;

    // Set initial position focused on Brazil
    // Context mode uses a slightly lower altitude for better ambiance
    const altitude = contextMode ? 2.0 : 2.2;
    globe.pointOfView({ lat: BRAZIL_CENTER.lat, lng: BRAZIL_CENTER.lng, altitude }, 0);

    // Configure controls
    const controls = globe.controls();
    if (controls) {
      controls.autoRotate = true;
      // Context mode uses slower, more cinematic rotation
      controls.autoRotateSpeed = contextMode ? 0.2 : 0.4;
      controls.enableZoom = contextMode ? false : false;
      controls.enablePan = false;
    }
  }, [contextMode]);

  // Handle view mode changes
  useEffect(() => {
    if (!globeRef.current) return;

    const globe = globeRef.current;
    const controls = globe.controls();

    if (viewMode === 'brazil') {
      globe.pointOfView(
        { lat: BRAZIL_CENTER.lat, lng: BRAZIL_CENTER.lng, altitude: 0.5 },
        1500
      );
      if (controls) {
        controls.autoRotate = false;
        controls.enableZoom = true;
        controls.minDistance = 120;
        controls.maxDistance = 400;
      }
      setIsRotating(false);
    } else {
      globe.pointOfView({ lat: BRAZIL_CENTER.lat, lng: BRAZIL_CENTER.lng, altitude: 2.2 }, 1500);
      if (controls) {
        controls.autoRotate = true;
        controls.enableZoom = false;
      }
      setIsRotating(true);
      setSelectedState(null);
    }
  }, [viewMode]);

  // Handle rotation toggle
  useEffect(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls();
    if (controls) {
      controls.autoRotate = isRotating && viewMode === 'global';
    }
  }, [isRotating, viewMode]);

  // Get state sigla from feature
  const getStateSigla = useCallback((feature: any): string | null => {
    const props = feature?.properties;
    if (!props) return null;

    const sigla = props.sigla || props.UF || props.SIGLA;
    if (sigla) return sigla.toUpperCase();

    const name = (props.name || props.nome || props.NAME || '').toLowerCase();

    const nameToSigla: Record<string, string> = {
      'acre': 'AC', 'alagoas': 'AL', 'amapá': 'AP', 'amazonas': 'AM',
      'bahia': 'BA', 'ceará': 'CE', 'distrito federal': 'DF', 'espírito santo': 'ES',
      'goiás': 'GO', 'maranhão': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
      'minas gerais': 'MG', 'pará': 'PA', 'paraíba': 'PB', 'paraná': 'PR',
      'pernambuco': 'PE', 'piauí': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
      'rio grande do sul': 'RS', 'rondônia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
      'são paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
    };

    return nameToSigla[name] || null;
  }, []);

  // Polygon cap color
  const polygonCapColor = useCallback(
    (feature: any) => {
      const sigla = getStateSigla(feature);
      const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;

      if (viewMode === 'brazil') {
        if (!stateData) {
          return 'rgba(20, 45, 38, 0.6)';
        }

        if (selectedState?.uf === sigla) {
          return `${RISK_COLORS[stateData.riskLevel]}90`;
        }
        if (hoveredState?.uf === sigla) {
          return `${RISK_COLORS[stateData.riskLevel]}70`;
        }

        const intensity = Math.pow(stateData.totalContracted / maxValue, 0.5);
        return `rgba(16, 185, 129, ${0.3 + intensity * 0.4})`;
      } else {
        // Global view - Brazil highlighted
        if (stateData) {
          const intensity = Math.pow(stateData.totalContracted / maxValue, 0.5);
          return `rgba(16, 185, 129, ${0.25 + intensity * 0.35})`;
        }
        return 'rgba(16, 185, 129, 0.2)';
      }
    },
    [viewMode, selectedState, hoveredState, maxValue, getStateSigla]
  );

  const polygonSideColor = useCallback(() => 'rgba(16, 185, 129, 0.03)', []);

  const polygonStrokeColor = useCallback(
    (feature: any) => {
      const sigla = getStateSigla(feature);
      const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;

      if (selectedState?.uf === sigla || hoveredState?.uf === sigla) {
        return stateData ? RISK_COLORS[stateData.riskLevel] : '#10b981';
      }

      if (stateData) {
        return viewMode === 'brazil' ? 'rgba(16, 185, 129, 0.7)' : 'rgba(16, 185, 129, 0.5)';
      }

      return 'rgba(16, 185, 129, 0.25)';
    },
    [viewMode, selectedState, hoveredState, getStateSigla]
  );

  const polygonAltitude = useCallback(
    (feature: any) => {
      if (viewMode !== 'brazil') return 0.005;

      const sigla = getStateSigla(feature);
      const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;

      if (stateData) {
        const normalized = stateData.totalContracted / maxValue;
        return 0.008 + normalized * 0.02;
      }
      return 0.003;
    },
    [viewMode, maxValue, getStateSigla]
  );

  // Handle polygon click
  const handlePolygonClick = useCallback(
    (feature: any) => {
      if (viewMode === 'global') {
        setViewMode('brazil');
        onViewModeChange?.('brazil');
      } else {
        const sigla = getStateSigla(feature);
        const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;
        if (stateData) {
          setSelectedState(stateData);
          onStateSelect?.(stateData);
        }
      }
    },
    [viewMode, onStateSelect, onViewModeChange, getStateSigla]
  );

  // Handle polygon hover
  const handlePolygonHover = useCallback(
    (feature: any) => {
      if (!feature) {
        setHoveredState(null);
        return;
      }

      const sigla = getStateSigla(feature);
      const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;
      setHoveredState(stateData || null);

      // Pause rotation on hover
      if (globeRef.current && viewMode === 'global') {
        const controls = globeRef.current.controls();
        if (controls) {
          controls.autoRotate = false;
        }
      }
    },
    [viewMode, getStateSigla]
  );

  // Handle pointer leave
  const handlePointerLeave = useCallback(() => {
    setHoveredState(null);
    if (globeRef.current && viewMode === 'global' && isRotating) {
      const controls = globeRef.current.controls();
      if (controls) {
        controls.autoRotate = true;
      }
    }
  }, [viewMode, isRotating]);

  // Polygon label
  const polygonLabel = useCallback(
    (feature: any) => {
      const sigla = getStateSigla(feature);
      const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;
      const stateName = feature?.properties?.name || feature?.properties?.nome || sigla || 'Estado';

      if (!stateData) {
        return `
          <div style="
            background: rgba(10, 15, 13, 0.9);
            border: 1px solid rgba(100, 120, 115, 0.5);
            border-radius: 8px;
            padding: 8px 12px;
            font-family: system-ui, sans-serif;
            pointer-events: none;
          ">
            <div style="color: rgba(255,255,255,0.7); font-weight: 500; font-size: 13px;">
              ${stateName}
            </div>
            <div style="color: rgba(255,255,255,0.4); font-size: 11px;">
              Sem projetos ativos
            </div>
          </div>
        `;
      }

      return `
        <div style="
          background: rgba(10, 15, 13, 0.95);
          border: 1px solid ${RISK_COLORS[stateData.riskLevel]};
          border-radius: 10px;
          padding: 10px 14px;
          font-family: system-ui, sans-serif;
          box-shadow: 0 0 15px ${RISK_COLORS[stateData.riskLevel]}30;
          pointer-events: none;
        ">
          <div style="color: white; font-weight: 600; font-size: 13px; margin-bottom: 3px;">
            ${stateData.state}
          </div>
          <div style="color: rgba(255,255,255,0.5); font-size: 10px; margin-bottom: 6px;">
            ${stateData.contractsCount} contrato${stateData.contractsCount !== 1 ? 's' : ''}
          </div>
          <div style="color: ${RISK_COLORS[stateData.riskLevel]}; font-weight: 700; font-size: 15px;">
            ${formatCompact(stateData.totalContracted)}
          </div>
        </div>
      `;
    },
    [getStateSigla]
  );

  // Point markers for states with projects
  const pointsData = useMemo(() => {
    if (viewMode !== 'brazil') return [];
    return STATE_PROJECT_DATA;
  }, [viewMode]);

  const pointColor = useCallback(
    (d: StateProjectData) => RISK_COLORS[d.riskLevel],
    []
  );

  const pointAltitude = useCallback(
    (d: StateProjectData) => {
      const normalized = d.totalContracted / maxValue;
      return 0.025 + normalized * 0.05;
    },
    [maxValue]
  );

  const pointRadius = useCallback(
    (d: StateProjectData) => {
      const normalized = Math.pow(d.totalContracted / maxValue, 0.4);
      return 0.12 + normalized * 0.3;
    },
    [maxValue]
  );

  // Close HUD panel
  const handleCloseHUD = useCallback(() => {
    setSelectedState(null);
    onStateSelect?.(null);
  }, [onStateSelect]);

  // Go back to global view
  const handleBackToGlobal = useCallback(() => {
    setViewMode('global');
    setSelectedState(null);
    onStateSelect?.(null);
    onViewModeChange?.('global');
  }, [onStateSelect, onViewModeChange]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full h-full overflow-hidden',
        // Context mode: transparent, no borders/rounded corners
        !contextMode && 'bg-gradient-to-br from-[#030705] via-[#050a08] to-[#030705]',
        !contextMode && 'rounded-2xl',
        className
      )}
      onPointerLeave={handlePointerLeave}
    >
      {/* Ambient glow - hidden in context mode (parent handles glow) */}
      {!contextMode && (
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background: 'radial-gradient(400px 200px at 50% 50%, rgba(16, 185, 129, 0.05), transparent 60%)',
          }}
        />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 border-2 border-emerald-500/30 rounded-full" />
            <div className="absolute inset-0 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      )}

      {/* Globe */}
      <Globe
        ref={globeRef}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(0,0,0,0)"
        atmosphereColor="#10b981"
        atmosphereAltitude={0.15}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        // Brazil states polygons
        polygonsData={brazilStates}
        polygonCapColor={polygonCapColor}
        polygonSideColor={polygonSideColor}
        polygonStrokeColor={polygonStrokeColor}
        polygonAltitude={polygonAltitude}
        polygonLabel={polygonLabel}
        onPolygonClick={handlePolygonClick}
        onPolygonHover={handlePolygonHover}
        // Points (markers in Brazil view)
        pointsData={pointsData}
        pointLat={(d: any) => d.lat}
        pointLng={(d: any) => d.lng}
        pointColor={pointColor as any}
        pointAltitude={pointAltitude as any}
        pointRadius={pointRadius as any}
        pointsMerge={false}
        onPointClick={(point: any) => {
          setSelectedState(point as StateProjectData);
          onStateSelect?.(point as StateProjectData);
        }}
      />

      {/* UI Elements - Hidden in context mode */}
      {!contextMode && (
        <>
          {/* Back button */}
          <AnimatePresence>
            {viewMode === 'brazil' && (
              <motion.button
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onClick={handleBackToGlobal}
                className={cn(
                  'absolute left-3 top-3 z-40',
                  'flex items-center gap-2 px-3 py-1.5',
                  'rounded-lg backdrop-blur-md',
                  'border border-emerald-500/30',
                  'text-xs text-white/80 hover:text-white',
                  'bg-black/50 hover:bg-black/70',
                  'transition-all duration-200'
                )}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar</span>
              </motion.button>
            )}
          </AnimatePresence>

          {/* View indicator */}
          <div className="absolute left-3 bottom-3 z-30">
            <div
              className={cn(
                'flex items-center gap-2 px-2.5 py-1',
                'rounded-full backdrop-blur-md',
                'border border-white/10 bg-black/50',
                'text-[10px] text-white/60'
              )}
            >
              <GlobeIcon className="w-3 h-3" />
              <span>{viewMode === 'global' ? 'Global' : 'Brasil'}</span>
              {viewMode === 'brazil' && (
                <>
                  <span className="text-white/30">•</span>
                  <span className="text-emerald-400">{STATE_PROJECT_DATA.length} estados</span>
                </>
              )}
            </div>
          </div>

          {/* Rotation toggle */}
          {viewMode === 'global' && (
            <button
              onClick={() => setIsRotating(!isRotating)}
              className={cn(
                'absolute right-3 bottom-3 z-30',
                'flex items-center gap-1.5 px-2.5 py-1',
                'rounded-full backdrop-blur-md',
                'border border-white/10 bg-black/50',
                'text-[10px] text-white/60 hover:text-white/80',
                'transition-colors'
              )}
            >
              <Maximize2 className={cn('w-3 h-3', isRotating && 'animate-pulse')} />
              <span>{isRotating ? 'Ativo' : 'Pausado'}</span>
            </button>
          )}

          {/* Hint */}
          <AnimatePresence>
            {viewMode === 'global' && !hoveredState && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={cn(
                  'absolute bottom-3 left-1/2 -translate-x-1/2 z-30',
                  'px-3 py-1.5 rounded-full',
                  'bg-black/60 backdrop-blur-md',
                  'border border-emerald-500/20',
                  'text-[10px] text-white/50'
                )}
              >
                Clique no Brasil para explorar
              </motion.div>
            )}
          </AnimatePresence>

          {/* HUD Panel */}
          <ProjectHUDPanel data={selectedState} onClose={handleCloseHUD} />
        </>
      )}
    </div>
  );
}

export default BrazilOperationalGlobe;
