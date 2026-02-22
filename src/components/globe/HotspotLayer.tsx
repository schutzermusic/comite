'use client';

import { useMemo, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { StateAggregate } from '@/data/geo/globe-kpi-data';

interface HotspotPoint {
  id: string;
  uf: string;
  stateName: string;
  lat: number;
  lng: number;
  intensity: number;
  pulseSpeed: number;
  status: StateAggregate['status'];
  projectCount: number;
  contractTotal: number;
  riskCount: number;
  liveEventCount: number;
  lastUpdate: string;
}

export interface HotspotLayerConfig {
  ringsData: HotspotPoint[];
  ringLat: (point: HotspotPoint) => number;
  ringLng: (point: HotspotPoint) => number;
  ringColor: (point: HotspotPoint) => ((t: number) => string);
  ringMaxRadius: (point: HotspotPoint) => number;
  ringPropagationSpeed: (point: HotspotPoint) => number;
  ringRepeatPeriod: (point: HotspotPoint) => number;
}

interface HotspotLayerProps {
  statesByUF: Record<string, StateAggregate>;
  metricIntensityByUF: Record<string, number>;
  selectedUF?: string | null;
  lowPerfMode: boolean;
  children: (config: HotspotLayerConfig) => ReactNode;
}

const STATUS_COLOR = {
  healthy: '#11e3b0',
  attention: '#ffb347',
  critical: '#ff5b65',
} as const;

export function HotspotLayer({
  statesByUF,
  metricIntensityByUF,
  selectedUF = null,
  lowPerfMode,
  children,
}: HotspotLayerProps) {
  const [ringEvents, setRingEvents] = useState<Array<HotspotPoint & { expiresAt: number }>>([]);

  const pointsData = useMemo<HotspotPoint[]>(() => {
    return Object.values(statesByUF)
      .map((state) => {
        const metricIntensity = metricIntensityByUF[state.uf] ?? state.intensity;
        return {
          uf: state.uf,
          stateName: state.stateName,
          lat: state.lat,
          lng: state.lon,
          intensity: metricIntensity,
          pulseSpeed: 0.8 + metricIntensity * 1.8,
          status: state.status,
          projectCount: state.projectCount,
          contractTotal: state.contractTotal,
          riskCount: state.riskCount,
          liveEventCount: state.liveEventCount,
          lastUpdate: state.lastUpdate,
          id: `${state.uf}-${state.lastUpdate}`,
        };
      })
      .filter((state) => state.liveEventCount > 0)
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, lowPerfMode ? 10 : 27)
      .map((state) => state);
  }, [lowPerfMode, metricIntensityByUF, statesByUF]);

  useEffect(() => {
    if (pointsData.length === 0) return;

    const tickMs = lowPerfMode ? 2600 : 1300;
    const lifeMs = lowPerfMode ? 2100 : 2600;

    const timer = window.setInterval(() => {
      setRingEvents((current) => {
        const now = Date.now();
        const alive = current.filter((event) => event.expiresAt > now);
        const budget = Math.min(2, Math.max(1, pointsData.length > 16 ? 2 : 1));
        const fresh: Array<HotspotPoint & { expiresAt: number }> = [];

        for (let i = 0; i < budget; i += 1) {
          const idx = Math.floor(Math.random() * pointsData.length);
          const pick = pointsData[idx];
          if (!pick) continue;
          fresh.push({
            ...pick,
            id: `${pick.uf}-${now}-${i}`,
            expiresAt: now + lifeMs,
          });
        }

        return [...alive, ...fresh].slice(-18);
      });
    }, tickMs);

    return () => window.clearInterval(timer);
  }, [lowPerfMode, pointsData]);

  const ringsData = useMemo(() => {
    const scoped = ringEvents.filter((event) => statesByUF[event.uf]);
    const selectedState = selectedUF ? statesByUF[selectedUF] : null;
    const selectedRing = selectedState && selectedState.liveEventCount > 0
      ? [{
          id: `selected-${selectedState.uf}`,
          uf: selectedState.uf,
          stateName: selectedState.stateName,
          lat: selectedState.lat,
          lng: selectedState.lon,
          intensity: Math.max(0.58, metricIntensityByUF[selectedState.uf] ?? selectedState.intensity),
          pulseSpeed: 2.7,
          status: selectedState.status,
          projectCount: selectedState.projectCount,
          contractTotal: selectedState.contractTotal,
          riskCount: selectedState.riskCount,
          liveEventCount: selectedState.liveEventCount,
          lastUpdate: selectedState.lastUpdate,
        } satisfies HotspotPoint]
      : [];

    if (lowPerfMode) {
      return [...scoped.slice(-5), ...selectedRing];
    }
    return [...scoped, ...selectedRing];
  }, [lowPerfMode, metricIntensityByUF, ringEvents, selectedUF, statesByUF]);

  const ringColor = useCallback(
    (point: HotspotPoint) => (t: number) => {
      const alpha = Math.max(0, 0.34 - t * 0.45);
      const color = STATUS_COLOR[point.status];
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
    },
    [],
  );

  const ringMaxRadius = useCallback((point: HotspotPoint) => {
    const isSelected = selectedUF === point.uf;
    return (isSelected ? 1.45 : 0.55) + point.intensity * (isSelected ? 1.8 : 1.25);
  }, [selectedUF]);
  const ringPropagationSpeed = useCallback((point: HotspotPoint) => {
    const isSelected = selectedUF === point.uf;
    return isSelected ? 2.4 : 1.05 + point.intensity * 2.2;
  }, [selectedUF]);
  const ringRepeatPeriod = useCallback(
    (point: HotspotPoint) => (selectedUF === point.uf ? 1180 : 10000),
    [selectedUF],
  );

  const config: HotspotLayerConfig = {
    ringsData,
    ringLat: (point) => point.lat,
    ringLng: (point) => point.lng,
    ringColor,
    ringMaxRadius,
    ringPropagationSpeed,
    ringRepeatPeriod,
  };

  return <>{children(config)}</>;
}
