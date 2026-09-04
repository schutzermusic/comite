/**
 * Contrato de segurança da Fase 0 do Contracts V2 — leitura estática das
 * migrations 099/100/101.
 *
 * Este arquivo não conversa com banco: ele afirma o que as migrations DIZEM,
 * e roda em qualquer máquina. A prova de que o banco se COMPORTA assim está em
 * `contracts-phase0-live-rls.test.ts`, que executa contra o Postgres real.
 * As duas são necessárias por razões diferentes: uma trava a redação, a outra
 * trava o efeito.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8');

/**
 * SQL sem comentários.
 *
 * As migrations desta fase explicam o defeito que corrigem, e explicar
 * `USING (true)` exige escrever `USING (true)`. Uma asserção sobre o que a
 * migration FAZ precisa olhar só o que ela executa — senão a documentação
 * derruba o teste que ela existe para tornar legível.
 */
const code = (sql: string) => sql.replace(/--.*$/gm, '');
const tenancy = read('099_tenant_isolation_reference_tables.sql');
const approval = read('100_contract_approval_safety.sql');
const status = read('101_contract_status_vocabulary.sql');

describe('0.1 · isolamento de tenant em cost_center e supplier', () => {
  it('remove as políticas de leitura irrestrita', () => {
    expect(tenancy).toContain('DROP POLICY IF EXISTS "ref_read_cc" ON public.cost_center');
    expect(tenancy).toContain('DROP POLICY IF EXISTS "ref_read_sup" ON public.supplier');
  });

  it('substitui por leitura escopada pela organização da sessão', () => {
    for (const policy of ['cost_center_select_scoped', 'supplier_select_scoped']) {
      expect(tenancy).toContain(`CREATE POLICY "${policy}"`);
    }
    // Nenhuma política nova pode voltar a ser irrestrita.
    expect(code(tenancy)).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });

  it('dá a supplier o UPDATE e o DELETE que nunca teve', () => {
    expect(tenancy).toContain('CREATE POLICY "supplier_update_scoped"');
    expect(tenancy).toContain('CREATE POLICY "supplier_delete_scoped"');
  });

  it('preserva a autoridade de escrita que já existia', () => {
    // INSERT de fornecedor continua sendo admin OU analista — a correção é de
    // tenant, não de quem pode cadastrar.
    expect(tenancy).toContain("has_finance_role_or_perm('finance_analyst', 'finance.edit')");
  });

  it('só faz backfill quando a atribuição é determinística', () => {
    expect(tenancy).toContain('IF org_count = 1 THEN');
    expect(tenancy).toMatch(/backfill NÃO executado/);
    // NOT NULL apenas quando não restou linha órfã.
    expect(tenancy).toContain('IF cc_null = 0 THEN');
    expect(tenancy).toContain('IF sup_null = 0 THEN');
  });

  it('não antecipa a Fase 1: não torna finance_cost_centers canônica', () => {
    expect(code(tenancy)).not.toMatch(/finance_cost_centers/);
    // e não toca as tabelas que só entram numa fronteira do V2
    expect(code(tenancy)).not.toMatch(/ALTER TABLE public\.(ledger_entry|apar_title|client|business_unit)/);
  });
});

describe('0.2 · segurança da aprovação de contratos', () => {
  it('remove a política FOR ALL que permitia aprovar com contracts.edit', () => {
    expect(approval).toContain('DROP POLICY IF EXISTS contract_approvals_manage');
    const policies = approval.slice(approval.indexOf('-- 3) RLS'));
    expect(code(policies)).not.toContain("current_user_has_permission('contracts.edit')");
    expect(policies).toContain("current_user_has_permission('contracts.approve')");
  });

  it('amarra reviewer_user_id ao usuário autenticado, no WITH CHECK', () => {
    const insert = approval.slice(approval.indexOf('CREATE POLICY contract_approvals_insert'));
    expect(insert).toContain('reviewer_user_id = auth.uid()');
    const update = approval.slice(approval.indexOf('CREATE POLICY contract_approvals_update'));
    expect(update).toContain('WITH CHECK');
    expect(update).toContain('reviewer_user_id = auth.uid()');
  });

  it('não deixa política de DELETE: decisão de aprovação é histórico', () => {
    expect(code(approval)).not.toMatch(/CREATE POLICY \w+ ON public\.contract_approvals\s+FOR DELETE/);
  });

  it('impõe segregação de funções e ordem por trigger — não só por RLS', () => {
    expect(approval).toContain('CREATE TRIGGER trg_contract_approval_safety');
    expect(approval).toContain('BEFORE INSERT OR UPDATE ON public.contract_approvals');
    expect(approval).toContain('NEW.reviewer_user_id = contract_creator');
    expect(approval).toContain('Segregação de funções');
    expect(approval).toContain('Ordem de aprovação');
  });

  it('o trigger vale para a chave de serviço (SECURITY DEFINER, search_path fixo)', () => {
    const fn = approval.slice(approval.indexOf('CREATE OR REPLACE FUNCTION public.enforce_contract_approval_safety'));
    expect(fn).toContain('SECURITY DEFINER');
    expect(fn).toContain('SET search_path = public, pg_temp');
  });

  it('só barra decisão terminal — o trâmite continua livre', () => {
    expect(approval).toContain("IF NEW.status NOT IN ('approved', 'rejected') THEN");
  });

  it('a ordem canônica das etapas é preservada, sem renomear nada', () => {
    expect(approval).toContain("ARRAY['juridico', 'financeiro', 'comite', 'diretoria']");
  });

  it('não antecipa a Fase 5: nenhuma tabela de approval engine', () => {
    expect(code(approval)).not.toMatch(/CREATE TABLE[\s\S]{0,40}approval_(policies|requests|steps|decisions|delegations)/);
  });
});

describe('0.4 · vocabulário canônico de contracts.status', () => {
  const CANONICAL = [
    'draft', 'negotiation', 'legal_review', 'commercial_review', 'signed',
    'active', 'expiring_soon', 'expired', 'closed', 'cancelled', 'archived',
  ];

  it('fecha a coluna com CHECK sobre o vocabulário observado', () => {
    expect(status).toContain('ADD CONSTRAINT contracts_status_check');
    for (const value of CANONICAL) expect(status).toContain(`'${value}'`);
  });

  it('interrompe a migration se a produção tiver valor fora do conjunto', () => {
    expect(status).toContain('RAISE EXCEPTION');
    expect(status).toMatch(/Nenhum dado foi alterado/);
    // O que NÃO pode existir: correção automática do valor divergente.
    expect(code(status)).not.toMatch(/UPDATE\s+public\.contracts\s+SET\s+status/i);
  });

  it('não renomeia nem descarta status algum', () => {
    expect(code(status)).not.toMatch(/DELETE\s+FROM\s+public\.contracts/i);
    expect(status).toContain("'negotiation'");
  });
});
