/**
 * Regression coverage for RESUMING an unfinished Document-First contract
 * onboarding.
 *
 * The defect this proves closed: a real intake (document preserved, reading
 * finished, REQUIRES_ATTENTION, contract_id NULL) had no product path back.
 * The only visible way forward was uploading the same PDF again — a second
 * reading of the same document and a second registration of the same contract.
 *
 * What is asserted here:
 *   · which intakes are resumable, and that a finalized one never is;
 *   · that the list is org-scoped, own-user-scoped and permission-gated;
 *   · that resuming RESTORES the persisted reading — identified, attention,
 *     unknown, evidence and prefill — instead of recomputing it;
 *   · that resuming is READ-ONLY: no upload, no CONTRACT_EXTRACTION, no
 *     CONTRACT_OPERATIONALIZATION, no mutation, repeatable;
 *   · that finalization still goes through the canonical RPC path and cannot
 *     fabricate human authority.
 *
 * NO live Anthropic call is made in this file, and the real production intake
 * (JA10182283 / 5ca15802-7a56-40b2-b2ac-a3b36e326982) is never referenced,
 * read or written: every fixture below is local and synthetic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ACTIVE_INTAKE_STATUSES,
  CONTRACT_INTAKE_STATUSES,
  RESUMABLE_INTAKE_STATUSES,
  RECOVERABLE_INTAKE_STATUSES,
  formValuesFromIntakePrefill,
  intakeContinuityKind,
  isActiveIntake,
  isResumableIntake,
  onboardingResumeHref,
  resumedIntakeView,
  selectActiveIntakes,
  summarizeIntakeContinuity,
  type IntakeContinuityRow,
} from '@/lib/contracts/onboarding/resume';
import {
  buildContractOnboardingResult,
  type ContractOnboardingExtraction,
  type DocumentaryFact,
} from '@/lib/contracts/onboarding/document-first';

const source = (path: string) => readFileSync(path, 'utf8');

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const USER_A = '33333333-3333-3333-3333-333333333333';
const INTAKE_A = '77777777-7777-7777-7777-777777777777';
const INTAKE_B = '88888888-8888-8888-8888-888888888888';

/* ------------------------------------------------------------------ *
 * Local fixture: a processed intake awaiting governed human decisions. *
 * ------------------------------------------------------------------ */

const fact = <T>(value: T, overrides: Partial<DocumentaryFact<T>> = {}): DocumentaryFact<T> => ({
  value, page: 3, excerpt: 'Trecho documental inequívoco do contrato.', confidence: 0.95,
  ambiguous: false, conflicting: false, ...overrides,
});
const absent = <T>(): DocumentaryFact<T | null> =>
  ({ value: null, page: null, excerpt: null, confidence: 0, ambiguous: false, conflicting: false });

function fixtureExtraction(): ContractOnboardingExtraction {
  return {
    contract_number: fact('CT-2026-014'),
    title: fact('Manutenção de subestações — Lote 2'),
    // Contraparte ambígua: exatamente o tipo de exceção que exige a pessoa.
    counterparty: fact('CLIENTE EXEMPLO S.A.', { ambiguous: true }),
    contract_type: fact('Prestação de serviços'),
    object: fact('Manutenção preventiva e corretiva de subestações.'),
    documentary_state: fact('signed' as const),
    signature_date: fact('2026-03-10'),
    start_date: fact('2026-04-01'),
    effective_date: { ...fact('2026-04-01'), derivation: 'explicit' as const },
    end_date: fact('2028-03-31'),
    renewal_date: absent<string>(),
    total_value: fact(4_250_000),
    monthly_value: absent<number>(),
    currency: fact('BRL'),
    payment_terms: fact('30 dias após medição aprovada'),
    indexation: fact('IPCA anual'),
    retention: absent<string>(),
    risk: { ...fact('medium' as const), factors: ['multa contratual relevante'] },
  };
}

const fixtureResult = buildContractOnboardingResult(fixtureExtraction());

const requiresAttentionRow = (): IntakeContinuityRow => ({
  id: INTAKE_A,
  status: 'REQUIRES_ATTENTION',
  contract_id: null,
  file_name: 'Contrato exemplo.pdf',
  attention_count: fixtureResult.attentionCount,
  received_at: '2026-09-10T12:00:00.000Z',
  completed_at: '2026-09-10T12:02:00.000Z',
  structured_result: fixtureResult,
});

/* ------------------------------------------------------------------ *
 * 1. Resumable lifecycle                                              *
 * ------------------------------------------------------------------ */

describe('resumable intake states', () => {
  it('uses the canonical status vocabulary of migration 166 and invents none', () => {
    const migration = source('supabase/migrations/166_contract_document_first_onboarding.sql');
    for (const status of CONTRACT_INTAKE_STATUSES) expect(migration).toContain(`'${status}'`);
    // O CHECK do banco é a lista fechada; nada além dela existe no domínio.
    expect(CONTRACT_INTAKE_STATUSES).toHaveLength(9);
  });

  it('treats a processed, unfinished REQUIRES_ATTENTION intake as resumable', () => {
    expect(isResumableIntake(requiresAttentionRow())).toBe(true);
    expect(intakeContinuityKind(requiresAttentionRow())).toBe('resume');
  });

  it('treats READY (no exceptions, still not registered) as resumable too', () => {
    expect(isResumableIntake({ status: 'READY', contract_id: null })).toBe(true);
  });

  it('keeps FAILED recovery distinct from attention: it is not a resumable result', () => {
    expect(intakeContinuityKind({ status: 'FAILED', contract_id: null })).toBe('recover');
    expect(isResumableIntake({ status: 'FAILED', contract_id: null })).toBe(false);
    expect(RECOVERABLE_INTAKE_STATUSES).toEqual(['FAILED']);
    expect(RESUMABLE_INTAKE_STATUSES).not.toContain('FAILED');
  });

  it('keeps an in-flight reading visible but not resumable', () => {
    for (const status of ['RECEIVED', 'QUEUED', 'READING', 'STRUCTURING'] as const) {
      expect(intakeContinuityKind({ status, contract_id: null })).toBe('processing');
      expect(isActiveIntake({ status, contract_id: null })).toBe(true);
      expect(isResumableIntake({ status, contract_id: null })).toBe(false);
    }
  });

  it('never exposes a finalized or discarded intake as an active draft', () => {
    expect(isActiveIntake({ status: 'REGISTERED', contract_id: 'c1' })).toBe(false);
    expect(isActiveIntake({ status: 'CANCELLED', contract_id: null })).toBe(false);
    // contract_id vence o status: contrato existente nunca reabre como rascunho.
    expect(isActiveIntake({ status: 'REQUIRES_ATTENTION', contract_id: 'c1' })).toBe(false);
    expect(ACTIVE_INTAKE_STATUSES).not.toContain('REGISTERED');
    expect(ACTIVE_INTAKE_STATUSES).not.toContain('CANCELLED');
  });

  it('lists only active intakes, newest first, and drops the finalized one', () => {
    const items = selectActiveIntakes([
      requiresAttentionRow(),
      { id: INTAKE_B, status: 'REGISTERED', contract_id: 'contract-1', file_name: 'ja-cadastrado.pdf',
        received_at: '2026-09-11T12:00:00.000Z', structured_result: null },
      { id: 'later', status: 'FAILED', contract_id: null, file_name: 'falhou.pdf',
        received_at: '2026-09-12T12:00:00.000Z', structured_result: null },
    ]);
    expect(items.map((item) => item.id)).toEqual(['later', INTAKE_A]);
    expect(items.map((item) => item.id)).not.toContain(INTAKE_B);
  });
});

/* ------------------------------------------------------------------ *
 * 2. Business context + Apex-native language                          *
 * ------------------------------------------------------------------ */

describe('continuity item presentation', () => {
  const item = summarizeIntakeContinuity(requiresAttentionRow());

  it('carries real business context taken from the persisted reading', () => {
    expect(item.contractNumber).toBe('CT-2026-014');
    expect(item.title).toBe('Manutenção de subestações — Lote 2');
    expect(item.fileName).toBe('Contrato exemplo.pdf');
    expect(item.attentionCount).toBeGreaterThan(0);
    expect(item.receivedAt).toBe('2026-09-10T12:00:00.000Z');
  });

  it('never presents an attention-state value as confirmed business context', () => {
    // A contraparte do fixture é AMBÍGUA; exibi-la como contexto seria afirmar
    // uma leitura que o próprio domínio recusou.
    expect(fixtureResult.fields.find((f) => f.key === 'counterparty')?.state).toBe('attention');
    expect(item.counterparty).toBeNull();
  });

  it('speaks the product language and names no provider, model or technology', () => {
    const domain = source('src/lib/contracts/onboarding/resume.ts');
    const component = source('src/components/contracts/ContractOnboardingContinuity.tsx');
    expect(item.stateLabel).toBe('Leitura concluída — requer sua atenção');
    expect(item.actionLabel).toBe('Continuar cadastro');
    for (const forbidden of [/\bClaude\b/i, /\bAnthropic\b/i, /\bLLM\b/i, /\bprompt\b/i, /\bopus\b/i, /\bsonnet\b/i]) {
      expect(domain).not.toMatch(forbidden);
      expect(component).not.toMatch(forbidden);
    }
    expect(component).toContain('Cadastros em andamento');
    // O rótulo da ação vem do domínio, não está escrito solto na tela.
    expect(component).toContain('{item.actionLabel}');
  });

  it('gives every item a durable URL instead of component memory', () => {
    expect(item.href).toBe(`/contratos/onboarding/${INTAKE_A}`);
    expect(onboardingResumeHref(INTAKE_A)).toBe(item.href);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The list endpoint: org scoping, RLS/RBAC, read-only              *
 * ------------------------------------------------------------------ */

const authState: { value: Record<string, unknown> } = { value: {} };
const recorded: { filters: Array<[string, unknown, unknown]>; table: string | null; columns: string | null } = {
  filters: [], table: null, columns: null,
};
let queryRows: unknown[] = [];

vi.mock('@/lib/contracts/onboarding/server-auth', () => ({
  requireContractOnboardingSession: vi.fn(async () => authState.value),
}));
const serviceRpc = vi.fn();
vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => ({ rpc: serviceRpc, from: vi.fn(), storage: { from: vi.fn() } }),
}));
const fastDrain = vi.fn();
vi.mock('@/lib/platform/jobs/fast-path', () => ({ scheduleFastDrain: fastDrain }));
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: vi.fn() }));

function queryBuilder() {
  const builder: Record<string, unknown> = {};
  const record = (name: string) => (...args: unknown[]) => {
    if (name === 'select') recorded.columns = String(args[0]);
    else recorded.filters.push([name, args[0], args[1]]);
    return builder;
  };
  for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit', 'gt', 'lt', 'neq']) {
    builder[method] = record(method);
  }
  (builder as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: queryRows, error: null });
  return builder;
}

/** Chama a rota e exige uma resposta: um handler que não responde é, por si só, um defeito. */
async function callListEndpoint() {
  const { GET } = await import('@/app/api/contracts/onboarding/route');
  const response = await GET();
  if (!response) throw new Error('GET /api/contracts/onboarding devolveu resposta vazia.');
  return response;
}

const authorizedSession = () => ({
  organizationId: ORG_A,
  user: { id: USER_A },
  supabase: { from: (table: string) => { recorded.table = table; return queryBuilder(); } },
});

describe('GET /api/contracts/onboarding — unfinished intakes', () => {
  beforeEach(() => {
    recorded.filters = [];
    recorded.table = null;
    recorded.columns = null;
    queryRows = [];
    serviceRpc.mockReset();
    fastDrain.mockReset();
  });

  it('scopes the read to the active organization, the caller and unfinished intakes', async () => {
    authState.value = authorizedSession();
    queryRows = [requiresAttentionRow()];
    const response = await callListEndpoint();
    const body = await response.json() as { ok: boolean; intakes: Array<{ id: string; kind: string }> };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.intakes.map((i) => i.id)).toEqual([INTAKE_A]);
    expect(body.intakes[0].kind).toBe('resume');

    expect(recorded.table).toBe('contract_onboarding_intakes');
    expect(recorded.filters).toContainEqual(['eq', 'organization_id', ORG_A]);
    expect(recorded.filters).toContainEqual(['is', 'contract_id', null]);
    const statuses = recorded.filters.find(([name]) => name === 'in');
    expect(statuses?.[1]).toBe('status');
    expect(statuses?.[2]).toEqual([...ACTIVE_INTAKE_STATUSES]);
    expect(statuses?.[2]).not.toContain('REGISTERED');
  });

  it('reads through the AUTHENTICATED client, never the service role', async () => {
    authState.value = authorizedSession();
    await callListEndpoint();
    // O service role ignoraria a política de RLS; a listagem não pode usá-lo.
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it('mutates nothing: no enqueue, no finalize, no fast drain, no upload', async () => {
    authState.value = authorizedSession();
    await callListEndpoint();
    await callListEndpoint();
    await callListEndpoint();
    expect(serviceRpc).not.toHaveBeenCalled();
    expect(fastDrain).not.toHaveBeenCalled();
    const writes = recorded.filters.filter(([name]) => ['insert', 'update', 'upsert', 'delete'].includes(name));
    expect(writes).toHaveLength(0);
  });

  it('returns the session error untouched when the caller is not authorized', async () => {
    const denied = new Response(JSON.stringify({ ok: false, error: 'Não autenticado.' }), { status: 401 });
    authState.value = { error: denied };
    const response = await callListEndpoint();
    expect(response.status).toBe(401);
  });

  it('cannot return another organization: the query is bound to the caller session org', async () => {
    authState.value = { ...authorizedSession(), organizationId: ORG_B };
    await callListEndpoint();
    expect(recorded.filters).toContainEqual(['eq', 'organization_id', ORG_B]);
    expect(recorded.filters).not.toContainEqual(['eq', 'organization_id', ORG_A]);
  });
});

describe('tenancy is enforced in the database, not only in the route', () => {
  const migration = source('supabase/migrations/166_contract_document_first_onboarding.sql');

  it('keeps RLS, own-user scoping and the contracts permission on the intake table', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('organization_id=public.current_user_organization_id()');
    expect(migration).toContain('uploaded_by=auth.uid()');
    expect(migration).toContain("public.current_user_has_permission('contracts.create')");
    expect(migration).toContain('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.contract_onboarding_intakes');
  });

  it('keeps GET-by-id authorization-protected and scoped to org + uploader', () => {
    const byId = source('src/app/api/contracts/onboarding/[id]/route.ts');
    expect(byId).toContain('requireContractOnboardingSession()');
    expect(byId).toContain("eq('organization_id', auth.organizationId)");
    expect(byId).toContain("eq('uploaded_by', auth.user.id)");
    expect(byId).toContain('Entrada de contrato não encontrada.');
  });

  it('requires contract permissions for every onboarding session, list included', () => {
    const auth = source('src/lib/contracts/onboarding/server-auth.ts');
    expect(auth).toContain("keys.has('contracts.create')");
    expect(auth).toContain("keys.has('contracts.upload_file')");
    expect(auth).toContain("keys.has('contracts.analyze_with_ai')");
    expect(source('src/app/api/contracts/onboarding/route.ts')).toContain('export async function GET()');
  });
});

/* ------------------------------------------------------------------ *
 * 4. Restoring the processed result                                   *
 * ------------------------------------------------------------------ */

describe('resume restores the persisted reading without recomputing it', () => {
  it('reopens a processed intake directly on the result screen', () => {
    expect(resumedIntakeView({ status: 'REQUIRES_ATTENTION', structured_result: fixtureResult })).toBe('summary');
    expect(resumedIntakeView({ status: 'READY', structured_result: fixtureResult })).toBe('summary');
    // Sem resultado persistido não há o que reconstruir: acompanha a leitura.
    expect(resumedIntakeView({ status: 'REQUIRES_ATTENTION', structured_result: null })).toBe('processing');
    expect(resumedIntakeView({ status: 'FAILED', structured_result: null })).toBe('processing');
    expect(resumedIntakeView({ status: 'READING', structured_result: null })).toBe('processing');
  });

  it('restores identified, attention and unknown fields exactly as classified', () => {
    const byState = (state: string) => fixtureResult.fields.filter((f) => f.state === state).map((f) => f.key);
    expect(byState('identified')).toContain('contract_number');
    expect(byState('attention')).toEqual(expect.arrayContaining([
      'counterparty', 'risk', 'responsible_internal', 'project',
    ]));
    expect(byState('unknown')).toEqual(expect.arrayContaining(['renewal_date', 'monthly_value', 'retention']));
    expect(fixtureResult.identifiedCount + fixtureResult.attentionCount + fixtureResult.unknownCount)
      .toBe(fixtureResult.fields.length);
  });

  it('drives the exception review from the domain vocabulary, not hard-coded fields', () => {
    const reasons = new Set(fixtureResult.fields.filter((f) => f.state === 'attention').map((f) => f.reason));
    expect(reasons).toContain('AMBIGUOUS');
    expect(reasons).toContain('INTERNAL_DECISION_REQUIRED');
    expect(reasons).toContain('PROJECT_MAPPING_REQUIRED');
    const component = source('src/components/contracts/contract-upload.tsx');
    expect(component).toContain("field.state === 'attention'");
    expect(component).toContain("field.state === 'unknown'");
    // Nenhum contrato, número ou campo real é citado pelo código.
    expect(component).not.toContain('JA10182283');
    expect(source('src/lib/contracts/onboarding/resume.ts')).not.toContain('JA10182283');
  });

  it('leaves unknown fields unknown instead of inventing a value', () => {
    for (const key of ['renewal_date', 'monthly_value', 'retention']) {
      const field = fixtureResult.fields.find((f) => f.key === key);
      expect(field).toMatchObject({ state: 'unknown', reason: 'NOT_FOUND_IN_DOCUMENT', value: null });
    }
    expect(fixtureResult.prefill).not.toHaveProperty('renewalDate');
    expect(fixtureResult.prefill).not.toHaveProperty('monthlyValue');
  });

  it('restores the documentary evidence beside each field', () => {
    const identified = fixtureResult.fields.find((f) => f.key === 'contract_number');
    expect(identified?.page).toBe(3);
    expect(identified?.excerpt).toContain('Trecho documental');
    const component = source('src/components/contracts/contract-upload.tsx');
    expect(component).toContain('{field.excerpt}');
    expect(component).toContain('Página {field.page}');
  });

  it('restores the prefill through the SAME translation used right after the reading', () => {
    const values = formValuesFromIntakePrefill(fixtureResult.prefill);
    expect(values).toMatchObject({
      contractNumber: 'CT-2026-014',
      title: 'Manutenção de subestações — Lote 2',
      startDate: '2026-04-01',
      endDate: '2028-03-31',
      signedDate: '2026-03-10',
      totalValue: '4250000',
      paymentTerms: '30 dias após medição aprovada',
    });
    // Campo não identificado permanece vazio: ausência não vira zero nem chute.
    expect(values.monthlyValue).toBe('');
    expect(values.renewalDate).toBe('');
    // Contraparte ambígua não preenche o formulário.
    expect(values.counterparty).toBe('');
  });

  it('never accepts the risk recommendation by default, on first read or on resume', () => {
    expect(formValuesFromIntakePrefill(fixtureResult.prefill).riskLevel).toBe('');
    expect(fixtureResult.prefill).not.toHaveProperty('riskLevel');
    const component = source('src/components/contracts/contract-upload.tsx');
    // Uma única tradução prefill -> formulário, usada pela leitura e pela retomada.
    expect(component.match(/formValuesFromIntakePrefill\(/g)?.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Resume is read-only: no upload, no model call, idempotent        *
 * ------------------------------------------------------------------ */

describe('resuming never re-uploads and never calls the model', () => {
  const resumePage = source('src/app/(main)/contratos/onboarding/[intakeId]/page.tsx');
  const component = source('src/components/contracts/contract-upload.tsx');
  const continuity = source('src/components/contracts/ContractOnboardingContinuity.tsx');

  it('asks for no document: the resume path never authorizes or performs an upload', () => {
    expect(resumePage).not.toContain('sendContractDocument');
    expect(resumePage).not.toContain('upload-authorize');
    expect(continuity).not.toContain('sendContractDocument');
    // O PDF original continua sendo o documento da entrada.
    expect(component).toContain('Documento original recebido e preservado. Não é necessário enviar novamente.');
    expect(resumePage).toContain('O documento original já está preservado.');
  });

  it('reuses the stored document reference: finalization promotes file_path, never a new object', () => {
    const migration = source('supabase/migrations/166_contract_document_first_onboarding.sql');
    expect(migration).toContain('VALUES(p_organization_id,c.id,r.file_name,r.file_path');
    expect(migration).toContain('r.content_sha256');
    // Nenhum SHA novo, nenhum objeto novo de Storage no caminho de retomada.
    expect(resumePage).not.toContain('createSignedUploadUrl');
    expect(resumePage).not.toContain('uploadToSignedUrl');
  });

  it('triggers no CONTRACT_EXTRACTION on resume', () => {
    expect(resumePage).not.toContain('contract_onboarding_enqueue');
    expect(resumePage).not.toContain('retryContractIntake');
    expect(continuity).not.toContain('contract_onboarding_enqueue');
    // A retomada usa apenas o GET por id.
    expect(resumePage).toContain('getContractIntake(intakeId)');
  });

  it('triggers no CONTRACT_OPERATIONALIZATION on resume', () => {
    expect(resumePage).not.toContain('contract_clause_extraction_request');
    expect(resumePage).not.toContain('scheduleFastDrain');
    expect(continuity).not.toContain('contract_clause_extraction_request');
    // A operacionalização segue existindo, e só depois da finalização humana.
    expect(source('src/app/api/contracts/onboarding/[id]/route.ts'))
      .toContain('contract_clause_extraction_request');
  });

  it('reconstructs from the persisted intake and mutates nothing while doing it', () => {
    expect(component).toContain('resumeIntake');
    expect(component).toContain('setForm((previous) => ({ ...previous, ...formValuesFromIntakePrefill(resumeIntake.structured_result?.prefill) }))');
    // Reconstrução é leitura: a retomada não escreve no resultado estruturado.
    expect(component).not.toContain('setIntake({ ...resumeIntake');
    expect(resumePage).not.toContain('structured_result =');
    expect(resumePage).not.toMatch(/method:\s*'(POST|PATCH|PUT|DELETE)'/);
  });

  it('is idempotent: opening the same intake repeatedly yields the same reconstruction', () => {
    const first = formValuesFromIntakePrefill(fixtureResult.prefill);
    const second = formValuesFromIntakePrefill(fixtureResult.prefill);
    const third = formValuesFromIntakePrefill(fixtureResult.prefill);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(summarizeIntakeContinuity(requiresAttentionRow()))
      .toEqual(summarizeIntakeContinuity(requiresAttentionRow()));
    // O fixture continua intocado depois de tudo isso.
    expect(fixtureResult.attentionCount).toBe(requiresAttentionRow().attention_count);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Finalization stays canonical                                     *
 * ------------------------------------------------------------------ */

describe('finalization is the existing canonical path', () => {
  const resumePage = source('src/app/(main)/contratos/onboarding/[intakeId]/page.tsx');
  const portfolio = source('src/app/(main)/contratos/page.tsx');
  const migration = source('supabase/migrations/166_contract_document_first_onboarding.sql');

  it('both entry points send the identical payload to the same finalize call', () => {
    expect(resumePage).toContain('finalizeContractIntake(draft.onboardingIntakeId, buildIntakeFinalValues(draft))');
    expect(portfolio).toContain('finalizeContractIntake(draft.onboardingIntakeId, buildIntakeFinalValues(draft))');
    expect(source('src/app/api/contracts/onboarding/[id]/route.ts'))
      .toContain("rpc('contract_onboarding_finalize'");
  });

  it('creates no alternate contract and cannot duplicate one', () => {
    expect(resumePage).not.toContain('persistContract');
    expect(resumePage).not.toContain("from('contracts')");
    // A RPC devolve o contrato existente em vez de criar um segundo.
    expect(migration).toContain('IF r.contract_id IS NOT NULL THEN');
    expect(migration).toContain("'reused',true");
    expect(migration).toContain('contract_documents_original_content_once');
  });

  it('preserves provenance: the machine reading survives beside the human outcome', () => {
    expect(migration).toContain('extraction jsonb');
    expect(migration).toContain('structured_result jsonb');
    expect(migration).toContain('final_values=p_final');
    const finalizeValues = source('src/lib/contracts/onboarding/finalize-values.ts');
    expect(finalizeValues).not.toContain('reviewed_by');
    expect(finalizeValues).not.toContain('approved_by');
    expect(finalizeValues).not.toContain('verified_by');
  });

  it('cannot fabricate human authority: the actor comes from the authenticated session', () => {
    const byId = source('src/app/api/contracts/onboarding/[id]/route.ts');
    expect(byId).toContain('p_actor: auth.user.id');
    expect(byId).not.toContain('p_actor: body');
    expect(migration).toContain('IF NOT FOUND OR r.uploaded_by<>p_actor THEN');
    expect(migration).toContain('Internal responsible person must be an active organization member.');
    expect(migration).toContain('Risk classification requires a governed human decision.');
    expect(resumePage).not.toContain('owner_user_id:');
  });

  it('hides a finalized intake from the active list and offers the contract instead', () => {
    expect(resumePage).toContain("kind === 'closed'");
    expect(resumePage).toContain('Este cadastro já foi concluído');
    expect(resumePage).toContain('Abrir contrato');
  });
});

/* ------------------------------------------------------------------ *
 * 7. No model-routing regression, no migration                        *
 * ------------------------------------------------------------------ */

describe('no routing or schema regression comes with the resume feature', () => {
  it('adds no migration: the resumable state was already durable', () => {
    const migrations = source('supabase/migrations/166_contract_document_first_onboarding.sql');
    expect(migrations).toContain('CREATE TABLE public.contract_onboarding_intakes');
    // A retomada lê colunas que já existem; nada novo é exigido do banco.
    for (const column of ['structured_result', 'attention_count', 'file_name', 'contract_id', 'received_at']) {
      expect(migrations).toContain(column);
    }
  });

  it('touches no provider transport, task policy or model routing', () => {
    const resumeModule = source('src/lib/contracts/onboarding/resume.ts');
    for (const forbidden of ['anthropic', 'CONTRACT_EXTRACTION', 'CONTRACT_OPERATIONALIZATION', '@/lib/ai/']) {
      expect(resumeModule.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // Nem a retomada nem a faixa da carteira conhecem o roteamento de tarefas.
    for (const file of [
      'src/app/(main)/contratos/onboarding/[intakeId]/page.tsx',
      'src/components/contracts/ContractOnboardingContinuity.tsx',
    ]) {
      expect(source(file)).not.toContain('@/lib/ai/');
      expect(source(file)).not.toContain('getApexAITaskPolicy');
    }
    // O gateway e o esquema do provedor seguem sendo assunto dos seus testes.
    expect(source('src/lib/contracts/onboarding/document-first.ts'))
      .toContain('CONTRACT_ONBOARDING_EXTRACTION_SCHEMA');
  });
});
