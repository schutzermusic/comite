'use client';

import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { GlobeProjectRecord } from '@/data/geo/globe-kpi-data';

interface ProjectAnchorPoint {
  id: string;
  uf: string;
  name: string;
  lat: number;
  lng: number;
  status: GlobeProjectRecord['status'];
  contractTotal: number;
  invoiced: number;
  riskCount: number;
  headcount: number;
  projectIds: string[];
  isCluster: boolean;
  clusterCount: number;
}

export interface ProjectAnchorLayerConfig {
  pointsData: ProjectAnchorPoint[];
  pointLat: (point: ProjectAnchorPoint) => number;
  pointLng: (point: ProjectAnchorPoint) => number;
  pointColor: (point: ProjectAnchorPoint) => string;
  pointAltitude: (point: ProjectAnchorPoint) => number;
  pointRadius: (point: ProjectAnchorPoint) => number;
  pointLabel: (point: ProjectAnchorPoint) => string;
  onPointHover: (point: ProjectAnchorPoint | null) => void;
  onPointClick: (point: ProjectAnchorPoint) => void;
}

interface ProjectAnchorLayerProps {
  projects: GlobeProjectRecord[];
  cameraAltitude: number;
  selectedUF: string | null;
  selectedProjectId?: string | null;
  hoveredProjectId?: string | null;
  lowPerfMode: boolean;
  onHoverProject: (projectId: string | null, uf: string | null) => void;
  onSelectCluster?: (uf: string, lat: number, lng: number) => void;
  onSelectProject: (project: GlobeProjectRecord) => void;
  children: (config: ProjectAnchorLayerConfig) => ReactNode;
}

const STATUS_COLOR: Record<string, [number, number, number]> = {
  em_andamento: [40, 220, 190],
  em_planejamento: [120, 210, 245],
  pausado: [245, 180, 90],
  atrasado: [255, 128, 98],
  concluido: [110, 235, 155],
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);
}

function statusLabel(status: GlobeProjectRecord['status']): string {
  return status.replace(/_/g, ' ');
}

export function ProjectAnchorLayer({
  projects,
  cameraAltitude,
  selectedUF,
  selectedProjectId = null,
  hoveredProjectId = null,
  lowPerfMode,
  onHoverProject,
  onSelectCluster,
  onSelectProject,
  children,
}: ProjectAnchorLayerProps) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhase((current) => (current + 0.08) % (Math.PI * 2));
    }, lowPerfMode ? 140 : 70);

    return () => window.clearInterval(timer);
  }, [lowPerfMode]);

  const filteredProjects = useMemo(() => {
    const scoped = selectedUF
      ? projects.filter((project) => project.stateUF === selectedUF)
      : projects;
    if (lowPerfMode) {
      return scoped.slice(0, 70);
    }
    return scoped;
  }, [lowPerfMode, projects, selectedUF]);

  const pointsData = useMemo<ProjectAnchorPoint[]>(() => {
    const rawPoints = filteredProjects.map((project) => ({
      id: project.id,
      uf: project.stateUF,
      name: project.name,
      lat: project.lat,
      lng: project.lon,
      status: project.status,
      contractTotal: project.contractTotal,
      invoiced: project.invoiced,
      riskCount: project.riskCount,
      headcount: project.estimatedHeadcount,
      projectIds: [project.id],
      isCluster: false,
      clusterCount: 1,
    }));

    if (cameraAltitude < 0.64 || selectedUF) {
      return rawPoints;
    }

    const cell = cameraAltitude > 1 ? 1.3 : cameraAltitude > 0.82 ? 0.9 : 0.58;
    const clustered = new Map<string, ProjectAnchorPoint[]>();

    rawPoints.forEach((point) => {
      const latBucket = Math.round(point.lat / cell);
      const lngBucket = Math.round(point.lng / cell);
      const key = `${point.uf}-${latBucket}-${lngBucket}`;
      const entries = clustered.get(key) || [];
      entries.push(point);
      clustered.set(key, entries);
    });

    return Array.from(clustered.values()).map((entry, index) => {
      if (entry.length === 1) {
        return entry[0];
      }
      const clusterId = `cluster-${entry[0].uf}-${index}-${entry.length}`;
      const lat = entry.reduce((sum, point) => sum + point.lat, 0) / entry.length;
      const lng = entry.reduce((sum, point) => sum + point.lng, 0) / entry.length;
      const contractTotal = entry.reduce((sum, point) => sum + point.contractTotal, 0);
      const invoiced = entry.reduce((sum, point) => sum + point.invoiced, 0);
      const riskCount = entry.reduce((sum, point) => sum + point.riskCount, 0);
      const headcount = entry.reduce((sum, point) => sum + point.headcount, 0);

      return {
        id: clusterId,
        uf: entry[0].uf,
        name: `${entry.length} projetos`,
        lat,
        lng,
        status: 'em_andamento',
        contractTotal,
        invoiced,
        riskCount,
        headcount,
        projectIds: entry.flatMap((point) => point.projectIds),
        isCluster: true,
        clusterCount: entry.length,
      };
    });
  }, [cameraAltitude, filteredProjects, selectedUF]);

  const pointColor = useCallback((point: ProjectAnchorPoint) => {
    const [r, g, b] = STATUS_COLOR[point.status] || [90, 200, 220];
    const isActive = !point.isCluster && (selectedProjectId === point.id || hoveredProjectId === point.id);
    const alpha = point.isCluster ? 0.72 : isActive ? 0.98 : 0.8;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }, [hoveredProjectId, selectedProjectId]);

  const pointAltitude = useCallback(
    (point: ProjectAnchorPoint) => {
      const breath = Math.sin(phase + (point.id.length % 6)) * (point.isCluster ? 0.005 : 0.008);
      const selectedBoost = !point.isCluster && selectedProjectId === point.id ? 0.04 : 0;
      return (point.isCluster ? 0.012 : 0.016) + breath + selectedBoost;
    },
    [phase, selectedProjectId],
  );

  const pointRadius = useCallback(
    (point: ProjectAnchorPoint) => {
      const pulse = (Math.sin(phase * 1.2 + point.id.length) + 1) * 0.5;
      const selectedBoost = !point.isCluster && selectedProjectId === point.id ? 0.04 : 0;
      const hoveredBoost = !point.isCluster && hoveredProjectId === point.id ? 0.025 : 0;
      const clusterBoost = point.isCluster ? Math.min(0.028, point.clusterCount * 0.003) : 0;
      return 0.02 + pulse * (point.isCluster ? 0.012 : 0.018) + selectedBoost + hoveredBoost + clusterBoost;
    },
    [hoveredProjectId, phase, selectedProjectId],
  );

  const pointLabel = useCallback((point: ProjectAnchorPoint) => {
    if (point.isCluster) {
      return `<div style="background:rgba(8,14,20,0.78);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:12px 16px;min-width:180px;font-family:Inter,system-ui,sans-serif;box-shadow:0 12px 40px -12px rgba(0,0,0,0.6);">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
          <span style="font-size:14px;font-weight:500;color:#fff;">${point.clusterCount} projetos</span>
          <span style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.06em;">${point.uf}</span>
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.05);">
            <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.08em;font-weight:500;">Receita</div>
            <div style="margin-top:3px;font-size:16px;font-weight:500;color:#fff;font-variant-numeric:tabular-nums;">${formatMoney(point.contractTotal)}</div>
          </div>
          <div style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.05);">
            <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.08em;font-weight:500;">Riscos</div>
            <div style="margin-top:3px;font-size:16px;font-weight:500;color:#fff;font-variant-numeric:tabular-nums;">${point.riskCount}</div>
          </div>
        </div>
      </div>`;
    }

    return `<div style="background:rgba(8,14,20,0.78);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:12px 16px;min-width:180px;font-family:Inter,system-ui,sans-serif;box-shadow:0 12px 40px -12px rgba(0,0,0,0.6);">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <span style="font-size:13px;font-weight:500;color:#fff;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">${point.name}</span>
        <span style="font-size:10px;font-weight:400;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.06em;">${point.uf}</span>
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.08em;font-weight:500;">Receita</div>
          <div style="margin-top:3px;font-size:16px;font-weight:500;color:#fff;font-variant-numeric:tabular-nums;">${formatMoney(point.contractTotal)}</div>
        </div>
        <div style="padding:6px 0;border-top:1px solid rgba(255,255,255,0.05);">
          <div style="font-size:9px;color:rgba(255,255,255,0.3);text-transform:uppercase;letter-spacing:0.08em;font-weight:500;">Riscos</div>
          <div style="margin-top:3px;font-size:16px;font-weight:500;color:#fff;font-variant-numeric:tabular-nums;">${point.riskCount}</div>
        </div>
      </div>
    </div>`;
  }, []);

  const onPointHover = useCallback(
    (point: ProjectAnchorPoint | null) => {
      if (point?.isCluster) {
        onHoverProject(null, point.uf || null);
        return;
      }
      onHoverProject(point?.id || null, point?.uf || null);
    },
    [onHoverProject],
  );

  const onPointClick = useCallback(
    (point: ProjectAnchorPoint) => {
      if (point.isCluster) {
        onSelectCluster?.(point.uf, point.lat, point.lng);
        return;
      }
      const project = filteredProjects.find((entry) => entry.id === point.id);
      if (!project) return;
      onSelectProject(project);
    },
    [filteredProjects, onSelectCluster, onSelectProject],
  );

  return children({
    pointsData,
    pointLat: (point) => point.lat,
    pointLng: (point) => point.lng,
    pointColor,
    pointAltitude,
    pointRadius,
    pointLabel,
    onPointHover,
    onPointClick,
  });
}
