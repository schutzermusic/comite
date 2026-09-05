/**
 * Contrato de segurança da Fase 1 do Contracts V2 — leitura estática das
 * migrations 102/103/104/105/106.
 *
 * Mesmo par de provas da Fase 0: este arquivo afirma o que as migrations
 * DIZEM, e roda em qualquer máquina; `contracts-phase1-live-rls.test.ts`
 * executa contra o Postgres real e afirma o que elas FAZEM. Uma trava a
 * redação, a outra trava o efeito — e a 034 é a lembrança permanente de que
 * ler a intenção nunca provou o comportamento.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARTY_ROLE_VOCABULARY } from '@/lib/parties/types';

const read = (f: string) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8');

/**
 * SQL sem comentários.
 *
 * As migrations desta fase explicam o defeito que corrigem, e explicar
 * `USING (true)` exige escrever `USING (true)`. A 102 chega a nomear os papéis
 * que REMOVEU (`contractor`, `contracting_authority`) para registrar por que
 * ficaram de fora. Uma asserção sobre o que a migration FAZ precisa olhar só o
 * que ela executa — senão a documentação derruba o teste que ela existe para
 * tornar legível.
 */
const code = (sql: string) => sql.replace(/--.*$/gm, '');

const parties = read('102_platform_parties.sql');
const perms = read('103_parties_perm_seeds.sql');
const tenancy = read('104_tenant_isolation_client_business_unit.sql');
const costcenter = read('105_canonical_cost_center.sql');
const counterparty = read('106_contracts_counterparty_party.sql');

const PHASE1 = [
  ['102', parties],
  ['103', perms],
  ['104', tenancy],
  ['105', costcenter],
  ['106', counterparty],
] as const;

describe('1.1 · parties e party_roles nascem fechadas', () => {
  it('cria as duas tabelas e liga RLS nas duas', () => {
    expect(parties).toContain('CREATE TABLE IF NOT EXISTS public.parties');
    expect(parties).toContain('CREATE TABLE IF NOT EXISTS public.party_roles');
    expect(parties).toContain('ALTER TABLE public.parties     ENABLE ROW LEVEL SECURITY');
    expect(parties).toContain('ALTER TABLE public.party_roles ENABLE ROW LEVEL SECURITY');
  });

  it('declara exatamente as oito políticas discretas, e nenhuma a mais', () => {
    const NAMED = [
      'parties_select_scoped',
      'parties_insert_permissioned',
      'parties_update_permissioned',
      'parties_delete_permissioned',
      'party_roles_select_scoped',
      'party_roles_insert_permissioned',
      'party_roles_update_permissioned',
      'party_roles_delete_permissioned',
    ];
    for (const policy of NAMED) {
      expect(parties).toContain(`CREATE POLICY ${policy} ON public.`);
      expect(parties).toContain(`DROP POLICY IF EXISTS ${policy} ON public.`);
    }
    const created = [...code(parties).matchAll(/CREATE POLICY\s+([a-z_]+)/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual([...NAMED].sort());
  });

  it('nenhuma política é irrestrita nem FOR ALL — a lição da 034', () => {
    // A 100 existe porque a 034 concedeu FOR ALL a `contracts.edit`. Política
    // larga é barata de escrever e cara de descobrir.
    expect(code(parties)).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(code(parties)).not.toMatch(/\bFOR\s+ALL\b/i);
  });

  it('todo WITH CHECK de escrita reafirma o inquilino', () => {
    const checks = [...code(parties).matchAll(/WITH CHECK\s*\(([\s\S]*?)\n  \)/g)].map((m) => m[1]);
    expect(checks.length).toBeGreaterThanOrEqual(4);
    for (const c of checks) expect(c).toContain('organization_id = public.current_user_organization_id()');
  });
});

describe('1.1b · o vocabulário de papéis é DOIS, e só dois', () => {
  it('party_role_vocabulary() devolve customer e supplier', () => {
    const fn = code(parties).slice(code(parties).indexOf('CREATE OR REPLACE FUNCTION public.party_role_vocabulary'));
    const body = fn.slice(0, fn.indexOf('$$', fn.indexOf('$$ SELECT') + 4));
    expect([...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(['customer', 'supplier']);
  });

  it('o CHECK escreve o mesmo vocabulário por extenso', () => {
    const check = code(parties).slice(code(parties).indexOf('ADD CONSTRAINT party_roles_role_check'));
    const values = [...check.slice(0, check.indexOf('))')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual(['customer', 'supplier']);
  });

  it('papéis relativos a contrato não vazaram para o cadastro mestre', () => {
    // 'contractor' e 'contracting_authority' descrevem a posição de uma party
    // DENTRO de um contrato — a mesma empresa é contratada num instrumento e
    // contratante noutro, ao mesmo tempo. Guardar isso aqui obrigaria a tabela
    // a afirmar algo que ela não tem como qualificar. `guarantor` e `insurer`
    // saíram por não terem hoje linha, tela nem regra que os exija.
    for (const removed of ['contractor', 'contracting_authority', 'guarantor', 'insurer']) {
      expect(code(parties)).not.toMatch(new RegExp(`\\b${removed}\\b`, 'i'));
      expect(code(perms)).not.toMatch(new RegExp(`\\b${removed}\\b`, 'i'));
    }
  });

  it('a migration e o TypeScript dizem a mesma coisa', () => {
    const fn = code(parties).slice(code(parties).indexOf('RETURNS text[]'));
    const sqlValues = [...fn.slice(0, fn.indexOf('::text[]')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlValues).toEqual([...PARTY_ROLE_VOCABULARY]);
  });

  it('divergência entre função e CHECK aborta a migration', () => {
    expect(parties).toContain('party_role_vocabulary() e party_roles_role_check divergem');
    expect(parties).toContain('RAISE EXCEPTION');
  });
});

describe('1.1c · a Fase 1 não inventa identidade', () => {
  it('não insere uma linha sequer em parties nem em party_roles', () => {
    expect(code(parties)).not.toMatch(/INSERT\s+INTO\s+(public\.)?parties/i);
    expect(code(parties)).not.toMatch(/INSERT\s+INTO\s+(public\.)?party_roles/i);
    // Nem por derivação a partir do texto livre que a fase existe para reduzir.
    expect(code(parties)).not.toMatch(/counterparty_name/i);
  });

  it('termina exigindo zero linhas nas duas tabelas', () => {
    const gate = parties.slice(parties.lastIndexOf('DO $$'));
    expect(gate).toContain('SELECT count(*) INTO n_parties FROM public.parties');
    expect(gate).toContain('SELECT count(*) INTO n_roles   FROM public.party_roles');
    expect(gate).toContain('IF n_parties <> 0 OR n_roles <> 0 THEN');
    expect(gate).toContain('RAISE EXCEPTION');
  });
});

describe('1.1d · coerência de inquilino por estrutura, não por política', () => {
  it('parties expõe o alvo composto (organization_id, id)', () => {
    expect(parties).toContain('ADD CONSTRAINT parties_org_id_unique UNIQUE (organization_id, id)');
  });

  it('party_roles referencia o par, não só o party_id', () => {
    const fk = code(parties).slice(code(parties).indexOf('ADD CONSTRAINT party_roles_party_same_org'));
    expect(fk).toContain('FOREIGN KEY (organization_id, party_id)');
    expect(fk).toContain('REFERENCES public.parties (organization_id, id)');
  });

  it('106 amarra a contraparte do contrato pelo mesmo par', () => {
    const fk = code(counterparty).slice(code(counterparty).indexOf('contracts_counterparty_party_same_org_fkey'));
    expect(fk).toContain('FOREIGN KEY (organization_id, counterparty_party_id)');
    expect(fk).toContain('REFERENCES public.parties (organization_id, id)');
    expect(fk).toContain('ON DELETE RESTRICT');
  });
});

describe('1.1e · deduplicação só determinística', () => {
  it('a unicidade de identidade é PARCIAL: cadastro sem documento continua possível', () => {
    const idx = code(parties).slice(code(parties).indexOf('CREATE UNIQUE INDEX IF NOT EXISTS uq_parties_org_document'));
    const stmt = idx.slice(0, idx.indexOf(';'));
    expect(stmt).toContain('(organization_id, document_type, document_normalized)');
    expect(stmt).toMatch(/WHERE\s+document_normalized\s+IS\s+NOT\s+NULL/i);
  });

  it('nunca há unicidade sobre legal_name — nome não é identidade', () => {
    expect(code(parties)).not.toMatch(/UNIQUE[\s\S]{0,80}legal_name/i);
    const named = [...code(parties).matchAll(/CREATE UNIQUE INDEX[^;]*;/gi)].map((m) => m[0]);
    for (const stmt of named) expect(stmt).not.toMatch(/legal_name/i);
  });

  it('a normalização do documento é do banco, não da aplicação', () => {
    expect(parties).toContain('document_normalized text GENERATED ALWAYS AS');
    expect(parties).toContain("regexp_replace(coalesce(document_number, ''), '\\D', '', 'g')");
  });
});

describe('1.3 · isolamento de tenant em client e business_unit', () => {
  it('remove as leituras irrestritas herdadas da 002', () => {
    expect(tenancy).toContain('DROP POLICY IF EXISTS "ref_read_cli" ON public.client');
    expect(tenancy).toContain('DROP POLICY IF EXISTS "ref_read_bu" ON public.business_unit');
  });

  it('cria as substitutas escopadas pela organização da sessão', () => {
    for (const policy of [
      'client_select_scoped', 'client_insert_scoped', 'client_update_scoped', 'client_delete_scoped',
      'business_unit_select_scoped', 'business_unit_write_scoped',
    ]) {
      expect(tenancy).toContain(`CREATE POLICY "${policy}"`);
    }
    expect(code(tenancy)).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });

  it('dá a client o UPDATE e o DELETE que nunca teve', () => {
    // `ref_write_cli` era FOR INSERT: nenhuma linha podia ser corrigida nem
    // desativada pela aplicação. Mesma lacuna que a 099 achou em supplier.
    expect(tenancy).toContain('CREATE POLICY "client_update_scoped"');
    expect(tenancy).toContain('CREATE POLICY "client_delete_scoped"');
  });

  it('preserva a autoridade de escrita que já existia', () => {
    expect(tenancy).toContain("has_finance_role_or_perm('finance_analyst', 'finance.edit')");
    expect(tenancy).toContain("has_finance_role_or_perm('finance_admin', 'finance.admin')");
  });

  it('é independente de ordem em relação à 090, que não está aplicada', () => {
    expect(tenancy).toContain('ADD COLUMN IF NOT EXISTS organization_id');
    const drops = [...code(tenancy).matchAll(/DROP POLICY[^;]*;/gi)].map((m) => m[0]);
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(d).toContain('IF EXISTS');
    for (const create of [...code(tenancy).matchAll(/CREATE POLICY "([a-z_]+)"/gi)].map((m) => m[1])) {
      expect(code(tenancy)).toContain(`DROP POLICY IF EXISTS "${create}"`);
    }
    expect(tenancy).toContain('CREATE INDEX IF NOT EXISTS');
    expect(tenancy).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
  });

  it('só faz backfill quando a atribuição é determinística', () => {
    expect(tenancy).toContain('IF org_count = 1 THEN');
    expect(tenancy).toMatch(/backfill NÃO executado/);
    expect(tenancy).toContain('IF cli_null = 0 THEN');
    expect(tenancy).toContain('IF bu_null = 0 THEN');
  });

  it('aborta se qualquer política irrestrita sobreviver', () => {
    const gate = tenancy.slice(tenancy.lastIndexOf('DO $$'));
    expect(gate).toContain("(qual = 'true' OR with_check = 'true')");
    expect(gate).toContain('RAISE EXCEPTION');
  });
});

describe('1.4 · finance_cost_centers vira canônica sem reescrever razão contábil', () => {
  it('absorve o que a 001 sabia fazer, de forma aditiva', () => {
    for (const col of ['parent_id', 'business_unit_id', 'type']) {
      expect(costcenter).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
    expect(costcenter).toContain('ADD CONSTRAINT fcc_org_id_unique UNIQUE (organization_id, id)');
    expect(costcenter).toContain('ADD CONSTRAINT fcc_parent_same_org');
    expect(costcenter).toContain('ADD CONSTRAINT fcc_parent_not_self');
  });

  it('reusa o enum public.cost_center_type e não fabrica um segundo', () => {
    expect(costcenter).toContain('ADD COLUMN IF NOT EXISTS type public.cost_center_type');
    expect(code(costcenter)).not.toMatch(/CREATE\s+TYPE/i);
  });

  it('tem portão de parada guardado nas contagens dos dependentes', () => {
    expect(costcenter).toContain('SELECT count(*) INTO n_ledger FROM public.ledger_entry');
    expect(costcenter).toContain('SELECT count(*) INTO n_alloc  FROM public.allocation_rule');
    expect(costcenter).toContain('IF n_ledger > 0 OR n_alloc > 0 THEN');
    expect(costcenter).toMatch(/RAISE EXCEPTION[\s\S]{0,120}Dependentes de cost_center NÃO estão vazios/);
    expect(costcenter).toMatch(/NADA FOI GRAVADO/);
  });

  it('o portão vem ANTES do primeiro repontamento de chave — parar tarde é não parar', () => {
    const gate = costcenter.indexOf('IF n_ledger > 0 OR n_alloc > 0 THEN');
    const repoint = costcenter.indexOf('ADD CONSTRAINT ledger_entry_cost_center_id_fkey');
    expect(gate).toBeGreaterThan(-1);
    expect(repoint).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(repoint);
  });

  it('reponta os DOIS dependentes, na mesma transação', () => {
    for (const t of ['ledger_entry', 'allocation_rule']) {
      expect(costcenter).toContain(`ALTER TABLE public.${t}\n  DROP CONSTRAINT IF EXISTS ${t}_cost_center_id_fkey`);
      expect(costcenter).toContain('FOREIGN KEY (cost_center_id) REFERENCES public.finance_cost_centers(id)');
    }
  });

  it('não derruba cost_center: o alvo antigo é o que torna o rollback barato', () => {
    expect(code(costcenter)).not.toMatch(/DROP\s+TABLE[\s\S]{0,40}cost_center/i);
    expect(code(costcenter)).not.toMatch(/DELETE\s+FROM\s+public\.cost_center/i);
    expect(costcenter).toMatch(/SUPERSEDED pela 105/);
  });

  it('não classifica os 8 centros existentes: type nasce NULLABLE', () => {
    expect(code(costcenter)).not.toMatch(/type\s+public\.cost_center_type\s+NOT NULL/i);
    expect(code(costcenter)).not.toMatch(/UPDATE\s+public\.finance_cost_centers\s+SET\s+type/i);
  });
});

describe('1.5 · a contraparte canônica nasce vazia', () => {
  it('a coluna é opcional e nenhum contrato é ligado', () => {
    expect(counterparty).toContain('ADD COLUMN IF NOT EXISTS counterparty_party_id uuid');
    expect(code(counterparty)).not.toMatch(/UPDATE\s+public\.contracts/i);
    expect(code(counterparty)).not.toMatch(/\bILIKE\b/i);
    expect(code(counterparty)).not.toMatch(/similarity|levenshtein/i);
  });

  it('a verificação final exige zero vínculos', () => {
    const gate = counterparty.slice(counterparty.lastIndexOf('DO $$'));
    expect(gate).toContain('WHERE counterparty_party_id IS NOT NULL');
    expect(gate).toContain('IF linked <> 0 THEN');
    expect(gate).toContain('RAISE EXCEPTION');
  });

  it('counterparty_name não é apagado nem depreciado', () => {
    expect(code(counterparty)).not.toMatch(/DROP\s+COLUMN[\s\S]{0,30}counterparty_name/i);
  });
});

describe('1.6 · integridade de auditoria — migration não fabrica ator', () => {
  it('nenhuma migration da Fase 1 escreve em audit_logs', () => {
    // Regra herdada da Fase 0: `audit_logs.user_id` é quem AGIU. Uma migration
    // não tem ator — inventar um transforma a trilha de auditoria em ficção
    // exatamente onde ela precisa ser prova.
    for (const [id, sql] of PHASE1) {
      expect(code(sql), `migration ${id}`).not.toMatch(/INSERT\s+INTO\s+(public\.)?audit_logs/i);
      expect(code(sql), `migration ${id}`).not.toMatch(/\baudit_logs\b/i);
    }
  });

  it('nenhuma migration da Fase 1 desliga RLS de tabela alguma', () => {
    for (const [id, sql] of PHASE1) {
      expect(code(sql), `migration ${id}`).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      expect(code(sql), `migration ${id}`).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
    }
  });

  it('toda migration da Fase 1 é uma transação só', () => {
    for (const [id, sql] of PHASE1) {
      expect(sql.trimStart().startsWith('--') || sql.includes('BEGIN;'), `migration ${id}`).toBe(true);
      expect(sql, `migration ${id}`).toContain('BEGIN;');
      expect(sql.trimEnd().endsWith('COMMIT;'), `migration ${id}`).toBe(true);
    }
  });
});
