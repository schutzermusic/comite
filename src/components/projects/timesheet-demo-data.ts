import type { TimeEntry } from '@/lib/types/people';
import { DEMO_PEOPLE } from './team-demo-data';

/* ════════════════════════════════════════════════════════════════════
   DEMO / DEMONSTRATION DATASET — Apontamentos do projeto
   ────────────────────────────────────────────────────────────────────
   Used ONLY for visual validation when there are no real time entries
   in Supabase. NEVER writes to the database. Consumers surface a
   "dados demonstrativos" badge and block mutations.
   ════════════════════════════════════════════════════════════════════ */

const ORG = 'demo-org';

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function demoEntry(
  id: string,
  personIdx: number,
  projectId: string,
  daysAgo: number,
  minutes: number,
  status: TimeEntry['status'],
  flags: TimeEntry['exceptionFlags'] = [],
  description?: string,
): TimeEntry {
  const person = DEMO_PEOPLE[personIdx];
  return {
    id,
    organizationId: ORG,
    personId: person.id,
    projectId,
    allocationId: null,
    timelineItemId: null,
    workDate: isoDaysAgo(daysAgo),
    minutes,
    description: description ?? null,
    sourceSessionId: null,
    status,
    exceptionFlags: flags,
    autoApproved: status === 'approved' && flags.length === 0,
    submittedAt: status !== 'draft' ? new Date().toISOString() : null,
    approvedBy: null,
    approvedAt: status === 'approved' ? new Date().toISOString() : null,
    rejectionReason: null,
    hourlyCostCents: null,
    costCents: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    person,
  };
}

export function buildDemoTimeEntries(projectId: string): TimeEntry[] {
  return [
    demoEntry('demo-te1', 0, projectId, 0, 480, 'approved', [], 'Planejamento executivo'),
    demoEntry('demo-te2', 0, projectId, 1, 450, 'approved', [], 'Revisão de projeto elétrico'),
    demoEntry('demo-te3', 1, projectId, 0, 510, 'submitted', ['over_capacity'], 'Mobilização de campo'),
    demoEntry('demo-te4', 1, projectId, 2, 480, 'approved', [], 'Coordenação de equipes'),
    demoEntry('demo-te5', 2, projectId, 1, 420, 'submitted', ['no_active_allocation'], 'Manutenção preventiva'),
    demoEntry('demo-te6', 2, projectId, 3, 480, 'approved', [], 'Instalação elétrica'),
    demoEntry('demo-te7', 3, projectId, 1, 240, 'approved', [], 'Atualização de cronograma'),
    demoEntry('demo-te8', 3, projectId, 4, 180, 'draft', [], 'Análise de produtividade'),
  ];
}
