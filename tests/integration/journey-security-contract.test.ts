import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../supabase/migrations/077_journey_management_center.sql', import.meta.url),
  'utf8',
);

describe('contrato de segurança da central de Jornada', () => {
  it('aplica o mesmo helper de escopo em marcações, evidências e aprovações', () => {
    expect(migration).toContain('current_user_can_access_journey_person(person_id, false)');
    expect(migration).toContain('current_user_can_access_journey_person(person_id, true)');
    expect(migration).toContain('CREATE POLICY location_evidence_select');
    expect(migration).toContain('CREATE POLICY authentication_evidence_select');
    expect(migration).toContain('CREATE POLICY journey_balance_approvals_select');
  });

  it('preserva o evento fiscal original na correção transacional', () => {
    const correction = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.correct_attendance_punch'),
      migration.indexOf('-- Employee undo'),
    );
    expect(correction).toContain("SET status = 'corrected'");
    expect(correction).toContain('original_punch_id');
    expect(correction).not.toMatch(/SET\s+(occurred_at|type|nsr|integrity_hash)\s*=/i);
    expect(correction).toContain("'attendance.corrected'");
  });

  it('desfaz somente de forma lógica e preserva NSR/hash', () => {
    const undo = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.undo_own_attendance_punch'),
      migration.indexOf('-- Approval and closing transitions'),
    );
    expect(undo).toContain("interval '5 minutes'");
    expect(undo).toContain("SET status = 'cancelled'");
    expect(undo).not.toMatch(/DELETE\s+FROM\s+public\.attendance_punches/i);
    expect(undo).not.toMatch(/SET\s+(nsr|integrity_hash)\s*=/i);
  });

  it('bloqueia alterações e fechamento indevido de competência', () => {
    expect(migration).toContain("cp.status = 'closed'");
    expect(migration).toContain('Ainda há jornadas sem decisão de saldo no seu escopo');
    expect(migration).toContain('Ainda há jornadas com saldo provisório sem decisão');
    expect(migration).toContain("p_action = 'reopen'");
    expect(migration).toContain('Informe o motivo da reabertura');
  });
});
