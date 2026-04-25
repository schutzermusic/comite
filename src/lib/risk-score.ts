import type { Risk } from "@/lib/types";

const SEVERITY_WEIGHTS: Record<Risk["severity"], number> = {
  critical: 5,
  high: 3,
  medium: 1.5,
  low: 0.5,
};

export function computeCorporateRiskScore(risks: Risk[]): number {
  const open = risks.filter((risk) => {
    const status = risk.status as string;
    return status !== "resolved" && status !== "closed";
  });
  if (open.length === 0) return 0;

  const raw = open.reduce((sum, risk) => sum + (SEVERITY_WEIGHTS[risk.severity] ?? 0), 0);
  const normalized = Math.min(10, raw / Math.max(1, open.length / 2));
  return Math.round(normalized * 10) / 10;
}

export function scoreVariant(score: number): "success" | "warning" | "critical" {
  if (score >= 7) return "critical";
  if (score >= 4) return "warning";
  return "success";
}
