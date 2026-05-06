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

/* ── Map risk to its funnel stage ── */
export function riskToFunnelStage(risk: ExtendedRisk): FunnelStage {
  if (risk.status === "resolved") return "resolved";
  if (risk.status === "mitigating") return "mitigating";
  if (risk.mitigationPlan) return "assessed";
  return "identified";
}

/* ── Filter risks by funnel stage ── */
export function filterByStage(risks: ExtendedRisk[], stage: FunnelStage): ExtendedRisk[] {
  return risks.filter((r) => riskToFunnelStage(r) === stage);
}

/* ── Count risks per funnel stage ── */
export function countByStage(risks: ExtendedRisk[]): Record<FunnelStage, number> {
  const counts: Record<FunnelStage, number> = { identified: 0, assessed: 0, mitigating: 0, resolved: 0 };
  risks.forEach((r) => { counts[riskToFunnelStage(r)]++; });
  return counts;
}

/* ── Exposure data per area ── */
export function computeAreaExposure(risks: ExtendedRisk[]): { area: string; score: number; count: number }[] {
  const map: Record<string, { total: number; count: number }> = {};
  risks.forEach((r) => {
    if (!map[r.area]) map[r.area] = { total: 0, count: 0 };
    map[r.area].total += r.level;
    map[r.area].count += 1;
  });
  return Object.entries(map)
    .map(([area, { total, count }]) => ({ area, score: Math.round((total / count) * 10) / 10, count }))
    .sort((a, b) => b.score - a.score);
}

/* ── Category distribution ── */
export function computeCategoryDistribution(risks: ExtendedRisk[]): { name: string; value: number }[] {
  const labels: Record<string, string> = {
    Operational: "Operacional",
    Financial: "Financeiro",
    Legal: "Jurídico",
    Contractual: "Contratual",
    Compliance: "Compliance",
  };
  const map: Record<string, number> = {};
  risks.forEach((r) => {
    const key = labels[r.category ?? ""] ?? r.category ?? "Outros";
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

/* ── Owner distribution ── */
export function computeOwnerDistribution(risks: ExtendedRisk[]): { name: string; count: number }[] {
  const map: Record<string, number> = {};
  risks.forEach((r) => {
    if (r.responsibleName) map[r.responsibleName] = (map[r.responsibleName] || 0) + 1;
  });
  return Object.entries(map).map(([name, count]) => ({ name, count }));
}

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
