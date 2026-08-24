/**
 * Classificação de origem — a fronteira entre a carteira da empresa e o que
 * apenas parece ser.
 *
 * Antes da migration 091, a Executive Band somava R$ 1,5M de exposição, dos
 * quais R$ 1,2M (88%) vinham do fixture de QA. O contrato real da empresa —
 * CEMIG, R$ 40 mil — era 2,6% do que a tela apresentava como carteira.
 *
 * Cada teste aqui trava uma das nove garantias exigidas para que isso não possa
 * voltar a acontecer.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTrustedContract, relationsBatchFromDetail } from '@/lib/contracts/trust/read-model';
import { computeTrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import { resolveForDisplay } from '@/lib/contracts/trust/display';
import {
  officialByOrigin, isOfficialOrigin, hasOfficialValue, isMissing, isDerived, isLive,
  live as mkLive, type ContractDataClass,
} from '@/lib/contracts/trust/trusted';
import { buildContractReportHtml } from '@/lib/reports/modules/contract-report';
import { buildContractDossierHtml } from '@/lib/reports/modules/contract-dossier-report';
import { enrichContractsForGovernance, DEMO_PREVIEW_INTENT } from '@/components/contracts/contract-governance-data';
import type { ContractDetail, ContractRow } from '@/lib/contracts/contract-service';
import { PROJECT_CEMIG } from './fixtures/contract-fixtures';

const NOW = new Date('2026-08-18T12:00:00.000Z');

/** Contrato real CEMIG, como está na base de produção. */
const CEMIG_ID = '09f84697-1a6f-454e-a8e1-2a126a58021b';
const cemigRow = (dataClass: ContractDataClass = 'live'): ContractRow => ({
  id: CEMIG_ID, organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
  title: 'CEMIG', contract_number: null, counterparty_name: 'CEMIG',
  contract_type: 'Ordem de serviço', status: 'negotiation', lifecycle_stage: null,
  start_date: null, end_date: '2027-05-13', signed_date: null, renewal_date: null,
  currency: 'BRL', total_value: 40_000, monthly_value: null, payment_terms: null,
  scope_summary: null, risk_level: 'low', health_score: null, owner_user_id: 'u-1',
  created_by: 'u-1', updated_by: 'u-1',
  created_at: '2026-05-13T13:26:33Z', updated_at: '2026-05-13T13:26:33Z', deleted_at: null,
  data_class: dataClass,
} as ContractRow);

/** Fixture de QA, como está na base — inclusive o evento inserido à mão. */
const QA_ID = '272b7184-fe5b-47e7-8e83-29960642ace9';
const qaRow = (dataClass: ContractDataClass = 'demo'): ContractRow => ({
  ...cemigRow('live'),
  id: QA_ID, title: '[QA] Contrato de Serviços', contract_number: 'QA-0001',
  counterparty_name: 'Fornecedor QA Ltda.', contract_type: 'Prestação de serviços',
  status: 'active', total_value: 1_200_000, risk_level: 'medium',
  data_class: dataClass,
} as ContractRow);

const ENEL_ID = '9549d407-f196-4bcb-aafc-dd7a5206c9b7';
const enelRow = (): ContractRow => ({
  ...cemigRow('unclassified'),
  id: ENEL_ID, title: 'ENEL', counterparty_name: 'ENEL', total_value: 130_000,
  data_class: 'unclassified',
} as ContractRow);

const emptyDetail = (row: ContractRow): ContractDetail => ({
  contract: row, clauses: [], penalties: [], milestones: [], risks: [], files: [], aiAnalyses: [],
  billingEvents: [] as never, obligations: [] as never, approvals: [] as never,
  projectLinks: [] as never, riskLinks: [] as never, documents: [] as never,
});

/** QA com faturamento — inclusive o evento REAL que um usuário inseriu pela UI. */
const qaDetailWithUserData = (row: ContractRow): ContractDetail => ({
  ...emptyDetail(row),
  billingEvents: [
    { id: 'b1', contract_id: row.id, milestone_id: null, title: '[QA] Mobilização (10%)', amount: 120_000, due_date: '2026-06-08', paid_at: '2026-06-09', status: 'pago' },
    { id: 'b2', contract_id: row.id, milestone_id: null, title: '[QA] Medição fase 1 (40%)', amount: 480_000, due_date: '2026-07-13', paid_at: null, status: 'pendente' },
    // Inserido MANUALMENTE pela interface por um usuário real:
    { id: 'b4', contract_id: row.id, milestone_id: null, title: 'Compra das barras de cobre', amount: 23_000, due_date: '2026-07-03', paid_at: '2026-07-03', status: 'pago' },
  ] as never,
});

const build = (detail: ContractDetail) =>
  buildTrustedContract(detail.contract, relationsBatchFromDetail(detail), [PROJECT_CEMIG], NOW);

// ═══════════════════════════════════════════════════════════════════
// 1 · DEMO nunca entra em agregado oficial
// ═══════════════════════════════════════════════════════════════════

describe('1 · contratos DEMO fora do agregado oficial', () => {
  it('a exposição de um contrato demo não é somada', () => {
    const stats = computeTrustedPortfolioStats([build(emptyDetail(qaRow('demo')))]);
    expect(isMissing(stats.totalValue)).toBe(true);
    if (isMissing(stats.totalValue)) expect(stats.totalValue.reason).toBe('demo-excluded');
  });

  it('o R$ 1,2M do fixture não aparece ao lado do CEMIG real', () => {
    const stats = computeTrustedPortfolioStats([
      build(emptyDetail(cemigRow('live'))),
      build(emptyDetail(qaRow('demo'))),
    ]);
    expect(isDerived(stats.totalValue)).toBe(true);
    if (isDerived(stats.totalValue)) {
      expect(stats.totalValue.value).toBe(40_000);            // só o CEMIG
      expect(stats.totalValue.value).not.toBe(1_240_000);
      /**
       * Cobertura 1/1, não 1/2.
       *
       * O agregado OFICIAL é sobre a carteira OFICIAL: o contrato de
       * demonstração nunca fez parte da conta, então contá-lo no denominador
       * produziria "parcial · 1/2", que o olho lê como "um contrato falhou".
       * A composição por origem já é declarada em `scope`.
       */
      expect(stats.totalValue.derivation.coverage).toEqual({ counted: 1, total: 1 });
      expect(stats.scope).toEqual({ live: 1, demo: 1, unclassified: 0, total: 2 });
    }
  });

  it('contagens operacionais também ignoram demo', () => {
    const stats = computeTrustedPortfolioStats([
      build(emptyDetail(cemigRow('live'))),
      build(emptyDetail(qaRow('demo'))),
    ]);
    expect(stats.contractCount).toBe(1);
    if (hasOfficialValue(stats.contractsWithoutProject)) {
      expect(stats.contractsWithoutProject.value).toBe(1);    // só o CEMIG conta
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2 · UNCLASSIFIED nunca entra em agregado oficial
// ═══════════════════════════════════════════════════════════════════

describe('2 · contratos NÃO CLASSIFICADOS fora do agregado oficial', () => {
  it('a exposição de um contrato não classificado não é somada', () => {
    const stats = computeTrustedPortfolioStats([build(emptyDetail(enelRow()))]);
    expect(isMissing(stats.totalValue)).toBe(true);
    if (isMissing(stats.totalValue)) expect(stats.totalValue.reason).toBe('unclassified-contract');
  });

  it('os dois ENEL não inflam a carteira do CEMIG', () => {
    const stats = computeTrustedPortfolioStats([
      build(emptyDetail(cemigRow('live'))),
      build(emptyDetail(enelRow())),
      build(emptyDetail({ ...enelRow(), id: 'c3385a11' } as ContractRow)),
    ]);
    if (isDerived(stats.totalValue)) expect(stats.totalValue.value).toBe(40_000);
    expect(stats.contractCount).toBe(1);
  });

  it('UNCLASSIFIED NÃO é colapsado em DEMO — os motivos são distintos', () => {
    const demo = computeTrustedPortfolioStats([build(emptyDetail(qaRow('demo')))]);
    const unc = computeTrustedPortfolioStats([build(emptyDetail(enelRow()))]);
    expect(isMissing(demo.totalValue) && demo.totalValue.reason).toBe('demo-excluded');
    expect(isMissing(unc.totalValue) && unc.totalValue.reason).toBe('unclassified-contract');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3 · Dado real de usuário não promove um contrato demo
// ═══════════════════════════════════════════════════════════════════

describe('3 · lançamento real dentro de contrato demo', () => {
  it('o evento inserido pela UI não torna o fixture oficial', () => {
    // "Compra das barras de cobre" (R$ 23.000, pago) foi lançado por um usuário
    // real dentro do fixture. É dado verdadeiro — e ainda assim não é carteira
    // da empresa, porque a ORIGEM do contrato é de demonstração.
    const qa = build(qaDetailWithUserData(qaRow('demo')));
    // No dossiê, o valor É medido:
    expect(isDerived(qa.billedValue)).toBe(true);
    if (hasOfficialValue(qa.billedValue)) expect(qa.billedValue.value).toBe(143_000);

    // Na carteira oficial, não entra:
    const stats = computeTrustedPortfolioStats([qa]);
    expect(isMissing(stats.billedValue)).toBe(true);
    if (isMissing(stats.billedValue)) expect(stats.billedValue.reason).toBe('demo-excluded');
  });

  it('a classificação é da LINHA, não da qualidade da medição', () => {
    const qa = build(qaDetailWithUserData(qaRow('demo')));
    // Medição boa, origem inelegível — as duas coisas coexistem.
    expect(hasOfficialValue(qa.billedValue)).toBe(true);
    expect(isOfficialOrigin(qa.dataClass)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4 · LIVE com relações ausentes continua LIVE
// ═══════════════════════════════════════════════════════════════════

describe('4 · contrato LIVE com relações ausentes', () => {
  const cemig = () => build(emptyDetail(cemigRow('live')));

  it('permanece elegível — ausência de relação não rebaixa a origem', () => {
    expect(cemig().dataClass).toBe('live');
    expect(isOfficialOrigin(cemig().dataClass)).toBe(true);
  });

  it('e suas relações aparecem como MISSING, não como zero', () => {
    const c = cemig();
    expect(isMissing(c.billedValue)).toBe(true);
    expect(isMissing(c.project)).toBe(true);
    expect('value' in c.billedValue).toBe(false);
  });

  it('mas o valor contratado, que existe, é somado', () => {
    const stats = computeTrustedPortfolioStats([cemig()]);
    if (isDerived(stats.totalValue)) expect(stats.totalValue.value).toBe(40_000);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5 · zero apurado ≠ ausência
// ═══════════════════════════════════════════════════════════════════

describe('5 · zero real continua distinguível de MISSING', () => {
  it('contrato live sem evento de faturamento → MISSING', () => {
    const c = build(emptyDetail(cemigRow('live')));
    expect(isMissing(c.billedValue)).toBe(true);
  });

  it('contrato live com evento nenhum realizado → zero APURADO', () => {
    const detail: ContractDetail = {
      ...emptyDetail(cemigRow('live')),
      billingEvents: [{ id: 'b', contract_id: CEMIG_ID, milestone_id: null, title: 'Parcela', amount: 40_000, due_date: '2027-01-01', paid_at: null, status: 'pendente' }] as never,
    };
    const c = build(detail);
    expect(isDerived(c.billedValue)).toBe(true);
    if (hasOfficialValue(c.billedValue)) expect(c.billedValue.value).toBe(0);
  });

  it('as duas formas não colapsam nem depois da fronteira de origem', () => {
    const semEvento = officialByOrigin(build(emptyDetail(cemigRow('live'))).billedValue, 'live');
    expect(isMissing(semEvento)).toBe(true);
    expect('value' in semEvento).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6 e 7 · A carteira oficial é o CEMIG, e só ele
// ═══════════════════════════════════════════════════════════════════

describe('6 · o CEMIG contribui com sua exposição real', () => {
  it('R$ 40 mil entram na Executive Band', () => {
    const stats = computeTrustedPortfolioStats([build(emptyDetail(cemigRow('live')))]);
    expect(isDerived(stats.totalValue)).toBe(true);
    if (isDerived(stats.totalValue)) expect(stats.totalValue.value).toBe(40_000);
    expect(resolveForDisplay(stats).totalValue.text).toContain('40');
  });

  it('o escopo declara a composição da carteira', () => {
    const stats = computeTrustedPortfolioStats([
      build(emptyDetail(cemigRow('live'))),
      build(emptyDetail(qaRow('demo'))),
      build(emptyDetail(enelRow())),
      build(emptyDetail({ ...enelRow(), id: 'c3385a11' } as ContractRow)),
    ]);
    expect(stats.scope).toEqual({ live: 1, demo: 1, unclassified: 2, total: 4 });
  });
});

describe('7 · a exposição sintética do QA não alcança band nem PDF', () => {
  const carteira = () => [
    build(emptyDetail(cemigRow('live'))),
    build(qaDetailWithUserData(qaRow('demo'))),
    build(emptyDetail(enelRow())),
  ];

  it('a band mostra R$ 40 mil, não R$ 1,5M', () => {
    const display = resolveForDisplay(computeTrustedPortfolioStats(carteira()));
    expect(display.totalValue.value).toBe(40_000);
    expect(display.contractCount).toBe(1);
  });

  it('o PDF oficial não imprime a exposição do fixture', () => {
    const contracts = carteira();
    const html = buildContractReportHtml({
      records: [],
      trusted: computeTrustedPortfolioStats(contracts),
      trustedContracts: contracts,
      source: 'teste',
    });
    for (const sintetico of ['R$ 1,2 mi', 'R$ 1,5 mi', 'R$ 1.200.000', 'R$ 143 mil']) {
      expect(html, `"${sintetico}" vazou para o PDF oficial`).not.toContain(sintetico);
    }
  });

  it('o PDF imprime a exposição real do CEMIG', () => {
    const contracts = carteira();
    const html = buildContractReportHtml({
      records: [],
      trusted: computeTrustedPortfolioStats(contracts),
      trustedContracts: contracts,
      source: 'teste',
    });
    // `Intl` com notação compacta usa espaço NÃO-QUEBRÁVEL (U+00A0); comparar
    // com espaço comum falharia por um caractere invisível.
    const normalizado = html.replace(/\u00A0/g, ' ');
    expect(normalizado).toContain('R$ 40 mil');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8 e 9 · Os caminhos de criação declaram a origem
// ═══════════════════════════════════════════════════════════════════

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

describe('8 · criação pela interface persiste LIVE', () => {
  it('a página de contratos declara dataClass: live', () => {
    const page = read('src/app/(main)/contratos/page.tsx');
    expect(page).toContain("dataClass: 'live'");
  });

  it('o serviço grava a coluna', () => {
    expect(read('src/lib/contracts/contract-service.ts')).toContain('data_class: input.dataClass');
  });

  it('o tipo EXIGE a declaração — não há default silencioso', () => {
    const svc = read('src/lib/contracts/contract-service.ts');
    // Sem `?`: toda criação tem de declarar a origem, e o compilador cobra.
    expect(svc).toMatch(/dataClass: 'live' \| 'demo' \| 'unclassified';/);
  });

  it('reclassificar está FORA do update genérico', () => {
    const svc = read('src/lib/contracts/contract-service.ts');
    expect(svc).toContain("| 'dataClass'>>");            // omitido do UpdateContractInput
    expect(svc).toContain('export async function reclassifyContract');
    expect(svc).toContain("action: 'contract.reclassified'");
  });
});

describe('9 · seeds e fixtures persistem DEMO', () => {
  it('a seed de QA grava data_class demo', () => {
    const seed = read('scripts/qa-contracts-governance-seed.mjs');
    expect(seed).toContain('data_class');
    expect(seed).toContain("'demo'");
  });

  it('a migration existe, com CHECK dos três estados e default seguro', () => {
    const sql = read('supabase/migrations/091_contract_data_class.sql');
    expect(sql).toContain("DEFAULT 'unclassified'");
    expect(sql).toContain("CHECK (data_class IN ('live', 'demo', 'unclassified'))");
    // O backfill marca por ID, nunca por heurística de nome/valor.
    expect(sql).toContain(CEMIG_ID);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Garantia estrutural
// ═══════════════════════════════════════════════════════════════════

describe('a fronteira não pode ser contornada', () => {
  it('toda soma da carteira passa por officialByOrigin', () => {
    const portfolio = read('src/lib/contracts/trust/portfolio.ts');
    const somas = portfolio.split('\n').filter((l) => l.includes('sumTrusted('));
    expect(somas.length).toBeGreaterThan(0);
    // Nenhuma soma recebe `contracts.map(` direto — todas passam por byOrigin.
    expect(portfolio).not.toMatch(/sumTrusted\(\s*\n\s*contracts\.map\(/);
  });

  it('sem a coluna na resposta, o contrato é tratado como não classificado', () => {
    // Base sem a migration, ou select parcial: na dúvida, fora da carteira.
    const semColuna = { ...cemigRow('live') } as ContractRow;
    delete (semColuna as { data_class?: unknown }).data_class;
    const c = buildTrustedContract(semColuna, relationsBatchFromDetail(emptyDetail(semColuna)), [], NOW);
    expect(c.dataClass).toBe('unclassified');
    expect(isMissing(computeTrustedPortfolioStats([c]).totalValue)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Vazamentos encontrados na auditoria de 19/08/2026
// ═══════════════════════════════════════════════════════════════════

describe('PDF oficial: as TABELAS por contrato também respeitam a origem', () => {
  /**
   * O vazamento real: os KPIs executivos já excluíam contratos demo, mas as
   * tabelas logo abaixo liam o índice inteiro e imprimiam suas quantias. Um
   * documento internamente contraditório é pior do que um sem filtro nenhum —
   * o leitor acredita na tabela, que parece mais detalhada.
   */
  const qaComFaturamento = (): ContractDetail => ({
    ...emptyDetail(qaRow('demo')),
    billingEvents: [{ id: 'b', contract_id: QA_ID, milestone_id: null, title: 'Parcela', amount: 143_000, due_date: '2026-06-01', paid_at: '2026-06-02', status: 'pago' }] as never,
  });

  const carteiraMista = () => [
    build(emptyDetail(cemigRow('live'))),
    build(qaComFaturamento()),
    build(emptyDetail(enelRow())),
  ];

  const gerar = () => {
    const contracts = carteiraMista();
    return buildContractReportHtml({
      // O chamador passa TODOS os records — o builder é quem precisa filtrar,
      // para que nenhuma tela consiga furar a regra passando o escopo errado.
      records: enrichContractsForGovernance(
        [{ id: QA_ID, name: '[QA] Contrato', vendorOrParty: 'Fornecedor QA', value: 1_200_000,
           currency: 'BRL', fileUrl: '', riskClassification: 'medium', status: 'active',
           uploadedAt: new Date('2026-01-01'), autoExtracted: false } as never],
        [],
        { intent: DEMO_PREVIEW_INTENT },
      ),
      trusted: computeTrustedPortfolioStats(contracts),
      trustedContracts: contracts,
      source: 'teste',
    }).replace(/\u00A0/g, ' ');
  };

  it('nenhuma quantia de contrato demo aparece nas tabelas', () => {
    const html = gerar();
    for (const valor of ['R$ 1,2 mi', 'R$ 143 mil', 'R$ 1.200.000', 'R$ 1,1 mi']) {
      expect(html, `"${valor}" (contrato demo) vazou para o PDF oficial`).not.toContain(valor);
    }
  });

  it('o relatório DECLARA quantos contratos excluiu', () => {
    const html = gerar();
    expect(html).toContain('Recorte da carteira oficial');
    expect(html).toContain('origem validada');
  });
});

describe('dossiê PDF de contrato não-operacional é rotulado', () => {
  it('contrato demo: faixa, kicker e rodapé denunciam a origem', () => {
    const html = buildContractDossierHtml({ contract: build(emptyDetail(qaRow('demo'))), source: 'teste' });
    expect(html).toContain('DEMONSTRAÇÃO');
    expect(html).toContain('não é carteira da empresa');
  });

  it('contrato não classificado também é rotulado, com texto próprio', () => {
    const html = buildContractDossierHtml({ contract: build(emptyDetail(enelRow())), source: 'teste' });
    expect(html).toContain('sem origem validada');
    expect(html).not.toContain('fixture de desenvolvimento');   // texto é o de unclassified
  });

  it('contrato LIVE não recebe faixa alguma — marcar o normal vira ruído', () => {
    const html = buildContractDossierHtml({ contract: build(emptyDetail(cemigRow('live'))), source: 'teste' });
    expect(html).not.toContain('não é carteira da empresa');
    expect(html).toContain('Dossiê de Contrato · Governança');
  });
});
