/**
 * Aceitar / descartar interpretação operacional (migration 188).
 *
 * Provas de forma: a RPC existe, o guard cede após confirm, a UI e a rota
 * apontam para o caminho certo. Sem I/O de banco — isso é vitest em node.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildContractIntelligence,
  type ContractOperationalInterpretationRow,
} from '@/lib/contracts/intelligence/operational-interpretations';

const read = (path: string) => readFileSync(path, 'utf8');

const migration = read('supabase/migrations/188_operational_interpretation_human_resolve.sql');
const session = read('src/lib/contracts/intelligence/session.ts');
const materialize = read('src/lib/contracts/intelligence/materialize-operational-interpretation.ts');
const route = read(
  'src/app/api/contracts/[id]/operational-interpretations/[interpretationId]/resolve/route.ts',
);
const tab = read('src/components/contracts/intelligence/ContractIntelligenceTab.tsx');

function row(
  over: Partial<ContractOperationalInterpretationRow> = {},
): ContractOperationalInterpretationRow {
  return {
    id: 'interp-1',
    organization_id: 'org',
    contract_id: 'c1',
    analysis_id: 'a1',
    source_document_id: 'doc',
    family: 'insurance_requirements',
    fingerprint: 'fp-seguro',
    normalized_payload: {
      title: 'RC - Danos Corporais e Materiais',
      required_coverage: 300_000,
      confidence: 0.9,
    },
    source_page: 52,
    source_excerpt: 'mínimo R$300.000,00',
    confidence: 0.9,
    provider: 'provedor',
    model: 'modelo',
    pipeline_version: 'contract-operationalization/1.0.0',
    requesting_user_id: null,
    trust_state: 'requires_attention',
    trust_reasons: ['material_financial_exposure'],
    trust_policy_version: 'contract-operational-trust/1.0.0',
    created_at: '2026-09-20T12:00:00.000Z',
    ...over,
  };
}

describe('188 · resolução humana de interpretação operacional', () => {
  it('a migration registra decisão, dismissed e a RPC de resolve', () => {
    expect(migration).toContain('human_decision');
    expect(migration).toContain('attention_resolved_at');
    expect(migration).toContain("'dismissed'");
    expect(migration).toContain('contract_operational_interpretation_resolve');
    expect(migration).toContain("p_decision NOT IN ('confirm', 'dismiss')");
    expect(migration).toContain('contracts.edit');
    expect(migration).toContain('auth.uid()');
    expect(migration).not.toMatch(/p_resolved_by|p_actor_user_id/);
  });

  it('o guard libera insert apex_ai quando o fingerprint foi confirmado', () => {
    expect(migration).toContain('contracts_guard_ai_operational_authority');
    expect(migration).toContain("i.human_decision = 'confirm'");
    expect(migration).toContain('i.fingerprint = fp');
  });

  it('confirm limpa reasons e promove a automatic; dismiss exige nota', () => {
    expect(migration).toContain("trust_state = 'automatic'");
    expect(migration).toContain('trust_reasons = ARRAY[]::text[]');
    expect(migration).toContain("trust_state = 'dismissed'");
    expect(migration).toContain('Dismissal requires a justification');
  });

  it('a sessão resolve via RPC e materializa só em confirm', () => {
    expect(session).toContain('resolveOperationalInterpretation');
    expect(session).toContain('contract_operational_interpretation_resolve');
    expect(session).toContain('materializeOperationalInterpretation');
    expect(session).toMatch(/decision !== 'confirm'[\s\S]*materialization: null/);
  });

  it('a materialização é idempotente por ai_fingerprint da interpretação', () => {
    expect(materialize).toContain('ai_fingerprint: row.fingerprint');
    expect(materialize).toContain('alreadyPresent');
    expect(materialize).toContain('contract_insurance_requirements');
    expect(materialize).toContain('contract_obligations_materialize');
  });

  it('a rota exige contracts.edit e não aceita organizationId do cliente', () => {
    expect(route).toContain("resolveFollowupActor('contracts.edit')");
    expect(route).toContain("z.enum(['confirm', 'dismiss'])");
    expect(route).not.toMatch(/organizationId:\s*z\./);
    expect(route).toContain('resolveOperationalInterpretation');
  });

  it('Aceitar na UI; disclaimer de produto incompleto sumiu', () => {
    expect(tab).toContain('interpretation-accept');
    expect(tab).toContain('onInterpretationDecision');
    expect(tab).not.toMatch(/ainda não existe no produto/);
  });

  it('buildContractIntelligence: Aceitar (automatic) tira da fila; dismiss também', () => {
    const pending = buildContractIntelligence([row()]);
    expect(pending.attentionCount).toBe(1);

    const accepted = buildContractIntelligence([
      row({
        trust_state: 'automatic',
        trust_reasons: [],
        human_decision: 'confirm',
        attention_resolved_at: '2026-09-20T13:00:00.000Z',
        attention_resolved_by: 'u1',
      }),
    ]);
    expect(accepted.attentionCount).toBe(0);
    expect(accepted.structuredCount).toBe(1);

    const dismissed = buildContractIntelligence([
      row({
        trust_state: 'dismissed',
        human_decision: 'dismiss',
        attention_resolved_at: '2026-09-20T13:00:00.000Z',
        attention_resolved_by: 'u1',
        attention_resolution_note: 'Fora do escopo.',
      }),
    ]);
    expect(dismissed.attentionCount).toBe(0);
    expect(dismissed.structuredCount).toBe(0);
    expect(dismissed.total).toBe(1);
  });
});
