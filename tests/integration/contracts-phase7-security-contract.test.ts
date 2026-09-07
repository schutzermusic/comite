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
// ---- correção (140–142) ----
const m140 = read('supabase/migrations/140_phase7_definer_tenant_boundary.sql');
const m141 = read('supabase/migrations/141_billing_release_authority.sql');
const m142 = read('supabase/migrations/142_release_governance_read_model.sql');
const all7 = m135 + m136 + m137 + m138 + m139 + m140 + m141 + m142;

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
const code140 = stripSql(m140);
const code141 = stripSql(m141);
const code7 = stripSql(all7);

/*
  O TypeScript sem comentários, pela MESMA razão do SQL: a documentação da
  regra cita o padrão proibido para explicá-lo, e ler o arquivo inteiro faria a
  explicação reprovar a regra.
*/
const stripTs = (ts: string) => ts
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[^\n'"`]*\/\/[^\n]*/gm, ' ');

/**
 * Corpo de uma função, recortado por DECLARAÇÃO em vez de por regex de fim.
 *
 * Casar o `$$;` final com expressão regular erra: os corpos terminam em
 * `END $$;` na mesma linha, e a variação de espaço entre as migrations tornava
 * a asserção frágil de um jeito que reprovava código correto.
 */
function functionBody(sql: string, name: string): string | null {
  const start = sql.search(
    new RegExp(`(?:CREATE OR REPLACE|CREATE) FUNCTION public\\.${name}\\(`));
  if (start < 0) return null;
  const end = sql.indexOf('$$;', start);
  return end < 0 ? sql.slice(start) : sql.slice(start, end);
}

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
    /*
      Só as DECLARAÇÕES. Os comentários das migrations explicam o que é
      SECURITY DEFINER e por que `current_user` mente lá dentro — e um
      `COMMENT ON` carrega esse texto num literal, que `stripSql` não remove.
      Casar `LANGUAGE ... SECURITY DEFINER` prende a asserção à declaração.
    */
    const definers = code7.match(/LANGUAGE\s+\w+[^\n]*SECURITY DEFINER[^\n]*/g) ?? [];
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
  it('o diretório só ganhou 135–142', () => {
    const versions = readdirSync('supabase/migrations')
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .map((f) => f.slice(0, 3))
      .sort();
    expect(versions[versions.length - 1]).toBe('142');
    for (const v of ['135', '136', '137', '138', '139', '140', '141', '142']) {
      expect(versions).toContain(v);
    }
    // 090 continua arquivada, nunca aplicada.
    expect(versions).not.toContain('090');
  });
});

/*
  ══════════════════════════════════════════════════════════════════════════
  CORREÇÃO DA FASE 7 — o que as migrations 140–142 fecharam
  ══════════════════════════════════════════════════════════════════════════

  Dois defeitos entregues pela fase, e as regras que impedem o retorno de cada
  um. Provas VIVAS em `contracts-phase7-cross-tenant-live.test.ts`; aqui fica
  o que nenhuma execução prova — que a decisão continua ESCRITA.
*/
describe('Fase 7 · correção · fronteira de inquilino em SECURITY DEFINER', () => {
  /*
    A lista é o contrato. Toda função SECURITY DEFINER alcançável pelo
    navegador tem de resolver o inquilino do CHAMADOR antes de descrever a
    linha — e `current_user` não serve para isso dentro de DEFINER, porque lá
    ele é a dona da função.
  */
  const GUARDED = [
    'contract_billing_eligibility_resolve', 'contract_billing_recompute_eligibility',
    'contract_billing_fiscal_readiness', 'contract_billing_fingerprint',
    'contract_billing_release', 'contract_billing_cancel', 'contract_billing_supersede',
    'contract_billing_create_from_milestone', 'finance_receivable_reverse',
    'finance_settlement_record', 'finance_settlement_reverse', 'finance_payment_source_import',
    'finance_reconciliation_record', 'finance_reconciliation_reverse',
    'approval_subject_resolve',
  ];

  it('toda função corrigida resolve o inquilino do chamador', () => {
    const corrected = code140 + code141;
    for (const fn of GUARDED) {
      const body = functionBody(corrected, fn);
      expect(body, `${fn} não foi corrigida`).not.toBeNull();
      expect(body!, fn).toContain('apex_browser_organization()');
    }
  });

  it('a guarda NÃO usa `current_user`, que mente dentro de DEFINER', () => {
    // O predicado de chamador vive num lugar só, e é SECURITY INVOKER.
    expect(code140).toMatch(
      /CREATE FUNCTION public\.apex_caller_is_browser\(\)[\s\S]{0,200}SECURITY INVOKER/);
    expect(code140).toContain("request.jwt.claims");
  });

  it('perfil ausente NEGA em vez de liberar', () => {
    expect(code140).toMatch(/org IS NULL[\s\S]{0,120}TENANT_UNRESOLVED/);
  });

  it('a resposta de "não é seu" é a MESMA de "não existe"', () => {
    expect(code140).toMatch(/not_found jsonb :=[\s\S]{0,200}BILLING_EVENT_NOT_FOUND/);
    // Nenhuma mensagem distingue os dois casos.
    expect(code140).not.toMatch(/outra organiza[çc][ãa]o'[\s]*USING ERRCODE/i);
  });

  it('as funções internas são revogadas de anon E authenticated, não só de PUBLIC', () => {
    /*
      `REVOKE ... FROM PUBLIC` não bastava: o projeto concede EXECUTE a `anon` e
      `authenticated` por ALTER DEFAULT PRIVILEGES quando a função nasce. Duas
      funções ficaram executáveis por `anon` em produção por causa disso.
    */
    for (const fn of ['contract_billing_fingerprint', 'contract_billing_recompute_eligibility',
      'approval_subject_resolve', 'fiscal_documents_emit_lifecycle']) {
      expect(code140, fn).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]{0,80}FROM[^;]*anon, authenticated`));
    }
  });

  it('o recomputo — que MUTA — sai do alcance do navegador', () => {
    expect(code140).toMatch(
      /REVOKE ALL ON FUNCTION public\.contract_billing_recompute_eligibility\(uuid\) FROM anon, authenticated/);
    // E o serviço do navegador passa a LER, não a recomputar.
    expect(service).toContain('readBillingEligibility');
    // Sem comentários: o serviço EXPLICA por que deixou de chamar a função que
    // muta, e a explicação cita o nome dela.
    expect(stripTs(service)).not.toContain('contract_billing_recompute_eligibility');
  });
});

describe('Fase 7 · correção · autoridade de liberação não é inventada', () => {
  it('as concessões automáticas a papéis globais foram desfeitas', () => {
    expect(code141).toMatch(/DELETE FROM public\.role_permissions[\s\S]{0,400}contracts\.billing\.release/);
    /*
      A 136 está APLICADA e não se reescreve — a concessão errada continua no
      arquivo dela, como registro do que foi feito. O que a correção precisa
      garantir é que nada de 140 em diante volte a conceder.
    */
    expect(code140 + code141 + stripSql(m142)).not.toMatch(
      /INSERT INTO public\.role_permissions[\s\S]{0,300}contracts\.billing\./);
  });

  it('o vocabulário das permissões permanece — capacidade não é autoridade', () => {
    expect(code136).toMatch(/INSERT INTO public\.permissions[\s\S]{0,300}'contracts\.billing\.release'/);
    expect(code141).not.toMatch(/DELETE FROM public\.permissions/);
  });

  it('o desvio de administrador saiu da liberação', () => {
    const release = functionBody(code141, 'contract_billing_release');
    expect(release).not.toBeNull();
    expect(release!).not.toContain('current_user_is_admin');
  });

  it('NO_POLICY sem autoridade declarada recusa, e recusa NOMEANDO o motivo', () => {
    expect(code141).toMatch(/authority IS NULL[\s\S]{0,600}RELEASE_AUTHORITY_NOT_CONFIGURED/);
    // A recusa vem ANTES de qualquer UPDATE de liberação.
    const idxRefusal = code141.indexOf('RELEASE_AUTHORITY_NOT_CONFIGURED');
    const idxRelease = code141.indexOf("SET release_state = 'RELEASED'");
    expect(idxRefusal).toBeGreaterThan(0);
    expect(idxRefusal).toBeLessThan(idxRelease);
  });

  it('a autoridade exige EVIDÊNCIA, e nasce vazia', () => {
    expect(code141).toMatch(/source_kind\s+text NOT NULL CHECK/);
    expect(code141).toMatch(/source_reference\s+text NOT NULL CHECK/);
    expect(code141).toMatch(/justification\s+text NOT NULL CHECK/);
    expect(code141).not.toMatch(/INSERT INTO public\.contract_billing_release_authorities/);
  });

  it('quem declara autoridade não é quem a exerce', () => {
    // A escrita da tabela pede administração, não `contracts.billing.release`.
    const policy = /CREATE POLICY cbra_write[\s\S]*?;/.exec(code141);
    expect(policy).not.toBeNull();
    expect(policy![0]).toContain('current_user_is_admin()');
    expect(policy![0]).not.toContain('contracts.billing.release');
  });

  it('a interface não oferece liberar sem governança configurada', () => {
    expect(display).toContain('blockedByGovernance');
    expect(display).toMatch(/releaseGovernanceState !== 'NOT_CONFIGURED'/);
  });
});
