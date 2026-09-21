/**
 * A DECISÃO FINANCEIRA DO MÓDULO DE PROJETOS.
 *
 * O que estes testes protegem é a COERÊNCIA: cabeçalho, aba Financeiro, aba
 * Contrato e evento de medição respondem à mesma pergunta, e a resposta é a
 * mesma nas quatro. O bug que eles impedem não é um vazamento — é o usuário
 * que vê "R$ 8.032.339,76" numa tela e "Restrito" na tela ao lado.
 *
 * Também fixam a fronteira entre as três perguntas que a 182 colapsava:
 * existir o marco, ver o valor em Contratos, ver dinheiro deste Projeto.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  PROJECT_FINANCIAL_PERMISSIONS, canViewProjectFinancials,
} from '@/lib/auth/project-financials';

/** Os papéis do produto, como a migration 005 os semeia. */
const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  owner_admin: [
    'projects.view', 'projects.view_costs', 'projects.view_margin',
    'finance.view', 'finance.view_project_costs',
    'contracts.view', 'contracts.view_values',
  ],
  ceo_diretoria: [
    'projects.view', 'projects.view_all', 'finance.view', 'finance.view_project_costs',
    'contracts.view', 'contracts.view_values',
  ],
  financeiro: [
    'projects.view', 'projects.view_all', 'projects.view_costs',
    'finance.view', 'finance.view_project_costs',
    'contracts.view', 'contracts.view_values',
  ],
  juridico_contratos: ['projects.view', 'contracts.view', 'contracts.view_values'],
  gestor_projetos: ['projects.view', 'projects.view_assigned', 'contracts.view'],
  engenharia_pcp: ['projects.view', 'projects.view_assigned', 'contracts.view'],
  rh: ['projects.view'],
};

const can = (role: string) =>
  canViewProjectFinancials((key) => ROLE_PERMISSIONS[role].includes(key));

describe('quem vê dinheiro de projeto', () => {
  it.each(['owner_admin', 'ceo_diretoria', 'financeiro'])('%s vê', (role) => {
    expect(can(role)).toBe(true);
  });

  it.each(['gestor_projetos', 'engenharia_pcp', 'rh'])('%s não vê', (role) => {
    expect(can(role)).toBe(false);
  });

  it('jurídico de contratos NÃO vê financeiro de PROJETO', () => {
    /*
      Consequência deliberada da separação. `juridico_contratos` tem
      `contracts.view_values` e nenhuma permissão financeira de projeto: lê o
      valor do marco no módulo de Contratos e o vê como "Restrito" dentro de
      Projetos.

      É este caso que prova que a decisão não é `contracts.view_values`
      disfarçada. Se este teste passar a falhar, alguém colapsou de novo as
      duas perguntas.
    */
    expect(can('juridico_contratos')).toBe(false);
    expect(ROLE_PERMISSIONS.juridico_contratos).toContain('contracts.view_values');
  });

  it('ver o contrato não é ver o dinheiro do projeto', () => {
    expect(canViewProjectFinancials((k) => k === 'contracts.view')).toBe(false);
    expect(canViewProjectFinancials((k) => k === 'contracts.view_values')).toBe(false);
  });

  it('sem permissão nenhuma, não vê', () => {
    expect(canViewProjectFinancials(() => false)).toBe(false);
  });

  it.each(PROJECT_FINANCIAL_PERMISSIONS)('%s sozinha já concede', (key) => {
    expect(canViewProjectFinancials((k) => k === key)).toBe(true);
  });
});

describe('o espelho TypeScript ↔ SQL', () => {
  /*
    A autoridade é `current_user_can_view_project_financials()` (183). Esta
    função existe para o DESENHO concordar com o dado. Duas listas que
    precisam ser iguais e que ninguém compara acabam diferentes — então aqui
    elas são comparadas contra o texto da própria migration.
  */
  const sql = fs.readFileSync(
    'supabase/migrations/183_project_financial_visibility.sql', 'utf8');
  const fnBody = sql.slice(
    sql.indexOf('CREATE OR REPLACE FUNCTION public.current_user_can_view_project_financials'),
    sql.indexOf('REVOKE ALL ON FUNCTION public.current_user_can_view_project_financials'),
  );

  it('toda chave do TypeScript está na função SQL', () => {
    for (const key of PROJECT_FINANCIAL_PERMISSIONS) {
      expect(fnBody, `chave ausente no SQL: ${key}`).toContain(`'${key}'`);
    }
  });

  it('a função SQL não concede por nenhuma chave além dessas', () => {
    const keysInSql = [...fnBody.matchAll(/current_user_has_permission\('([^']+)'\)/g)]
      .map((m) => m[1]);
    expect(new Set(keysInSql)).toEqual(new Set(PROJECT_FINANCIAL_PERMISSIONS));
  });

  it('a função SQL admite administrador — e o TypeScript não precisa de ramo', () => {
    // `owner_admin` recebe todas as chaves na 005, então o espelho de
    // TypeScript passa sem um `isAdmin` especial. Um ramo especial seria
    // exatamente onde as duas implementações poderiam divergir.
    expect(fnBody).toContain('current_user_is_admin()');
    expect(can('owner_admin')).toBe(true);
  });

  it('contracts.view_values não aparece na decisão de projeto', () => {
    expect(fnBody).not.toContain('contracts.view_values');
    expect(PROJECT_FINANCIAL_PERMISSIONS).not.toContain('contracts.view_values');
  });
});

describe('as visões mascaram no banco, não no React', () => {
  const evt = fs.readFileSync(
    'supabase/migrations/183_project_financial_visibility.sql', 'utf8');
  const fin = fs.readFileSync(
    'supabase/migrations/184_project_contract_financial_gate.sql', 'utf8');

  it('o evento de medição pergunta à decisão canônica', () => {
    expect(evt).toContain(
      'SELECT public.current_user_can_view_project_financials() AS can_view_values');
  });

  it('o read model contratual do projeto pergunta à mesma', () => {
    expect(fin).toContain(
      'SELECT public.current_user_can_view_project_financials() AS can_view_values');
  });

  it('as duas continuam security_invoker — a RLS de linha não foi tocada', () => {
    expect(evt).toContain('WITH (security_invoker = true)');
    expect(fin).toContain('WITH (security_invoker = true)');
  });

  it('nenhuma das duas cria permissão ou concede escrita', () => {
    for (const sql of [evt, fin]) {
      expect(sql).not.toMatch(/INSERT INTO public\.permissions/i);
      expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)/i);
    }
  });

  it('o evento de medição mantém a informação OPERACIONAL fora do portão', () => {
    // Estas colunas não podem ganhar `CASE WHEN g.can_view_values`: são o que
    // sustenta a visibilidade operacional do gestor de projeto.
    for (const col of [
      'p.planned_billing_date,', 'p.timeline_item_id,', 'p.measurement_status,',
      'p.billing_event_id,', 'p.title,',
    ]) {
      expect(evt, `coluna operacional ausente: ${col}`).toContain(col);
    }
    expect(evt).toContain('(COALESCE(p.planned_amount, 0) > 0)        AS generates_billing');
  });
});
