import type { Risk } from "@/lib/types";

/* ── Extended risk type for the Control Room ── */
export interface RiskAction {
  id: string;
  riskId: string;
  title: string;
  description?: string;
  assignee: string;
  dueDate: Date;
  status: "pending" | "in_progress" | "done";
  createdAt: Date;
}

export interface RiskHistoryEntry {
  id: string;
  riskId: string;
  action: string;
  user: string;
  timestamp: Date;
  detail?: string;
}

export interface RiskEvidence {
  id: string;
  riskId: string;
  name: string;
  type: "document" | "image" | "link";
  url?: string;
  uploadedAt: Date;
  uploadedBy: string;
}

export interface ExtendedRisk extends Risk {
  area: string;
  nextAction?: string;
  dueDate?: Date;
  actions: RiskAction[];
  history: RiskHistoryEntry[];
  evidences: RiskEvidence[];
  /** AI-origin metadata (populated when origin === 'ai'). */
  sourceModule?: string;
  sourceEntityId?: string;
  aiConfidence?: number;
  aiRationale?: string;
  aiModel?: string;
  aiAnalyzedAt?: Date;
  /** AI suggestion dismissal (independent from status='resolved'). */
  aiDismissed?: boolean;
  aiDismissedAt?: Date;
  aiDismissedBy?: string;
  aiDismissalReason?: string;
}

/* ── Funnel stages ── */
export type FunnelStage = "identified" | "assessed" | "mitigating" | "resolved";

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  identified: "Identificados",
  assessed: "Avaliados",
  mitigating: "Em Mitigação",
  resolved: "Resolvidos",
};

export const FUNNEL_STAGE_ORDER: FunnelStage[] = [
  "identified",
  "assessed",
  "mitigating",
  "resolved",
];

/* ── Category label map ── */
export const CATEGORY_LABELS: Record<string, string> = {
  Operational: "Operacional",
  Financial: "Financeiro",
  Legal: "Jurídico",
  Contractual: "Contratual",
  Compliance: "Compliance",
};

/* ── Status labels ── */
export const STATUS_LABELS: Record<Risk["status"], string> = {
  open: "Aberto",
  mitigating: "Mitigando",
  resolved: "Resolvido",
};

/* ── Severity labels ── */
export const SEVERITY_LABELS: Record<Risk["severity"], string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Médio",
  low: "Baixo",
};

/* ── Drawer context ── */
export type DrawerContext =
  | { type: "cell"; probability: number; impact: number }
  | { type: "funnel"; stage: FunnelStage }
  | { type: "risk"; riskId: string }
  | null;
