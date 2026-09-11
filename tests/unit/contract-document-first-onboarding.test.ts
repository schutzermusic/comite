import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildContractOnboardingResult,
  resolveEffectiveDate,
  type ContractOnboardingExtraction,
  type DocumentaryFact,
} from '@/lib/contracts/onboarding/document-first';

const source = (path: string) => readFileSync(path, 'utf8');
const fact = <T>(value: T, overrides: Partial<DocumentaryFact<T>> = {}): DocumentaryFact<T> => ({
  value, page: 1, excerpt: 'Trecho documental inequívoco.', confidence: 0.96,
  ambiguous: false, conflicting: false, ...overrides,
});

function extraction(): ContractOnboardingExtraction {
  return {
    contract_number: fact('CW40999'),
    title: fact('Manutenção de subestações'),
    counterparty: fact('CEMIG DISTRIBUIÇÃO S.A.'),
    contract_type: fact('Prestação de serviços'),
    object: fact('Manutenção preventiva e corretiva.'),
    documentary_state: fact('signed' as const),
    signature_date: fact('2026-08-31'),
    start_date: fact<string | null>(null, { page: null, excerpt: null, confidence: 0 }),
    effective_date: { ...fact<string | null>(null), derivation: 'from_signature' },
    end_date: fact('2028-08-31'),
    renewal_date: fact<string | null>(null, { page: null, excerpt: null, confidence: 0 }),
    total_value: fact(18_400_000),
    monthly_value: fact<number | null>(null, { page: null, excerpt: null, confidence: 0 }),
    currency: fact('BRL'),
    payment_terms: fact('30 dias após medição aprovada'),
    indexation: fact('IPCA anual'),
    retention: fact('Retenção de 5%'),
    risk: { ...fact('high' as const), factors: ['multa contratual relevante', 'garantia de execução'] },
  };
}

describe('document-first contract onboarding trust', () => {
  it('prefills strong documentary facts including deterministic effective-from-signature', () => {
    const result = buildContractOnboardingResult(extraction());
    expect(result.prefill).toMatchObject({
      contractNumber: 'CW40999', title: 'Manutenção de subestações',
      counterparty: 'CEMIG DISTRIBUIÇÃO S.A.', scopeSummary: 'Manutenção preventiva e corretiva.',
      signedDate: '2026-08-31', startDate: '2026-08-31', totalValue: 18_400_000,
    });
    expect(resolveEffectiveDate(extraction()).value).toBe('2026-08-31');
  });

  it('routes ambiguous and conflicting evidence to attention instead of prefill', () => {
    const raw = extraction();
    raw.start_date = fact('2026-09-01', { ambiguous: true });
    raw.total_value = fact(18_400_000, { conflicting: true });
    const result = buildContractOnboardingResult(raw);
    expect(result.fields.find((f) => f.key === 'start_date')).toMatchObject({ state: 'attention', reason: 'AMBIGUOUS' });
    expect(result.fields.find((f) => f.key === 'total_value')).toMatchObject({ state: 'attention', reason: 'CONFLICTING_EVIDENCE' });
    expect(result.prefill.totalValue).toBeUndefined();
  });

  it('keeps missing values unknown and never fabricates owner or project', () => {
    const raw = extraction();
    raw.total_value = fact<number | null>(null, { page: null, excerpt: null, confidence: 0 });
    const result = buildContractOnboardingResult(raw);
    expect(result.fields.find((f) => f.key === 'total_value')).toMatchObject({
      state: 'unknown', reason: 'NOT_FOUND_IN_DOCUMENT', value: null,
    });
    expect(result.fields.find((f) => f.key === 'responsible_internal')).toMatchObject({
      state: 'attention', reason: 'INTERNAL_DECISION_REQUIRED', value: null,
    });
    expect(result.fields.find((f) => f.key === 'project')).toMatchObject({
      state: 'attention', reason: 'PROJECT_MAPPING_REQUIRED', value: null,
    });
    expect(result.prefill).not.toHaveProperty('ownerUserId');
    expect(result.prefill).not.toHaveProperty('projectId');
  });

  it('keeps risk as a recommendation requiring governed confirmation', () => {
    const result = buildContractOnboardingResult(extraction());
    expect(result.fields.find((f) => f.key === 'risk')).toMatchObject({
      value: 'high', state: 'attention', reason: 'GOVERNED_CONFIRMATION_REQUIRED',
    });
    expect(result.prefill).not.toHaveProperty('riskLevel');
  });
});

describe('document-first integration contract', () => {
  const component = source('src/components/contracts/contract-upload.tsx');
  const migration = source('supabase/migrations/166_contract_document_first_onboarding.sql');
  const route = source('src/app/api/contracts/onboarding/route.ts');
  const finalRoute = source('src/app/api/contracts/onboarding/[id]/route.ts');

  it('opens with document as the primary business workflow and preserves manual registration', () => {
    expect(component).toContain("useState<OnboardingView>('entry')");
    expect(component).toContain('Enviar contrato');
    expect(component).toContain('Cadastrar manualmente');
    expect(component.indexOf('Enviar contrato')).toBeLessThan(component.indexOf('Cadastrar manualmente'));
    expect(component).toContain("setView('manual')");
    expect(component).toContain("const STEPS = ['Identidade', 'Vigência e valor', 'Projeto', 'Documento', 'Revisão']");
  });

  it('uploads before fields, keeps the original for retry, and does not ask twice', () => {
    expect(component).toContain('sendContractDocument(selected)');
    expect(component).toContain('O arquivo foi preservado.');
    expect(component).toContain('Não é necessário enviar novamente.');
    expect(component).toContain('onboardingIntakeId: intakeId');
    expect(route).toContain('content_sha256: hash');
    expect(finalRoute).toContain("contract_clause_extraction_request");
  });

  it('preserves raw interpretation beside final human values and enforces idempotency', () => {
    expect(migration).toContain('extraction jsonb');
    expect(migration).toContain('final_values jsonb');
    expect(migration).toContain('coni_content_actor_unique');
    expect(migration).toContain('contract_documents_original_content_once');
    expect(migration).toContain("IF r.contract_id IS NOT NULL THEN");
    expect(migration).toContain("RETURN jsonb_build_object('contract_id',r.contract_id,'document_id',existing_document_id,'reused',true)");
  });

  it('keeps tenant/RLS boundaries and does not write Project, Finance or Fiscal domains', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('organization_id=public.current_user_organization_id()');
    expect(migration).toContain('uploaded_by=auth.uid()');
    expect(migration).toContain('FROM public.projects p');
    expect(migration).not.toMatch(/INSERT INTO public\.(projects|finance_|fiscal_)/i);
  });

  it('keeps technology/provider terminology out of the rendered business copy', () => {
    const jsxStrings = [...component.matchAll(/>([^<>{}\n][^<>{}]*)</g)].map((match) => match[1]).join(' ');
    expect(jsxStrings).not.toMatch(/\b(?:IA|AI|LLM|Claude|Anthropic)\b/i);
    expect(component).toContain('Apex está lendo o contrato');
    expect(component).toContain('Requer sua atenção');
    expect(component).toContain('Não identificado no documento');
  });
});
