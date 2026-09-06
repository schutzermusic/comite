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

## Phase 4 — Event Graph
Deferred:
- domain_events
- transactional outbox
- apex_jobs
- SKIP LOCKED claim
- lock expiry/reaper
- scheduler
- queued clause extraction

## Phase 5 — Shared Approval Engine
Deferred:
- approval_policies
- approval_requests
- approval_steps
- approval_decisions
- approval_delegations
- atomic decision RPC
- migration from module-specific approval engines

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
