/**
 * Fase 7 — o contrato que o CÓDIGO tem de manter, lido do arquivo.
 *
 * Provas VIVAS moram em `scripts/lib/phase7-assertions.mjs` (uma sessão,
 * reexecutada a cada aplicação) e em `contracts-phase7-live.test.ts` (duas
 * sessões). Este arquivo prova o que nenhuma execução prova: que a fronteira
 * continua ESCRITA onde foi decidida.
 *
 * O que ele guarda, em uma frase cada:
 *
 *   · `billing_amount` nunca vira degrau da precedência de valor medido;
 *   · Contratos não escreve `fiscal_documents` nem `finance_receivables`;
 *   · o ator nunca é parâmetro das RPCs governadas;
 *   · o navegador não escreve história financeira — o GRANT não pode voltar;
 *   · nada de política de aprovação, base de valor ou mapeamento contábil
 *     semeado;
 *   · casamento difuso não fecha conciliação;
 *   · a fila do Fiscal não migra para `apex_jobs`;
 *   · nada da Fase 8/9/10 começado por engano;
 *   · migrations aplicadas não são editadas.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const m135 = read('supabase/migrations/135_finance_tenant_hardening.sql');
const m136 = read('supabase/migrations/136_contracts_billing_entitlement.sql');
const m137 = read('supabase/migrations/137_contracts_fiscal_bridge.sql');
const m138 = read('supabase/migrations/138_finance_receivables_settlements.sql');
const m139 = read('supabase/migrations/139_contract_to_cash_read_model.sql');
const all7 = m135 + m136 + m137 + m138 + m139;

/**
 * O SQL sem os comentários.
 *
 * As asserções abaixo procuram por padrões PROIBIDOS, e os comentários destas
 * migrations explicam com todas as letras por que cada um é proibido — logo,
 * CITAM o padrão. Ler o arquivo inteiro faria a explicação da regra reprovar a
 * regra.
 */
const stripSql = (sql: string) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ');

const code136 = stripSql(m136);
const code138 = stripSql(m138);
const code7 = stripSql(all7);

/*
  O TypeScript sem comentários, pela MESMA razão do SQL: a documentação da
  regra cita o padrão proibido para explicá-lo, e ler o arquivo inteiro faria a
  explicação reprovar a regra.
*/
const stripTs = (ts: string) => ts
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[^\n'"`]*\/\/[^\n]*/gm, ' ');

const service = read('src/lib/contracts/billing/contract-to-cash-service.ts');
const display = read('src/lib/contracts/billing/contract-to-cash-display.ts');
const contractService = read('src/lib/contracts/contract-service.ts');
const handlers = read('src/lib/platform/jobs/handlers.ts');
const registry = read('src/lib/platform/jobs/registry.ts');
const intake = read('src/lib/fiscal/server/billing-intake.ts');

describe('Fase 7 · precedência do valor medido permanece congelada', () => {
  it('nenhuma função da fase lê billing_amount como VALOR', () => {
    /*
      A coluna aparece nas migrations, e deve mesmo: o resolvedor a menciona
      para DECLARAR que existe e foi ignorada. O que não pode existir é ela do
      lado direito de uma atribuição de valor ou dentro de um COALESCE de
      valor — que é como ela virava número antes.
    */
    expect(code7).not.toMatch(/COALESCE\s*\([^)]*billing_amount/i);
    expect(code7).not.toMatch(/amount\s*[:=]\s*[^;]*\bbilling_amount\b/i);
    expect(code7).not.toMatch(/measured_amount\s*,\s*billing_amount\s*\)/i);
  });

  it('o resolvedor devolve FONTE junto do valor', () => {
    expect(code136).toContain('amount_source');
    expect(code136).toMatch(/'ACCEPTED_MEASUREMENT'/);
    expect(code136).toMatch(/'LEGACY_MEASURED_AMOUNT'/);
    expect(code136).toMatch(/'FIXED_CONTRACT_ENTITLEMENT'/);
  });

  it('direito contratual FIXO exige origem contratual verificável', () => {
    expect(code136).toMatch(/cber_provenance_required/);
    expect(code136).toMatch(/source_clause_id IS NOT NULL[\s\S]{0,120}source_document_id IS NOT NULL/);
  });

  it('a ponte marco → faturamento não reintroduz o `??` opaco', () => {
    // A função TypeScript delega ao banco; a expressão proibida não volta.
    expect(stripTs(contractService)).not.toMatch(/measured_amount\s*\?\?\s*[^;]*billing_amount/);
    expect(contractService).toContain('contract_billing_create_from_milestone');
  });

  it('o módulo de apresentação recusa exibir valor sem procedência', () => {
    expect(display).toMatch(/amountSource === 'UNKNOWN'/);
    expect(display).toMatch(/LEGACY_NO_PROVENANCE/);
  });
});

describe('Fase 7 · fronteiras de domínio', () => {
  it('Contratos não insere em fiscal_documents', () => {
    // A ponte grava PEDIDO; quem cria rascunho é o serviço do Fiscal.
    expect(stripSql(m136)).not.toMatch(/INSERT\s+INTO\s+public\.fiscal_documents/i);
    expect(stripSql(m137)).not.toMatch(/INSERT\s+INTO\s+public\.fiscal_documents/i);
    expect(stripSql(m139)).not.toMatch(/INSERT\s+INTO\s+public\.fiscal_documents/i);
  });

  it('a criação de rascunho fiscal mora no módulo do FISCAL', () => {
    expect(intake).toContain('createFiscalDocument');
    // E o handler de Contratos só a alcança por importação do módulo do Fiscal.
    expect(handlers).toContain("@/lib/fiscal/server/billing-intake");
    expect(handlers).not.toMatch(/from\('fiscal_documents'\)\s*\.\s*insert/);
  });

  it('só Finanças cria Contas a Receber e lançamento de razão', () => {
    expect(stripSql(m136)).not.toMatch(/INSERT\s+INTO\s+public\.finance_receivables/i);
    expect(stripSql(m137)).not.toMatch(/INSERT\s+INTO\s+public\.ledger_entry/i);
    expect(code138).toMatch(/INSERT INTO public\.ledger_entry/);
    // E a porta automática do razão é inalcançável pelo navegador.
    expect(code138).toMatch(
      /REVOKE ALL ON FUNCTION public\.finance_ledger_post_receivable\(uuid\)\s*\n?\s*FROM PUBLIC, anon, authenticated/);
  });

  it('a transmissão fiscal permanece em fiscal_jobs', () => {
    expect(code7).not.toMatch(/apex_jobs_enqueue\([^)]*fiscal[^)]*transmit/i);
    expect(stripSql(m139)).not.toMatch(/INSERT INTO public\.apex_event_routes[\s\S]*fiscal\.[a-z.]*transmit/i);
  });
});

describe('Fase 7 · o ator nunca é parâmetro', () => {
  it('as RPCs governadas derivam o ator de auth.uid()', () => {
    for (const fn of ['contract_billing_release', 'contract_billing_cancel',
      'contract_billing_supersede', 'contract_billing_create_from_milestone']) {
      const sig = new RegExp(`CREATE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS`);
      const match = sig.exec(code136);
      expect(match, `assinatura de ${fn}`).not.toBeNull();
      expect(match![1]).not.toMatch(/actor|user_id|released_by|by_user/i);
    }
    expect(code136).toMatch(/actor\s+uuid\s*:=\s*auth\.uid\(\)/);
  });

  it('registrar liquidação e conciliar também derivam o ator', () => {
    for (const fn of ['finance_settlement_record', 'finance_settlement_reverse',
      'finance_reconciliation_record']) {
      const sig = new RegExp(`CREATE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS`);
      const match = sig.exec(code138);
      expect(match, `assinatura de ${fn}`).not.toBeNull();
      expect(match![1]).not.toMatch(/actor|user_id|reconciled_by|by_user/i);
    }
  });

  it('o serviço do navegador não envia ator para o banco', () => {
    expect(service).not.toMatch(/p_actor|actor_user_id|released_by:/);
  });
});

describe('Fase 7 · o navegador não escreve história financeira', () => {
  const FINANCIAL = [
    'finance_receivables', 'finance_receivable_installments', 'finance_settlements',
    'finance_reconciliations', 'finance_reconciliation_candidates', 'finance_payment_sources',
    'contract_billing_fiscal_requests', 'contract_billing_fiscal_allocations',
    'contract_billing_event_history', 'contract_billing_adjustments',
  ];

  it('nenhuma delas ganha GRANT de escrita', () => {
    for (const table of FINANCIAL) {
      const grant = new RegExp(`GRANT[^;]*\\b(INSERT|UPDATE|DELETE)\\b[^;]*ON\\s+public\\.${table}\\b`, 'i');
      expect(code7, table).not.toMatch(grant);
    }
  });

  it('e todas são explicitamente revogadas', () => {
    for (const table of FINANCIAL) {
      expect(code7, table).toMatch(new RegExp(`REVOKE[\\s\\S]{0,400}\\b${table}\\b`));
    }
  });

  it('nenhuma migration da fase concede TRUNCATE a papel de navegador', () => {
    expect(code7).not.toMatch(/GRANT[^;]*TRUNCATE[^;]*(anon|authenticated)/i);
  });

  it('a guarda de coluna do navegador cobre liberação e procedência', () => {
    expect(code136).toMatch(/contract_billing_events_guard_browser/);
    for (const col of ['release_state', 'released_by', 'eligibility_state', 'amount_source',
      'entitlement_key', 'source_measurement_id']) {
      expect(code136, col).toContain(col);
    }
  });
});

describe('Fase 7 · nada fabricado', () => {
  it('nenhuma política de aprovação é semeada', () => {
    expect(code7).not.toMatch(/INSERT\s+INTO\s+public\.approval_polic/i);
    expect(code7).not.toMatch(/INSERT\s+INTO\s+public\.approval_engine_cutover/i);
  });

  it('nenhuma base de recebível nem mapeamento contábil é semeado', () => {
    expect(code7).not.toMatch(/INSERT\s+INTO\s+public\.finance_receivable_basis_policies/i);
    expect(code7).not.toMatch(/INSERT\s+INTO\s+public\.finance_posting_rules/i);
  });

  it('nenhuma regra de direito contratual fixo é semeada', () => {
    expect(code7).not.toMatch(/INSERT\s+INTO\s+public\.contract_billing_entitlement_rules/i);
  });

  it('nenhum portão de produção fiscal é semeado', () => {
    expect(code7).not.toMatch(/INSERT\s+INTO\s+public\.fiscal_production_gates/i);
    expect(code7).not.toMatch(/production_enabled\s*=\s*true/i);
  });

  it('nenhum documento fiscal, título, liquidação ou conciliação é semeado', () => {
    /*
      As migrations PRECISAM conter `INSERT INTO finance_receivables` — dentro
      do corpo da função que cria o título quando uma nota é autorizada. O que
      não pode existir é INSERT no nível da MIGRATION, que gravaria linha no
      momento da aplicação.

      Por isso os corpos de função saem antes da conferência. A prova
      complementar, de que a contagem em produção é zero depois de aplicar,
      está no portão pós-aplicação de `apply-contracts-v2-phase7.mjs`.
    */
    const outsideFunctions = code7.replace(/AS \$\$[\s\S]*?\$\$/g, ' ');
    for (const table of ['fiscal_documents', 'finance_receivables', 'finance_settlements',
      'finance_reconciliations', 'finance_payment_sources', 'apar_title', 'ledger_entry',
      'contract_billing_events']) {
      expect(outsideFunctions, table).not.toMatch(
        new RegExp(`INSERT\\s+INTO\\s+public\\.${table}\\b`, 'i'));
    }
  });
});

describe('Fase 7 · conciliação e liquidação', () => {
  it('casamento difuso não pode fechar conciliação', () => {
    expect(code138).toMatch(/match_kind[\s\S]{0,120}'DETERMINISTIC_SOURCE_ID'[\s\S]{0,60}'MANUAL_GOVERNED'/);
    expect(code138).toMatch(/FUZZY_CANNOT_FINALIZE/);
    // Proposta difusa mora em tabela separada, estruturalmente.
    expect(code138).toMatch(/CREATE TABLE public\.finance_reconciliation_candidates/);
  });

  it('pago e aberto são DERIVADOS: nenhuma coluna os materializa', () => {
    const table = /CREATE TABLE public\.finance_receivables \(([\s\S]*?)\n\);/.exec(code138);
    expect(table).not.toBeNull();
    expect(table![1]).not.toMatch(/paid_amount_cents|paid_at\b|open_amount_cents/);
    expect(code138).toMatch(/CREATE VIEW public\.finance_receivable_balances/);
  });

  it('liquidação é append-only e o estorno é linha nova', () => {
    expect(code138).toMatch(/finance_settlements_no_rewrite/);
    expect(code138).toMatch(/reversal_of/);
    expect(code138).toMatch(/fs_reversal_unique UNIQUE \(organization_id, reversal_of\)/);
  });

  it('excesso de recebimento é recusado, não absorvido', () => {
    expect(code138).toMatch(/OVERPAYMENT_REVIEW_REQUIRED/);
  });

  it('a base de valor do recebível é obrigatória e explícita', () => {
    expect(code138).toMatch(/AR_BASIS_UNCONFIGURED/);
    expect(code138).toMatch(/amount_basis\s+text NOT NULL/);
  });

  it('o vencimento não é inventado a partir de texto livre', () => {
    expect(code138).toMatch(/DUE_DATE_UNKNOWN/);
    expect(code138).toMatch(/'FISCAL_DOCUMENT_DUE_DATE'/);
    expect(code138).not.toMatch(/payment_terms/);
  });
});

describe('Fase 7 · SECURITY DEFINER e inquilino', () => {
  it('toda função nova SECURITY DEFINER fixa search_path', () => {
    const definers = code7.match(/SECURITY DEFINER[^\n]*/g) ?? [];
    expect(definers.length).toBeGreaterThan(10);
    for (const line of definers) expect(line).toMatch(/SET search_path = public/);
  });

  it('os vínculos novos são FK COMPOSTA de mesmo inquilino', () => {
    for (const constraint of ['fr_party_tenant', 'fr_contract_tenant', 'fr_billing_tenant',
      'fr_document_tenant', 'fs_receivable_tenant', 'frec_settlement_tenant',
      'cbe_measurement_tenant', 'cbfa_document_tenant']) {
      expect(code7, constraint).toContain(constraint);
    }
  });

  it('as visões de leitura respeitam a RLS de quem consulta', () => {
    expect(code7).toMatch(/CREATE VIEW public\.finance_receivable_balances\s*\n?WITH \(security_invoker = true\)/);
    expect(code7).toMatch(/CREATE VIEW public\.contract_to_cash_read_model\s*\n?WITH \(security_invoker = true\)/);
  });

  it('as tabelas legadas de Finanças ganharam recorte de organização', () => {
    for (const table of ['apar_title', 'ledger_entry', 'period_close', 'finance_audit_log']) {
      expect(stripSql(m135), table).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s*\\n?\\s*ADD COLUMN organization_id uuid NOT NULL`));
    }
    // E o fechamento de período deixou de ser global.
    expect(stripSql(m135)).toMatch(/DROP CONSTRAINT period_close_period_key_key/);
  });
});

describe('Fase 7 · fronteiras de fase', () => {
  it('nenhuma tabela de Fase 8/9/10 é criada', () => {
    for (const forbidden of ['risk_exposure', 'control_tower', 'automation_policies',
      'automation_executions', 'dunning', 'collections_case', 'write_off']) {
      expect(code7, forbidden).not.toMatch(new RegExp(`CREATE TABLE public\\.\\w*${forbidden}`, 'i'));
    }
  });

  it('os tipos de trabalho novos são só os cinco da cadeia', () => {
    const phase7 = (registry.match(/'(contracts\.billing|finance\.receivable)\.[a-z_.]+'/g) ?? []);
    expect(new Set(phase7).size).toBe(5);
    expect(registry).toContain("'contracts.billing.candidate_from_measurement'");
    expect(registry).toContain("'finance.receivable.create_from_fiscal'");
  });

  it('todo handler novo declara a base da idempotência', () => {
    for (const name of ['billingCandidate', 'billingApproval', 'fiscalRequest',
      'receivableFromFiscal', 'fiscalCancellation']) {
      const block = new RegExp(`const ${name}: JobHandler<[^>]+> = \\{([\\s\\S]*?)\\n\\};`);
      const match = block.exec(handlers);
      expect(match, name).not.toBeNull();
      expect(match![1], name).toContain('idempotencyBasis');
    }
  });
});

describe('Fase 7 · migrations aplicadas não são editadas', () => {
  it('o diretório só ganhou 135–139', () => {
    const versions = readdirSync('supabase/migrations')
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 3))
      .sort();
    expect(versions[versions.length - 1]).toBe('139');
    for (const v of ['135', '136', '137', '138', '139']) expect(versions).toContain(v);
    // 090 continua arquivada, nunca aplicada.
    expect(versions).not.toContain('090');
  });
});
