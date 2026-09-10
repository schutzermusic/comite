import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isValidTransition, verifyEvidence } from '@/lib/platform/followups/state';

const read = (path: string) => readFileSync(path, 'utf8');
const migration159 = read('supabase/migrations/159_contracts_operationalization_release_hardening.sql');
const migration160 = read('supabase/migrations/160_contract_operational_fact_ai_provenance.sql');

describe('contracts operationalization release hardening', () => {
  it('keeps authenticated definer entry points tenant-bound with fixed search_path', () => {
    for (const fn of [
      'organization_has_business_calendar', 'organization_shift_business_days',
      'apex_followup_due_nudges', 'apex_followup_should_escalate',
      'apex_followup_create', 'apex_followup_transition', 'apex_followup_assign',
      'apex_followup_confirm_completion', 'contract_clause_resolve_attention',
    ]) {
      const start = migration159.indexOf(`FUNCTION public.${fn}`);
      expect(start, fn).toBeGreaterThan(-1);
      expect(migration159.slice(start, start + 2_000), fn).toContain('SET search_path = public, pg_temp');
    }
    expect(migration159).toContain('_org IS DISTINCT FROM p_organization_id');
    expect(migration159).toContain("current_user_has_permission('contracts.edit')");
  });

  it('uses actual acceptance, never the planned measurement date, for acceptance anchors', () => {
    expect(migration159).toContain("WHEN 'measurement' THEN m.expected_at");
    expect(migration159).toContain("m.status = 'ACCEPTED' AND m.accepted_at IS NOT NULL");
    expect(migration159).toContain('THEN m.accepted_at::date');
  });

  it('protects full human authority tuples and terminal rows', () => {
    expect(migration159).toContain('Terminal follow-ups are immutable.');
    expect(migration159).toContain('NEW.responsible_user_id, NEW.responsible_party_id, NEW.responsible_text');
    expect(migration159).toContain('NEW.verification_mode, NEW.verification_rule, NEW.verified_at');
    expect(migration159).toContain('NEW.review_status, NEW.reviewed_by, NEW.reviewed_at');
    expect(migration159).toContain('NEW.interpretation_state, NEW.attention_resolved_by, NEW.attention_resolved_at');
    expect(isValidTransition('CANCELLED', 'CANCELLED')).toBe(false);
    expect(isValidTransition('COMPLETED', 'COMPLETED')).toBe(false);
  });

  it('does not expose deterministic evidence completion to the browser', () => {
    const route = read('src/app/api/platform/followups/[id]/complete/route.ts');
    expect(route).not.toContain("z.literal('verified_evidence')");
    expect(route).not.toContain('evidenceId:');
    expect(migration159).toContain(
      'REVOKE ALL ON FUNCTION public.apex_followup_complete_verified_evidence(uuid,uuid,text,date) FROM PUBLIC, anon, authenticated',
    );
    expect(migration159).toContain('Evidence document is outside this follow-up contract/tenant.');
  });

  it('requires tenant-scoped idempotency and session-bound human mutations', () => {
    expect(migration159).toContain('ON public.apex_followups (organization_id, idempotency_key)');
    expect(migration159).toContain('ON CONFLICT (organization_id, idempotency_key)');
    const route = read('src/app/api/platform/followups/route.ts');
    const transition = read('src/app/api/platform/followups/[id]/transition/route.ts');
    const session = read('src/lib/platform/followups/session.ts');
    expect(route).toContain("req.headers.get('Idempotency-Key')");
    expect(route).toContain('createFollowupAsHuman');
    expect(transition).toContain('transitionFollowupAsHuman');
    expect(session).toContain("rpc('apex_followup_create'");
    expect(session).toContain("rpc('apex_followup_transition'");
  });

  it('validates deterministic evidence conservatively', () => {
    expect(verifyEvidence(
      { expectedTaxId: '123', mustCoverDate: '2026-12-31' },
      { documentTaxId: '999', validUntil: '2027-01-01' },
    ).verified).toBe(false);
    expect(verifyEvidence(
      { expectedTaxId: '123', mustCoverDate: '2026-12-31' },
      { documentTaxId: '123', validUntil: '2026-12-30' },
    ).verified).toBe(false);
  });

  it('persists complete immutable AI provenance and explicit partial failures', () => {
    for (const table of [
      'contract_obligation_definitions', 'contract_billing_conditions',
      'contract_guarantees', 'contract_insurance_requirements', 'contract_indexation_rules',
    ]) expect(migration160).toContain(`'${table}'`);
    for (const column of [
      'ai_analysis_id', 'ai_provider', 'ai_model', 'ai_confidence',
      'ai_pipeline_version', 'ai_requesting_user_id', 'ai_evidence', 'ai_fingerprint',
    ]) expect(migration160).toContain(column);

    const operationalizer = read('src/lib/ai/contract-operationalization.ts');
    expect(operationalizer).toContain(".select('ai_fingerprint')");
    expect(operationalizer).toContain('partial_failure: {');
    expect(operationalizer).toContain('materialized_instances: materializedInstances');
    expect(operationalizer).toContain('if (materializeError)');
    expect(operationalizer).toContain('if (countError)');
    expect(operationalizer).toContain('if (completionError)');
    expect(operationalizer).not.toContain('source_excerpt.slice(0, 500)');
  });

  it('does not move schedule or financial truth into Contracts', () => {
    const operationalizer = read('src/lib/ai/contract-operationalization.ts');
    expect(operationalizer).not.toMatch(/\.from\(['"](?:finance|fiscal|project_measurements|projects)/);
    expect(migration159).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.project_measurements/i);
    expect(migration159).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:finance|fiscal)/i);
  });
});
