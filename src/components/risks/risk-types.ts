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
  /** Optional financial exposure in BRL (demo / estimated). */
  financialExposure?: number;
  /** AI-origin metadata (populated when origin === 'ai'). */
  sourceModule?: string;
  sourceEntityId?: string;
  aiConfidence?: number;
  aiRationale?: string;
  /** Actionable AI recommendation (deterministic placeholder or model output). */
  aiRecommendation?: string;
  aiModel?: string;
  aiAnalyzedAt?: Date;
  /** AI suggestion dismissal (independent from status='resolved'). */
  aiDismissed?: boolean;
  aiDismissedAt?: Date;
  aiDismissedBy?: string;
  aiDismissalReason?: string;
}

/* ── Funnel / mitigation pipeline stages ──
   Five-stage executive pipeline. "validating" is derived (mitigating with all
   actions complete) so it does not require a new DB status column. */
export type FunnelStage = "identified" | "assessed" | "mitigating" | "validating" | "resolved";

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  identified: "Identificados",
  assessed: "Avaliados",
  mitigating: "Em Mitigação",
  validating: "Em Validação",
  resolved: "Resolvidos",
};

export const FUNNEL_STAGE_ORDER: FunnelStage[] = [
  "identified",
  "assessed",
  "mitigating",
  "validating",
  "resolved",
];

/* ── Category / domain label map ──
   English keys come from the DB / AI scanners; Portuguese domain keys come from
   demo data and richer manual classification. Both resolve to a display label. */
export const CATEGORY_LABELS: Record<string, string> = {
  Operational: "Operacional",
  Financial: "Financeiro",
  Legal: "Jurídico",
  Contractual: "Contratual",
  Compliance: "Compliance",
  Security: "Segurança",
  People: "Pessoas",
  Project: "Projetos",
  Technology: "Tecnologia",
  Supply: "Suprimentos",
  Operacional: "Operacional",
  Financeiro: "Financeiro",
  Jurídico: "Jurídico",
  Contratual: "Contratual",
  Segurança: "Segurança",
  Pessoas: "Pessoas",
  Projetos: "Projetos",
  Tecnologia: "Tecnologia",
  Suprimentos: "Suprimentos",
};

/** Canonical executive domains used by the radar / heatmap. */
export const RISK_DOMAINS = [
  "Financeiro",
  "Operacional",
  "Contratual",
  "Compliance",
  "Segurança",
  "Pessoas",
  "Projetos",
  "Tecnologia",
] as const;

/** Map a raw category (EN or PT) to a canonical executive domain. */
export function categoryToDomain(category: string | undefined | null): string {
  const label = CATEGORY_LABELS[category ?? ""] ?? category ?? "Operacional";
  switch (label) {
    case "Financeiro":
    case "Operacional":
    case "Contratual":
    case "Compliance":
    case "Segurança":
    case "Pessoas":
    case "Projetos":
    case "Tecnologia":
      return label;
    case "Jurídico":
      return "Compliance";
    case "Suprimentos":
      return "Operacional";
    default:
      return "Operacional";
  }
}

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
