import type { GovernanceException } from '@/lib/types/people';
import { DEMO_PEOPLE } from '@/components/projects/team-demo-data';

/* ════════════════════════════════════════════════════════════════════
   DEMO / DEMONSTRATION DATASET — Governança
   ────────────────────────────────────────────────────────────────────
   Used ONLY for visual validation when there are no real exceptions.
   NEVER writes to the database. Consumers surface a badge and block
   mutations.
   ════════════════════════════════════════════════════════════════════ */

function ex(
  id: string,
  type: GovernanceException['type'],
  severity: GovernanceException['severity'],
  status: GovernanceException['status'],
  title: string,
  personIdx: number | null,
  evidence: Record<string, unknown>,
): GovernanceException {
  const person = personIdx == null ? undefined : DEMO_PEOPLE[personIdx];
  return {
    id,
    organizationId: 'demo-org',
    type,
    severity,
    status,
    personId: person?.id ?? null,
    projectId: null,
    allocationId: null,
    title,
    evidence,
    fingerprint: `demo:${id}`,
    detectedAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    resolutionNotes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    person,
  };
}

export const DEMO_EXCEPTIONS: GovernanceException[] = [
  ex('demo-g1', 'over_allocation', 'critical', 'open', 'Carlos Santos com 140% de comprometimento', 2, { total_percentage: 140 }),
  ex('demo-g2', 'self_approval', 'high', 'open', 'Apontamento criado e aprovado pela mesma pessoa', 1, { user_id: 'demo-user' }),
  ex('demo-g3', 'payroll_without_allocation', 'medium', 'under_review', 'Roberto Lima na folha sem alocação ativa', 4, {}),
  ex('demo-g4', 'cost_without_cost_center', 'low', 'open', 'Alocação faturável sem centro de custo', 0, {}),
  ex('demo-g5', 'recurring_correction', 'medium', 'resolved', '4 correções de ponto no mês', 2, { corrections: 4 }),
];
