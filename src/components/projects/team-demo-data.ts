import type { Person, PersonProjectAllocation } from '@/lib/types/people';

/* ════════════════════════════════════════════════════════════════════
   DEMO / DEMONSTRATION DATASET — Equipe do projeto
   ────────────────────────────────────────────────────────────────────
   Used ONLY for visual validation when there are no real allocations
   in Supabase. It NEVER writes to the database — client-side constant.
   Every consumer surfaces a "dados demonstrativos" badge while active
   and blocks mutations (same pattern as risk-demo-data.ts).
   ════════════════════════════════════════════════════════════════════ */

const ORG = 'demo-org';
const NOW = new Date();
const Y = NOW.getFullYear();
const M = NOW.getMonth(); // 0-based

function iso(year: number, month0: number, day: number): string {
  const d = new Date(year, month0, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function demoPerson(
  id: string,
  fullName: string,
  jobTitle: string,
  department: string,
  contractType: Person['contractType'],
  weeklyHours = 40,
): Person {
  return {
    id,
    organizationId: ORG,
    profileId: null,
    fullName,
    payrollNameKey: fullName.toLowerCase(),
    cpf: null,
    email: null,
    jobTitle,
    department,
    contractType,
    weeklyHours,
    costCenterId: null,
    managerPersonId: null,
    status: 'active',
    source: 'manual',
    hiredAt: iso(Y - 3, 1, 10),
    terminatedAt: null,
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export const DEMO_PEOPLE: Person[] = [
  demoPerson('demo-p1', 'Alice Chen', 'Engenheira Eletricista Sênior', 'Engenharia', 'clt'),
  demoPerson('demo-p2', 'Bob Torres', 'Coordenador de Campo', 'Operações', 'clt', 44),
  demoPerson('demo-p3', 'Carlos Santos', 'Técnico de Manutenção', 'Manutenção', 'clt'),
  demoPerson('demo-p4', 'Marina Silva', 'Planejadora PCP', 'Engenharia', 'pj'),
  demoPerson('demo-p5', 'Roberto Lima', 'Engenheiro de Segurança', 'SSMA', 'clt'),
];

function demoAllocation(
  id: string,
  person: Person,
  projectId: string,
  roleTitle: string,
  plannedPercentage: number,
  startDate: string,
  endDate: string | null,
  status: PersonProjectAllocation['status'] = 'active',
): PersonProjectAllocation {
  return {
    id,
    organizationId: ORG,
    personId: person.id,
    projectId,
    roleTitle,
    allocationType: 'billable',
    startDate,
    endDate,
    plannedPercentage,
    plannedHoursWeek: Math.round((person.weeklyHours * plannedPercentage) / 100),
    status,
    source: 'manual',
    costCenterId: null,
    justification: plannedPercentage > 100 ? 'Pico de comissionamento autorizado pela diretoria' : null,
    requiresPonto: false,
    requestedBy: null,
    approvedBy: null,
    approvedAt: status === 'active' ? new Date().toISOString() : null,
    rejectionReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    person,
  };
}

/** Allocations of the CURRENT project (any projectId works in demo). */
export function buildDemoTeamAllocations(projectId: string): PersonProjectAllocation[] {
  return [
    demoAllocation('demo-a1', DEMO_PEOPLE[0], projectId, 'Líder técnica', 80, iso(Y, M, 1), iso(Y, M + 5, 28)),
    demoAllocation('demo-a2', DEMO_PEOPLE[1], projectId, 'Coordenação de campo', 60, iso(Y, M - 1, 1), iso(Y, M + 2, 30)),
    demoAllocation('demo-a3', DEMO_PEOPLE[2], projectId, 'Execução elétrica', 70, iso(Y, M, 15), iso(Y, M + 1, 31)),
    demoAllocation('demo-a4', DEMO_PEOPLE[3], projectId, 'Planejamento', 30, iso(Y, M, 1), null),
    demoAllocation(
      'demo-a5',
      DEMO_PEOPLE[4],
      projectId,
      'Inspeção SSMA',
      40,
      iso(Y, M - 3, 1),
      iso(Y, M - 1, 28),
      'ended',
    ),
  ];
}

/** Org-wide live allocations (other projects) — feeds "total empresa". */
export function buildDemoCorporateAllocations(projectId: string): PersonProjectAllocation[] {
  const team = buildDemoTeamAllocations(projectId).filter((a) => a.status === 'active');
  const others: PersonProjectAllocation[] = [
    demoAllocation('demo-b1', DEMO_PEOPLE[1], 'demo-proj-enel', 'Suporte técnico', 40, iso(Y, M, 1), iso(Y, M + 3, 30)),
    demoAllocation('demo-b2', DEMO_PEOPLE[2], 'demo-proj-cemig', 'Manutenção preventiva', 50, iso(Y, M, 1), null),
    demoAllocation('demo-b3', DEMO_PEOPLE[3], 'demo-proj-cemig', 'Planejamento', 20, iso(Y, M, 1), null),
  ];
  return [...team, ...others];
}
