"use client";

import type { Project } from "@/lib/types";
import type { ProjectRiskItem, ProjectV2 } from "@/lib/types/project-v2";
import { getProjects, getProjectsV2 } from "@/lib/services/projects";
import { computeActionItems } from "@/lib/utils/project-utils";
import { STATE_CENTROIDS } from "@/data/geo/brazil-operational-data";

export type OperationsProjectStatus = "active" | "attention" | "critical" | "completed";

export interface OperationsProjectRecord {
  id: string;
  name: string;
  code: string;
  client: string;
  companyInitials: string;
  city?: string;
  uf: string;
  region: string;
  locationLabel: string;
  lat: number;
  lng: number;
  status: OperationsProjectStatus;
  sourceStatus: Project["status"];
  progress: number;
  type: string;
  contractTotal: number;
  invoiced: number;
  deadlineLabel: string;
  mainRisk: string;
  responsibleManager: string;
  lastUpdate: string;
  linkedRisks: number;
  linkedActions: number;
  linkedContracts: number;
  linkedDocuments: number;
  linkedAssets: number;
}

const STATUS_LABEL: Record<OperationsProjectStatus, string> = {
  active: "Ativo",
  attention: "Atenção",
  critical: "Crítico",
  completed: "Concluído",
};

const REGION_BY_UF: Record<string, string> = {
  AC: "Norte",
  AM: "Norte",
  AP: "Norte",
  PA: "Norte",
  RO: "Norte",
  RR: "Norte",
  TO: "Norte",
  AL: "Nordeste",
  BA: "Nordeste",
  CE: "Nordeste",
  MA: "Nordeste",
  PB: "Nordeste",
  PE: "Nordeste",
  PI: "Nordeste",
  RN: "Nordeste",
  SE: "Nordeste",
  DF: "Centro-Oeste",
  GO: "Centro-Oeste",
  MS: "Centro-Oeste",
  MT: "Centro-Oeste",
  ES: "Sudeste",
  MG: "Sudeste",
  RJ: "Sudeste",
  SP: "Sudeste",
  PR: "Sul",
  RS: "Sul",
  SC: "Sul",
};

function hashString(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function clampProgress(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeDate(value?: string): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function formatOperationsDate(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "Hoje";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatOperationsMoney(value: number, compact = true): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: compact ? "compact" : "standard",
    compactDisplay: "short",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

export function getOperationsStatusLabel(status: OperationsProjectStatus): string {
  return STATUS_LABEL[status];
}

function getProjectUf(project: Project, v2?: ProjectV2): string {
  if (v2?.uf && STATE_CENTROIDS[v2.uf]) return v2.uf;
  const client = (project.cliente || "").toUpperCase();
  if (client.includes("CEMIG")) return "MG";
  if (client.includes("PETROBRAS")) return "RJ";
  if (client.includes("CHESF") || client.includes("ENEL")) return "PE";
  if (client.includes("EQUATORIAL")) return "PA";
  if (client.includes("EDP")) return "ES";
  if (client.includes("NEOENERGIA")) return "BA";
  return "SP";
}

function getCoordinates(project: Project, uf: string, v2?: ProjectV2): { lat: number; lng: number } {
  if (typeof v2?.location?.lat === "number" && typeof v2.location.lng === "number") {
    return { lat: v2.location.lat, lng: v2.location.lng };
  }

  const centroid = STATE_CENTROIDS[uf] || STATE_CENTROIDS.SP;
  const hash = hashString(project.id);
  return {
    lat: centroid.lat + ((hash % 220) - 110) / 210,
    lng: centroid.lng + (((hash / 5) % 220) - 110) / 210,
  };
}

function chooseMainRisk(v2?: ProjectV2, project?: Project): string {
  const openRisks = [...(v2?.risks || [])]
    .filter((risk) => risk.status !== "resolved")
    .sort((a, b) => b.level - a.level);

  if (openRisks[0]) return openRisks[0].title;
  if (project?.impacto_financeiro === "critico") return "Exposição financeira crítica";
  if (project?.impacto_financeiro === "alto") return "Pressão financeira elevada";
  if (project?.status === "pausado") return "Frente operacional pausada";
  return "Sem risco crítico registrado";
}

function hasCriticalRisk(risks?: ProjectRiskItem[]): boolean {
  return Boolean(risks?.some((risk) => risk.status !== "resolved" && risk.severity === "critical"));
}

function deriveStatus(project: Project, v2?: ProjectV2): OperationsProjectStatus {
  if (project.status === "concluido") return "completed";
  if (project.status === "cancelado") return "critical";
  if (project.impacto_financeiro === "critico" || hasCriticalRisk(v2?.risks)) return "critical";
  if (
    project.status === "pausado" ||
    project.status === "planejamento" ||
    project.comite_status === "atencao_necessaria" ||
    project.impacto_financeiro === "alto"
  ) {
    return "attention";
  }
  return "active";
}

function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return (parts.map((part) => part[0]).join("") || "IG").toUpperCase();
}

function getDeadline(project: Project, v2?: ProjectV2): string {
  const milestone = v2?.milestones
    ?.filter((item) => item.status !== "completed")
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
  if (milestone) return `${milestone.name} · ${formatOperationsDate(milestone.date)}`;
  if (v2?.next_milestone_at) return `Próximo marco · ${formatOperationsDate(v2.next_milestone_at)}`;
  if (project.data_inicio) return `Início · ${formatOperationsDate(project.data_inicio)}`;
  return "Marco executivo a definir";
}

export function buildOperationsProjectRecords(): OperationsProjectRecord[] {
  const projects = getProjects();
  const projectsV2 = getProjectsV2();
  const v2ById = new Map(projectsV2.map((project) => [project.id, project]));

  return projects.map((project) => {
    const v2 = v2ById.get(project.id);
    const uf = getProjectUf(project, v2);
    const state = STATE_CENTROIDS[uf] || STATE_CENTROIDS.SP;
    const coords = getCoordinates(project, uf, v2);
    const client = project.cliente || "Insight Governance";
    const unresolvedRisks = (v2?.risks || []).filter((risk) => risk.status !== "resolved").length;
    const actions = v2 ? computeActionItems(v2).filter((item) => item.status !== "resolved").length : 0;
    const contractTotal = Math.max(0, project.valor_total || 0);
    const invoiced = Math.max(0, project.valor_executado || 0);

    return {
      id: project.id,
      name: project.nome,
      code: project.codigo || project.codigoInterno || project.id,
      client,
      companyInitials: initials(client),
      city: v2?.location?.city,
      uf,
      region: REGION_BY_UF[uf] || "Brasil",
      locationLabel: [v2?.location?.city, uf].filter(Boolean).join(" - ") || `${state.name} - ${uf}`,
      lat: coords.lat,
      lng: coords.lng,
      status: deriveStatus(project, v2),
      sourceStatus: project.status,
      progress: clampProgress(project.progresso_percentual),
      type: project.tipo || v2?.templateType || "Projeto operacional",
      contractTotal,
      invoiced,
      deadlineLabel: getDeadline(project, v2),
      mainRisk: chooseMainRisk(v2, project),
      responsibleManager: project.responsavel?.nome || project.responsavel?.full_name || "Gestor não definido",
      lastUpdate: normalizeDate(v2?.last_activity_at || project.created_date),
      linkedRisks: unresolvedRisks || (project.impacto_financeiro === "baixo" ? 0 : 1),
      linkedActions: actions,
      linkedContracts: v2?.contract_id || project.sankhya_projeto_id ? 1 : project.codigo ? 1 : 0,
      linkedDocuments: v2?.documents?.length || 0,
      linkedAssets: Math.max(1, Math.min(18, (v2?.documents?.length || 0) + (v2?.billing_eventogram?.length || 0) + 1)),
    };
  });
}

export function buildOperationsSummary(projects: OperationsProjectRecord[]) {
  const lastUpdate = projects.reduce((latest, project) => {
    return latest > project.lastUpdate ? latest : project.lastUpdate;
  }, "1970-01-01T00:00:00.000Z");

  return {
    totalProjects: projects.length,
    activeFronts: projects.filter((project) => project.status === "active" || project.status === "attention").length,
    criticalProjects: projects.filter((project) => project.status === "critical").length,
    completedProjects: projects.filter((project) => project.status === "completed").length,
    assetsLinked: projects.reduce((sum, project) => sum + project.linkedAssets, 0),
    lastUpdate,
    contractTotal: projects.reduce((sum, project) => sum + project.contractTotal, 0),
    linkedRisks: projects.reduce((sum, project) => sum + project.linkedRisks, 0),
    linkedActions: projects.reduce((sum, project) => sum + project.linkedActions, 0),
    linkedContracts: projects.reduce((sum, project) => sum + project.linkedContracts, 0),
  };
}
