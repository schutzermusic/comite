/**
 * P2F — entrada de contrato real e prontidão operacional.
 *
 * Duas coisas são verificadas aqui, e a segunda importa mais que a primeira:
 *
 *   1. a lista de prontidão diz a verdade sobre o que está registrado;
 *   2. o cadastro NÃO inventa nada — a ausência de um dado sobrevive à
 *      gravação em vez de virar um valor plausível.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOnboardingReadiness, identityGaps } from '@/lib/contracts/trust/onboarding';
import { buildTrustedContract, relationsBatchFromDetail } from '@/lib/contracts/trust/read-model';
import type {
  ContractDetail, ContractRow, ContractClauseRow, ContractDocumentRow,
  ContractObligationRow, ContractProjectLinkRow,
} from '@/lib/contracts/contract-service';
import { missing, failed } from '@/lib/contracts/trust/trusted';
import { PROJECT_CEMIG } from './fixtures/contract-fixtures';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/**
 * O arquivo SEM comentários.
 *
 * Um guarda do tipo "esta expressão não aparece mais no código" casa também
 * com o comentário que explica por que ela foi removida — e passa a proibir a
 * própria documentação da mudança. Estes testes olham o código.
 */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOW = new Date('2026-08-25T12:00:00.000Z');
const ID = 'onb-0001';

/** Contrato plenamente identificado — o ponto de partida "tudo preenchido". */
const row = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: ID, organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
  title: 'Contrato de manutenção', contract_number: 'CT-2026-014',
  counterparty_name: 'Concessionária X', contract_type: 'Prestação de serviços',
  status: 'active', lifecycle_stage: 'created',
  start_date: '2026-09-01', end_date: '2027-08-31', signed_date: '2026-08-20', renewal_date: null,
  currency: 'BRL', total_value: 2_400_000, monthly_value: null, payment_terms: null,
  scope_summary: null, risk_level: 'medium', health_score: null, owner_user_id: 'user-1',
  created_by: 'u', updated_by: 'u', created_at: '2026-08-25T09:00:00Z',
  updated_at: '2026-08-25T09:00:00Z', deleted_at: null, data_class: 'live',
  ...over,
} as ContractRow);

const base = (contract: ContractRow): ContractDetail => ({
  contract, clauses: [], obligationDefinitions: [], penalties: [], milestones: [], risks: [], files: [], aiAnalyses: [],
  billingEvents: [] as never, obligations: [] as never, approvals: [] as never,
  projectLinks: [] as never, riskLinks: [] as never, documents: [] as never, amendments: [], amendmentClauses: [], amendmentsError: null
});

const trusted = (contract: ContractRow, over: Partial<ContractDetail> = {}) =>
  buildTrustedContract(
    contract,
    relationsBatchFromDetail({ ...base(contract), ...over }),
    [PROJECT_CEMIG],
    NOW,
  );

const readiness = (contract: ContractRow, over: Partial<ContractDetail> = {}) =>
  buildOnboardingReadiness(trusted(contract, over));

const stepOf = (r: ReturnType<typeof readiness>, key: string) =>
  r.steps.find((s) => s.key === key)!;

const doc = (over: Partial<ContractDocumentRow> = {}): ContractDocumentRow => ({
  id: 'doc-1', organization_id: 'org-1', contract_id: ID, title: 'Contrato.pdf',
  file_path: 'org/c/doc.pdf', document_type: 'contract', status: 'uploaded',
  uploaded_by: 'u', approved_at: null, approved_by: null, rejection_reason: null,
  version: 1, supersedes_document_id: null, superseded_by_document_id: null, superseded_at: null,
  created_at: '2026-08-25T10:00:00Z', updated_at: '2026-08-25T10:00:00Z',
  ...over,
} as ContractDocumentRow);

const clause = (over: Partial<ContractClauseRow> = {}): ContractClauseRow => ({
  id: 'cl-1', organization_id: 'org-1', contract_id: ID, title: 'Multa por atraso',
  clause_type: 'penalidades', content: null, ai_flagged: false, review_status: 'validated',
  created_by: 'u', updated_by: 'u', created_at: '2026-08-25T10:00:00Z', updated_at: '2026-08-25T10:00:00Z',
  ...over,
} as ContractClauseRow);

// ═══════════════════════════════════════════════════════════════════
// 1 · Identidade
// ═══════════════════════════════════════════════════════════════════

describe('identityGaps', () => {
  it('contrato plenamente identificado não tem lacuna', () => {
    expect(identityGaps(trusted(row()))).toEqual([]);
  });

  it('aponta cada campo ausente pelo nome', () => {
    const gaps = identityGaps(trusted(row({
      counterparty_name: null, contract_type: null, start_date: null,
      end_date: null, total_value: null, owner_user_id: null,
    })));
    expect(gaps.map((g) => g.field).sort()).toEqual([
      'contract_type', 'counterparty_name', 'end_date',
      'owner_user_id', 'start_date', 'total_value',
    ]);
  });

  it('valor mensal, condições de pagamento e objeto NÃO são exigidos', () => {
    /*
      São frequentemente inaplicáveis — um contrato de valor fechado não tem
      valor mensal. Exigi-los ensinaria a preencher campo com ruído para
      satisfazer um checklist, que é como um controle corrompe o dado.
    */
    const gaps = identityGaps(trusted(row({
      monthly_value: null, payment_terms: null, scope_summary: null,
    })));
    expect(gaps).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2 · Ausência não é irregularidade
// ═══════════════════════════════════════════════════════════════════

describe('a prontidão nunca acusa', () => {
  it('lista vazia lida é PENDENTE — ausência apurada que convida a registrar', () => {
    const r = readiness(row(), { obligations: [] as never });
    expect(stepOf(r, 'obligations').state).toBe('pending');
    expect(stepOf(r, 'obligations').detail).toBe('Nenhuma obrigação registrada');
  });

  it('obrigações, marcos, aprovações e cláusulas NÃO são essenciais', () => {
    /*
      Um contrato sem obrigações registradas pode ser um contrato que
      genuinamente não tem obrigações a acompanhar. Marcá-lo como incompleto
      transformaria a tela num painel de acusação contra quem acabou de
      cadastrar — e ensinaria a registrar linha vazia para apagar alerta.
    */
    const r = readiness(row());
    for (const key of ['obligations', 'milestones', 'approvals', 'clauses', 'risks']) {
      expect(stepOf(r, key).essential, key).toBe(false);
    }
  });

  it('só identidade, projeto e documento são essenciais', () => {
    const r = readiness(row());
    expect(r.steps.filter((s) => s.essential).map((s) => s.key))
      .toEqual(['identity', 'project', 'documents']);
    expect(r.essentialTotal).toBe(3);
  });

  it('não existe nota, percentual nem semáforo de conformidade', () => {
    const src = code('src/lib/contracts/trust/onboarding.ts');
    expect(src).not.toMatch(/\bscore\b/i);
    expect(src).not.toMatch(/compliance|conformidade\s*[:=]/i);
    expect(src).not.toMatch(/violation|violaç/i);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3 · Não lido nunca vira não registrado
// ═══════════════════════════════════════════════════════════════════

describe('pendente e desconhecido são estados diferentes', () => {
  it('relação não apurada é UNKNOWN, jamais "falta registrar"', () => {
    /*
      Hoje o lote não produz este estado: `section()` no read model devolve
      `live([])` para relação sem entrada no mapa — "a consulta rodou e não há".
      O estado existe porque `Official<T>` admite `missing`, e qualquer leitura
      parcial futura cairá nele. Se a prontidão tratasse `missing` como
      pendente, passaria a afirmar "falta registrar" sobre algo que ninguém leu.
    */
    const t = {
      ...trusted(row()),
      milestones: missing<readonly unknown[]>('no-permission'),
    } as unknown as Parameters<typeof buildOnboardingReadiness>[0];
    const r = buildOnboardingReadiness(t);
    expect(stepOf(r, 'milestones').state).toBe('unknown');
    // E, sendo desconhecido, não afirma ausência no texto.
    expect(stepOf(r, 'milestones').detail).toBeNull();
  });

  it('leitura que FALHOU é errored, distinto de vazia', () => {
    const t = {
      ...trusted(row()),
      // A prontidão passou a contar a obrigação ESTRUTURADA (Fase 3), então é
      // a leitura DELA que precisa falhar para a etapa ficar "não apurada".
      obligationDefinitions: failed<readonly unknown[]>('timeout', 'contract_obligation_definitions'),
    } as unknown as Parameters<typeof buildOnboardingReadiness>[0];
    const r = buildOnboardingReadiness(t);
    expect(stepOf(r, 'obligations').state).toBe('errored');
    expect(r.hasErrors).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4 · Cláusulas: proposta pendente não é cláusula do contrato
// ═══════════════════════════════════════════════════════════════════

describe('cláusulas', () => {
  it('proposta de IA aguardando revisão NÃO conta como registrada', () => {
    /*
      Contá-la daria por concluído justamente o passo — a revisão humana — que
      dá valor à extração.
    */
    const r = readiness(row(), {
      clauses: [clause({ ai_flagged: true, review_status: 'draft' })],
    });
    expect(stepOf(r, 'clauses').state).toBe('pending');
    expect(stepOf(r, 'clauses').detail).toBe('1 proposta aguardando revisão');
  });

  it('proposta VALIDADA conta', () => {
    const r = readiness(row(), {
      clauses: [clause({ ai_flagged: true, review_status: 'validated' })],
    });
    expect(stepOf(r, 'clauses').state).toBe('complete');
  });

  it('cláusula registrada à mão conta sem depender de IA', () => {
    const r = readiness(row(), { clauses: [clause({ ai_flagged: false })] });
    expect(stepOf(r, 'clauses').state).toBe('complete');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5 · Riscos: aplicável vem do contrato, não de inferência
// ═══════════════════════════════════════════════════════════════════

describe('riscos', () => {
  it('contrato de risco médio sem risco vinculado é NÃO APLICÁVEL', () => {
    const r = readiness(row({ risk_level: 'medium' }));
    expect(stepOf(r, 'risks').state).toBe('not_applicable');
    expect(stepOf(r, 'risks').detail).toBe('Contrato não classificado como alto risco');
  });

  it('contrato de ALTO risco sem risco vinculado fica pendente', () => {
    const r = readiness(row({ risk_level: 'high' }));
    expect(stepOf(r, 'risks').state).toBe('pending');
  });

  it('risco vinculado conta mesmo em contrato de risco baixo', () => {
    const r = readiness(row({ risk_level: 'low' }), {
      riskLinks: [{ id: 'rl-1', contract_id: ID, risk_id: 'r-1' } as ContractRiskLinkRowLike] as never,
    });
    expect(stepOf(r, 'risks').state).toBe('complete');
  });
});
type ContractRiskLinkRowLike = { id: string; contract_id: string; risk_id: string };

// ═══════════════════════════════════════════════════════════════════
// 6 · Operável
// ═══════════════════════════════════════════════════════════════════

describe('vínculo de projeto', () => {
  it('conta o vínculo gravado em contracts.project_id', () => {
    /*
      É o que o assistente de cadastro grava. `contract_project_links` e a
      coluna coexistem e os dois são vínculos reais — ler só a tabela reportava
      "nenhum projeto" exatamente no contrato recém-cadastrado com projeto.
    */
    const r = readiness(row({ project_id: PROJECT_CEMIG.id }));
    expect(stepOf(r, 'project').state).toBe('complete');
    expect(stepOf(r, 'project').detail).toContain(PROJECT_CEMIG.codigo);
  });

  it('conta o vínculo gravado em contract_project_links', () => {
    const r = readiness(row(), {
      projectLinks: [{ id: 'pl-1', contract_id: ID, project_id: PROJECT_CEMIG.id } as never] as never,
    });
    expect(stepOf(r, 'project').state).toBe('complete');
  });

  it('sem nenhum dos dois, fica pendente', () => {
    expect(stepOf(readiness(row()), 'project').state).toBe('pending');
  });
});

describe('operável', () => {
  it('identidade + projeto + documento torna o contrato operável', () => {
    const r = readiness(row(), {
      documents: [doc()] as never,
      projectLinks: [{ id: 'pl-1', contract_id: ID, project_id: PROJECT_CEMIG.id } as never] as never,
    });
    expect(r.operable).toBe(true);
    expect(r.missingEssential).toEqual([]);
  });

  it('sem documento não é operável, e diz exatamente o que falta', () => {
    const r = readiness(row(), {
      projectLinks: [{ id: 'pl-1', contract_id: ID, project_id: PROJECT_CEMIG.id } as never] as never,
    });
    expect(r.operable).toBe(false);
    expect(r.missingEssential).toEqual(['documents']);
  });

  it('operável NÃO significa conforme — obrigações podem estar todas ausentes', () => {
    const r = readiness(row(), {
      documents: [doc()] as never,
      projectLinks: [{ id: 'pl-1', contract_id: ID, project_id: PROJECT_CEMIG.id } as never] as never,
    });
    expect(r.operable).toBe(true);
    expect(stepOf(r, 'obligations').state).toBe('pending');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7 · O cadastro não inventa
// ═══════════════════════════════════════════════════════════════════

describe('o assistente de cadastro não fabrica dado', () => {
  const wizard = code('src/components/contracts/contract-upload.tsx');

  it('não inventa vencimento nem data de renovação', () => {
    /*
      O código anterior gravava `expirationDate || addDays(new Date(), 365)` e
      `addDays(expirationDate, -60)`. As duas viravam colunas de um contrato
      `live`, alimentavam o Horizonte de Renovação e o PDF oficial, e ninguém
      distinguia a data lida do papel da data que o formulário chutou.
    */
    expect(wizard).not.toContain('addDays');
    expect(wizard).toContain('form.endDate || null');
    expect(wizard).toContain('form.renewalDate || null');
  });

  it('valor em branco é ausência, não zero', () => {
    expect(wizard).toContain('if (!trimmed) return null;');
  });

  it('não encena análise de IA', () => {
    // A etapa antiga tinha barra de progresso parada em 68% e onze selos
    // "mock pendente" sobre capacidades inexistentes.
    expect(wizard).not.toContain('HudProgressBar');
    expect(wizard).not.toMatch(/mock pendente/);
    expect(wizard).not.toMatch(/Iniciar análise mock/);
  });

  it('não promete rota de aprovação que ninguém cria', () => {
    expect(wizard).not.toMatch(/Jurídico \+ Financeiro \+ Comitê/);
  });

  it('o responsável é um usuário real, não texto livre', () => {
    expect(wizard).toContain('listOrgMembers');
    expect(wizard).toContain('ownerUserId');
    expect(wizard).not.toContain("owner: 'Gestão de Contratos'");
  });

  it('o documento entra em contract_documents, com tipo', () => {
    expect(wizard).toContain('documentType');
    const page = code('src/app/(main)/contratos/page.tsx');
    expect(page).toContain('uploadContractDocument');
  });

  it('o contrato nasce NÃO CLASSIFICADO e a análise é opcional', () => {
    const page = code('src/app/(main)/contratos/page.tsx');
    // Promover a `live` é ato de governança (`reclassifyContract`), com
    // justificativa e auditoria — não um literal no caminho de criação.
    expect(page).toContain("dataClass: 'unclassified'");
    expect(page).not.toContain("dataClass: 'live',");
    expect(page).toContain('draft.runExtraction && documentId');
  });

  it('status não é copiado para lifecycle_stage', () => {
    const page = code('src/app/(main)/contratos/page.tsx');
    expect(page).not.toContain("lifecycleStage: metadata?.status || 'created'");
  });

  it('a análise placeholder que nunca concluía foi removida', () => {
    const service = code('src/lib/contracts/contract-service.ts');
    expect(service).not.toContain('export async function requestContractAiAnalysisPlaceholder');
    expect(service).not.toContain('aiPlaceholderRequested');
  });
});
