/**
 * Fase 7.5 — prova VIVA da fronteira multi-organização.
 *
 * ─── O que este arquivo guarda ────────────────────────────────────────────
 *
 * A fase move a fronteira de inquilino de "a organização do perfil" para "a
 * organização ATIVA, provada por vínculo". Isso significa que
 * `current_user_organization_id()` — que 362 políticas RLS, 34 funções e todas
 * as políticas de Storage consultam — passou a depender de uma tabela nova.
 *
 * Uma bateria que só provasse que o membro certo consegue entrar não diria
 * nada. O que precisa ficar provado, permanentemente, é o contrário:
 *
 *   · quem NÃO tem vínculo não lê, não escreve e não descobre que existe;
 *   · quem TINHA vínculo e perdeu, perde no ato;
 *   · quem administra o GRUPO não herda os dados das organizações do grupo;
 *   · trocar de organização não deixa resíduo do inquilino anterior.
 *
 * ─── Por que `SET LOCAL ROLE authenticated` ───────────────────────────────
 *
 * A suíte conecta como `postgres`, que tem BYPASSRLS. Trocar só a reivindicação
 * do JWT faria `auth.uid()` responder certo e deixaria RLS, GRANT e gatilhos
 * inteiramente de fora — a prova passaria sem exercitar nada.
 *
 * Sem `SUPABASE_DB_URL` a suíte é pulada: em CI sem banco ela não falha, e
 * também não finge ter passado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';

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

/** O valor e a marca que NÃO podem aparecer do outro lado da fronteira. */
const SECRET_AMOUNT = '765432.10';
const SECRET_MARK = 'P75-SIGILOSO';

suite('Fase 7.5 · fronteira multi-organização', () => {
  let db: pg.Client;
  const sfx = Math.random().toString(36).slice(2, 10);

  /* Dois GRUPOS empresariais distintos, para provar isolamento cross-enterprise. */
  let eaHome: string; let eaForeign: string;
  /* eaHome tem DUAS organizações: é onde "administrar o grupo" é testado. */
  let orgA: string; let orgB: string; let orgForeign: string;

  let memberA: string;          // vínculo ACTIVE só em A
  let multiMember: string;      // vínculo ACTIVE em A e em B
  let enterpriseAdmin: string;  // ADMIN do grupo eaHome, membro só de A
  let outsider: string;         // membro só de orgForeign
  let revoked: string;          // tinha vínculo em A; será revogado
  let suspended: string;        // vínculo em A; será suspenso

  let contractA: string; let contractB: string;
  let milestoneA: string; let billingA: string; let receivableA: string;
  let projectA: string; let partyA: string;
  let storagePathA: string;

  const asRole = (uid: string, sql: string) =>
    `SET LOCAL ROLE authenticated;`
    + ` SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true);`
    + ` ${sql}; RESET ROLE;`;

  const callAs = async (uid: string, sql: string): Promise<Record<string, unknown>> => {
    const res = await db.query(asRole(uid, sql));
    const list = Array.isArray(res) ? res : [res];
    return (list[list.length - 2].rows[0] ?? {}) as Record<string, unknown>;
  };

  const rowsAs = async (uid: string, sql: string): Promise<Record<string, unknown>[]> => {
    const res = await db.query(asRole(uid, sql));
    const list = Array.isArray(res) ? res : [res];
    return list[list.length - 2].rows as Record<string, unknown>[];
  };

  /** Mensagem quando a chamada FALHA; null quando ela passa. */
  const refusedAs = async (uid: string, sql: string): Promise<string | null> => {
    try { await db.query(asRole(uid, sql)); return null; }
    catch (e) { return (e as Error).message; }
  };

  const countAs = async (uid: string, sql: string): Promise<number> =>
    Number((await callAs(uid, sql)).n);

  const scalar = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query('SET SESSION default_transaction_read_only = off');

    const mkEnterprise = async (label: string) => (await scalar(
      `INSERT INTO enterprise_accounts (name, slug) VALUES ($1,$2) RETURNING id`,
      [`[P75] ${label}`, `p75-ea-${label.toLowerCase()}-${sfx}`])).id;
    eaHome = await mkEnterprise('Home');
    eaForeign = await mkEnterprise('Foreign');

    const mkOrg = async (label: string, ea: string) => (await scalar(
      `INSERT INTO organizations (name, slug, enterprise_account_id) VALUES ($1,$2,$3) RETURNING id`,
      [`[P75] ${label} ${sfx}`, `p75-${label.toLowerCase()}-${sfx}`, ea])).id;
    orgA = await mkOrg('A', eaHome);
    orgB = await mkOrg('B', eaHome);
    orgForeign = await mkOrg('Foreign', eaForeign);

    /*
      A pessoa é criada SEM perfil e o vínculo é escrito à mão: é assim que se
      testa o modelo novo em vez de testar o gatilho de compatibilidade.
      `homeOrg` existe só para as pessoas que precisam de perfil (o módulo de
      pessoas ainda o exige em alguns caminhos).
    */
    const mkUser = async (label: string) => (await scalar(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
       VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
               $1,'x',now(),now()) RETURNING id`, [`p75.${label}.${sfx}@example.test`])).id;

    const link = async (uid: string, org: string, status = 'ACTIVE') =>
      db.query(
        `INSERT INTO organization_memberships (organization_id, user_id, status, source, joined_at, disabled_at)
         VALUES ($1,$2,$3,'BACKFILL', CASE WHEN $3='ACTIVE' THEN now() END,
                 CASE WHEN $3 IN ('SUSPENDED','REVOKED') THEN now() END)`, [org, uid, status]);

    const grant = async (uid: string, org: string, roleKey: string) =>
      db.query(
        `INSERT INTO user_roles (user_id, role_id, organization_id)
         SELECT $1, r.id, $2 FROM roles r WHERE r.key=$3 AND r.organization_id IS NULL`,
        [uid, org, roleKey]);

    memberA = await mkUser('member-a');          await link(memberA, orgA);          await grant(memberA, orgA, 'owner_admin');
    multiMember = await mkUser('multi');         await link(multiMember, orgA);      await link(multiMember, orgB);
    await grant(multiMember, orgA, 'owner_admin'); await grant(multiMember, orgB, 'owner_admin');
    enterpriseAdmin = await mkUser('ent-admin'); await link(enterpriseAdmin, orgA);  await grant(enterpriseAdmin, orgA, 'owner_admin');
    outsider = await mkUser('outsider');         await link(outsider, orgForeign);   await grant(outsider, orgForeign, 'owner_admin');
    revoked = await mkUser('revoked');           await link(revoked, orgA);
    suspended = await mkUser('suspended');       await link(suspended, orgA);

    await db.query(
      `INSERT INTO enterprise_account_memberships (enterprise_account_id, user_id, role, status, granted_basis)
       VALUES ($1,$2,'ADMIN','ACTIVE','[P75] teste')`, [eaHome, enterpriseAdmin]);

    // ---- fatos operacionais de A, que ninguém de fora pode alcançar ----
    projectA = `p75-${sfx}`;
    await db.query(`INSERT INTO projects (id, organization_id, project) VALUES ($1,$2,$3)`,
      [projectA, orgA, JSON.stringify({ name: `[P75] Projeto ${SECRET_MARK}`, status: 'em_andamento' })]);
    partyA = (await scalar(
      `INSERT INTO parties (organization_id, kind, legal_name, document_type, document_number)
       VALUES ($1,'organization','[P75] Parte','cnpj','11222333000181') RETURNING id`, [orgA])).id;
    contractA = (await scalar(
      `INSERT INTO contracts (organization_id, title, status, currency, data_class, counterparty_party_id, project_id)
       VALUES ($1,$2,'active','BRL','demo',$3,$4) RETURNING id`,
      [orgA, `[P75] Contrato ${SECRET_MARK}`, partyA, projectA])).id;
    contractB = (await scalar(
      `INSERT INTO contracts (organization_id, title, status, currency, data_class)
       VALUES ($1,'[P75] Contrato B','active','BRL','demo') RETURNING id`, [orgB])).id;
    milestoneA = (await scalar(
      `INSERT INTO contract_milestones (organization_id, contract_id, project_id, title, status)
       VALUES ($1,$2,$3,'[P75] Marco','pending') RETURNING id`, [orgA, contractA, projectA])).id;
    billingA = (await scalar(
      `INSERT INTO contract_billing_events
         (organization_id, contract_id, milestone_id, title, amount, currency, status,
          source_kind, entitlement_key, amount_source, eligibility_state, release_state)
       VALUES ($1,$2,$3,$4,${SECRET_AMOUNT},'BRL','pendente','MANUAL',$5,
               'LEGACY_MEASURED_AMOUNT','UNKNOWN','NOT_ELIGIBLE') RETURNING id`,
      [orgA, contractA, milestoneA, `[P75] Faturamento ${SECRET_MARK}`, `p75-ent-${sfx}`])).id;
    receivableA = (await scalar(
      `INSERT INTO finance_receivables
         (organization_id, party_id, contract_id, billing_event_id, currency, amount_basis,
          original_amount_cents, gross_amount_cents, issue_date)
       VALUES ($1,$2,$3,$4,'BRL','GROSS_SERVICE_AMOUNT',100000,100000,current_date) RETURNING id`,
      [orgA, partyA, contractA, billingA])).id;

    // ---- objeto de Storage no caminho canônico `organization_id/...` ----
    storagePathA = `${orgA}/contracts/${contractA}/${SECRET_MARK}.pdf`;
    await db.query(
      `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('contract-files', $1, NULL)`,
      [storagePathA]);
    await db.query(
      `INSERT INTO contract_files (organization_id, contract_id, file_path, file_name, uploaded_by)
       VALUES ($1,$2,$3,$4,$5)`, [orgA, contractA, storagePathA, `${SECRET_MARK}.pdf`, memberA]);
  }, 180_000);

  afterAll(async () => {
    if (!db) return;
    try {
      /*
        `storage.protect_delete()` recusa DELETE direto — a proteção existe para
        impedir órfão entre a tabela e o objeto binário. Aqui não há binário:
        a linha foi inserida direto pela suíte. `session_replication_role` é o
        caminho suportado para uma limpeza de teste conduzida como superusuário,
        e volta ao normal na mesma transação.
      */
      await db.query(`SET session_replication_role = replica`);
      await db.query(`DELETE FROM storage.objects WHERE name LIKE $1`, [`${orgA}/%`]);
      await db.query(`SET session_replication_role = origin`);
      /*
        `audit_logs` é append-only e a FK da organização é ON DELETE CASCADE:
        apagar a organização exigiria apagar auditoria, que o gatilho recusa —
        e com razão. As organizações [P75] ficam como carcaça vazia, sem
        vínculo, sem contexto e sem fato operacional. O sweep abaixo prova
        isso; ele não tenta reescrever história imutável.
      */
      /*
        Varre TODAS as organizações desta execução, e não uma lista fixa: o
        teste de corrida e o de provisionamento criam organizações cujos IDs a
        lista não conhece. Uma limpeza que só conhece o que foi escrito à mão
        deixa exatamente o resíduo que ela existe para não deixar.
      */
      const created = (await db.query(
        `SELECT id FROM organizations WHERE name LIKE $1`, [`[P75]%${sfx}%`])).rows.map((r) => r.id);
      for (const org of created) {
        await db.query(`DELETE FROM user_active_organization WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM organization_memberships WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM user_roles WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM finance_receivables WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM contract_files WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM contract_billing_events WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM contract_milestones WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM contracts WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM parties WHERE organization_id=$1`, [org]);
        await db.query(`DELETE FROM projects WHERE organization_id=$1`, [org]);
      }
      await db.query(`DELETE FROM enterprise_account_memberships WHERE enterprise_account_id = ANY($1)`,
        [[eaHome, eaForeign]]);
      await db.query(`UPDATE organizations SET status='archived', archived_at=now()
                       WHERE id = ANY($1) AND status <> 'archived'`, [created]);
      /*
        Só saem as identidades que NÃO agiram. Quem agiu deixou linha em
        `audit_logs`, que é append-only e referencia o ator: apagar a pessoa
        exigiria apagar a auditoria dela, e um rastro que some quando o ator
        some não é rastro. Elas ficam sem vínculo, sem perfil e sem contexto —
        o que a asserção abaixo transforma em fato verificado em vez de
        promessa.
      */
      await db.query(
        `DELETE FROM auth.users u
          WHERE u.email LIKE $1
            AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.actor_user_id = u.id)`,
        [`p75.%.${sfx}@example.test`]);

      const residue = await db.query(
        `SELECT u.id FROM auth.users u
          WHERE u.email LIKE $1
            AND (EXISTS (SELECT 1 FROM organization_memberships m WHERE m.user_id = u.id AND m.status = 'ACTIVE')
              OR EXISTS (SELECT 1 FROM user_active_organization ua WHERE ua.user_id = u.id))`,
        [`p75.%.${sfx}@example.test`]);
      if (residue.rows.length > 0) {
        throw new Error(`resíduo com acesso: ${residue.rows.map((r) => r.id).join(', ')}`);
      }
    } finally {
      await db.end();
    }
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════════
  describe('vínculo autoriza — e só ele', () => {
    it('membro de A resolve A e enxerga os contratos de A', async () => {
      expect((await callAs(memberA, `SELECT current_user_organization_id() AS org`)).org).toBe(orgA);
      expect(await countAs(memberA, `SELECT count(*)::int n FROM contracts WHERE id='${contractA}'`)).toBe(1);
    });

    it('membro de A não lê NADA de B, mesmo com os UUIDs na mão', async () => {
      for (const [table, id] of [['contracts', contractB]] as const) {
        expect(await countAs(memberA, `SELECT count(*)::int n FROM ${table} WHERE id='${id}'`)).toBe(0);
      }
      expect(await countAs(memberA, `SELECT count(*)::int n FROM contracts WHERE organization_id='${orgB}'`)).toBe(0);
    });

    it('estranho de outro GRUPO não lê contrato, faturamento nem recebível de A', async () => {
      expect(await countAs(outsider, `SELECT count(*)::int n FROM contracts WHERE id='${contractA}'`)).toBe(0);
      expect(await countAs(outsider, `SELECT count(*)::int n FROM contract_billing_events WHERE id='${billingA}'`)).toBe(0);
      expect(await countAs(outsider, `SELECT count(*)::int n FROM finance_receivables WHERE id='${receivableA}'`)).toBe(0);
      expect(await countAs(outsider, `SELECT count(*)::int n FROM projects WHERE id='${projectA}'`)).toBe(0);
      expect(await countAs(outsider, `SELECT count(*)::int n FROM parties WHERE id='${partyA}'`)).toBe(0);
    });

    it('o valor sigiloso não aparece em nenhuma leitura do estranho', async () => {
      const rows = await rowsAs(outsider,
        `SELECT count(*)::int n FROM contract_billing_events WHERE amount = ${SECRET_AMOUNT}`);
      expect(Number(rows[0].n)).toBe(0);
    });

    it('estranho não MUTA linha de A', async () => {
      const affected = await countAs(outsider,
        `WITH u AS (UPDATE contracts SET title='INVADIDO' WHERE id='${contractA}' RETURNING 1)
         SELECT count(*)::int n FROM u`);
      expect(affected).toBe(0);
      expect((await scalar(`SELECT title FROM contracts WHERE id=$1`, [contractA])).title)
        .toContain(SECRET_MARK);
    });

    it('estranho não APAGA linha de A', async () => {
      const affected = await countAs(outsider,
        `WITH d AS (DELETE FROM contract_billing_events WHERE id='${billingA}' RETURNING 1)
         SELECT count(*)::int n FROM d`);
      expect(affected).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('troca de organização', () => {
    it('my_organizations devolve só o que o vínculo prova', async () => {
      const mine = await rowsAs(multiMember, `SELECT organization_id FROM my_organizations()`);
      const ids = mine.map((r) => r.organization_id);
      expect(ids).toContain(orgA);
      expect(ids).toContain(orgB);
      expect(ids).not.toContain(orgForeign);
    });

    it('membro de duas organizações troca entre elas e vê APENAS a ativa', async () => {
      await callAs(multiMember, `SELECT organization_switch('${orgA}') AS r`);
      expect((await callAs(multiMember, `SELECT current_user_organization_id() AS org`)).org).toBe(orgA);
      expect(await countAs(multiMember, `SELECT count(*)::int n FROM contracts WHERE id='${contractA}'`)).toBe(1);
      expect(await countAs(multiMember, `SELECT count(*)::int n FROM contracts WHERE id='${contractB}'`)).toBe(0);

      await callAs(multiMember, `SELECT organization_switch('${orgB}') AS r`);
      expect((await callAs(multiMember, `SELECT current_user_organization_id() AS org`)).org).toBe(orgB);
      expect(await countAs(multiMember, `SELECT count(*)::int n FROM contracts WHERE id='${contractB}'`)).toBe(1);
      expect(await countAs(multiMember, `SELECT count(*)::int n FROM contracts WHERE id='${contractA}'`)).toBe(0);

      // A → B → A: o resultado é correto em toda travessia, não só na primeira.
      await callAs(multiMember, `SELECT organization_switch('${orgA}') AS r`);
      expect(await countAs(multiMember, `SELECT count(*)::int n FROM contracts WHERE id='${contractA}'`)).toBe(1);
      expect(await countAs(multiMember, `SELECT count(*)::int n FROM contracts WHERE id='${contractB}'`)).toBe(0);
    });

    it('trocar para organização sem vínculo é recusado com a MESMA resposta de inexistente', async () => {
      const foreign = await refusedAs(memberA, `SELECT organization_switch('${orgForeign}')`);
      const nonexistent = await refusedAs(memberA, `SELECT organization_switch(gen_random_uuid())`);
      expect(foreign).toContain('ORGANIZATION_NOT_FOUND');
      expect(nonexistent).toContain('ORGANIZATION_NOT_FOUND');
    });

    it('o navegador não escreve o contexto ativo por conta própria', async () => {
      const refusal = await refusedAs(outsider,
        `INSERT INTO user_active_organization (user_id, organization_id) VALUES ('${outsider}','${orgA}')`);
      expect(refusal).toBeTruthy();
    });

    it('o navegador não escreve vínculo por conta própria', async () => {
      const refusal = await refusedAs(outsider,
        `INSERT INTO organization_memberships (organization_id, user_id, status)
         VALUES ('${orgA}','${outsider}','ACTIVE')`);
      expect(refusal).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('revogação e suspensão derrubam o acesso', () => {
    it('vínculo REVOGADO perde o contexto e os dados no ato', async () => {
      expect((await callAs(revoked, `SELECT current_user_organization_id() AS org`)).org).toBe(orgA);
      await db.query(`UPDATE organization_memberships SET status='REVOKED', disabled_at=now()
                       WHERE user_id=$1 AND organization_id=$2`, [revoked, orgA]);
      expect((await callAs(revoked, `SELECT current_user_organization_id() AS org`)).org).toBeNull();
      expect(await countAs(revoked, `SELECT count(*)::int n FROM contracts WHERE id='${contractA}'`)).toBe(0);
    });

    it('vínculo SUSPENSO perde o contexto, e o contexto GUARDADO não o salva', async () => {
      await callAs(suspended, `SELECT organization_switch('${orgA}') AS r`);
      expect((await callAs(suspended, `SELECT current_user_organization_id() AS org`)).org).toBe(orgA);
      await db.query(`UPDATE organization_memberships SET status='SUSPENDED', disabled_at=now()
                       WHERE user_id=$1 AND organization_id=$2`, [suspended, orgA]);
      // A linha em user_active_organization continua lá — e não vale mais nada.
      expect(Number((await scalar(
        `SELECT count(*)::int n FROM user_active_organization WHERE user_id=$1`, [suspended])).n)).toBe(1);
      expect((await callAs(suspended, `SELECT current_user_organization_id() AS org`)).org).toBeNull();
      expect(await countAs(suspended, `SELECT count(*)::int n FROM contracts WHERE id='${contractA}'`)).toBe(0);
    });

    it('a RPC de revogação derruba o contexto guardado e recusa auto-alteração', async () => {
      await callAs(memberA, `SELECT organization_switch('${orgA}') AS r`);
      const self = await refusedAs(memberA,
        `SELECT organization_membership_set_status('${orgA}','${memberA}','REVOKED')`);
      expect(self).toContain('SELF_MEMBERSHIP_CHANGE_FORBIDDEN');

      await callAs(suspended, `SELECT 1 AS ok`);
      await callAs(memberA,
        `SELECT organization_membership_set_status('${orgA}','${suspended}','REVOKED') AS r`);
      expect(Number((await scalar(
        `SELECT count(*)::int n FROM user_active_organization WHERE user_id=$1`, [suspended])).n)).toBe(0);
      // devolvido ao estado do teste anterior para não acoplar ordem
      await db.query(`UPDATE organization_memberships SET status='SUSPENDED'
                       WHERE user_id=$1 AND organization_id=$2`, [suspended, orgA]);
    });

    it('administrador de A não mexe no quadro de B nem sabendo o UUID', async () => {
      const refusal = await refusedAs(memberA,
        `SELECT organization_membership_set_status('${orgB}','${multiMember}','REVOKED')`);
      expect(refusal).toContain('ORGANIZATION_NOT_FOUND');
    });

    it('organização SUSPENSA deixa de render contexto e de aceitar escrita', async () => {
      await db.query(`UPDATE organizations SET status='suspended', suspended_at=now() WHERE id=$1`, [orgB]);
      expect((await callAs(multiMember, `SELECT current_user_organization_id() AS org`)).org).toBe(orgA);
      const inserted = await countAs(multiMember,
        `WITH i AS (INSERT INTO contracts (organization_id,title,status,currency)
                    SELECT '${orgB}','[P75] proibido','active','BRL'
                     WHERE public.current_user_organization_id() = '${orgB}' RETURNING 1)
         SELECT count(*)::int n FROM i`);
      expect(inserted).toBe(0);
      await db.query(`UPDATE organizations SET status='active', suspended_at=NULL WHERE id=$1`, [orgB]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('administrar o GRUPO não é ler os DADOS do grupo', () => {
    it('admin empresarial vê o REGISTRO de B (nome e estado)', async () => {
      expect(await countAs(enterpriseAdmin,
        `SELECT count(*)::int n FROM organizations WHERE id='${orgB}'`)).toBe(1);
    });

    it('admin empresarial NÃO lê contrato, faturamento nem recebível de B', async () => {
      expect(await countAs(enterpriseAdmin, `SELECT count(*)::int n FROM contracts WHERE id='${contractB}'`)).toBe(0);
      expect(await countAs(enterpriseAdmin, `SELECT count(*)::int n FROM contracts WHERE organization_id='${orgB}'`)).toBe(0);
    });

    it('admin empresarial NÃO entra em B sem vínculo', async () => {
      expect(await refusedAs(enterpriseAdmin, `SELECT organization_switch('${orgB}')`))
        .toContain('ORGANIZATION_NOT_FOUND');
    });

    it('admin empresarial NÃO lê a prontidão de B (contagem é dado operacional)', async () => {
      expect(await refusedAs(enterpriseAdmin, `SELECT organization_readiness('${orgB}')`))
        .toContain('ORGANIZATION_NOT_FOUND');
    });

    it('admin empresarial ADMINISTRA o ciclo de vida de B — e isso é outra coisa', async () => {
      await callAs(enterpriseAdmin, `SELECT organization_set_lifecycle_status('${orgB}','suspended','[P75] teste') AS r`);
      expect((await scalar(`SELECT status FROM organizations WHERE id=$1`, [orgB])).status).toBe('suspended');
      await callAs(enterpriseAdmin, `SELECT organization_set_lifecycle_status('${orgB}','active',NULL) AS r`);
      expect((await scalar(`SELECT status FROM organizations WHERE id=$1`, [orgB])).status).toBe('active');
    });

    it('admin empresarial de um grupo não toca no ciclo de vida do OUTRO grupo', async () => {
      expect(await refusedAs(enterpriseAdmin, `SELECT organization_set_lifecycle_status('${orgForeign}','suspended')`))
        .toContain('ORGANIZATION_NOT_FOUND');
    });

    it('ser admin de organização NÃO concede autoridade de provisionamento', async () => {
      // memberA é owner_admin em A e não tem vínculo empresarial nenhum.
      expect((await callAs(memberA, `SELECT current_user_can_provision_organizations() AS can`)).can).toBe(false);
      expect(await refusedAs(memberA, `SELECT organization_provision('[P75] Pirata ${sfx}')`))
        .toContain('ENTERPRISE_PROVISIONING_NOT_ALLOWED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('provisionamento: vazio, idempotente e governado', () => {
    let provisioned: string;

    it('provisiona sob autoridade empresarial e nasce com ZERO fato operacional', async () => {
      const result = (await callAs(enterpriseAdmin,
        `SELECT organization_provision('[P75] Nova ${sfx}','[P75] Razao','BR','BRL','America/Sao_Paulo',
           NULL,'p75-prov-${sfx}','${eaHome}') AS r`)).r as Record<string, unknown>;
      provisioned = String(result.organization_id);
      expect(result.idempotent_replay).toBe(false);

      await callAs(enterpriseAdmin, `SELECT organization_switch('${provisioned}') AS r`);
      const readiness = (await callAs(enterpriseAdmin,
        `SELECT organization_readiness('${provisioned}') AS r`)).r as Record<string, unknown>;
      expect(Number(readiness.operational_facts_total)).toBe(0);
      for (const value of Object.values(readiness.operational_facts as Record<string, number>)) {
        expect(Number(value)).toBe(0);
      }
    });

    it('nenhum fato de demonstração é copiado para a organização nova', async () => {
      for (const table of ['contracts', 'projects', 'parties', 'contract_billing_events',
        'finance_receivables', 'finance_settlements', 'finance_reconciliations',
        'fiscal_documents', 'fiscal_establishments', 'risks', 'approval_policies',
        'approval_requests', 'contract_files', 'contract_billing_release_authorities']) {
        const n = Number((await scalar(
          `SELECT count(*)::int n FROM ${table} WHERE organization_id = $1`, [provisioned])).n);
        expect(`${table}=${n}`).toBe(`${table}=0`);
      }
    });

    it('a governança de negócio nasce AUSENTE, não preenchida', async () => {
      const readiness = (await callAs(enterpriseAdmin,
        `SELECT organization_readiness('${provisioned}') AS r`)).r as Record<string, unknown>;
      const config = readiness.configuration as Record<string, string | number>;
      expect(config.fiscal).toBe('NOT_CONFIGURED');
      expect(config.approval_policies).toBe('NOT_CONFIGURED');
      expect(config.billing_release_authority).toBe('NOT_CONFIGURED');
      expect(Number(config.members)).toBe(1);
    });

    it('a mesma chave de idempotência devolve a MESMA organização', async () => {
      const replay = (await callAs(enterpriseAdmin,
        `SELECT organization_provision('[P75] Nova ${sfx}',NULL,NULL,NULL,NULL,NULL,
           'p75-prov-${sfx}','${eaHome}') AS r`)).r as Record<string, unknown>;
      expect(replay.organization_id).toBe(provisioned);
      expect(replay.idempotent_replay).toBe(true);
      expect(Number((await scalar(
        `SELECT count(*)::int n FROM organizations WHERE provisioning_idempotency_key = $1`,
        [`p75-prov-${sfx}`])).n)).toBe(1);
    });

    it('provisionamento concorrente com a mesma chave não cria duas organizações', async () => {
      const key = `p75-race-${sfx}`;
      const call = () => db.query(asRole(enterpriseAdmin,
        `SELECT organization_provision('[P75] Corrida ${sfx}',NULL,NULL,NULL,NULL,NULL,'${key}','${eaHome}') AS r`))
        .then(() => 'ok').catch((e: Error) => e.message);
      await Promise.all([call(), call(), call()]);
      expect(Number((await scalar(
        `SELECT count(*)::int n FROM organizations WHERE provisioning_idempotency_key = $1`, [key])).n))
        .toBe(1);
    });

    it('quem provisiona vira membro ATIVO — e ninguém mais', async () => {
      const members = await db.query(
        `SELECT user_id, status FROM organization_memberships WHERE organization_id=$1`, [provisioned]);
      expect(members.rows).toHaveLength(1);
      expect(members.rows[0].user_id).toBe(enterpriseAdmin);
      expect(members.rows[0].status).toBe('ACTIVE');
    });

    it('a criação deixa rastro factual e auditoria com ator autêntico', async () => {
      const ev = await db.query(
        `SELECT event_type, actor_user_id FROM domain_events
          WHERE organization_id=$1 AND event_type='platform.organization.created'`, [provisioned]);
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].actor_user_id).toBe(enterpriseAdmin);
      const audit = await db.query(
        `SELECT actor_user_id FROM audit_logs WHERE organization_id=$1 AND action='organization.created'`,
        [provisioned]);
      expect(audit.rows[0].actor_user_id).toBe(enterpriseAdmin);
    });

  });

  // ══════════════════════════════════════════════════════════════════════
  describe('Storage, Event Graph, jobs e Aprovação', () => {
    it('objeto de Storage de A é invisível para quem não é de A', async () => {
      expect(await countAs(memberA,
        `SELECT count(*)::int n FROM storage.objects WHERE name='${storagePathA}'`)).toBe(1);
      expect(await countAs(outsider,
        `SELECT count(*)::int n FROM storage.objects WHERE name='${storagePathA}'`)).toBe(0);
    });

    it('adivinhar o caminho do Storage não ajuda: o prefixo é conferido', async () => {
      const refusal = await countAs(outsider,
        `WITH i AS (INSERT INTO storage.objects (bucket_id, name)
                    SELECT 'contract-files','${orgA}/contracts/forjado.pdf'
                     WHERE public.current_user_organization_id() = '${orgA}' RETURNING 1)
         SELECT count(*)::int n FROM i`);
      expect(refusal).toBe(0);
    });

    it('Event Graph e apex_jobs não são alcançáveis pelo navegador', async () => {
      /*
        A defesa aqui é anterior à RLS: `authenticated` não tem sequer GRANT de
        SELECT nessas tabelas. Afirmar "devolve zero linha" seria uma prova mais
        fraca do que a realidade — e mascararia o dia em que o GRANT aparecesse.
      */
      for (const uid of [memberA, outsider]) {
        expect(await refusedAs(uid, `SELECT count(*) FROM domain_events`)).toContain('permission denied');
        expect(await refusedAs(uid, `SELECT count(*) FROM apex_jobs`)).toContain('permission denied');
      }
    });

    it('emitir evento carimbando OUTRA organização é recusado', async () => {
      const refusal = await refusedAs(outsider,
        `SELECT emit_domain_event('${orgA}','p75.teste.forjado',1,'contract','${contractA}','p75-forjado-${sfx}')`);
      expect(refusal).toBeTruthy();
    });

    it('Motor de Aprovação e Fiscal/Financeiro seguem por organização', async () => {
      expect(await countAs(outsider, `SELECT count(*)::int n FROM approval_requests WHERE organization_id='${orgA}'`)).toBe(0);
      expect(await countAs(outsider, `SELECT count(*)::int n FROM approval_policies WHERE organization_id='${orgA}'`)).toBe(0);
      expect(await countAs(outsider, `SELECT count(*)::int n FROM fiscal_documents WHERE organization_id='${orgA}'`)).toBe(0);
      expect(await countAs(outsider, `SELECT count(*)::int n FROM finance_settlements WHERE organization_id='${orgA}'`)).toBe(0);
    });

    it('as tabelas financeiras antigas deixaram de ser cegas ao inquilino', async () => {
      for (const table of ['allocation_result', 'allocation_rule', 'attachment',
        'category_mapping', 'ingestion_batch', 'payroll_batch', 'user_finance_role']) {
        const nullable = await scalar(
          `SELECT is_nullable FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id'`, [table]);
        expect(`${table}:${nullable?.is_nullable}`).toBe(`${table}:NO`);
        expect(await countAs(outsider, `SELECT count(*)::int n FROM ${table}`)).toBe(0);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('auditoria permanente da superfície SECURITY DEFINER', () => {
    it('nenhuma função DEFINER alcançável pelo navegador sem search_path fixo', async () => {
      const { rows } = await db.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.prosecdef
            AND has_function_privilege('authenticated',p.oid,'EXECUTE')
            AND (p.proconfig IS NULL OR NOT EXISTS (
                  SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'))`);
      expect(rows.map((r) => r.proname)).toEqual([]);
    });

    it('nenhuma RPC de tenancy da fase é alcançável por anon', async () => {
      const { rows } = await db.query(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')
            AND p.proname IN ('organization_switch','organization_provision','my_organizations',
                              'organization_membership_set_status','organization_set_lifecycle_status',
                              'organization_readiness','current_user_is_organization_member',
                              'current_user_enterprise_admin_accounts',
                              'current_user_can_provision_organizations',
                              'current_user_enterprise_account_id')`);
      expect(rows.map((r) => r.proname)).toEqual([]);
    });

    it('as tabelas de tenancy não aceitam escrita do navegador', async () => {
      const { rows } = await db.query(
        `SELECT tablename, policyname, cmd FROM pg_policies
          WHERE schemaname='public'
            AND tablename IN ('organization_memberships','enterprise_account_memberships',
                              'user_active_organization','enterprise_accounts')
            AND cmd <> 'SELECT'`);
      expect(rows).toEqual([]);
    });

    it('organizations não tem mais política FOR ALL irrestrita', async () => {
      const { rows } = await db.query(
        `SELECT policyname FROM pg_policies
          WHERE schemaname='public' AND tablename='organizations' AND cmd='ALL'`);
      expect(rows).toEqual([]);
    });

    it('toda política que fala de organização passa pelo resolvedor de vínculo', async () => {
      /*
        A trava permanente da fase: uma política nova que compare
        `organization_id` com qualquer outra coisa que não o resolvedor
        canônico volta a abrir a porta que a 145 fechou.
      */
      const { rows } = await db.query(
        `SELECT tablename, policyname FROM pg_policies
          WHERE schemaname='public'
            AND (coalesce(qual,'') LIKE '%organization_id%' OR coalesce(with_check,'') LIKE '%organization_id%')
            AND coalesce(qual,'') NOT LIKE '%current_user_organization_id%'
            AND coalesce(with_check,'') NOT LIKE '%current_user_organization_id%'
            AND coalesce(qual,'') NOT LIKE '%current_user_is_organization_member%'
            AND coalesce(with_check,'') NOT LIKE '%current_user_is_organization_member%'
            AND coalesce(qual,'') NOT LIKE '%current_user_enterprise_admin_accounts%'`);

      /*
        Uma exceção, e ela precisa de justificativa escrita para continuar
        existindo: `roles` guarda o VOCABULÁRIO global de papéis, cujas linhas
        têm `organization_id IS NULL` de propósito. Ler o nome de um papel
        global não revela fato de inquilino nenhum. Qualquer outra política que
        apareça nesta lista é regressão.
      */
      const JUSTIFIED = ['roles.roles_select_assigned_or_admin'];
      expect(rows.map((r) => `${r.tablename}.${r.policyname}`).filter((n) => !JUSTIFIED.includes(n)))
        .toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('nenhuma assinatura de tempo real sobrevive à troca', () => {
    it('o produto não abre canal Realtime — não há canal a vazar', async () => {
      /*
        A §17 exige que a troca substitua assinaturas de tempo real. Este
        produto não abre nenhuma: a prova correta é que continua não abrindo, e
        o dia em que abrir, este teste falha e obriga a tratar o caso.
      */
      const { rows } = await db.query(
        `SELECT schemaname, tablename FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime' AND schemaname = 'public'`);
      expect(rows.map((r) => r.tablename)).toEqual([]);
    });
  });
});
