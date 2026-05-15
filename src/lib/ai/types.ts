/**
 * Shared AI risk-engine types. Kept in a single place so finance / projects /
 * contracts scanners stay structurally identical (same finding shape, same
 * severity table, same persistence contract).
 */

export type AiRiskCategory =
  | 'Operational'
  | 'Financial'
  | 'Legal'
  | 'Contractual'
  | 'Compliance'
  | 'Schedule';

export type AiRiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AiSourceModule = 'contracts' | 'finance' | 'projects';

export interface AiRiskFinding {
  title: string;
  description: string;
  category: AiRiskCategory;
  /** Anchor entity inside the scanned module (e.g. specific ledger_entry id). Optional. */
  sourceEntityId?: string | null;
  probability: number;
  impact: number;
  severity: AiRiskSeverity;
  rationale: string;
  confidence: number;
  mitigation: string;
}

export function computeSeverity(level: number): AiRiskSeverity {
  if (level >= 16) return 'critical';
  if (level >= 12) return 'high';
  if (level >= 7) return 'medium';
  return 'low';
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampFloat(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
