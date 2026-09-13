import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DB_URL = process.env.SUPABASE_DB_URL;
const suite = DB_URL ? describe : describe.skip;

suite('migration 167 — live tenant/RLS invariants', () => {
  let db: pg.Client;
  let orgA: string;
  let orgB: string;
  let actor: string;
  let contractOnly: string;
  let activePersonA: string;
  let inactivePersonA: string;
  let activePersonB: string;
  const suffix = Math.random().toString(36).slice(2, 9);

  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

  async function asUser<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    await db.query('SAVEPOINT as_user');
    await db.query('SET LOCAL ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    try {
      const value = await operation();
      await db.query('RESET ROLE');
      await db.query('RELEASE SAVEPOINT as_user');
      return value;
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT as_user');
      await db.query('RESET ROLE');
      await db.query('RELEASE SAVEPOINT as_user');
      throw error;
    }
  }

  async function refused(operation: () => Promise<unknown>): Promise<string> {
    await db.query('SAVEPOINT refused');
    try {
      await operation();
      await db.query('ROLLBACK TO SAVEPOINT refused');
      return '';
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT refused');
      return error instanceof Error ? error.message : String(error);
    }
  }

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: false });
    await db.connect();
    await db.query('BEGIN');

    const enterprise = (await one(
      'INSERT INTO enterprise_accounts(name,slug) VALUES($1,$2) RETURNING id',
      [`[167] Test ${suffix}`, `m167-${suffix}`],
    )).id;
    orgA = (await one('INSERT INTO organizations(name,slug,enterprise_account_id) VALUES($1,$2,$3) RETURNING id',
      ['Org A 167', `m167-a-${suffix}`, enterprise])).id;
    orgB = (await one('INSERT INTO organizations(name,slug,enterprise_account_id) VALUES($1,$2,$3) RETURNING id',
      ['Org B 167', `m167-b-${suffix}`, enterprise])).id;

    const makeUser = async (label: string) => (await one(
      `INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
       VALUES(gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now()) RETURNING id`,
      [`m167-${label}-${suffix}@example.test`],
    )).id;
    actor = await makeUser('actor');
    contractOnly = await makeUser('contract');
    for (const userId of [actor, contractOnly]) {
      await db.query("INSERT INTO organization_memberships(organization_id,user_id,status,source,joined_at) VALUES($1,$2,'ACTIVE','PROFILE_PROJECTION',now())", [orgA, userId]);
      await db.query('INSERT INTO user_active_organization(user_id,organization_id) VALUES($1,$2)', [userId, orgA]);
    }

    const makeRole = async (key: string, permissions: string[]) => {
      const role = (await one('INSERT INTO roles(organization_id,key,name,is_system_role) VALUES($1,$2,$3,false) RETURNING id',
        [orgA, `${key}-${suffix}`, key])).id;
      await db.query(`INSERT INTO role_permissions(role_id,permission_id)
        SELECT $1,id FROM permissions WHERE key=ANY($2::text[])`, [role, permissions]);
      return role;
    };
    const actorRole = await makeRole('actor', ['contracts.create', 'people.manage', 'projects.create']);
    const contractRole = await makeRole('contract', ['contracts.create']);
    await db.query('INSERT INTO user_roles(organization_id,user_id,role_id) VALUES($1,$2,$3)', [orgA, actor, actorRole]);
    await db.query('INSERT INTO user_roles(organization_id,user_id,role_id) VALUES($1,$2,$3)', [orgA, contractOnly, contractRole]);

    activePersonA = (await one("INSERT INTO people(organization_id,full_name,status,source,created_by) VALUES($1,'Pessoa A','active','manual',$2) RETURNING id", [orgA, actor])).id;
    inactivePersonA = (await one("INSERT INTO people(organization_id,full_name,status,source,created_by) VALUES($1,'Pessoa Inativa','inactive','manual',$2) RETURNING id", [orgA, actor])).id;
    activePersonB = (await one("INSERT INTO people(organization_id,full_name,status,source,created_by) VALUES($1,'Pessoa B','active','manual',$2) RETURNING id", [orgB, actor])).id;
  });

  afterAll(async () => {
    if (db) { await db.query('ROLLBACK'); await db.end(); }
  });

  it('allows a canonical Person with no auth user/profile identity', async () => {
    const row = await one('SELECT profile_id FROM people WHERE id=$1', [activePersonA]);
    expect(row.profile_id).toBeNull();
    const authCount = await one("SELECT count(*)::int n FROM auth.users WHERE email='pessoa-a@example.test'");
    expect(authCount.n).toBe(0);
  });

  it('enforces same-org and active-Person assignment for contracts', async () => {
    const base = `INSERT INTO contracts(organization_id,title,status,risk_level,currency,data_class,created_by,owner_person_id)
      VALUES($1,'Contrato 167','active','medium','BRL','unclassified',$2,$3)`;
    expect(await refused(() => db.query(base, [orgA, actor, activePersonB]))).toMatch(/same organization|foreign key|contracts_owner_person_tenant_fk/i);
    expect(await refused(() => db.query(base, [orgA, actor, inactivePersonA]))).toMatch(/must be active/i);
    await db.query(base, [orgA, actor, activePersonA]);
  });

  it('enforces same-org and active-Person assignment for projects', async () => {
    const base = `INSERT INTO projects(id,organization_id,project,created_by,responsible_person_id)
      VALUES($1,$2,$3::jsonb,$4,$5)`;
    expect(await refused(() => db.query(base, [`p-${suffix}-x`, orgA, '{"nome":"X","codigo":"X"}', actor, activePersonB]))).toMatch(/same organization|foreign key|projects_responsible_person_tenant_fk/i);
    expect(await refused(() => db.query(base, [`p-${suffix}-i`, orgA, '{"nome":"I","codigo":"I"}', actor, inactivePersonA]))).toMatch(/must be active/i);
    await db.query(base, [`p-${suffix}-ok`, orgA, '{"nome":"OK","codigo":"OK"}', actor, activePersonA]);
  });

  it('finalizes through the canonical RPC with Person ownership and a separate actor', async () => {
    const intake = (await one(
      `INSERT INTO contract_onboarding_intakes(
        organization_id,uploaded_by,file_name,file_path,file_size,mime_type,content_sha256,status
      ) VALUES($1,$2,$3,$4,100,'application/pdf',$5,'FAILED') RETURNING id`,
      [orgA, actor, 'fixture-167.pdf', `contracts-intake/${suffix}.pdf`, 'a'.repeat(64)],
    )).id;
    const finalValues = {
      title: 'Contrato finalizado pela fixture 167', contract_number: `CT-${suffix}`,
      counterparty_name: 'Contraparte Teste', contract_type: 'Prestação de serviços',
      owner_person_id: activePersonA, owner_user_id: null,
      status: 'signed', risk_level: 'medium', currency: 'BRL', total_value: 10,
      project_id: null,
    };
    await db.query('SAVEPOINT canonical_finalize');
    await db.query('SET LOCAL ROLE service_role');
    const result = await db.query(
      'SELECT contract_onboarding_finalize($1,$2,$3,$4::jsonb) result',
      [orgA, intake, actor, JSON.stringify(finalValues)],
    );
    await db.query('RESET ROLE');
    await db.query('RELEASE SAVEPOINT canonical_finalize');
    const contractId = result.rows[0].result.contract_id;
    const contract = await one('SELECT owner_person_id,owner_user_id,created_by FROM contracts WHERE id=$1', [contractId]);
    expect(contract).toEqual({ owner_person_id: activePersonA, owner_user_id: null, created_by: actor });
  });

  it('prevents inactivation while a Person owns an active business relation', async () => {
    expect(await refused(() => db.query("UPDATE people SET status='inactive' WHERE id=$1", [activePersonA])))
      .toMatch(/Reassign active contract\/project responsibility/i);
  });

  it('keeps People and Project creation behind their own RLS permissions', async () => {
    const noPeople = await asUser(contractOnly, () => refused(() => db.query(
      "INSERT INTO people(organization_id,full_name,status,source,created_by) VALUES($1,'Sem permissão','active','manual',$2)",
      [orgA, contractOnly],
    )));
    expect(noPeople).toMatch(/row-level security|permission denied/i);

    const noProject = await asUser(contractOnly, () => refused(() => db.query(
      "INSERT INTO projects(id,organization_id,project,created_by) VALUES($1,$2,'{\"nome\":\"Sem permissão\",\"codigo\":\"X\"}'::jsonb,$3)",
      [`p-${suffix}-denied`, orgA, contractOnly],
    )));
    expect(noProject).toMatch(/row-level security|permission denied/i);
  });

  it('allows permitted canonical writes and tenant-scoped limited directories', async () => {
    await asUser(actor, () => db.query(
      "INSERT INTO people(organization_id,full_name,status,source,created_by) VALUES($1,'Pessoa Permitida','active','manual',$2)",
      [orgA, actor],
    ));
    await asUser(actor, () => db.query(
      "INSERT INTO projects(id,organization_id,project,created_by) VALUES($1,$2,'{\"nome\":\"Permitido\",\"codigo\":\"P\"}'::jsonb,$3)",
      [`p-${suffix}-allowed`, orgA, actor],
    ));

    const people = await asUser(contractOnly, () => db.query('SELECT * FROM contract_onboarding_responsible_people_directory()'));
    expect(people.rows.some((row) => row.id === activePersonA)).toBe(true);
    expect(people.rows.some((row) => row.id === activePersonB)).toBe(false);
    const projects = await asUser(contractOnly, () => db.query('SELECT * FROM contract_onboarding_project_directory()'));
    expect(projects.rows.every((row) => row.id !== `p-${suffix}-x`)).toBe(true);
  });
});
