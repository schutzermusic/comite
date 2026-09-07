/**
 * Fase 7 — verificação REEXECUTÁVEL do estado de produção.
 *
 *   node scripts/verify-contracts-v2-phase7.mjs
 *
 * Somente LEITURA. Não cria nada, não muda nada e não precisa de organização
 * descartável — é o que permite rodá-la em produção a qualquer momento, e é o
 * que a distingue de `apply-contracts-v2-phase7.mjs`, que exercita a cadeia
 * inteira contra inquilino descartável dentro de uma transação.
 *
 * O que ela responde: as migrations estão registradas, o navegador continua
 * sem TRUNCATE, nenhum fato financeiro/fiscal foi fabricado, as rotas da fase
 * estão ativas e os modelos de leitura respondem.
 *
 * Cartas mortas ALHEIAS à Fase 7 são listadas, não reprovadas: reprovar por
 * falha de outro domínio faria esta verificação mentir sobre o que ela mede.
 */
import pg from 'pg'; import dotenv from 'dotenv';
dotenv.config({path:'.env',quiet:true}); dotenv.config({path:'.env.local',quiet:true});
const c=new pg.Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
await c.connect(); const q=async(s,p)=>(await c.query(s,p)).rows;
const one=async(s,p)=>(await q(s,p))[0];
let ok=true; const must=(l,p,d='')=>{console.log(`${p?'✓':'✗'} ${l}${d?` — ${d}`:''}`); if(!p)ok=false;};
must('registro na ponta 139',(await one(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).version==='139');
must('090 fora do registro',(await one(`SELECT count(*)::int n FROM supabase_migrations.schema_migrations WHERE version='090'`)).n===0);
must('TRUNCATE anon = 0',(await one(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee='anon'`)).n===0);
must('TRUNCATE authenticated = 0',(await one(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee='authenticated'`)).n===0);
for(const [t,label] of [['finance_receivables','recebível'],['finance_settlements','liquidação'],['finance_reconciliations','conciliação'],['finance_payment_sources','evidência de caixa'],['contract_billing_fiscal_requests','pedido fiscal'],['contract_billing_fiscal_allocations','alocação fiscal'],['fiscal_documents','documento fiscal'],['fiscal_jobs','trabalho fiscal'],['ledger_entry','lançamento de razão'],['apar_title','título legado'],['finance_receivable_basis_policies','política de base'],['finance_posting_rules','regra contábil'],['contract_billing_entitlement_rules','regra de direito fixo'],['fiscal_production_gates','portão de produção'],['approval_policies','política de aprovação']]){
  const n=(await one(`SELECT count(*)::int n FROM public.${t}`)).n;
  must(`nenhum ${label} fabricado em produção`, n===0, String(n));
}
must('faturamentos continuam 5 e todos legado',(await one(`SELECT count(*)::int n FROM contract_billing_events`)).n===5 && (await one(`SELECT count(*)::int n FROM contract_billing_events WHERE legacy_row`)).n===5);
must('grafo de eventos saudável',(await one(`SELECT count(*)::int n FROM domain_events WHERE routing_state='FAILED'`)).n===0);
const p7Jobs=['contracts.billing.candidate_from_measurement','contracts.billing.apply_approval','contracts.billing.request_fiscal_document','finance.receivable.create_from_fiscal','finance.receivable.apply_fiscal_cancellation'];
must('nenhuma carta morta da Fase 7',(await one(`SELECT count(*)::int n FROM apex_jobs WHERE status='DEAD_LETTER' AND job_type = ANY($1)`,[p7Jobs])).n===0);
const preexisting=await q(`SELECT job_type, count(*)::int n FROM apex_jobs WHERE status='DEAD_LETTER' GROUP BY 1`);
if(preexisting.length) console.log('  · cartas mortas PRÉ-EXISTENTES, alheias à Fase 7:', JSON.stringify(preexisting));
must('rotas da Fase 7 registradas',(await one(`SELECT count(*)::int n FROM apex_event_routes WHERE enabled`)).n===7);
must('visão contrato-a-caixa responde',(await one(`SELECT count(*)::int n FROM contract_to_cash_read_model`)).n===5);
must('saúde operacional responde',(await one(`SELECT count(*)::int n FROM contract_to_cash_health`)).n>=0);
must('nenhuma organização descartável [P7] viva',(await one(`SELECT count(*)::int n FROM organizations WHERE name LIKE '[P7%'`)).n===0);
must('nenhum usuário descartável vivo',(await one(`SELECT count(*)::int n FROM auth.users WHERE email LIKE 'p7%@example.test'`)).n===0);
must('valor apurado legado intacto',(await one(`SELECT count(*)::int n FROM contract_milestones WHERE measured_amount IS NOT NULL`)).n===1);
await c.end();
console.log(ok?'\nPRODUÇÃO VERDE':'\nPRODUÇÃO VERMELHA'); process.exit(ok?0:1);
