/**
 * Fase 5 — o contrato que o CÓDIGO tem de manter, lido do arquivo.
 *
 * Provas VIVAS moram em `scripts/lib/phase5-assertions.mjs` (uma sessão,
 * reexecutável por `scripts/verify-contracts-v2-phase5.mjs`) e em
 * `platform-approval-engine-live.test.ts` (duas sessões). Este arquivo prova o
 * que nenhuma execução prova: que a fronteira continua ESCRITA onde foi
 * decidida.
 *
 * O que ele guarda, em uma frase cada:
 *
 *   · o ator NUNCA é parâmetro — nenhuma assinatura pode reintroduzi-lo;
 *   · o navegador não escreve decisão — o GRANT não pode voltar;
 *   · administrar o motor não concede alçada — `is_admin` não pode entrar na
 *     elegibilidade;
 *   · nada de política de negócio semeada em organização real;
 *   · nada de Fase 6/7 começado por engano;
 *   · migrations aplicadas não são editadas.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const m125 = read('supabase/migrations/125_platform_approval_policies.sql');
const m126 = read('supabase/migrations/126_platform_approval_requests.sql');
const m127 = read('supabase/migrations/127_platform_approval_runtime.sql');
const m128 = read('supabase/migrations/128_contracts_approval_pilot.sql');
const m129 = read('supabase/migrations/129_platform_approval_expiration_job.sql');
const all5 = m125 + m126 + m127 + m128 + m129;

/**
 * O SQL sem os comentários.
 *
 * As asserções estruturais abaixo procuram por padrões PROIBIDOS — despacho
 * dinâmico, `is_admin` na elegibilidade, GRANT de TRUNCATE. Os comentários
 * destas migrations explicam, com todas as letras, por que cada um desses
 * padrões é proibido, e por isso CITAM o padrão. Ler o arquivo inteiro faria
 * a explicação da regra reprovar a regra — que foi exatamente o que aconteceu
 * quando estes testes rodaram pela primeira vez.
 */
const stripSql = (sql: string) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ');

const code125 = stripSql(m125);
const code127 = stripSql(m127);
const code128 = stripSql(m128);
const code5 = stripSql(all5);

const service = read('src/lib/platform/approvals/approval-service.ts');
const types = read('src/lib/platform/approvals/types.ts');
const handlers = read('src/lib/platform/jobs/handlers.ts');
const registry = read('src/lib/platform/jobs/registry.ts');
const producers = read('src/lib/platform/jobs/producers.ts');

describe('o ator vem da identidade autenticada, nunca do chamador', () => {
  it('approval_decide não tem parâmetro de ator', () => {
    // Um `p_approved_by` na assinatura bastaria para o navegador aprovar em
    // nome de terceiro, e nenhuma verificação posterior consertaria isso.
    const signature = m127.slice(m127.indexOf('CREATE FUNCTION public.approval_decide('));
    const params = signature.slice(0, signature.indexOf(') RETURNS'));
    expect(params).not.toMatch(/p_actor|p_approved_by|p_user_id|p_decided_by/);
  });

  it('o ator é lido de auth.uid() dentro da função', () => {
    expect(m127).toContain('actor     uuid := auth.uid();');
  });

  it('sem identidade autenticada a decisão é recusada — sistema e IA não decidem', () => {
    expect(m127).toContain('Decisão exige identidade autenticada. Sistema e IA não decidem.');
  });

  it('o cliente também não envia ator', () => {
    const decide = service.slice(service.indexOf('export async function decideApprovalStep'));
    expect(decide).not.toMatch(/p_actor|approved_by|actor_user_id/);
  });
});

describe('o navegador não escreve decisão', () => {
  it('pedidos, etapas e decisões só recebem SELECT', () => {
    expect(m126).toContain('GRANT SELECT ON public.approval_requests, public.approval_request_stages,\n                public.approval_request_steps, public.approval_decisions TO authenticated;');
    expect(m126).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.approval_requests');
  });

  it('nenhuma policy de escrita foi criada para essas quatro tabelas', () => {
    for (const t of ['approval_requests', 'approval_request_stages',
                     'approval_request_steps', 'approval_decisions']) {
      expect(m126).not.toMatch(new RegExp(`POLICY ${t}_(insert|update|delete|write)`));
      expect(m126).toContain(`CREATE POLICY ${t}_select`);
    }
  });

  it('o histórico de decisão é append-only por gatilho, não por convenção', () => {
    expect(m126).toContain('CREATE TRIGGER adec_no_update BEFORE UPDATE ON public.approval_decisions');
    expect(m126).toContain('Histórico de decisão é append-only');
  });

  it('uma etapa admite UMA decisão, garantido pelo banco', () => {
    expect(m126).toContain('CONSTRAINT adec_one_per_step UNIQUE (organization_id, request_step_id)');
  });
});

describe('administrar o motor não concede autoridade de decisão', () => {
  it('a elegibilidade não consulta is_admin', () => {
    /*
      Um `OR current_user_is_admin()` dentro de `approval_step_eligibility`
      faria todo administrador decidir qualquer etapa, e a segregação de
      funções viraria enfeite. A §35 separa administração de alçada, e a
      separação tem de estar no corpo da função — não numa promessa.
    */
    const fn = code127.slice(
      code127.indexOf('CREATE FUNCTION public.approval_step_eligibility('),
      code127.indexOf('REVOKE ALL ON FUNCTION public.approval_step_eligibility('),
    );
    expect(fn).not.toContain('current_user_is_admin');
  });

  it('owner_admin não recebe approvals.decide na semeadura', () => {
    const seed = code125.slice(code125.indexOf("r.key = 'owner_admin'"));
    const granted = seed.slice(0, seed.indexOf('ON CONFLICT'));
    expect(granted).toContain('approvals.policy.manage');
    expect(granted).not.toContain('approvals.decide');
  });

  it('a permissão de administração declara, no texto, o que não concede', () => {
    expect(m125).toContain('NÃO concede alçada nem dispensa SoD');
  });
});

describe('a segregação de funções é obrigatória e não é contornável por delegação', () => {
  it('requerente e autor do objeto são verificados', () => {
    expect(m127).toContain("'SOD_REQUESTER'");
    expect(m127).toContain("'SOD_SUBJECT_CREATOR'");
    expect(m127).toContain("'SOD_INCOMPATIBLE_STEP'");
  });

  it('a SoD é avaliada sobre o ator E sobre o delegante', () => {
    // Delegar para o requerente não pode ser a porta dos fundos da
    // autoaprovação: as duas identidades entram na comparação.
    expect(m127).toContain('(p_user_id = req.requested_by OR principal = req.requested_by)');
    expect(m127).toContain('(p_user_id = req.subject_created_by OR principal = req.subject_created_by)');
  });

  it('não há encadeamento de delegação por padrão', () => {
    expect(m127).toContain('SEM ENCADEAMENTO');
    expect(m127).toContain('principal := del.delegator_user_id;');
  });

  it('delegação exige prazo — não existe delegação permanente', () => {
    expect(m127).toMatch(/effective_until\s+timestamptz NOT NULL/);
  });
});

describe('não há conversão de moeda inventada', () => {
  it('moeda incompatível bloqueia em vez de converter', () => {
    expect(m127).toContain("'AUTHORITY_CURRENCY_MISMATCH'");
    expect(m127).toContain('não há conversão de moeda');
    expect(code5).not.toMatch(/exchange_rate|fx_rate|convert_currency/i);
  });

  it('valor desconhecido bloqueia a etapa com alçada', () => {
    expect(m127).toContain("'AUTHORITY_AMOUNT_UNKNOWN'");
  });
});

describe('a política é versionada e a história não é reescrita', () => {
  it('versão fora de DRAFT é imutável, por gatilho', () => {
    expect(m125).toContain('CREATE TRIGGER apv_immutable_after_draft');
    expect(m125).toContain('CREATE TRIGGER aps_immutable_after_draft');
    expect(m125).toContain('CREATE TRIGGER apst_immutable_after_draft');
  });

  it('o pedido copia o plano de etapas em vez de consultar a política viva', () => {
    expect(m126).toContain('Cópia GOVERNADA do plano de etapas');
    expect(m127).toContain('INSERT INTO public.approval_request_steps (');
  });

  it('a seleção nunca desempata por "a mais recente"', () => {
    expect(m125).toContain('Seleção de política ambígua');
    const select = code125.slice(code125.indexOf('CREATE FUNCTION public.approval_policy_select('));
    expect(select).not.toMatch(/ORDER BY .*version_no DESC.*LIMIT 1/);
    expect(select).not.toMatch(/ORDER BY .*created_at DESC.*LIMIT 1/);
  });
});

describe('a impressão digital liga a aprovação ao conteúdo exato', () => {
  it('a impressão é reconferida a cada decisão, não só na abertura', () => {
    expect(m127).toContain('SUBJECT_CHANGED');
    expect(m127).toContain('SELECT * INTO subj FROM public.approval_subject_resolve(');
  });

  it('a impressão do contrato ignora o que muda sozinho', () => {
    const fp = code128.slice(
      code128.indexOf('CREATE FUNCTION public.contract_approval_fingerprint('),
      code128.indexOf('REVOKE ALL ON FUNCTION public.contract_approval_fingerprint'),
    );
    expect(fp).not.toContain('updated_at');
    expect(fp).not.toContain('health_score');
    // E inclui o que é conteúdo, dinheiro e prazo inclusive.
    for (const col of ['total_value', 'currency', 'end_date', 'counterparty_name']) {
      expect(fp).toContain(col);
    }
  });

  it('o adaptador de sujeito não despacha por nome vindo de tabela', () => {
    // Executar código nomeado por dado persistido é uma porta, não extensão.
    const resolver = code128.slice(code128.indexOf('CREATE OR REPLACE FUNCTION public.approval_subject_resolve('));
    expect(resolver).not.toMatch(/EXECUTE format/);
    expect(resolver).toContain("IF p_subject_type = 'contract' THEN");
  });
});

describe('o evento é transacional e a aprovação não afirma execução', () => {
  it('a decisão emite o fato pela mesma função da Fase 4', () => {
    expect(m127).toContain('public.emit_domain_event(');
    expect(m127).toContain("'approval.decision.recorded'");
  });

  it('o fato de aprovação declara a execução a jusante como não iniciada', () => {
    // APPROVED é decisão, não execução. Um consumidor que falhe não devolve o
    // pedido para PENDING.
    expect(m127).toContain("'downstream_execution','not_started'");
  });

  it('a expiração usa apex_jobs, e não uma fila própria do motor', () => {
    expect(m129).toContain('public.apex_jobs_enqueue(');
    expect(registry).toContain("'platform.approvals.expire'");
    expect(handlers).toContain("'platform.approvals.expire': approvalExpiration");
    expect(producers).toContain("name: 'platform.approvals.expire'");
    expect(code5).not.toMatch(/CREATE TABLE public\.approval_jobs/);
  });
});

describe('as fronteiras que esta fase NÃO cruza', () => {
  it('nenhuma política de negócio é semeada por migration', () => {
    /*
      Semear chave de permissão é vocabulário de sistema e é permitido.
      Semear política, aprovador ou alçada seria fabricar governança — e uma
      alçada inventada é indistinguível de uma real depois que alguém aprova
      por cima dela.
    */
    expect(code5).not.toMatch(/INSERT INTO public\.approval_policies/);
    expect(code5).not.toMatch(/INSERT INTO public\.approval_policy_versions/);
    expect(code5).not.toMatch(/INSERT INTO public\.approval_policy_steps/);
    expect(code5).not.toMatch(/INSERT INTO public\.approval_engine_cutover/);
    expect(m125).toContain('INSERT INTO public.permissions');
  });

  it('a história legada não recebe campo fabricado', () => {
    const view = m128.slice(m128.indexOf('CREATE VIEW public.contract_approvals_legacy_history'));
    expect(view).toContain("'LEGACY_CONTRACT_APPROVALS'::text    AS provenance");
    expect(view).toContain('NULL::uuid   AS policy_version_id');
    expect(view).toContain('NULL::text   AS authority_source');
    // Nenhum UPDATE nem DELETE sobre a tabela legada.
    expect(code5).not.toMatch(/UPDATE public\.contract_approvals SET/);
    expect(code5).not.toMatch(/DELETE FROM public\.contract_approvals/);
    expect(code5).not.toMatch(/DROP TABLE[\s\S]{0,40}contract_approvals/);
  });

  it('um motor de escrita só: legado e compartilhado se excluem', () => {
    expect(m128).toContain('CREATE TRIGGER trg_contract_approvals_cutover');
    expect(m128).toContain('CREATE TRIGGER trg_approval_requests_cutover');
    expect(m128).toContain('NOT_CUT_OVER');
  });

  it('a Fase 6 e a Fase 7 não foram começadas', () => {
    expect(code5).not.toMatch(/project_measurements|measurement_acceptance/);
    expect(code5).not.toMatch(/billing_release|invoice_orchestration|ar_titles|settlement/);
  });

  it('não há DSL de fluxo: nada de SQL, JS ou laço autorável', () => {
    // A §65 proíbe expressão arbitrária. O motor é estruturado: estágios
    // ordenados, etapas paralelas, quórum. Não é um BPMN.
    expect(code5).not.toMatch(/EXECUTE\s+format\(/);
    expect(code5).not.toMatch(/CREATE TABLE[\s\S]{0,200}(expression|script|formula)\s+text/i);
  });

  it('a IA não decide, e o vocabulário não a admite', () => {
    expect(m126).toContain("CHECK (actor_source IN ('human','system'))");
    expect(code5).not.toMatch(/'ai'|'llm'|'model'/);
  });

  it('as migrations 001–128 não foram editadas por causa da 129', () => {
    // Migration aplicada é registro, não rascunho: a 129 corrige a 127 sem
    // tocá-la, como a 123 e a 124 fizeram na Fase 4.
    const files = readdirSync('supabase/migrations').filter((f) => /^\d{3}_/.test(f));
    const phase5 = files.filter((f) => {
      const n = Number(f.slice(0, 3));
      return n >= 125 && n <= 129;
    });
    expect(phase5.sort()).toEqual([
      '125_platform_approval_policies.sql',
      '126_platform_approval_requests.sql',
      '127_platform_approval_runtime.sql',
      '128_contracts_approval_pilot.sql',
      '129_platform_approval_expiration_job.sql',
    ]);
    // A 090 continua arquivada como NUNCA aplicada.
    expect(existsSync('supabase/migrations/090_fiscal_nfse.sql')).toBe(false);
    expect(existsSync('supabase/migrations-superseded/090_fiscal_nfse.sql.superseded')).toBe(true);
  });

  it('a 118 não foi editada e o TRUNCATE não volta por GRANT', () => {
    expect(code5).not.toMatch(/GRANT[^;]*TRUNCATE/);
    expect(code5).not.toMatch(/GRANT ALL[^;]*TO (anon|authenticated)/);
  });

  it('toda função SECURITY DEFINER da fase fixa o search_path', () => {
    const definers = code5.match(/SECURITY DEFINER[^;]*?AS \$\$/g) ?? [];
    expect(definers.length).toBeGreaterThan(5);
    for (const d of definers) expect(d).toMatch(/SET search_path = public/);
  });
});

describe('a tela não transforma ausência em conformidade', () => {
  it('o estado do motor é declarado, e "não migrado" não é "nada pendente"', () => {
    const banner = read('src/components/contracts/intelligence/ApprovalEngineStatusBanner.tsx');
    expect(banner).toContain('ainda não foi migrada');
    const panel = read('src/components/contracts/intelligence/SharedApprovalEnginePanel.tsx');
    expect(panel).toContain('Isto não quer dizer que não haja');
  });

  it('falha de leitura aparece como indisponível, não como lista vazia', () => {
    const panel = read('src/components/contracts/intelligence/SharedApprovalEnginePanel.tsx');
    expect(panel).toContain('não significa que não existam');
  });

  it('expirado e rejeitado têm rótulos distintos', () => {
    expect(types).toContain("EXPIRED: 'Prazo esgotado'");
    expect(types).toContain("REJECTED: 'Rejeitado'");
    expect(types).toContain("RETURNED_FOR_CORRECTION: 'Devolvido para correção'");
  });

  it('a navegação do módulo não ganhou item novo', () => {
    // A §41 é explícita: nada de barra lateral do Motor de Aprovação.
    const sidebar = read('src/app/(main)/contratos/page.tsx');
    expect(sidebar).not.toMatch(/id: 'approval-engine'|Motor de Aprovação'/);
  });
});
