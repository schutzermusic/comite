/**
 * Fase 4 — o contrato que o CÓDIGO tem de manter, lido do arquivo.
 *
 * Provas vivas moram em scripts/assert-contracts-v2-phase4.sql (uma sessão) e
 * em platform-event-graph-live.test.ts (duas sessões). Este arquivo prova o que
 * nenhuma execução prova: que a fronteira continua ESCRITA onde foi decidida —
 * migrations que não são editadas, `fiscal_jobs` que não é substituída, Ponto
 * que não é migrado, e fases futuras que não foram começadas.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
const m119 = read('supabase/migrations/119_platform_domain_events.sql');
const m120 = read('supabase/migrations/120_platform_apex_jobs.sql');
const m121 = read('supabase/migrations/121_contracts_event_bindings_and_emission.sql');
const m122 = read('supabase/migrations/122_contracts_clause_extraction_queue.sql');
const m123 = read('supabase/migrations/123_contracts_extraction_request_set_null_scope.sql');
const m124 = read('supabase/migrations/124_platform_claim_batch_limit.sql');
const all4 = m119 + m120 + m121 + m122 + m123 + m124;

const worker = read('src/lib/platform/jobs/worker.ts');
const handlers = read('src/lib/platform/jobs/handlers.ts');
const fastPath = read('src/lib/platform/jobs/fast-path.ts');
const drainRoute = read('src/app/api/platform/jobs/drain/route.ts');
const healthRoute = read('src/app/api/platform/jobs/health/route.ts');
const extractionRoute = read('src/app/api/ai/clause-extraction/[contractId]/route.ts');
const workflow = read('.github/workflows/apex-jobs.yml');
const pontoWorkflow = read('.github/workflows/ponto-cron.yml');
const pontoCronAuth = read('src/lib/ponto/cron-auth.ts');
const pontoCronRoute = read('src/app/api/ponto/cron/route.ts');
const middleware = read('src/utils/supabase/middleware.ts');

describe('a caixa de saída é transacional', () => {
  it('a emissão é gatilho na tabela de domínio, não uma segunda ida ao banco', () => {
    // Entre um COMMIT e um INSERT posterior cabe um processo derrubado, e o que
    // sobra é um fato real que o Apex nunca vai saber que aconteceu.
    expect(m121).toContain('AFTER INSERT ON public.contract_obligation_instance_history');
    expect(m121).toContain('AFTER INSERT ON public.contract_obligation_evidence');
    expect(m121).toContain('AFTER INSERT ON public.contract_amendments');
  });

  it('nenhum gatilho genérico "todo UPDATE emite evento" foi criado', () => {
    expect(all4).not.toMatch(/BEFORE\s+UPDATE\s+OR\s+INSERT\s+ON\s+public\.\w+\s+FOR EACH ROW EXECUTE FUNCTION public\.emit/);
    // Os gatilhos de saída são três, nomeados, e cada um sabe qual fato emite.
    const emitTriggers = (m121.match(/EXECUTE FUNCTION public\.\w*emit\w*_event\(\)/g) ?? []).length;
    expect(emitTriggers).toBe(3);
  });

  it('a idempotência do fato é identidade de NEGÓCIO, não UUID aleatório', () => {
    expect(m119).toContain('CONSTRAINT de_idempotent UNIQUE (organization_id, event_type, idempotency_key)');
    expect(m121).toContain("'obligation-instance:' || NEW.instance_id::text || ':history:' || NEW.id::text");
    expect(m121).toContain("'amendment:' || NEW.id::text || ':created'");
  });

  it('o tempo do NEGÓCIO governa, não o do trabalhador', () => {
    expect(m121).toContain('apex_causal_context_occurred_at()');
    expect(m121).toContain("activated_at     = event_day");
    expect(m121).toContain("event_day := (ev.occurred_at AT TIME ZONE 'UTC')::date");
  });
});

describe('o fato é imutável', () => {
  it('todo campo factual está na guarda de reescrita', () => {
    for (const column of ['organization_id', 'event_type', 'schema_version', 'aggregate_type',
      'aggregate_id', 'occurred_at', 'actor_user_id', 'source', 'correlation_id',
      'causation_event_id', 'idempotency_key', 'payload']) {
      expect(m119).toContain(`NEW.${column}`);
    }
  });

  it('apagar evento é recusado à aplicação e permitido ao caminho privilegiado', () => {
    // Recusar a todo mundo tornaria impossível apagar um inquilino inteiro.
    expect(m119).toContain('de_no_erasure BEFORE DELETE ON public.domain_events');
    expect(m119).toContain('public.contracts_reject_history_erasure()');
    expect(m119).toContain('REFERENCES public.organizations(id) ON DELETE CASCADE');
  });
});

describe('segredo não é persistido', () => {
  it('o payload de evento e de trabalho recusa chave com nome de segredo', () => {
    expect(m119).toContain('CONSTRAINT de_payload_no_secrets CHECK (public.apex_payload_is_safe(payload))');
    expect(m120).toContain('CONSTRAINT aj_payload_no_secrets CHECK (public.apex_payload_is_safe(payload))');
    for (const word of ['password', 'secret', 'token', 'api[_-]?key', 'cookie', 'credential']) {
      expect(m119).toContain(word);
    }
  });

  it('o payload é pequeno: referência, não conteúdo', () => {
    // 16 KB é folgado para um punhado de ids e apertado demais para um XML ou
    // um PDF em base64.
    expect(m119).toContain('pg_column_size(payload) <= 16384');
    expect(m120).toContain('pg_column_size(payload) <= 16384');
  });

  it('a mensagem de erro persistida é a SEGURA, nunca a exceção crua', () => {
    expect(worker).toContain('classifyJobError');
    expect(worker).toContain('p_error_safe: classified.safe');
    expect(worker).not.toMatch(/JSON\.stringify\(error\)/);
  });
});

describe('posse por concessão', () => {
  it('a reivindicação é UM comando, com SKIP LOCKED', () => {
    // SELECT primeiro e UPDATE depois seria uma corrida com nome de padrão.
    expect(m120).toContain('FOR UPDATE SKIP LOCKED');
    expect(m120).toMatch(/UPDATE public\.apex_jobs j[\s\S]*FROM \([\s\S]*FOR UPDATE SKIP LOCKED/);
  });

  it('a seleção limitada é MATERIALIZADA, e não pode ser reexecutada', () => {
    /*
      Sem `MATERIALIZED`, o planejador põe a subconsulta com LIMIT do lado
      interno de um laço aninhado e a reexecuta por linha externa — cada
      passada devolvendo OUTRAS n linhas, porque o SKIP LOCKED pula o que ela
      mesma acabou de travar. Pedir 4 entregava 8.

      A palavra é explícita de propósito: depender de o planejador "não
      conseguir" embutir uma CTE com FOR UPDATE seria apoiar uma garantia de
      execução num detalhe de implementação.
    */
    expect(m124).toContain('WITH due AS MATERIALIZED (');
    expect(m124).toContain('WITH expired AS MATERIALIZED (');
    // E o limite nulo não vira "sem limite".
    expect(m124).toContain('IF p_limit IS NULL OR p_limit < 1');
  });

  it('a tentativa é contada na reivindicação, não na falha', () => {
    // Contá-la na falha faria um trabalhador que morre no meio nunca gastar
    // tentativa, e o trabalho giraria para sempre sem chegar a carta morta.
    expect(m120).toContain('attempt_count    = j.attempt_count + 1');
  });

  it('concluir e falhar exigem o token corrente', () => {
    expect(m120).toMatch(/apex_jobs_complete[\s\S]*lock_token = p_lock_token/);
    expect(m120).toMatch(/apex_jobs_fail[\s\S]*lock_token = p_lock_token/);
  });

  it('o ceifador invalida o token e preserva a contagem de tentativas', () => {
    expect(m120).toContain('lock_token = NULL, lease_expires_at = NULL');
    expect(m120).toContain('lease_expires_at < now()');
    // Nenhuma escrita em attempt_count dentro da ceifa.
    const reaper = m120.slice(m120.indexOf('FUNCTION public.apex_jobs_reap'),
      m120.indexOf('FUNCTION public.apex_validate_route_provider'));
    expect(reaper).not.toMatch(/attempt_count\s*=/);
  });
});

describe('roteamento', () => {
  it('marca roteado DEPOIS de inserir o trabalho, nunca antes', () => {
    const routing = m120.slice(m120.indexOf('FUNCTION public.apex_route_pending_events'));
    expect(routing.indexOf('apex_jobs_enqueue')).toBeLessThan(routing.indexOf("routing_state = 'ROUTED'"));
  });

  it('versão sem consumidor não some em silêncio', () => {
    expect(m120).toContain("'unsupported_schema_version'");
  });

  it('o núcleo do trabalhador não conhece Contratos', () => {
    // Keep Platform generic: o domínio se registra como provedor.
    expect(m120).not.toContain('contract_obligation');
    expect(m120).toContain('apex_dynamic_route_providers');
    expect(m121).toContain("INSERT INTO public.apex_dynamic_route_providers");
  });

  it('o nome do provedor vem de tabela de servidor, nunca de payload', () => {
    expect(m120).toContain('SELECT provider_function FROM public.apex_dynamic_route_providers');
    expect(m120).toContain('REVOKE ALL ON public.apex_dynamic_route_providers FROM anon, authenticated');
    expect(m120).toContain('::regprocedure');
  });
});

describe('ativação por evento é EXPLÍCITA', () => {
  it('nada é inferido do texto contratual', () => {
    /*
      `activation_event_text` é proveniência JURÍDICA. Deduzir dali qual evento
      dispara a obrigação seria casamento semântico por semelhança, e errar
      produziria um prazo contado a partir de uma ativação inventada.
    */
    expect(m121).toContain('activation_event_text');
    expect(m121).toContain('CONFIGURAÇÃO DE EXECUÇÃO');
    expect(m121).not.toMatch(/similarity|levenshtein|ILIKE '%'/);
  });

  it('só definição de ativação por evento aceita vínculo', () => {
    expect(m121).toContain("d.activation_kind <> 'external_event'");
  });

  it('as três estratégias de ocorrência são determinísticas', () => {
    expect(m121).toContain("CHECK (occurrence_strategy IN ('single','payload_occurrence_key','event_period'))");
    // Recorrência cuja chave depende da âncora não é derivável da data do
    // evento: sem resposta é o resultado correto.
    expect(m121).toContain("reason := 'occurrence_unresolved'");
    expect(m121).toContain("reason := 'occurrence_not_materializable'");
  });

  it('a recorrência NÃO foi reescrita em TypeScript', () => {
    // A Fase 3 já tem a materialização determinística e idempotente.
    expect(m121).toContain('public.contract_obligations_materialize(');
    expect(handlers).not.toMatch(/interval|recurrence_kind|occurrence_key\s*=/);
  });

  it('definição removida ou sucedida não é ativada', () => {
    expect(m121).toContain("IF d.status <> 'active' THEN");
    expect(m121).toContain("reason := 'definition_' || d.status");
  });
});

describe('o agendador é um despertador', () => {
  it('o workflow existe, com cadência de dez minutos e grupo de concorrência', () => {
    expect(workflow).toContain("cron: '*/10 * * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes:');
  });

  it('o segredo vai no header, e o status é conferido', () => {
    // Query string aparece em log de acesso, em referrer e no proxy.
    expect(workflow).toContain('-H "Authorization: Bearer $APEX_JOBS_SECRET"');
    expect(workflow).not.toMatch(/\?[a-z]*secret=/i);
    expect(workflow).toContain("::error::drain do Apex falhou com HTTP");
    expect(workflow).toContain('exit 1');
  });

  it('a correção não depende de o cron ter rodado na hora', () => {
    expect(workflow).toContain('DESPERTADOR');
    expect(fastPath).toContain('best-effort');
    expect(fastPath).toContain('Não é a correção do sistema');
  });

  it('o `after()` engole a própria falha em vez de derrubar o pedido', () => {
    // O trabalho já está durável quando isto roda.
    expect(fastPath).toMatch(/catch[\s\S]*console\.warn/);
    expect(extractionRoute).toContain('scheduleFastDrain');
  });
});

describe('autorização do trabalhador', () => {
  it('as rotas de plataforma exigem Bearer, não sessão', () => {
    expect(drainRoute).toContain('authorizePlatformCron');
    expect(healthRoute).toContain('authorizePlatformCron');
    expect(drainRoute).not.toContain('getUser()');
  });

  it('o middleware não redireciona o trabalhador para /login', () => {
    /*
      Descoberto executando, não lendo: sem esta isenção o middleware de sessão
      responde 307 para `/login` ANTES de o handler existir, e o GitHub Actions
      recebe um redirecionamento em vez de drenar. O workflow falharia alto
      (307 não é 2xx), mas a fila nunca andaria — e a causa ficaria escondida
      atrás de uma tela de login que nenhum agendador sabe preencher.
    */
    expect(middleware).toContain("pathname.startsWith('/api/platform/jobs/')");
    // A isenção é do REDIRECIONAMENTO, não da autorização.
    expect(drainRoute).toContain('authorizePlatformCron');
    // E a do Ponto continua exatamente onde estava.
    expect(middleware).toContain("pathname.startsWith('/api/ponto/cron')");
    expect(middleware).toContain("pathname.startsWith('/api/ponto/retention')");
  });

  it('a resposta é contador, nunca payload', () => {
    // O corpo de sucesso tem três campos, e nenhum deles carrega conteúdo de
    // trabalho: quem lê esta rota está diagnosticando infraestrutura.
    expect(drainRoute).toContain('NextResponse.json({ ok: true, triggeredBy, counters })');
    expect(drainRoute).not.toMatch(/json\([^)]*\bjobs\b/);
    expect(drainRoute).not.toMatch(/counters\.\w+\s*,\s*payload/);
  });
});

describe('as fronteiras que esta fase NÃO cruza', () => {
  it('as migrations 001–118 não foram editadas', () => {
    // Migration aplicada é registro, não rascunho.
    const files = readdirSync('supabase/migrations').filter((f) => /^\d{3}_/.test(f));
    const phase4 = files.filter((f) => Number(f.slice(0, 3)) >= 119);
    expect(phase4.sort()).toEqual([
      '119_platform_domain_events.sql',
      '120_platform_apex_jobs.sql',
      '121_contracts_event_bindings_and_emission.sql',
      '122_contracts_clause_extraction_queue.sql',
      // 123 é correção provada em EXECUÇÃO, não redesenho: a 122 não foi
      // editada, porque migration aplicada é registro.
      '123_contracts_extraction_request_set_null_scope.sql',
      '124_platform_claim_batch_limit.sql',
    ]);
    // A 090 continua arquivada como NUNCA aplicada.
    expect(existsSync('supabase/migrations/090_contract_obligations.sql')).toBe(false);
  });

  it('fiscal_jobs não foi substituída, renomeada nem referenciada', () => {
    expect(all4).not.toMatch(/ALTER TABLE public\.fiscal_jobs/);
    expect(all4).not.toMatch(/DROP TABLE[\s\S]*fiscal_jobs/);
    expect(all4).not.toMatch(/REFERENCES public\.fiscal_jobs/);
    expect(worker + handlers).not.toContain('fiscal_jobs');
  });

  it('o cron do Ponto ficou intacto', () => {
    expect(pontoWorkflow).toContain("cron: '0 * * * *'");
    expect(pontoCronAuth).toContain('process.env.CRON_SECRET');
    expect(pontoCronRoute).toContain("authorizeCron(req, 'api/ponto/cron')");
    // A Plataforma tem segredo PRÓPRIO: compartilhar o do Ponto alargaria
    // privilégio a pretexto de reuso.
    expect(read('src/lib/platform/cron-auth.ts')).toContain('APEX_JOBS_SECRET');
  });

  it('nenhuma tabela de Fase 5, 6 ou 7 foi criada', () => {
    for (const forbidden of ['approval_policies', 'approval_requests', 'approval_decisions',
      'approval_delegations', 'project_measurements', 'measurement_acceptance',
      'billing_release', 'apar_title', 'ledger_entry']) {
      expect(all4).not.toContain(`CREATE TABLE public.${forbidden}`);
      expect(all4).not.toContain(`REFERENCES public.${forbidden}`);
    }
  });

  it('nenhum handler manufatura aprovação, aceite de medição ou liberação de faturamento', () => {
    expect(handlers).not.toMatch(/approv|measurement_accept|billing_release/i);
  });

  it('nenhuma tela de Grafo de Eventos ou de Fila foi criada', () => {
    // A ferramenta operacional de fila fica INTERNA.
    expect(existsSync('src/app/(main)/eventos')).toBe(false);
    expect(existsSync('src/app/(main)/jobs')).toBe(false);
    expect(existsSync('src/app/(main)/fila')).toBe(false);
  });
});

describe('extração enfileirada preserva o significado jurídico', () => {
  it('o portão de evidência é verificado ANTES de enfileirar', () => {
    // Documento inexistente ou não-PDF é falha determinística: enfileirá-la
    // produziria cinco tentativas do mesmo erro.
    expect(m122).toContain("lower(doc.file_path) NOT LIKE '%.pdf'");
    expect(m122).toContain('Documento não encontrado para este contrato.');
  });

  it('pedido repetido não multiplica trabalho de provedor', () => {
    expect(m122).toContain("ccer_one_open");
    expect(m122).toContain("WHERE status IN ('QUEUED','RUNNING')");
  });

  it('pedido e trabalho nascem na MESMA transação', () => {
    expect(m122).toMatch(/INSERT INTO public\.contract_clause_extraction_requests[\s\S]*apex_jobs_enqueue/);
  });

  it('o SET NULL do pedido anula a REFERÊNCIA, não o inquilino', () => {
    /*
      `ON DELETE SET NULL` sem lista de colunas anula TODAS as colunas da chave
      composta, `organization_id` incluída — e ela é NOT NULL. O efeito não era
      "a referência fica nula": era a transação inteira caindo. Pior, como
      `organizations` apaga em cascata tanto `apex_jobs` quanto o pedido, o
      apagamento do INQUILINO passava a depender da ORDEM em que o Postgres
      percorre a cascata.
    */
    expect(m123).toContain('ON DELETE SET NULL (job_id)');
    expect(m123).toContain('ON DELETE SET NULL (analysis_id)');
    // A amarra composta continua inteira: a coluna do inquilino segue na chave.
    expect(m123).toContain('FOREIGN KEY (organization_id, job_id)');
    expect(m123).toContain('FOREIGN KEY (organization_id, analysis_id)');
  });

  it('o resultado continua no modelo que já existia', () => {
    expect(handlers).toContain('extractClausesFromDocument');
    expect(m122).toContain('REFERENCES public.contract_ai_analyses');
  });

  it('nenhuma obrigação nasce de inferência da IA', () => {
    expect(handlers).not.toContain('contract_obligation_definitions');
    expect(m122).toContain('nenhuma obrigação nasce de inferência');
  });
});

describe('entrega at-least-once, dita com esse nome', () => {
  it('nenhum comentário PROMETE exactly-once', () => {
    /*
      A palavra aparece — nos dois lugares em que o repositório diz que NÃO é
      isso. O que não pode existir é a afirmação: "garante", "é" ou "assegura"
      exactly-once.
    */
    const sources = worker + handlers + m120 + fastPath;
    expect(sources).not.toMatch(/(garant\w*|assegur\w*|é|is)\s+exactly[- ]once/i);
    expect(m120).toContain('AT-LEAST-ONCE');
    expect(m120).toContain('Não exactly-once');
    expect(worker).toContain('at-least-once');
  });

  it('estado de fila não é estado contratual', () => {
    expect(m120).toContain('DEAD_LETTER` diz que o Apex não conseguiu executar');
    expect(m120).toContain('NÃO diz que');
  });
});
