import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertOperationalEvidence,
  evaluateOperationalTrust,
} from '@/lib/ai/contract-operationalization';
import { nudgeDecision, shouldEscalate } from '@/lib/platform/followups/state';
import type { ApexFollowupRow } from '@/lib/platform/followups/types';
import { JOB_TYPES, parseJobPayload } from '@/lib/platform/jobs/registry';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/161_contracts_operationalization_release_blockers.sql');
const migration162 = read('supabase/migrations/162_apex_followup_governed_teardown_boundary.sql');
const migration163 = read('supabase/migrations/163_apex_followup_due_state_alignment.sql');

const obligation = (overrides: Record<string, unknown> = {}) => ({
  title: 'Enviar relatório mensal',
  requirement_text: 'Enviar o relatório mensal exigido pelo contrato.',
  responsible_side: 'contracting_organization',
  activation_kind: 'manual',
  activation_offset_days: null,
  activation_fixed_date: null,
  activation_event_text: null,
  due_kind: 'recurring',
  due_offset_days: null,
  due_fixed_date: null,
  calendar_basis: 'calendar_days',
  schedule_anchor: null,
  schedule_anchor_offset_days: null,
  schedule_anchor_text: null,
  recurrence_kind: 'fixed_interval',
  recurrence_interval: 30,
  blocks_billing: true,
  source_page: 1,
  source_excerpt: 'A CONTRATADA deverá enviar o relatório operacional a cada trinta dias.',
  confidence: 0.95,
  ...overrides,
});

const followup = (overrides: Partial<ApexFollowupRow> = {}): ApexFollowupRow => ({
  id: '10000000-0000-0000-0000-000000000001',
  organization_id: '10000000-0000-0000-0000-000000000002',
  source_kind: 'contract',
  source_id: '10000000-0000-0000-0000-000000000003',
  contract_id: '10000000-0000-0000-0000-000000000003',
  goal: 'Obter evidência', expected_evidence: null,
  responsible_user_id: null, responsible_party_id: null, responsible_text: 'Responsável',
  assigned_by: null, assigned_at: null,
  due_date: '2026-09-01', next_expected_event: null, next_expected_event_at: null,
  cadence_days: null, last_nudge_at: null, nudge_count: 0,
  escalate_after_days: null, escalation_target_user_id: null, escalated_at: null,
  verification_mode: 'human_confirmation', verification_rule: null,
  verified_at: null, verified_by: null, verification_evidence_id: null,
  state: 'ACTIVE', state_note: null, closure_basis: null, closed_at: null,
  created_by: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...overrides,
});

describe('final Contracts operationalization release blockers', () => {
  it('rejects every incoherent fixed interval without dropping its valid sibling', () => {
    const result = assertOperationalEvidence({ obligations: [
      obligation(),
      obligation({ recurrence_interval: null }),
      obligation({ recurrence_interval: 0 }),
      obligation({ recurrence_interval: -3 }),
      obligation({ recurrence_kind: 'monthly', recurrence_interval: 30 }),
    ] }, 2);
    expect(result.accepted.obligations).toHaveLength(1);
    expect(result.accepted.obligations[0].recurrence_interval).toBe(30);
    expect(result.rejected).toHaveLength(4);
  });

  it('keeps low confidence and material exposure in attention governance', () => {
    expect(evaluateOperationalTrust('obligations', obligation({ confidence: 0.05 }))).toMatchObject({
      state: 'requires_attention', reasons: ['low_confidence'],
    });
    expect(evaluateOperationalTrust('guarantees', {
      confidence: 0.99, required_amount: 100_000,
    })).toMatchObject({ state: 'requires_attention', reasons: ['material_financial_exposure'] });
    expect(evaluateOperationalTrust('obligations', obligation({ confidence: 0.95 }))).toMatchObject({
      state: 'automatic', reasons: [],
    });
    expect(migration).toContain('contract_operational_interpretations');
    expect(migration).toContain("AI operational fact requires attention: low confidence.");
  });

  it('routes actual Projects facts to the typed schedule-anchor handler', () => {
    expect(migration).toContain("'projects.measurement.schedule_changed', 1, 'contracts.obligation.schedule_anchor.apply'");
    expect(migration).toContain("'projects.measurement.accepted', 1, 'contracts.obligation.schedule_anchor.apply'");
    expect(migration).toContain("WHEN 'measurement' THEN m.expected_at");
    expect(migration).toContain("m.status = 'ACCEPTED' AND m.accepted_at IS NOT NULL");
    expect(migration).toContain('THEN m.accepted_at::date');
    expect(JOB_TYPES).toContain('contracts.obligation.schedule_anchor.apply');
    expect(parseJobPayload('contracts.obligation.schedule_anchor.apply', 1, {
      event_id: '10000000-0000-4000-8000-000000000001',
      event_type: 'projects.measurement.schedule_changed', schema_version: 1,
    })).toBeTruthy();
  });

  it('has a bounded production Follow-up loop with quiet waiting and blocked states', () => {
    expect(JOB_TYPES).toContain('platform.followups.execute');
    expect(parseJobPayload('platform.followups.execute', 1, { as_of: '2026-09-11', limit: 200 })).toBeTruthy();
    expect(() => parseJobPayload('platform.followups.execute', 1, { as_of: '2026-09-11', limit: 501 })).toThrow();
    expect(nudgeDecision(followup({
      state: 'WAITING_EXTERNAL_PARTY', next_expected_event_at: '2026-09-15',
    }), '2026-09-11').shouldNudge).toBe(false);
    expect(nudgeDecision(followup({ state: 'BLOCKED' }), '2026-09-11').shouldNudge).toBe(false);
    expect(shouldEscalate(followup({ state: 'BLOCKED', escalate_after_days: 1 }), '2026-09-11')).toBe(false);
    expect(migration).toContain('FOR UPDATE SKIP LOCKED');
    expect(migration).toContain('apex_followup_verification_attempts');
    expect(migration).toContain('apex_followup_complete_verified_evidence');
    expect(migration163).toContain("f.state IN ('ACTIVE','WAITING_EXTERNAL_PARTY')");
    expect(migration163).not.toContain("f.state IN ('ACTIVE','WAITING_EXTERNAL_PARTY','BLOCKED')");
    expect(read('vercel.json')).toContain('/api/platform/jobs/drain');
  });

  it('never fabricates organization identity as a requesting user and fails partial jobs', () => {
    const handler = read('src/lib/platform/jobs/handlers.ts');
    expect(handler).not.toContain('request.requested_by ?? job.organization_id');
    expect(handler).not.toMatch(/operational\s*=\s*\{\s*error:/);
    expect(handler).toContain('request.contract_id, request.document_id, request.requested_by');
    expect(migration).not.toContain('AND ai_requesting_user_id IS NOT NULL');
  });

  it('allows only privileged DELETE cascades while every UPDATE remains forbidden', () => {
    expect(migration162).toContain("current_user NOT IN ('authenticated','anon')");
    expect(migration162).toContain('pg_trigger_depth() > 1');
    expect(migration162).toContain("current_setting('apex.governed_followup_teardown', true) = 'on'");
    expect(migration162).toContain('LANGUAGE plpgsql SECURITY INVOKER');
    expect(migration162).toContain('apex_followups_reject_history_rewrite');
    expect(migration162).toContain('apex_followups_reject_verification_rewrite');
    expect(migration162).toContain('apex_followup_delete_governed');
  });

  it('does not write Projects, Finance, or Fiscal truth from Contracts', () => {
    const anchorStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.contract_obligations_apply_schedule_anchor');
    const anchorEnd = migration.indexOf('-- 3) Bounded Follow-up execution', anchorStart);
    const anchor = migration.slice(anchorStart, anchorEnd);
    expect(anchor).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.project_measurements/i);
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:finance|fiscal)/i);
  });
});
