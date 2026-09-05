/**
 * Fase 1 — prova VIVA dos invariantes, contra o Postgres real.
 *
 * O teste irmão (`contracts-phase1-security-contract.test.ts`) lê o texto das
 * migrations. Este executa. A distinção é a mesma da Fase 0, e vale ainda mais
 * aqui: a coerência de inquilino de `party_roles` NÃO é política — é chave
 * composta. Ler a política nunca provaria que a chave existe, e a checagem de
 * chave estrangeira no PostgreSQL não passa por RLS.
 *
 * As migrations 102–106 NÃO estão aplicadas nesta base. A suíte as aplica
 * dentro da PRÓPRIA transação — do mesmo jeito que
 * `scripts/apply-contracts-v2-phase1.mjs` faz no ensaio, removendo o `BEGIN;` e
 * o `COMMIT;` de cada arquivo — roda as provas e dá ROLLBACK de tudo. Nada
 * sobrevive: nem as tabelas, nem as políticas, nem as organizações sintéticas.
 *
 * Sem `SUPABASE_DB_URL` a suíte é pulada — em CI sem banco ela não falha, e não
 * finge ter passado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { PARTY_ROLE_VOCABULARY } from '@/lib/parties/types';

for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* arquivo ausente é um caso normal */ }
}

const DB_URL = process.env.SUPABASE_DB_URL;
const suite = DB_URL ? describe : describe.skip;

const ORG_B = '00000000-0000-4000-8000-0000000000b1';
const CNPJ = '12345678000195';

const migrationText = (f: string) =>
  readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8');

/** Mesmo desmonte de transação do applier: o arquivo roda DENTRO da nossa. */
const inlineable = (f: string) =>
  migrationText(f).replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');

/**
 * REMENDOS LOCAIS — dois defeitos de SINTAXE que impedem 104 e 105 de aplicar.
 *
 * Não são correções: o arquivo no repositório continua quebrado, e o teste
 * `0` abaixo FALHA enquanto qualquer remendo for necessário. Eles existem só
 * para que as outras dezoito provas possam rodar em vez de morrerem todas no
 * `beforeAll` — um único erro de sintaxe escondendo o comportamento inteiro da
 * fase é o pior resultado possível para um portão de segurança.
 *
 *   104  `... AS t(rel regclass, padrao text, rotulo text)` — lista de apelidos
 *        de coluna no PostgreSQL NÃO aceita tipos. Só nomes. A migration inteira
 *        falha com `syntax error at or near "regclass"`.
 *
 *   105  o RAISE do portão de parada encadeia vários literais `E'...'`
 *        adjacentes. Continuação de literal por quebra de linha só vale para
 *        literais SIMPLES: o segundo `E'` abre um token novo e o parser quebra.
 *        A 102 e a 106 fazem certo — um `E'` seguido de `'` comuns.
 */
const REPAIRS: ReadonlyArray<{ migration: string; sintoma: string; apply: (sql: string) => string }> = [
  {
    migration: '104_tenant_isolation_client_business_unit.sql',
    sintoma: 'lista de apelidos de coluna com tipos: AS t(rel regclass, ...)',
    apply: (sql) => sql.replace('AS t(rel regclass, padrao text, rotulo text)', 'AS t(rel, padrao, rotulo)'),
  },
  {
    migration: '105_canonical_cost_center.sql',
    sintoma: "literais E'...' adjacentes no RAISE do portão de parada",
    apply: (sql) => sql.replace(/('\n\s+)E'/g, "$1'"),
  },
];

const repair = (f: string, sql: string) =>
  REPAIRS.filter((r) => r.migration === f).reduce((acc, r) => r.apply(acc), sql);

const RAW_105 = repair('105_canonical_cost_center.sql', migrationText('105_canonical_cost_center.sql'));

/**
 * O portão de parada da 105, recortado do arquivo — não reescrito.
 *
 * Reproduzir a lógica no teste provaria que o teste sabe contar linhas.
 * Executar o bloco ORIGINAL prova que o portão do arquivo é o que dispara.
 */
const STOP_GATE = (() => {
  const start = RAW_105.indexOf('DO $$', RAW_105.indexOf('PORTÃO DE PARADA'));
  const end = RAW_105.indexOf('END $$;', start) + 'END $$;'.length;
  return RAW_105.slice(start, end);
})();

suite('Fase 1 · invariantes vivos no Postgres', () => {
  let client: pg.Client;
  let orgA: string;
  /** owner_admin da organização A. */
  let userA: string;
  /** owner_admin da organização B — o vizinho que não pode enxergar nada. */
  let userB: string;
  let partyA: string;
  let partyB: string;
  let buA: string;
  let fccA: string;
  /** Migrations que só aplicaram DEPOIS de um remendo local. Deve ficar vazia. */
  const quebradas: string[] = [];

  /** Executa uma consulta como usuário autenticado — com RLS valendo. */
  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query('SAVEPOINT as_user');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE');
      await client.query('RELEASE SAVEPOINT as_user').catch(() => undefined);
    }
  }

  /** Espera que a operação seja recusada, e devolve a mensagem. */
  async function refused(fn: () => Promise<unknown>): Promise<string> {
    await client.query('SAVEPOINT attempt');
    try {
      await fn();
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return '';
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT attempt');
      return err instanceof Error ? err.message : String(err);
    }
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    // Ver a nota da Fase 0: o pooler reaproveita backends, e um
    // `default_transaction_read_only` deixado por outro processo chega até aqui.
    await client.query('SET SESSION default_transaction_read_only = off');
    await client.query('BEGIN');

    // A ordem importa: 105 depende da 104 (business_unit precisa de inquilino
    // antes de virar alvo de FK do modelo canônico), e a 106 depende da 102.
    for (const f of [
      '102_platform_parties.sql',
      '103_parties_perm_seeds.sql',
      '104_tenant_isolation_client_business_unit.sql',
      '105_canonical_cost_center.sql',
      '106_contracts_counterparty_party.sql',
    ]) {
      const verbatim = inlineable(f);
      try {
        await client.query('SAVEPOINT verbatim');
        await client.query(verbatim);
        await client.query('RELEASE SAVEPOINT verbatim');
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT verbatim');
        const patched = repair(f, verbatim);
        if (patched === verbatim) throw err;
        quebradas.push(`${f}: ${err instanceof Error ? err.message : String(err)}`);
        await client.query(patched);
      }
    }

    orgA = (await client.query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)).rows[0].id;

    // Organização B criada DEPOIS das migrations, de propósito: o backfill da
    // 104 só é determinístico com uma organização, e é esse o estado desta base.
    await client.query(
      `INSERT INTO organizations (id, name, slug) VALUES ($1, '[PHASE1] Org B', 'phase1-org-b')`, [ORG_B]);

    const mkUser = async (label: string, org: string) => {
      const { rows } = await client.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
         VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                 $1, 'x', now(), now())
         RETURNING id`, [`phase1.${label}@example.test`]);
      const userId: string = rows[0].id;
      await client.query(
        `INSERT INTO profiles (user_id, organization_id, full_name) VALUES ($1, $2, $3)`,
        [userId, org, `[PHASE1] ${label}`]);
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, organization_id)
         SELECT $1, r.id, $2 FROM roles r WHERE r.key = 'owner_admin' AND r.organization_id IS NULL`,
        [userId, org]);
      return userId;
    };

    userA = await mkUser('org-a-admin', orgA);
    userB = await mkUser('org-b-admin', ORG_B);

    const mkParty = async (org: string, name: string, docType: string | null, doc: string | null) =>
      (await client.query(
        `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
         VALUES ($1, 'organization', $2, $3, $4) RETURNING id`, [org, name, docType, doc])).rows[0].id;

    partyA = await mkParty(orgA, '[PHASE1] ACME Energia S.A.', 'cnpj', CNPJ);
    partyB = await mkParty(ORG_B, '[PHASE1] Vizinha da Org B', null, null);

    // Cadastro de referência espelhado nas duas organizações — sem par, um
    // "não vejo nada" não distingue isolamento de tabela vazia.
    buA = (await client.query(
      `INSERT INTO business_unit (code, name, uf, organization_id)
       VALUES ('PH1-BU-A', '[PHASE1] BU da Org A', 'SP', $1) RETURNING id`, [orgA])).rows[0].id;
    await client.query(
      `INSERT INTO business_unit (code, name, uf, organization_id)
       VALUES ('PH1-BU-B', '[PHASE1] BU da Org B', 'SP', $1)`, [ORG_B]);
    await client.query(
      `INSERT INTO client (name, organization_id) VALUES ('[PHASE1] Cliente da Org A', $1)`, [orgA]);
    await client.query(
      `INSERT INTO client (name, organization_id) VALUES ('[PHASE1] Cliente da Org B', $1)`, [ORG_B]);
    fccA = (await client.query(
      `INSERT INTO finance_cost_centers (organization_id, code, name)
       VALUES ($1, 'PH1-CC-A', '[PHASE1] CC da Org A') RETURNING id`, [orgA])).rows[0].id;
    await client.query(
      `INSERT INTO finance_cost_centers (organization_id, code, name)
       VALUES ($1, 'PH1-CC-B', '[PHASE1] CC da Org B')`, [ORG_B]);
    await client.query(
      `INSERT INTO supplier (name, organization_id) VALUES ('[PHASE1] Fornecedor da Org A', $1)`, [orgA]);
    await client.query(
      `INSERT INTO supplier (name, organization_id) VALUES ('[PHASE1] Fornecedor da Org B', $1)`, [ORG_B]);
  }, 120_000);

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  // ── 0 · o pré-requisito de todas as outras provas ─────────────────────────

  it('0 · as migrations da Fase 1 aplicam COMO ESTÃO ESCRITAS, sem remendo', () => {
    // Uma migration que não aplica não protege nada. Enquanto esta lista não
    // estiver vazia, as provas abaixo descrevem o que o arquivo REMENDADO faz —
    // e o arquivo do repositório aborta antes da primeira política.
    expect(quebradas).toEqual([]);
  });

  // ── 1 · parties: identidade não atravessa inquilino ────────────────────────

  it('1 · a Org B não lê uma linha sequer de parties da Org A', async () => {
    const rows = await asUser(userB, async () =>
      (await client.query(`SELECT id, organization_id, legal_name FROM parties`)).rows);

    // Não-vazio: a Org B enxerga a PRÓPRIA party. Sem isso, "zero linhas da A"
    // seria explicado por falta de permissão, não por isolamento.
    expect(rows.map((r) => r.id)).toContain(partyB);
    expect(rows.every((r) => r.organization_id === ORG_B)).toBe(true);
    expect(rows.filter((r) => r.organization_id === orgA)).toEqual([]);
  });

  it('1b · a Org B não grava party dentro da Org A', async () => {
    const msg = await asUser(userB, () => refused(() => client.query(
      `INSERT INTO parties (organization_id, kind, legal_name, created_by)
       VALUES ($1, 'organization', '[PHASE1] invasora', $2)`, [orgA, userB])));
    expect(msg).toMatch(/row-level security/i);
  });

  it('1c · a Org B não altera party da Org A, nem muda a própria de dono', async () => {
    // Cross-tenant: a linha é invisível, então o UPDATE não encontra nada.
    const affected = await asUser(userB, async () => (await client.query(
      `UPDATE parties SET legal_name = 'sequestrada' WHERE id = $1`, [partyA])).rowCount);
    expect(affected).toBe(0);
    const stillThere = (await client.query(
      `SELECT legal_name FROM parties WHERE id = $1`, [partyA])).rows[0].legal_name;
    expect(stillThere).toBe('[PHASE1] ACME Energia S.A.');

    // E o mesmo defeito pelo outro lado: reescrever a PRÓPRIA linha para dentro
    // da organização alheia. É o WITH CHECK do UPDATE que barra.
    const msg = await asUser(userB, () => refused(() => client.query(
      `UPDATE parties SET organization_id = $1 WHERE id = $2`, [orgA, partyB])));
    expect(msg).toMatch(/row-level security/i);
  });

  it('2 · papel de outra organização é barrado pela CHAVE, não pela política', async () => {
    // Sem trocar de papel: `postgres` ignora RLS por completo. Se a recusa
    // viesse só da política, esta inserção passaria — e um papel da Org B
    // ficaria pendurado numa identidade da Org A. A checagem de chave
    // estrangeira do PostgreSQL não consulta RLS; a chave composta, sim.
    const msg = await refused(() => client.query(
      `INSERT INTO party_roles (organization_id, party_id, role) VALUES ($1, $2, 'customer')`,
      [ORG_B, partyA]));
    expect(msg).toContain('party_roles_party_same_org');
    expect(msg).toMatch(/foreign key/i);
  });

  it('2b · o mesmo papel na própria organização é aceito', async () => {
    const msg = await refused(() => client.query(
      `INSERT INTO party_roles (organization_id, party_id, role) VALUES ($1, $2, 'customer')`,
      [orgA, partyA]));
    expect(msg).toBe('');
  });

  it('3 · papel fora do vocabulário é recusado, e o vocabulário é o do TypeScript', async () => {
    const msg = await refused(() => client.query(
      `INSERT INTO party_roles (organization_id, party_id, role) VALUES ($1, $2, 'contractor')`,
      [orgA, partyA]));
    expect(msg).toContain('party_roles_role_check');

    const vocab: string[] = (await client.query(`SELECT public.party_role_vocabulary() AS v`)).rows[0].v;
    expect(vocab).toEqual([...PARTY_ROLE_VOCABULARY]);
  });

  // ── 4 · deduplicação: determinística, e só ────────────────────────────────

  it('4 · o mesmo documento duas vezes na mesma organização é recusado', async () => {
    // E a máscara não engana: a coluna gerada normaliza antes de comparar.
    const msg = await refused(() => client.query(
      `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
       VALUES ($1, 'organization', '[PHASE1] ACME digitada de novo', 'cnpj', '12.345.678/0001-95')`,
      [orgA]));
    expect(msg).toContain('uq_parties_org_document');
  });

  it('4b · duas parties SEM documento e com o MESMO nome são duas — nome não é identidade', async () => {
    await client.query('SAVEPOINT homonimos');
    const a = await client.query(
      `INSERT INTO parties (organization_id, kind, legal_name)
       VALUES ($1, 'organization', '[PHASE1] Homônima Ltda') RETURNING id`, [orgA]);
    const b = await client.query(
      `INSERT INTO parties (organization_id, kind, legal_name)
       VALUES ($1, 'organization', '[PHASE1] Homônima Ltda') RETURNING id`, [orgA]);
    expect(a.rows[0].id).not.toBe(b.rows[0].id);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM parties WHERE organization_id = $1 AND legal_name = '[PHASE1] Homônima Ltda'`,
      [orgA]);
    expect(rows[0].n).toBe(2);
    await client.query('ROLLBACK TO SAVEPOINT homonimos');
  });

  it('4c · o mesmo CNPJ em duas organizações são DUAS parties, nunca uma', async () => {
    await client.query('SAVEPOINT mesmo_cnpj');
    await client.query(
      `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
       VALUES ($1, 'organization', '[PHASE1] ACME vista pela Org B', 'cnpj', $2)`, [ORG_B, CNPJ]);
    const { rows } = await client.query(
      `SELECT organization_id FROM parties WHERE document_normalized = $1 ORDER BY organization_id`, [CNPJ]);
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.organization_id))).toEqual(new Set([orgA, ORG_B]));
    await client.query('ROLLBACK TO SAVEPOINT mesmo_cnpj');
  });

  // ── 5 · o cadastro de referência que a 104 fechou ─────────────────────────

  it('5 · client, business_unit e finance_cost_centers pararam de vazar', async () => {
    const seen = await asUser(userA, async () => ({
      cli: (await client.query(`SELECT name, organization_id FROM client`)).rows,
      bu: (await client.query(`SELECT code, organization_id FROM business_unit`)).rows,
      fcc: (await client.query(`SELECT code, organization_id FROM finance_cost_centers`)).rows,
    }));

    for (const [rotulo, rows, meu, alheio] of [
      ['client', seen.cli, '[PHASE1] Cliente da Org A', '[PHASE1] Cliente da Org B'],
      ['business_unit', seen.bu, 'PH1-BU-A', 'PH1-BU-B'],
      ['finance_cost_centers', seen.fcc, 'PH1-CC-A', 'PH1-CC-B'],
    ] as const) {
      const chave = rotulo === 'client' ? 'name' : 'code';
      const valores = (rows as Array<Record<string, unknown>>).map((r) => r[chave]);
      expect(valores, rotulo).toContain(meu);
      expect(valores, rotulo).not.toContain(alheio);
      expect((rows as Array<{ organization_id: string }>).every((r) => r.organization_id === orgA), rotulo).toBe(true);
    }
  });

  it('5b · o endurecimento da Fase 0 em supplier continua de pé', async () => {
    const { rows: policies } = await client.query(
      `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'supplier'`);
    const names = policies.map((r) => r.policyname).sort();
    expect(names).toEqual([
      'supplier_delete_scoped', 'supplier_insert_scoped', 'supplier_select_scoped', 'supplier_update_scoped',
    ]);

    const sup = await asUser(userB, async () =>
      (await client.query(`SELECT name, organization_id FROM supplier`)).rows);
    expect(sup.map((r) => r.name)).toContain('[PHASE1] Fornecedor da Org B');
    expect(sup.map((r) => r.name)).not.toContain('[PHASE1] Fornecedor da Org A');
    expect(sup.every((r) => r.organization_id === ORG_B)).toBe(true);
  });

  it('5c · nenhuma política irrestrita restou em nenhuma das sete tabelas', async () => {
    const { rows } = await client.query(
      `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('parties','party_roles','client','business_unit','cost_center','supplier','finance_cost_centers')
          AND (qual = 'true' OR with_check = 'true')`);
    expect(rows).toEqual([]);
  });

  // ── 6 · finance_cost_centers é a canônica ─────────────────────────────────

  it('6 · ledger_entry e allocation_rule apontam para a canônica', async () => {
    const { rows } = await client.query(
      `SELECT conrelid::regclass::text AS tabela, confrelid::regclass::text AS alvo
         FROM pg_constraint
        WHERE contype = 'f'
          AND conrelid IN ('public.ledger_entry'::regclass, 'public.allocation_rule'::regclass)
          AND conname IN ('ledger_entry_cost_center_id_fkey', 'allocation_rule_cost_center_id_fkey')
        ORDER BY tabela`);
    expect(rows).toEqual([
      { tabela: 'allocation_rule', alvo: 'finance_cost_centers' },
      { tabela: 'ledger_entry', alvo: 'finance_cost_centers' },
    ]);
  });

  it('6b · só a autorreferência de cost_center ainda aponta para a legada', async () => {
    const { rows } = await client.query(
      `SELECT conrelid::regclass::text AS tabela, conname FROM pg_constraint
        WHERE confrelid = 'public.cost_center'::regclass`);
    expect(rows.length).toBe(1);
    expect(rows[0].tabela).toBe('cost_center');
  });

  it('6c · a tabela legada continua de pé — é ela que torna o rollback barato', async () => {
    const { rows } = await client.query(`SELECT to_regclass('public.cost_center') AS t`);
    expect(rows[0].t).toBe('cost_center');
  });

  it('6d · o PORTÃO DE PARADA da 105 dispara de verdade quando há lançamento', async () => {
    await client.query('SAVEPOINT gate');
    // A precondição do portão é justamente esta: com dado real, o repontamento
    // exigiria um mapeamento de código revisado por gente.
    await client.query(
      `INSERT INTO ledger_entry
         (entry_date, description, amount_cents, category_id, cost_center_id,
          business_unit_id, period_key, created_by)
       VALUES (current_date, '[PHASE1] lançamento que obriga a parar', 100,
               (SELECT id FROM management_category LIMIT 1), $1, $2, to_char(current_date, 'YYYY-MM'), $3)`,
      [fccA, buA, userA]);

    const msg = await refused(() => client.query(STOP_GATE));
    expect(msg).toContain('[105]');
    expect(msg).toContain('Dependentes de cost_center NÃO estão vazios');
    expect(msg).toContain('ledger_entry=1');

    await client.query('ROLLBACK TO SAVEPOINT gate');
    // E, sem o lançamento, o mesmo bloco volta a passar.
    expect(await refused(() => client.query(STOP_GATE))).toBe('');
  });

  // ── 7 · a contraparte canônica ────────────────────────────────────────────

  it('7 · nenhum contrato foi ligado a party pela migration', async () => {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM contracts WHERE counterparty_party_id IS NOT NULL`);
    expect(rows[0].n).toBe(0);
  });

  it('7b · um contrato não pode apontar para party de outra organização', async () => {
    const msg = await refused(() => client.query(
      `UPDATE contracts SET counterparty_party_id = $1
        WHERE id = (SELECT id FROM contracts WHERE organization_id = $2 LIMIT 1)`, [partyB, orgA]));
    expect(msg).toContain('contracts_counterparty_party_same_org_fkey');
  });
});
