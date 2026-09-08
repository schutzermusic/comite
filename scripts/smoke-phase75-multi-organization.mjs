/**
 * Fase 7.5 — fumaça de produção da fronteira multi-organização.
 *
 *   node scripts/smoke-phase75-multi-organization.mjs
 *
 * Somente LEITURA sobre o banco real. Serve para responder, depois de um
 * deploy, a pergunta que a suíte de integração não responde: a organização de
 * PRODUÇÃO continua se comportando como antes, e a superfície nova continua
 * fechada? Não cria nada, não apaga nada.
 */
import pg from 'pg'; import dotenv from 'dotenv';
dotenv.config({path:'.env',quiet:true}); dotenv.config({path:'.env.local',quiet:true});
const c=new pg.Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
let ok=true; const must=(l,p,d='')=>{console.log(`${p?'✓':'✗'} ${l}${d?` — ${d}`:''}`);if(!p)ok=false;};
const one=async(s,p)=>(await c.query(s,p)).rows[0];
const asRole=(uid,sql)=>`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true); ${sql}; RESET ROLE;`;
const q=async(uid,sql)=>{const r=await c.query(asRole(uid,sql));const l=Array.isArray(r)?r:[r];return l[l.length-2].rows;};

console.log('=== FUMAÇA DE PRODUÇÃO — FASE 7.5 ===');
must('ponta do registro é 150', (await one(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).version==='150');
const prod=await c.query(`SELECT id,name,slug,status,enterprise_account_id FROM organizations WHERE status='active'`);
must('exatamente 1 organização ATIVA em produção', prod.rowCount===1, prod.rows.map(r=>r.name).join(', '));
const org=prod.rows[0];
must('a organização de produção está ancorada num grupo', !!org.enterprise_account_id);

const sergio=await one(`SELECT p.user_id, p.organization_id, p.full_name FROM profiles p
  JOIN user_roles ur ON ur.user_id=p.user_id JOIN roles r ON r.id=ur.role_id AND r.key='owner_admin'
  WHERE p.full_name='SERGIO' LIMIT 1`);
must('administrador real resolve a organização de produção',
  (await q(sergio.user_id,`SELECT current_user_organization_id() o`))[0].o===org.id);
const counts=await q(sergio.user_id,`SELECT
  (SELECT count(*) FROM contracts) contracts,(SELECT count(*) FROM projects) projects,
  (SELECT count(*) FROM contract_billing_events) billing,(SELECT count(*) FROM finance_receivables) recv`);
must('os fatos da organização continuam visíveis para ele', Number(counts[0].contracts)>0, JSON.stringify(counts[0]));
must('administrador tem autoridade de provisionamento (derivada, não inventada)',
  (await q(sergio.user_id,`SELECT current_user_can_provision_organizations() c`))[0].c===true);
const orgs=await q(sergio.user_id,`SELECT organization_id, name, membership_status FROM my_organizations()`);
must('o seletor mostra só a organização de que ele é membro', orgs.length===1 && orgs[0].organization_id===org.id,
  orgs.map(o=>o.name).join(', '));

const eam=await c.query(`SELECT u.email, m.role, m.granted_basis FROM enterprise_account_memberships m JOIN auth.users u ON u.id=m.user_id`);
console.log('   titulares empresariais:', eam.rows.map(r=>`${r.email}(${r.role})`).join(', '));
must('titularidade empresarial = 2, derivada de admin.manage_organization', eam.rowCount===2);

const mems=await one(`SELECT count(*)::int n FROM organization_memberships WHERE organization_id=$1 AND status='ACTIVE'`,[org.id]);
const profs=await one(`SELECT count(*)::int n FROM profiles WHERE organization_id=$1 AND status='active'`,[org.id]);
must('vínculos ativos == perfis ativos', mems.n===profs.n, `${mems.n} vs ${profs.n}`);

must('nenhuma tabela com organization_id anulável entre as endurecidas',
  Number((await one(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public'
    AND column_name='organization_id' AND is_nullable='YES'
    AND table_name IN ('allocation_result','allocation_rule','attachment','category_mapping','ingestion_batch','payroll_batch','user_finance_role')`)).n)===0);
must('organizations sem política FOR ALL',
  Number((await one(`SELECT count(*)::int n FROM pg_policies WHERE tablename='organizations' AND cmd='ALL'`)).n)===0);
must('nenhuma DEFINER de navegador sem search_path',
  Number((await one(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.prosecdef AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND (p.proconfig IS NULL OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cf WHERE cf LIKE 'search_path=%'))`)).n)===0);
must('RPCs de tenancy fora do alcance de anon',
  Number((await one(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND has_function_privilege('anon',p.oid,'EXECUTE')
      AND p.proname IN ('organization_switch','organization_provision','my_organizations',
        'organization_membership_set_status','organization_set_lifecycle_status','organization_readiness')`)).n)===0);
must('nenhuma SECURITY DEFINER ao alcance de anon',
  Number((await one(`SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
    WHERE ns.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'EXECUTE')`)).n)===0);
must('documentos de projeto usam bucket privado',
  (await one(`SELECT public FROM storage.buckets WHERE id='project-documents'`)).public===false);
must('bucket público de logos não aceita PDF',
  !(await one(`SELECT allowed_mime_types @> ARRAY['application/pdf']::text[] accepts_pdf
    FROM storage.buckets WHERE id='project-files'`)).accepts_pdf);
must('nenhuma organização de teste ATIVA sobrou',
  Number((await one(`SELECT count(*)::int n FROM organizations WHERE status='active' AND (name LIKE '[P75]%' OR name LIKE '[P7XT]%' OR name LIKE '[P148]%' OR name LIKE '[PB]%')`)).n)===0);
must('nenhum fato operacional em organização não-produção',
  Number((await one(`SELECT count(*)::int n FROM contracts WHERE organization_id <> $1`,[org.id])).n)===0);
await c.end(); process.exit(ok?0:1);
