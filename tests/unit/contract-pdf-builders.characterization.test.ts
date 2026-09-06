/**
 * CARACTERIZAÇÃO dos builders de PDF de Contratos — atravessando P0.3.
 *
 * Registra o que os builders imprimem, e sobretudo O QUE MUDOU ao trocar a
 * fonte das métricas do enricher para o read model confiável.
 *
 * A mudança numérica é INTENCIONAL e está documentada em cada teste: onde o
 * relatório antes afirmava um valor fabricado, agora declara "Não apurado".
 * Nenhum valor apurado foi alterado.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => vi.useRealTimers());
import { createHash } from 'node:crypto';
import { enrichContractsForGovernance, DEMO_PREVIEW_INTENT } from '@/components/contracts/contract-governance-data';
import { buildContractReportHtml } from '@/lib/reports/modules/contract-report';
import { buildContractDossierHtml } from '@/lib/reports/modules/contract-dossier-report';
import { buildTrustedPortfolio } from '@/lib/contracts/trust/read-model';
import { computeTrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import type { ContractRelationsBatch, ContractRow, ContractAmendmentRow } from '@/lib/contracts/contract-service';
import { live } from '@/lib/contracts/trust/trusted';
import { CONTRACTS, PROJECTS, FIXED_NOW } from './fixtures/contract-fixtures';

const records = () => enrichContractsForGovernance(CONTRACTS, PROJECTS, { intent: DEMO_PREVIEW_INTENT, now: FIXED_NOW });

const noErrors = () => ({
  obligations: null, billing: null, documents: null,
  approvals: null, projectLinks: null, risks: null, ai: null,
  milestones: null, clauses: null, penalties: null, obligationDefinitions: null,
});

function batch(over: Partial<ContractRelationsBatch> = {}): ContractRelationsBatch {
  return {
    obligations: new Map(), billingEvents: new Map(), documents: new Map(),
    approvals: new Map(), projectLinks: new Map(), riskLinks: new Map(),
    aiAnalyses: new Map(), milestones: new Map(), clauses: new Map(), penalties: new Map(), obligationDefinitions: new Map(), riskDetails: new Map(),
    sectionsWithData: {
      obligations: false, billing: false, documents: false,
      approvals: false, projectLinks: false, risks: false, ai: false,
    },
    sectionErrors: noErrors(),
    ...over,
  } as ContractRelationsBatch;
}

const rows: ContractRow[] = CONTRACTS.map((c, i) => ({
  id: c.id, organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
  title: c.name, contract_number: `CTR-${i}`, counterparty_name: c.vendorOrParty,
  contract_type: null, status: c.status, lifecycle_stage: null,
  start_date: null, end_date: c.expirationDate?.toISOString().slice(0, 10) ?? null,
  signed_date: null, renewal_date: null, currency: 'BRL',
  total_value: c.value, monthly_value: null, payment_terms: null, scope_summary: null,
  risk_level: c.riskClassification, health_score: null, owner_user_id: null,
  created_by: null, updated_by: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
  // Fixtures marcadas `live`: o que se caracteriza aqui é o comportamento do
  // PDF diante de dado ausente/errado, não a exclusão por origem.
  data_class: 'live',
} as ContractRow));

const portfolioFrom = (b: ContractRelationsBatch) => buildTrustedPortfolio(rows, b, PROJECTS, FIXED_NOW);
const trustedFrom = (b: ContractRelationsBatch) => computeTrustedPortfolioStats(portfolioFrom(b));

function content(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/style="[^"]*"/g, '');
}

function currencies(html: string): string[] {
  return (content(html).match(/R\$\s*[\d.,]+\s*(?:mil|mi|bi)?/g) ?? []).map((s) =>
    s.replace(/\s+/g, ' ').trim(),
  );
}

function stableHash(html: string): string {
  const normalized = content(html)
    .replace(/\d{2}\/\d{2}\/\d{4}/g, '<DATA>')
    .replace(/\d{2}:\d{2}(:\d{2})?/g, '<HORA>')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<ISO>')
    .replace(/id="[^"]*"/g, '')
    .replace(/url\(#[^)]*\)/g, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════════
// MUDANÇA INTENCIONAL nº 1 — sem faturamento na base
// ═══════════════════════════════════════════════════════════════════

describe('carteira SEM evento de faturamento registrado', () => {
  const html = () => buildContractReportHtml({
    // Instante fixo: o documento embute os rótulos dos 12 meses seguintes, e
    // sem isto o hash de estrutura muda quando o dia vira.
    now: FIXED_NOW,
    records: records(), trusted: trustedFrom(batch()),
    trustedContracts: portfolioFrom(batch()), source: 'teste',
  });

  it('a exposição total apurada segue idêntica — nada de real foi alterado', () => {
    // 1.200.000 + 480.000 + 0 = 1.680.000. Este valor vem da coluna `value` e
    // era correto antes; continua correto agora.
    expect(currencies(html())).toContain('R$ 1,7 mi');
  });

  it('MUDOU: faturado deixa de imprimir R$ 900 mil fabricados', () => {
    // ANTES de P0.3 o relatório imprimia "R$ 900 mil" faturado e "R$ 780 mil"
    // de saldo — ambos derivados de `hash(id + nome)`, sem uma única linha em
    // `contract_billing_events`.
    const out = currencies(html());
    expect(out).not.toContain('R$ 900 mil');
    expect(out).not.toContain('R$ 780 mil');
  });

  it('MUDOU: declara "Não apurado" no lugar do número inventado', () => {
    expect(content(html())).toContain('Não apurado');
  });

  it('MUDOU: o relatório passa a declarar as próprias lacunas', () => {
    // Um PDF que omite o que não conseguiu apurar engana tanto quanto um que
    // preenche com ficção.
    const out = content(html());
    expect(out).toContain('Cobertura da apuração');
    expect(out).toContain('sem dado apurado na base');
  });

  it('nenhum gráfico financeiro é desenhado sem execução apurada', () => {
    // Um gauge em 0% comunica "nada faturado", que é diferente de "não sabemos".
    const out = content(html());
    expect(out).toContain('sem faturamento apurado');
  });

  it('NENHUM valor fabricado pelo enricher chega ao PDF oficial', () => {
    /**
     * A prova direta da regra: os valores que o enricher inventa para estas
     * fixtures são conhecidos (caracterizados em
     * contract-portfolio-stats.characterization.test.ts). Se qualquer um deles
     * aparecer no documento, dado de demonstração vazou para superfície
     * oficial.
     */
    const fabricados = [
      'R$ 900 mil',    // faturado agregado (hash)
      'R$ 780 mil',    // saldo agregado (hash)
      'R$ 540 mil',    // faturado do CTR-42ACE9 (hash)
      'R$ 540.000',
      'R$ 660 mil',    // saldo do CTR-42ACE9 (hash)
      'R$ 660.000',
      'R$ 360 mil',    // faturado do CTR-58021B (hash)
      'R$ 360.000',
      'R$ 120 mil',    // saldo do CTR-58021B (hash)
    ];
    const impressos = currencies(html());
    for (const valor of fabricados) {
      expect(impressos, `valor fabricado "${valor}" vazou para o PDF`).not.toContain(valor);
    }
  });

  it('fixa as quantias impressas neste cenário', () => {
    expect(currencies(html())).toMatchInlineSnapshot(`
      [
        "R$ 1,7 mi",
        "R$ 1,7 mi",
        "R$ 1,7 mi",
        "R$ 1,2 mi",
        "R$ 1,2 mi",
        "R$ 1,2 mi",
        "R$ 480 mil",
        "R$ 0",
        "R$ 1,2 mi",
        "R$ 480 mil",
        "R$ 0",
        "R$ 1,7 mi",
        "R$ 480 mil",
        "R$ 1,2 mi",
        "R$ 480 mil",
        "R$ 1,2 mi",
        "R$ 1.200.000",
        "R$ 480.000",
        "R$ 0",
        "R$ 1.680.000",
      ]
    `);
  });

  it('fixa a estrutura do documento', () => {
    expect(stableHash(html())).toMatchInlineSnapshot(`"bc2b3eab9ed27f64"`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Com faturamento real: os números voltam, agora apurados
// ═══════════════════════════════════════════════════════════════════

describe('carteira COM faturamento real', () => {
  const withBilling = () => batch({
    billingEvents: new Map([
      [rows[0].id, [
        { id: 'b1', contract_id: rows[0].id, milestone_id: null, title: 'Medição 01',
          amount: 300_000, due_date: null, paid_at: '2026-06-01', status: 'pago' } as never,
        { id: 'b2', contract_id: rows[0].id, milestone_id: null, title: 'Medição 02',
          amount: 900_000, due_date: null, paid_at: null, status: 'pendente' } as never,
      ]],
    ]),
  });

  const html = () => buildContractReportHtml({
    // Instante fixo: o documento embute os rótulos dos 12 meses seguintes, e
    // sem isto o hash de estrutura muda quando o dia vira.
    now: FIXED_NOW,
    records: records(), trusted: trustedFrom(withBilling()),
    trustedContracts: portfolioFrom(withBilling()), source: 'teste',
  });

  it('imprime o faturado REAL, derivado dos eventos realizados', () => {
    expect(currencies(html())).toContain('R$ 300 mil');
  });

  it('e o gráfico de execução volta a ser desenhado', () => {
    expect(content(html())).not.toContain('sem faturamento apurado');
  });

  it('fixa as quantias deste cenário', () => {
    expect(currencies(html())).toMatchInlineSnapshot(`
      [
        "R$ 1,7 mi",
        "R$ 1,7 mi",
        "R$ 1,7 mi",
        "R$ 300 mil",
        "R$ 900 mil",
        "R$ 1,2 mi",
        "R$ 300 mil",
        "R$ 1,7 mi",
        "R$ 1,7 mi",
        "R$ 300 mil",
        "R$ 900 mil",
        "R$ 1,2 mi",
        "R$ 1,2 mi",
        "R$ 480 mil",
        "R$ 0",
        "R$ 0",
        "R$ 470,4 mil",
        "R$ 940,8 mil",
        "R$ 1,4 mi",
        "R$ 1,9 mi",
        "R$ 1,7 mi",
        "R$ 300 mil",
        "R$ 1,4 mi",
        "R$ 1,2 mi",
        "R$ 300 mil",
        "R$ 900 mil",
        "R$ 480 mil",
        "R$ 0",
        "R$ 1,7 mi",
        "R$ 300 mil",
        "R$ 900 mil",
        "R$ 480 mil",
        "R$ 1,2 mi",
        "R$ 480 mil",
        "R$ 1,2 mi",
        "R$ 300 mil",
        "R$ 1,7 mi",
        "R$ 900 mil",
        "R$ 900 mil",
        "R$ 1.200.000",
        "R$ 300.000",
        "R$ 480.000",
        "R$ 0",
        "R$ 1.680.000",
        "R$ 300.000",
      ]
    `);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MUDANÇA INTENCIONAL nº 2 — falha de leitura
// ═══════════════════════════════════════════════════════════════════

describe('falha ao ler o faturamento', () => {
  const html = () => buildContractReportHtml({
    // Instante fixo: o documento embute os rótulos dos 12 meses seguintes, e
    // sem isto o hash de estrutura muda quando o dia vira.
    now: FIXED_NOW,
    records: records(),
    trusted: trustedFrom(batch({ sectionErrors: { ...noErrors(), billing: 'permission denied' } })),
    trustedContracts: portfolioFrom(batch({ sectionErrors: { ...noErrors(), billing: 'permission denied' } })),
    source: 'teste',
  });

  it('imprime "Dados indisponíveis" — jamais "estimado", jamais R$ 0', () => {
    const out = content(html());
    expect(out).toContain('Dados indisponíveis');
    expect(out).not.toMatch(/faturado\s+R\$\s*0\b/i);
  });

  it('declara a falha como falha, distinta de ausência', () => {
    expect(content(html())).toContain('falha ao ler a fonte');
  });

  it('métricas independentes seguem apuradas — o erro não contamina tudo', () => {
    expect(currencies(html())).toContain('R$ 1,7 mi');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Dossiê — MIGRADO para o modelo confiável em P0.4
// ═══════════════════════════════════════════════════════════════════

describe('contract-dossier-report sobre o modelo confiável', () => {
  const dossier = (b: ContractRelationsBatch) =>
    buildContractDossierHtml({ contract: portfolioFrom(b)[0], source: 'teste' });

  it('é determinístico', () => {
    expect(currencies(dossier(batch()))).toEqual(currencies(dossier(batch())));
  });

  it('MUDOU: R$ 540/660 mil fabricados sumiram do dossiê', () => {
    // Antes de P0.4 o dossiê imprimia faturado R$ 540 mil e saldo R$ 660 mil
    // para este contrato — ambos de hash(id+nome), num PDF de diretoria.
    const out = currencies(dossier(batch()));
    expect(out).not.toContain('R$ 540 mil');
    expect(out).not.toContain('R$ 660 mil');
    expect(out).not.toContain('R$ 540.000');
  });

  it('MUDOU: sem risk score nem margem inventados', () => {
    const out = content(dossier(batch()));
    expect(out).not.toContain('Risk score');
    expect(out).not.toContain('Margem est.');
    expect(out).not.toContain('Confiança IA');
  });

  it('declara que a pontuação de saúde não foi emitida, e por quê', () => {
    const out = content(dossier(batch()));
    expect(out).toContain('Pontuação de saúde não emitida');
    expect(out).toContain('modelo de pontuação aprovado para contratos');
    expect(out).toContain('Cobertura da avaliação');
  });

  it('o valor total apurado permanece', () => {
    expect(currencies(dossier(batch()))).toContain('R$ 1,2 mi');
  });

  it('com faturamento real, imprime o valor derivado', () => {
    const withBilling = batch({
      billingEvents: new Map([[rows[0].id, [
        { id: 'b1', contract_id: rows[0].id, milestone_id: null, title: 'Medição 01',
          amount: 300_000, due_date: null, paid_at: '2026-06-01', status: 'pago' } as never,
      ]]]),
    });
    expect(currencies(dossier(withBilling))).toContain('R$ 300 mil');
  });

  it('falha de leitura aparece como indisponível, não como zero', () => {
    const errored = batch({ sectionErrors: { ...noErrors(), billing: 'permission denied' } });
    const out = content(dossier(errored));
    expect(out).toContain('Dados indisponíveis');
    expect(out).toContain('Falha ao ler os eventos de faturamento');
  });

  it('fixa as quantias do dossiê confiável', () => {
    expect(currencies(dossier(batch()))).toMatchInlineSnapshot(`
      [
        "R$ 1,2 mi",
        "R$ 1.200.000",
        "R$ 1,2 mi",
      ]
    `);
  });

  // ── Instrumentos contratuais (P2F.1) ──

  it('sem aditivos consultados, o PDF ADMITE que não olhou', () => {
    /*
      A distinção que este teste protege: "não há aditivo" e "não consultei os
      aditivos" são afirmações diferentes. Um dossiê que omite um aditivo de
      milhões porque a consulta não foi feita é pior que um que admite a
      lacuna — o primeiro parece completo.
    */
    const html = dossier(batch());
    expect(html).toContain('Instrumentos Contratuais');
    expect(html).toContain('Aditivos não consultados');
  });

  it('com aditivos lidos e vazios, diz que não há nenhum registrado', () => {
    const html = buildContractDossierHtml({
      contract: portfolioFrom(batch())[0],
      source: 'teste',
      amendments: live([], 'contracts'),
    });
    expect(html).toContain('Nenhum aditivo registrado');
    expect(html).not.toContain('Aditivos não consultados');
  });

  it('imprime original E vigente lado a lado, nunca só um', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2028-01-01T12:00:00Z'));
    const html = buildContractDossierHtml({
      contract: portfolioFrom(batch())[0],
      source: 'teste',
      amendments: live([{
        id: 'am-1', organization_id: 'org-1', contract_id: 'x',
        amendment_number: 'TA-01', title: 'Reajuste', document_id: null,
        status: 'active', signed_date: null, effective_date: '2027-01-01',
        value_delta: 300_000, value_absolute: null,
        new_end_date: null, term_extension_days: null,
        scope_change: null, notes: null,
        created_by: 'u', updated_by: 'u',
        created_at: '2026-12-01T00:00:00Z', updated_at: '2026-12-01T00:00:00Z',
        deleted_at: null,
      }] as ContractAmendmentRow[], 'contracts'),
    });
    // O mestre não é sobrescrito: os dois valores aparecem.
    expect(html).toContain('Valor original');
    expect(html).toContain('valor vigente');
    expect(html).toContain('TA-01');
    expect(html).toContain('aplicado');
  });

  it('aditivo em vigor sem data de efeito NÃO produz total no PDF', () => {
    const html = buildContractDossierHtml({
      contract: portfolioFrom(batch())[0],
      source: 'teste',
      amendments: live([{
        id: 'am-1', organization_id: 'org-1', contract_id: 'x',
        amendment_number: 'TA-01', title: null, document_id: null,
        status: 'active', signed_date: null, effective_date: null,
        value_delta: 300_000, value_absolute: null,
        new_end_date: null, term_extension_days: null,
        scope_change: null, notes: null,
        created_by: 'u', updated_by: 'u',
        created_at: '2026-12-01T00:00:00Z', updated_at: '2026-12-01T00:00:00Z',
        deleted_at: null,
      }] as ContractAmendmentRow[], 'contracts'),
    });
    expect(html).toContain('sem data de efeito registrada');
    expect(html).toContain('aparenta confiabilidade sem tê-la');
  });

  it('fixa a estrutura do dossiê confiável', () => {
    expect(stableHash(dossier(batch()))).toMatchInlineSnapshot(`"8696332faf2a98ad"`);
  });
});
