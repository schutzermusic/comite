'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
    STATE_PROJECT_DATA,
    StateProjectData,
    BRAZIL_CENTER,
    RISK_COLORS,
    formatCompact,
    getMaxContractValue,
} from '@/data/geo/brazil-operational-data';
import { StateContractPanel } from './StateContractPanel';
import { GlobeModeChip } from './GlobeModeChip';
import { cn } from '@/lib/utils';

// Dynamic import Globe.gl to avoid SSR issues
const Globe = dynamic(() => import('react-globe.gl'), {
    ssr: false,
    loading: () => (
        <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-16 h-16">
                <div className="absolute inset-0 border-2 border-cyan-500/30 rounded-full" />
                <div className="absolute inset-0 border-2 border-cyan-500/50 border-t-transparent rounded-full animate-spin" />
            </div>
        </div>
    ),
});

// View state machine types
export type GlobeViewState = 'GLOBAL_VIEW' | 'BRAZIL_FOCUS' | 'STATE_SELECTED';

// Brazil states GeoJSON
const BRAZIL_STATES_URL = 'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson';

// Camera positions for each view state
const CAMERA_POSITIONS = {
    GLOBAL_VIEW: { lat: -10, lng: -55, altitude: 2.5 },
    BRAZIL_FOCUS: { lat: -14.2, lng: -51.9, altitude: 0.8 },
    STATE_SELECTED: { lat: -14.2, lng: -51.9, altitude: 0.6 },
};

// Animation durations
const FLIGHT_DURATION_MS = {
    GLOBAL_TO_BRAZIL: 1000,
    BRAZIL_TO_STATE: 400,
    STATE_TO_BRAZIL: 300,
    BRAZIL_TO_GLOBAL: 800,
};

interface EnterpriseGlobeProps {
    className?: string;
    /** When true, renders as a background context layer */
    contextMode?: boolean;
    /** Enable interactive features (clicking, hovering) */
    interactive?: boolean;
    onStateSelect?: (state: StateProjectData | null) => void;
}

/**
 * EnterpriseGlobe
 * 
 * An enterprise-grade interactive globe with state machine navigation.
 * Supports drill-down from global view to Brazil, states, and contracts.
 */
export function EnterpriseGlobe({
    className,
    contextMode = false,
    interactive = true,
    onStateSelect
}: EnterpriseGlobeProps) {
    const globeRef = useRef<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // State machine
    const [viewState, setViewState] = useState<GlobeViewState>('GLOBAL_VIEW');
    const [selectedState, setSelectedState] = useState<StateProjectData | null>(null);
    const [hoveredState, setHoveredState] = useState<StateProjectData | null>(null);

    // Globe state
    const [dimensions, setDimensions] = useState({ width: 400, height: 400 });
    const [brazilStates, setBrazilStates] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isTransitioning, setIsTransitioning] = useState(false);

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
        const pos = CAMERA_POSITIONS.GLOBAL_VIEW;
        globe.pointOfView({ lat: pos.lat, lng: pos.lng, altitude: pos.altitude }, 0);

        const controls = globe.controls();
        if (controls) {
            controls.autoRotate = !contextMode;
            controls.autoRotateSpeed = contextMode ? 0.15 : 0.3;
            controls.enableZoom = false;
            controls.enablePan = false;
        }
    }, [contextMode]);

    // Camera flight on view state change
    useEffect(() => {
        if (!globeRef.current) return;

        const globe = globeRef.current;
        const controls = globe.controls();
        let duration = 0;
        let targetPos = CAMERA_POSITIONS[viewState];

        // Adjust camera for selected state
        if (viewState === 'STATE_SELECTED' && selectedState) {
            targetPos = {
                lat: selectedState.lat,
                lng: selectedState.lng,
                altitude: 0.55,
            };
            duration = FLIGHT_DURATION_MS.BRAZIL_TO_STATE;
        } else if (viewState === 'BRAZIL_FOCUS') {
            duration = FLIGHT_DURATION_MS.GLOBAL_TO_BRAZIL;
        } else {
            duration = FLIGHT_DURATION_MS.BRAZIL_TO_GLOBAL;
        }

        setIsTransitioning(true);
        globe.pointOfView(targetPos, duration);

        // Update controls based on view
        if (controls) {
            controls.autoRotate = viewState === 'GLOBAL_VIEW' && !contextMode;
        }

        const timer = setTimeout(() => setIsTransitioning(false), duration);
        return () => clearTimeout(timer);
    }, [viewState, selectedState, contextMode]);

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

    // Polygon styling callbacks
    const polygonCapColor = useCallback(
        (feature: any) => {
            const sigla = getStateSigla(feature);
            const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;

            if (viewState === 'GLOBAL_VIEW') {
                // Global view - subtle Brazil highlight
                if (stateData) {
                    const intensity = Math.pow(stateData.totalContracted / maxValue, 0.5);
                    return `rgba(16, 185, 129, ${0.15 + intensity * 0.2})`;
                }
                return 'rgba(16, 185, 129, 0.08)';
            }

            // Brazil focus or state selected
            if (!stateData) {
                return 'rgba(30, 45, 40, 0.4)';
            }

            if (selectedState?.uf === sigla) {
                return `${RISK_COLORS[stateData.riskLevel]}50`;
            }
            if (hoveredState?.uf === sigla) {
                return `rgba(16, 185, 129, 0.35)`;
            }

            const intensity = Math.pow(stateData.totalContracted / maxValue, 0.5);
            return `rgba(16, 185, 129, ${0.12 + intensity * 0.18})`;
        },
        [viewState, selectedState, hoveredState, maxValue, getStateSigla]
    );

    const polygonSideColor = useCallback(() => 'rgba(16, 185, 129, 0.02)', []);

    const polygonStrokeColor = useCallback(
        (feature: any) => {
            const sigla = getStateSigla(feature);
            const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;

            if (selectedState?.uf === sigla || hoveredState?.uf === sigla) {
                return stateData ? RISK_COLORS[stateData.riskLevel] : '#10b981';
            }

            if (stateData) {
                return viewState !== 'GLOBAL_VIEW' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(16, 185, 129, 0.3)';
            }

            return 'rgba(16, 185, 129, 0.15)';
        },
        [viewState, selectedState, hoveredState, getStateSigla]
    );

    const polygonAltitude = useCallback(
        (feature: any) => {
            if (viewState === 'GLOBAL_VIEW') return 0.004;

            const sigla = getStateSigla(feature);
            const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;

            if (stateData) {
                const normalized = stateData.totalContracted / maxValue;
                if (selectedState?.uf === sigla) return 0.02 + normalized * 0.02;
                return 0.006 + normalized * 0.015;
            }
            return 0.003;
        },
        [viewState, selectedState, maxValue, getStateSigla]
    );

    // Handle polygon click
    const handlePolygonClick = useCallback(
        (feature: any) => {
            if (!interactive || isTransitioning) return;

            if (viewState === 'GLOBAL_VIEW') {
                // Transition to Brazil focus
                setViewState('BRAZIL_FOCUS');
            } else {
                // Select state
                const sigla = getStateSigla(feature);
                const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;
                if (stateData) {
                    setSelectedState(stateData);
                    setViewState('STATE_SELECTED');
                    onStateSelect?.(stateData);
                }
            }
        },
        [viewState, interactive, isTransitioning, onStateSelect, getStateSigla]
    );

    // Handle polygon hover
    const handlePolygonHover = useCallback(
        (feature: any) => {
            if (!interactive) return;

            if (!feature) {
                setHoveredState(null);
                return;
            }

            const sigla = getStateSigla(feature);
            const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;
            setHoveredState(stateData || null);

            // Pause rotation on hover
            if (globeRef.current && viewState === 'GLOBAL_VIEW') {
                const controls = globeRef.current.controls();
                if (controls) {
                    controls.autoRotate = false;
                }
            }
        },
        [viewState, interactive, getStateSigla]
    );

    // Resume rotation when pointer leaves
    const handlePointerLeave = useCallback(() => {
        setHoveredState(null);
        if (globeRef.current && viewState === 'GLOBAL_VIEW' && !contextMode) {
            const controls = globeRef.current.controls();
            if (controls) {
                controls.autoRotate = true;
            }
        }
    }, [viewState, contextMode]);

    // Polygon tooltip
    const polygonLabel = useCallback(
        (feature: any) => {
            if (!interactive || viewState === 'GLOBAL_VIEW') return '';

            const sigla = getStateSigla(feature);
            const stateData = sigla ? STATE_PROJECT_DATA.find((s) => s.uf === sigla) : null;
            const stateName = feature?.properties?.name || feature?.properties?.nome || sigla || 'Estado';

            if (!stateData) {
                return `
          <div style="
            background: rgba(10, 15, 13, 0.95);
            border: 1px solid rgba(100, 120, 115, 0.3);
            border-radius: 8px;
            padding: 8px 12px;
            font-family: system-ui, sans-serif;
            pointer-events: none;
          ">
            <div style="color: rgba(255,255,255,0.6); font-weight: 500; font-size: 12px;">
              ${stateName}
            </div>
            <div style="color: rgba(255,255,255,0.35); font-size: 10px;">
              Sem projetos ativos
            </div>
          </div>
        `;
            }

            const riskLabels: Record<string, string> = {
                active: 'Ativo',
                at_risk: 'Em Risco',
                critical: 'Crítico',
                completed: 'Concluído',
            };

            return `
        <div style="
          background: rgba(10, 15, 13, 0.95);
          border: 1px solid ${RISK_COLORS[stateData.riskLevel]}60;
          border-radius: 10px;
          padding: 10px 14px;
          font-family: system-ui, sans-serif;
          box-shadow: 0 0 20px ${RISK_COLORS[stateData.riskLevel]}20;
          pointer-events: none;
        ">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <div style="color: white; font-weight: 600; font-size: 12px;">
              ${stateData.uf}
            </div>
            <div style="color: rgba(255,255,255,0.5); font-size: 11px;">
              · ${stateData.state}
            </div>
          </div>
          <div style="color: rgba(255,255,255,0.5); font-size: 10px; margin-bottom: 6px;">
            ${stateData.contractsCount} projeto${stateData.contractsCount !== 1 ? 's' : ''} ativo${stateData.contractsCount !== 1 ? 's' : ''}
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="color: white; font-weight: 700; font-size: 14px;">
              ${formatCompact(stateData.totalContracted)}
            </div>
            <div style="
              background: ${RISK_COLORS[stateData.riskLevel]}20;
              color: ${RISK_COLORS[stateData.riskLevel]};
              padding: 2px 8px;
              border-radius: 10px;
              font-size: 9px;
              font-weight: 500;
              text-transform: uppercase;
            ">
              ${riskLabels[stateData.riskLevel]}
            </div>
          </div>
        </div>
      `;
        },
        [viewState, interactive, getStateSigla]
    );

    // Handle back navigation
    const handleBack = useCallback(() => {
        if (viewState === 'STATE_SELECTED') {
            setSelectedState(null);
            setViewState('BRAZIL_FOCUS');
            onStateSelect?.(null);
        } else if (viewState === 'BRAZIL_FOCUS') {
            setViewState('GLOBAL_VIEW');
        }
    }, [viewState, onStateSelect]);

    // Close panel
    const handleClosePanel = useCallback(() => {
        setSelectedState(null);
        setViewState('BRAZIL_FOCUS');
        onStateSelect?.(null);
    }, [onStateSelect]);

    // Point markers for states with projects
    const pointsData = useMemo(() => {
        if (viewState === 'GLOBAL_VIEW') return [];
        return STATE_PROJECT_DATA;
    }, [viewState]);

    const pointColor = useCallback(
        (d: StateProjectData) => RISK_COLORS[d.riskLevel],
        []
    );

    const pointAltitude = useCallback(
        (d: StateProjectData) => {
            const normalized = d.totalContracted / maxValue;
            return 0.02 + normalized * 0.04;
        },
        [maxValue]
    );

    const pointRadius = useCallback(
        (d: StateProjectData) => {
            const normalized = Math.pow(d.totalContracted / maxValue, 0.4);
            return 0.1 + normalized * 0.25;
        },
        [maxValue]
    );

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative w-full h-full overflow-hidden',
                !contextMode && 'rounded-2xl',
                className
            )}
            onPointerLeave={handlePointerLeave}
        >
            {/* Loading */}
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center z-10">
                    <div className="relative w-12 h-12">
                        <div className="absolute inset-0 border-2 border-cyan-500/30 rounded-full" />
                        <div className="absolute inset-0 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                </div>
            )}

            {/* Globe */}
            <Globe
                ref={globeRef}
                width={dimensions.width}
                height={dimensions.height}
                backgroundColor="rgba(0,0,0,0)"
                atmosphereColor="#06b6d4"
                atmosphereAltitude={0.12}
                globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
                // Brazil states polygons
                polygonsData={brazilStates}
                polygonCapColor={polygonCapColor}
                polygonSideColor={polygonSideColor}
                polygonStrokeColor={polygonStrokeColor}
                polygonAltitude={polygonAltitude}
                polygonLabel={interactive ? polygonLabel : undefined}
                onPolygonClick={interactive ? handlePolygonClick : undefined}
                onPolygonHover={interactive ? handlePolygonHover : undefined}
                // Points (markers)
                pointsData={pointsData}
                pointLat={(d: any) => d.lat}
                pointLng={(d: any) => d.lng}
                pointColor={pointColor as any}
                pointAltitude={pointAltitude as any}
                pointRadius={pointRadius as any}
                pointsMerge={false}
                onPointClick={interactive ? (point: any) => {
                    if (isTransitioning) return;
                    setSelectedState(point as StateProjectData);
                    setViewState('STATE_SELECTED');
                    onStateSelect?.(point as StateProjectData);
                } : undefined}
            />

            {/* UI Elements - Only show if interactive and not in context mode */}
            {interactive && !contextMode && (
                <>
                    {/* Mode chip */}
                    <div className="absolute left-4 bottom-4 z-30">
                        <GlobeModeChip
                            viewState={viewState}
                            onBackClick={handleBack}
                        />
                    </div>

                    {/* Hint for global view */}
                    <AnimatePresence>
                        {viewState === 'GLOBAL_VIEW' && !hoveredState && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className={cn(
                                    'absolute bottom-4 left-1/2 -translate-x-1/2 z-30',
                                    'px-4 py-2 rounded-full',
                                    'bg-black/50 backdrop-blur-xl',
                                    'border border-white/[0.08]',
                                    'text-xs text-white/50'
                                )}
                            >
                                Clique no Brasil para explorar
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* State Contract Panel */}
                    <StateContractPanel
                        data={selectedState}
                        onClose={handleClosePanel}
                    />
                </>
            )}
        </div>
    );
}

export default EnterpriseGlobe;
