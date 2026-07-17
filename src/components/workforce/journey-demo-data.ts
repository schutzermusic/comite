import type { AttendancePunch } from '@/lib/types/people';
import { DEMO_PEOPLE } from '@/components/projects/team-demo-data';

/* ════════════════════════════════════════════════════════════════════
   DEMO / DEMONSTRATION DATASET — Jornada
   ────────────────────────────────────────────────────────────────────
   Used ONLY for visual validation when there are no real punches in
   Supabase. NEVER writes to the database. Consumers surface a "dados
   demonstrativos" badge and block mutations.
   ════════════════════════════════════════════════════════════════════ */

function at(daysAgo: number, h: number, m: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function punch(
  id: string,
  personIdx: number,
  type: AttendancePunch['type'],
  daysAgo: number,
  h: number,
  m: number,
): AttendancePunch {
  const person = DEMO_PEOPLE[personIdx];
  return {
    id,
    organizationId: 'demo-org',
    personId: person.id,
    type,
    occurredAt: at(daysAgo, h, m),
    receivedAt: at(daysAgo, h, m),
    timezone: 'America/Sao_Paulo',
    source: 'web',
    status: 'accepted',
    originalPunchId: null,
    correctionReason: null,
    correctedBy: null,
    clientEventId: null,
    notes: null,
    nsr: null,
    integrityHash: null,
    createdAt: at(daysAgo, h, m),
    updatedAt: at(daysAgo, h, m),
    person,
  };
}

/** Two days of journeys for three people, incl. overtime and a night shift. */
export function buildDemoPunches(): AttendancePunch[] {
  const out: AttendancePunch[] = [];
  let i = 0;
  const id = () => `demo-punch-${i++}`;

  // Alice — dia cheio com hora extra
  out.push(punch(id(), 0, 'clock_in', 1, 7, 52));
  out.push(punch(id(), 0, 'break_start', 1, 12, 3));
  out.push(punch(id(), 0, 'break_end', 1, 13, 1));
  out.push(punch(id(), 0, 'clock_out', 1, 18, 40));

  // Bob — jornada padrão
  out.push(punch(id(), 1, 'clock_in', 1, 8, 3));
  out.push(punch(id(), 1, 'break_start', 1, 12, 0));
  out.push(punch(id(), 1, 'break_end', 1, 13, 0));
  out.push(punch(id(), 1, 'clock_out', 1, 17, 6));

  // Carlos — turno com adicional noturno
  out.push(punch(id(), 2, 'clock_in', 1, 18, 0));
  out.push(punch(id(), 2, 'break_start', 1, 22, 30));
  out.push(punch(id(), 2, 'break_end', 1, 23, 15));
  out.push(punch(id(), 2, 'clock_out', 2, 2, 30));

  // Hoje — Alice em jornada aberta (entrada sem saída)
  out.push(punch(id(), 0, 'clock_in', 0, 7, 58));

  return out;
}
