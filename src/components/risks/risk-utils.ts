import type { ExtendedRisk, FunnelStage } from "./risk-types";

/* ── Aging in days ── */
export function computeAging(createdAt: Date): number {
  return Math.floor((Date.now() - createdAt.getTime()) / 86_400_000);
}

/* ── Severity color CSS variable ── */
export function severityColor(severity: ExtendedRisk["severity"]): string {
  switch (severity) {
    case "critical": return "var(--ig-danger)";
    case "high":     return "var(--ig-warning)";
    case "medium":   return "var(--ig-info)";
    case "low":      return "var(--ig-success)";
  }
}

/* ── Severity → HudStatusPill variant ── */
export function severityVariant(severity: ExtendedRisk["severity"]) {
  const map = { critical: "critical", high: "warning", medium: "neutral", low: "active" } as const;
  return map[severity];
}

/* ── Status → HudStatusPill variant ── */
export function statusVariant(status: ExtendedRisk["status"]) {
  const map = { open: "critical", mitigating: "warning", resolved: "completed" } as const;
  return map[status];
}

/* ── Cell severity label from P × I ── */
export function cellSeverityLabel(prob: number, impact: number) {
  const level = prob * impact;
  if (level >= 16) return "Crítico";
  if (level >= 11) return "Alto";
  if (level >= 6) return "Médio";
  return "Baixo";
}

/* ── Cell severity key from P × I ── */
export function cellSeverityKey(prob: number, impact: number): ExtendedRisk["severity"] {
  const level = prob * impact;
  if (level >= 16) return "critical";
  if (level >= 11) return "high";
  if (level >= 6) return "medium";
  return "low";
}

/* ── Map risk to its funnel stage ──
   "validating" is inferred: a mitigating risk whose action plan is fully
   executed but not yet formally resolved sits in validation/review. */
export function riskToFunnelStage(risk: ExtendedRisk): FunnelStage {
  if (risk.status === "resolved") return "resolved";
  if (risk.status === "mitigating") {
    const hasActions = risk.actions.length > 0;
    const allDone = hasActions && risk.actions.every((a) => a.status === "done");
    return allDone ? "validating" : "mitigating";
  }
  if (risk.mitigationPlan) return "assessed";
  return "identified";
}

/* ── Filter risks by funnel stage ── */
export function filterByStage(risks: ExtendedRisk[], stage: FunnelStage): ExtendedRisk[] {
  return risks.filter((r) => riskToFunnelStage(r) === stage);
}

/* ── Count risks per funnel stage ── */
export function countByStage(risks: ExtendedRisk[]): Record<FunnelStage, number> {
  const counts: Record<FunnelStage, number> = { identified: 0, assessed: 0, mitigating: 0, validating: 0, resolved: 0 };
  risks.forEach((r) => { counts[riskToFunnelStage(r)]++; });
  return counts;
}

/* ── Distribution selectors live in risk-analytics.ts (single source of truth). ── */

/* ── Format date to pt-BR ── */
export function fmtDate(d: Date | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/* ── Format short date ── */
export function fmtDateShort(d: Date | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
