# Contracts V2 — Deferred Items Register

Do not pull these items into an authorized phase as opportunistic cleanup.

## Phase 0 deferred
- Successful live clause extraction after provider credit restoration.

## Phase 1 deferred

### Party / legacy adapters
- client.party_id
- supplier.party_id
- dropping contracts.client_id
- dropping contracts.supplier_id
- future fiscal_parties.party_id
- Party addresses/contacts
- Party roles beyond customer/supplier
- broader legacy Party-like text cleanup

### Cost center
- dropping legacy cost_center
- converting payroll_cost_center_mappings.cost_center_id text bridge
- classifying the eight seeded finance_cost_centers.type
- assigning business units to seeded cost centers
- deeper hierarchy cycle prevention
- cleanup of redundant single-column FKs where stronger composite FKs coexist

### Application cleanup
- /financeiro/centros-custo mock shim
- ContractInstrumentCard project cliente fallback
- unrelated sidebar lint issue

## Phase 3 — Obligations Engine — ENTREGUE

Migrations 114–117. O que estava listado como deferido foi implementado:
instâncias, recorrência idempotente, ativação, regras de prazo, dependências,
completude de evidência, dispensa/exceção, escalonamento, impacto financeiro
contratual e avaliação de `blocks_billing`.

### Deferido DENTRO da Fase 3

- **Extração automática de obrigação a partir de cláusula.** A proposta por IA
  não foi adaptada. Ligá-la agora transformaria a fase num projeto de extração,
  e uma obrigação proposta por modelo não pode virar oficial por ter sido
  inferida. O caminho seguro continua sendo documento → proposta → proveniência
  explícita → obrigação governada.
- **Calendário oficial de dias úteis.** Sem ele, `calendar_basis =
  'business_days'` mantém a regra conhecida e a data DESCONHECIDA. Contar dia
  útil como dia corrido produziria prazo errado com cara de certo.
- **Ativação por evento externo.** O descritor contratual é gravado
  (`activation_event_text`), mas nada o consome: consumir evento é Fase 4.
  Evento não observado não ativa nada.
- **Aceite formal.** `requires_formal_acceptance` e `acceptance_state`
  representam a exigência e o estado; o motor de aprovação é a Fase 5.
- **Materialização automática.** `contract_obligations_materialize` é
  determinística, idempotente e chamável por rota. Quem a chama sozinha é a
  Fase 4 — a Fase 3 não traz agendador, e não precisa de um para estar completa.
- **Interface de escrita das obrigações.** A API existe (criar definição,
  materializar, transicionar, registrar evidência e dispensa) e é usada pelos
  testes e pelo smoke; a tela de cadastro assistido ainda não foi desenhada.
- **Migração da lista de tarefas legada.** As três linhas `[QA]` de
  `contract_obligations` (todas num contrato `demo`) NÃO foram convertidas.
  Converter exigiria inventar a proveniência e a regra de prazo que nunca foram
  registradas. A tabela virou somente-leitura e se declara legado.

### Achado de segurança — RESOLVIDO na migration 118

O schema `public` carregava DEFAULT PRIVILEGES concedendo `arwdDxtm` — todos os
privilégios de tabela, TRUNCATE incluído — a `anon` e `authenticated` em toda
tabela nova. Padrão instalado pelo Supabase, não escrito por ninguém aqui.

TRUNCATE importa porque é o único privilégio de escrita que a **RLS não
filtra**: SELECT/INSERT/UPDATE/DELETE passam pelas políticas e um papel sem
organização não alcança linha nenhuma; TRUNCATE não olha para linha, esvazia a
tabela.

Não havia porta aberta — o PostgREST não expõe o verbo, e nenhuma função
`SECURITY INVOKER` o executava (verificado: zero funções em todo o banco com
TRUNCATE no corpo, e o único TRUNCATE do repositório está na migration 005,
sobre uma TEMP TABLE, executado como `postgres`). O que havia era um privilégio
muito mais largo que o desenho.

**Migration 118** revoga TRUNCATE de `anon` e `authenticated` em todas as
tabelas de `public` e corrige o DEFAULT ACL de cada papel que realmente possui
tabela ali, para que nenhuma tabela futura o herde. 146 tabelas antes, 0 depois.
`service_role`, `postgres` e todo o DML governado por RLS ficaram intactos.

Resíduo declarado, fora do nosso alcance: `supabase_admin` também tem um DEFAULT
ACL concedendo TRUNCATE, e `postgres` não é membro dele — `ALTER DEFAULT
PRIVILEGES FOR ROLE supabase_admin` responde *permission denied*. Aquele default
só vale para tabela criada POR `supabase_admin`, e nenhuma das tabelas de
`public` é dele: todas pertencem a `postgres`, que é sob quem as migrations
rodam. Se um dia a plataforma criar tabela de aplicação em `public`, ela
nasceria com o privilégio — `tests/integration/platform-truncate-privilege.test.ts`
detecta isso, porque ele consulta o catálogo em vez de reler a migration.

## Phase 4 — Platform Event Graph / Durable Work Execution — ENTREGUE

Migrations 119–124 (119–122 desenho; 123–124 correções provadas em EXECUÇÃO —
nenhuma migration aplicada foi editada). O que estava listado como deferido foi
implementado:

- `domain_events` (119) — fato durável, append-only, org-scoped, com
  idempotência de negócio, causação do mesmo inquilino e payload sem segredo;
- caixa de saída transacional (121) — três gatilhos de emissão, na MESMA
  transação da mutação autoritativa;
- `apex_jobs` (120) — fila durável com posse por concessão;
- reivindicação com `FOR UPDATE SKIP LOCKED`, num único comando;
- concessão com token, expiração e ceifador;
- retentativa com recuo exponencial limitado e carta morta;
- agendador (GitHub Actions, `*/10`) + caminho rápido `after()`;
- extração de cláusulas enfileirada (122).

Além do que estava na lista, e porque a Fase 3 os havia deferido explicitamente
para cá:

- **Materialização automática de obrigações.** Produtor agendado + handler que
  chama `contract_obligations_materialize` — a função da Fase 3, não uma
  reescrita. Horizonte rolante de 180 dias.
- **Ativação por evento externo.** Vínculo EXPLÍCITO
  (`contract_obligation_event_bindings`) entre definição de obrigação e tipo de
  evento. O descritor contratual (`activation_event_text`) continua sendo
  proveniência jurídica; nada é inferido dele.

### Dois defeitos que só a execução revelou

Nenhum dos dois seria encontrado lendo o SQL, e por isso os dois ganharam teste
vivo permanente em `tests/integration/platform-event-graph-live.test.ts`.

- **123 — `ON DELETE SET NULL` composto anulava o inquilino.** A 122 escreveu
  `FOREIGN KEY (organization_id, job_id) ... ON DELETE SET NULL`, e sem lista de
  colunas isso anula TODAS as colunas da chave, `organization_id` inclusive —
  que é NOT NULL. Apagar um trabalho referenciado derrubava a transação. Pior:
  como `organizations` apaga em cascata tanto `apex_jobs` quanto o pedido, o
  apagamento do INQUILINO INTEIRO passava a depender da ORDEM da cascata. O
  smoke passou por sorte de ordenação. Corrigido com `SET NULL (job_id)` /
  `SET NULL (analysis_id)`.
- **124 — o lote da reivindicação não valia.** `UPDATE ... FROM (SELECT ...
  LIMIT n FOR UPDATE SKIP LOCKED)` colocava a subconsulta limitada do lado
  INTERNO de um laço aninhado, e o lado interno é reexecutado por linha externa.
  Cada reexecução respeitava o limite e, como o SKIP LOCKED pula o que ela mesma
  travou, devolvia OUTRAS n. Pedir 4 entregava 8. Nada era executado duas vezes
  — o que quebrava era a EXECUÇÃO LIMITADA, que é o que impede a hospedagem de
  derrubar o trabalhador no meio. Corrigido com CTE `AS MATERIALIZED`. De
  quebra, `LIMIT NULL` é "sem limite" no Postgres e a guarda antiga deixava NULL
  passar; agora recusa.

### Deferido DENTRO da Fase 4

- **Segredo do agendador em produção.** O workflow
  `.github/workflows/apex-jobs.yml` existe e falha alto sem eles, mas
  `APEX_JOBS_SECRET` (secret) e `APEX_SITE_URL` (variable) ainda NÃO estão
  configurados no repositório, e `APEX_JOBS_SECRET` ainda não está na Vercel.
  Enquanto isso não for feito, a cadência de dez minutos não roda: o que
  funciona é o caminho rápido `after()` e o disparo manual autenticado. Isto é
  configuração de credencial, não código, e não pode ser feito de dentro do
  repositório.
- **Registro ESTÁTICO de rotas vazio.** `apex_event_routes` nasce sem linha. Os
  cinco fatos do vocabulário inicial não têm, hoje, consumidor automático que
  não fosse especulação sobre as Fases 5–7. O primeiro consumidor real é
  dinâmico (vínculo de ativação de obrigação).
- **Estratégia de ocorrência para recorrência diária / intervalo fixo.** As
  chaves dessas séries dependem da âncora e do passo; derivá-las da data do
  evento acertaria por acaso. O resultado é `occurrence_unresolved`, e é o
  resultado correto.
- **Interface de operação da fila.** Carta morta, reprocessamento e saúde
  existem como funções de banco (`apex_jobs_dead_letters`, `apex_jobs_replay`,
  `apex_jobs_health`) e como rota interna autenticada por Bearer. Não há tela de
  usuário, e a Fase 4 não precisa de uma — a Fase 9 é a Torre de Controle.
- **Escalonamento justo entre inquilinos.** A reivindicação ordena por
  `run_after`. Um inquilino com backlog enorme pode, em tese, ocupar lotes
  seguidos. Não há evidência de que isso aconteça hoje, e construir um
  escalonador justo sem evidência seria complexidade especulativa.
- **`contract_amendment_revisions.organization_id` sem `ON DELETE CASCADE`.**
  FK ANTERIOR à Fase 4, que bloqueia o apagamento privilegiado de um inquilino
  que tenha aditivo. Não é escopo desta fase corrigi-la; está anotada aqui para
  não ser redescoberta.
- **Fila do Fiscal.** `fiscal_jobs` continua do Fiscal. Unificá-la com
  `apex_jobs` exigiria migration destrutiva numa fila de transmissão a provedor,
  e não há razão de correção para isso hoje.
- **Cron do Ponto.** Não migrado. O Ponto tem segredo próprio
  (`CRON_SECRET`), workflow próprio e cadência própria, e nenhuma linha dele foi
  tocada.

## Phase 5 — Motor de Aprovação da Plataforma — ENTREGUE (infraestrutura)

Migrations 125–129 (125–128 desenho; 129 correção provada em EXECUÇÃO — nenhuma
migration aplicada foi editada). Tudo o que estava listado como deferido foi
implementado: `approval_policies` com versão imutável, `approval_requests` com
plano de etapas COPIADO na criação, estágios ordenados, etapas paralelas com
quórum declarado, `approval_decisions` append-only com uma decisão por etapa
garantida pelo banco, `approval_delegations` com prazo obrigatório e escopo, e
a RPC atômica `approval_decide`.

Além da lista: segregação de funções (requerente, autor do objeto e etapas
incompatíveis), limites de alçada com proveniência congelada na decisão,
impressão digital do sujeito reconferida a CADA decisão, devolução para
correção distinta de rejeição, cancelamento, expiração e sucessão — todos com
fato durável emitido na MESMA transação, pelo Grafo de Eventos da Fase 4.

### A auditoria que definiu o escopo, e o que ela encontrou

`contract_approvals` tem TRÊS linhas. As três são do MESMO contrato, e esse
contrato é `data_class = 'demo'` (`[QA] Contrato de Serviços`). **Não existe
uma única aprovação de contrato real na base.**

A única regra autoritativa PROVÁVEL é estrutural: o vocabulário de etapas
(`juridico`, `financeiro`, `comite`, `diretoria`), a ordem entre elas
(`contract_approval_step_order`, IMMUTABLE, em produção) e a segregação de
funções da Fase 0 (quem cadastrou o contrato não decide etapa terminal).

O que NÃO existe em lugar nenhum — nem no banco, nem no repositório, nem em
documento: alçada, limite por valor, quórum, delegação e aprovador nomeado.
Nenhuma linha, nenhuma constante.

Outros motores mapeados e NÃO migrados (a §7 proíbe big-bang):
`deliberations` + `deliberation_votes` (0 linhas), `journey_balance_approvals`
(0 linhas), `time_entries.approved_by` (0 linhas), `allowance_weeks`,
`payroll_batch`, `ledger_entry`, `fiscal_documents`, `project_allocations`,
`contract_documents`. Todos intactos.

### Deferido DENTRO da Fase 5

- **O corte real de Contratos.** BLOQUEADO, e o bloqueio é a conclusão certa da
  §34/§63, não uma tarefa pendente de código. Sem regra autoritativa provada,
  ativar o corte exigiria inventar política, alçada ou aprovador — e uma alçada
  inventada é indistinguível de uma real depois que alguém aprova por cima
  dela. `approval_engine_cutover` está VAZIA em produção. O motor foi validado
  ponta a ponta com política e organização DESCARTÁVEIS, apagadas ao final.
  Para desbloquear é preciso o que o código não pode produzir: alguém com
  autoridade declarando quais etapas cada contrato exige, sob que valor, e
  quem decide.
- **Interface de desenho de política.** As tabelas, a validação
  (`approval_policy_version_problems`) e a ativação existem e são exercitadas
  pelos testes e pela fumaça. Não há tela de cadastro de política — e não podia
  haver antes de existir política real para cadastrar.
- **Interface de decisão.** O modelo de leitura
  (`approval_request_read_model`), a elegibilidade do espectador e o serviço de
  cliente existem; a aba Aprovações já os consome e declara honestamente o
  estado do motor. Os BOTÕES de aprovar/rejeitar/devolver não foram
  construídos: enquanto a organização não é cortada, não há pedido para decidir,
  e um botão sobre lista vazia sugeriria governança que não está em vigor.
- **Migração dos demais módulos.** Fora de escopo por decisão da §7. Cada um
  exigirá a mesma auditoria de regra real que Contratos exigiu.
- **Reabertura de estágio após devolução.** `return_behavior` admite apenas
  `TERMINATE_REQUEST`, e o CHECK diz isso. Reabrir exigiria mais de uma decisão
  por etapa, e o histórico deixaria de ter uma linha por decisão. A correção
  volta por SUCESSÃO, com impressão digital nova — que é o caminho honesto.
- **`BLOCK_STAGE` na rejeição.** Mesma razão: o valor não foi declarado no
  CHECK porque o runtime não o implementa. Estado de governança que existe no
  vocabulário e não no comportamento é pior que estado ausente.
- **Encadeamento de delegação.** Proibido por padrão (§20). O delegante precisa
  satisfazer a etapa POR SI; permitir a cadeia tornaria impossível dizer de
  onde a autoridade veio originalmente.
- **Alçada por ATOR.** O limite mora na ETAPA, não na pessoa. Modelar alçada
  pessoal exigiria conhecer as alçadas reais de pessoas reais, que é
  exatamente o que a auditoria não encontrou. A delegação já limita pelo MENOR
  entre o teto do delegante e o da etapa.
- **Lembretes de prazo.** A §29 permite "se explicitamente necessário", e não
  há evidência de que sejam.

### Dois defeitos que só a execução revelou

- **Sucessão depois da inserção nunca rodava.** `approval_request_create`
  suprimia o pedido antigo DEPOIS de inserir o novo — e o índice parcial
  `areq_one_active` recusava o sucessor enquanto o antecessor ainda estava
  PENDING, corretamente. A ordem foi invertida: o id é gerado antes, a sucessão
  acontece primeiro. Encontrado pela bateria, não pela leitura do SQL.
- **`current_user` dentro de SECURITY DEFINER é o DONO, não quem chamou.** A
  guarda que impedia consultar a elegibilidade de terceiros nunca disparava,
  porque comparava um `current_user` que já valia `postgres`. O oráculo de
  permissão estava aberto. Corrigido POR CONSTRUÇÃO e não por verificação:
  `approval_step_eligibility_for_viewer` não tem o parâmetro de ator, e é a
  única que `authenticated` alcança.

### Resíduo confirmado, e agora com consequência medida

`contract_amendment_revisions.organization_id` sem `ON DELETE CASCADE` — já
registrado na Fase 4 — BLOQUEIA de fato a exclusão de um inquilino que tenha
aditivo. A limpeza da bateria e a da fumaça precisam apagar a linhagem antes da
organização. Continua fora do escopo desta fase; deixa de ser teórico.

## Phase 6 — Project Measurement
Deferred:
- project_measurements
- operational measurement instances
- accepted/rejected measurement events
- schedule integration
- execution evidence integration
- readiness computation

Frozen invariant:

```text
accepted project measurement
→ legacy milestone.measured_amount
→ STOP
```

Never fallback to billing_amount.

## Phase 7 — Finance Chain
Deferred:
- real Finance replacement where mock remains
- billing event → fiscal document
- AR titles
- settlement
- reversal
- reconciliation
- dispute
- retention
- glosa
- real paid/received joins

## Phase 8 — Risks
Deferred:
- derived risk fingerprint/idempotency
- financial exposure
- operational risk links
- clause → obligation → finance → approval → amendment graph

## Phase 9 — Control Tower
Deferred until real Phase 3 + 7 + 8 data exists:
- required actions
- money blocked
- overdue obligations
- renewals
- receivables
- approvals
- risk/exposure
- counterparties blocking progress
- recent material changes

Do not fake this dashboard before the underlying data is real.

## Phase 10 — Autonomy
Deferred:
- automation policies
- automation executions
- reversibility model
- higher autonomy levels

Measurement acceptance remains NEVER_AUTOMATED.

## Measurement / billing readiness
Phase 2 structures requirements only.

Operational readiness remains deferred.

Apex does not generate the technical report.

```text
Contracts → WHAT is required
Schedule → WHEN expected
Projects / Operations → WHAT happened
Apex → WHAT is missing
Engineering → authors report
Billing → acceptance → release → invoice → receivable
```

## UI items intentionally not reopened
- Contracts module sidebar hierarchy
- dossier horizontal navigation
- removed vertical dossier rail
- portfolio-level Histórico
- portfolio-level Exportar PDF
- Análise IA as workspace
- generic Reports workspace
- global UI token redesign

## Repository housekeeping

### `.preview/`
Tests regenerate tracked `.preview/` files.
Restore incidental changes and keep net diff zero.

### Existing sidebar lint issue
Known pre-existing `react-hooks/set-state-in-effect` in `app-sidebar.tsx`.
Do not fix inside a Contracts schema phase unless that logic is touched.

### Disk capacity
Recent builds reached ENOSPC. Ensure adequate free space before large builds, Playwright runs or worktrees.

## Fiscal / NFS-e — fundação entregue, emissão real no portão de credencial

Migrations 112 (fundação) e 113 (permissões). O rascunho `090_fiscal_nfse.sql`
NUNCA foi aplicado e está arquivado em `supabase/migrations-superseded/`.

Deferido:
- **Emissão real em homologação** — depende de itens externos ao código:
  certificado A1, senha, `FISCAL_CERT_KEY`, inscrição municipal ativa, adesão ao
  ambiente nacional e `base_url` do ambiente. Ver `docs/plan/TASK-024`.
- **Produção** — bloqueada estruturalmente por `fiscal_production_gates` e pelo
  gatilho `fiscal_guard_production`, que roda para todos, service role incluído.
- **Integração com Finanças** (razão, contas a receber, `tax_obligation`) —
  Fase 7. O documento fiscal declara `finance_status = 'not_posted'`.
- **DANFSe** — o pipeline existe e arquiva; a recuperação depende do provedor
  real e não foi exercitada.
- **Menu do módulo** — segue exigindo `NEXT_PUBLIC_FISCAL_MODULE_ENABLED`
  explícito por ambiente.

## Portão pré-Fase-3 — RESOLVIDO

O registro foi reconciliado: as 22 versões provadas (089, 091–111) foram
gravadas, e a 090 fica declaradamente FORA por nunca ter sido aplicada. A partir
das migrations 112+, todo runner grava a linha do registro DENTRO da transação
que aplica o arquivo (`scripts/lib/migration-registry.mjs`) — aplicar e
registrar deixaram de ser dois eventos que podem divergir. O registro termina
em 117.

O texto original do portão fica abaixo, como registro do que foi decidido.

## Mandatory pre-Phase-3 gate — migration registry drift

`supabase_migrations.schema_migrations` in production ends at **088**, while the
schema itself carries everything through **111**. Migrations 089–111 were applied
through the controlled runners in `scripts/` (`apply-contracts-v2-phase0/1/2.mjs`
and their siblings), which execute the files inside one transaction with real
preflight and post-apply assertions — but do not write a registry row.

Nothing is wrong with the schema: every applied migration is in the repository, in
order, and the Phase 2 runner verifies the result structurally on each run. What is
wrong is that the registry no longer describes the database, so `supabase db push`
or any registry-driven tool would try to replay 089 onward against a database that
already has them, and the first `CREATE TABLE` would fail — or worse, a partially
idempotent one would not.

**This was deliberately left out of the Phase 2 security fix.** Reconciling a
migration registry is a write to migration history, and doing it inside a change
whose subject is a cross-tenant leak would have mixed two unrelated risks in one
reviewable diff.

Before Phase 3 starts, decide and execute one of:

1. **Backfill the registry** — insert rows 089–111 as already-applied, after
   proving file-by-file that each is in fact present in the schema. Registry
   becomes truthful; runners stay the apply path.
2. **Adopt the registry as the apply path** — reconcile as above, then move the
   phase runners' preflight/assertions into repeatable checks around
   `supabase db push`, so one mechanism owns applying and the other owns proving.
3. **Record the runners as the sole source of truth** — document that
   `schema_migrations` is not used by this project, and remove or fence the tools
   that would consult it, so no one later trusts a number that means nothing.

Do not pick by default. Whichever is chosen, the gate closes only when the
registry and the schema agree, or when the registry is provably out of the loop.

## Phase 6 — Contract ↔ Project / Measurement — ENTREGUE

Migrations 130–134. Entregues: `project_measurements` canônica de dono
Projetos, vínculo estrutural regra→medição, mapeamento governado regra↔etapa,
histórico de transição imutável, materialização determinística e idempotente de
candidatos, vinculação automática de evidência reusando o resolvedor existente,
integração de evidência de Ponto/localização/projeto, pacote e rastreio de
exigências, resolvedor canônico de prontidão com READY / BLOCKED / INCOMPLETE /
NOT_APPLICABLE / UNKNOWN, submissão controlada, aceite/rejeição autoritativos,
eventos transacionais pelo Grafo de Eventos, compatibilidade com o
`measured_amount` legado e a proibição permanente de `billing_amount`.

### Corrigido na Fase 6 (defeito que existia em `main`)

`src/lib/contracts/trust/contract-to-cash.ts` somava
`m.measured_amount ?? m.billing_amount` e apresentava o resultado como "medido".
`billing_amount` é o valor PREVISTO: marco sem apuração contribuía com o
previsto dele. A regra agora mora em
`src/lib/projects/measurements/measured-amount.ts`, com regressão permanente em
`tests/unit/project-measured-amount.test.ts`.

### Deferido DENTRO da Fase 6

- **Corte do Motor de Aprovação para aceite de medição.** Bloqueado por
  governança, não por esforço: não existe política de aceite autoritativa em
  lugar nenhum. `approval_engine_cutover` segue vazia para
  `project_measurement`. O sujeito e a impressão digital já estão registrados —
  falta a REGRA, e inventá-la seria fabricar governança.
- **Aceite parcial / glosa.** A §72 manda só modelar com evidência de negócio
  real. Não há nenhuma. `accepted_quantity` e `accepted_value` existem
  congelados; a divisão entre submetido, aceito e glosado não foi criada.
- **Semântica declarada nas regras reais.** `measurement_basis`,
  `accumulation_mode`, `aggregation_mode` e `cadence` nascem `UNKNOWN` e a
  prontidão devolve UNKNOWN enquanto assim estiverem. Preencher exige leitura
  dos contratos reais — é trabalho de dado, não de código.
- **Vinculação automática de evidência em produção.** O módulo
  `evidence-acquisition.ts` está pronto e testado, mas nenhuma rota o executa
  em lote ainda: falta projeto real com medição para acionar.
- **Aba de propostas de mapeamento.** Propostas com `review_state='proposed'`
  são gravadas e ficam inertes; não há tela para revisá-las.
- **Recomputo agendado.** Os dois tipos de trabalho
  (`projects.measurements.reconcile_candidates` e `...recompute_readiness`)
  estão registrados com handler, mas não há entrada de cron chamando
  `projects_enqueue_measurement_reconciliation`.
- **Limpeza do legado.** `contract_milestones.measured_amount` e
  `billing_amount` permanecem. A §70 proíbe removê-los antes de evidência de
  produção provar que é seguro.
- **Procedência do valor no evento de faturamento (Fase 7).**
  `createBillingEventFromMilestone` monta o valor com
  `measured_amount ?? billing_amount`. Isso NÃO viola a §12 — o que se está
  compondo ali é o valor a FATURAR, e `billing_amount` é o previsto em
  contrato, que é o significado dele. O que falta é registrar QUAL das duas
  fontes deu o número: hoje "faturado pelo previsto" e "faturado pelo medido"
  ficam indistinguíveis depois do fato. Corrigir exige mexer na cadeia de
  faturamento, que é fronteira da Fase 7.

### Prova de fluxo REAL — bloqueada por dado

`REAL PRODUCTION MEASUREMENT FLOW PROVEN = BLOCKED_BY_REAL_DATA`.

O motor está completo e provado ponta a ponta contra organização descartável.
A prova REAL exige um projeto de produção com: vínculo explícito ao contrato,
regra de medição cadastrada, mapeamento de cronograma, evidência de execução e
fonte de aceite autoritativa. Em produção existe UM vínculo Projeto↔Contrato, e
ele aponta para um contrato `data_class = 'demo'`; `contract_measurement_requirements`
tem zero linhas. Nenhuma dessas ausências é corrigível por código.
