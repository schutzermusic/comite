# Auditoria de implementações de aprovação — Fase 5

Levantada antes de qualquer migration, como a §5 exige. Estado do banco e do
repositório em `main = fe88795` (após o merge da Fase 4).

Serve para uma coisa: decidir o que migrar e o que **não** migrar. A §7 proíbe
big-bang, e a §34 proíbe fabricar governança. As duas conclusões abaixo saem
daqui.

---

## 1. Contratos — o piloto

| dimensão | achado |
|---|---|
| tabelas | `contract_approvals` |
| rota / RPC | nenhuma RPC. `submitContractApproval` faz **upsert do navegador** (`contract-service.ts`) |
| estados | `pending`, `under_review`, `approved`, `rejected` |
| ordem | `contract_approval_step_order()` — `juridico → financeiro → comite → diretoria`, IMMUTABLE |
| autoaprovação | **sim, protegida**: `enforce_contract_approval_safety` barra o CRIADOR DO CONTRATO em decisão terminal |
| SoD | apenas a acima. Não há requerente, logo não há SoD de requerente |
| alçada | **nenhuma** |
| delegação | **nenhuma** |
| quórum | **nenhum** |
| histórico | **mutável** — o upsert sobrescreve a linha; não há registro append-only |
| uso em produção | **3 linhas, 1 contrato, `data_class = 'demo'` (`[QA] Contrato de Serviços`)** |
| cutover | **BLOQUEADO** — ver §3 |

Observações que importam para a migração:

- `reviewer_user_id` acumula DOIS papéis (designado e decisor). A visão legada
  não finge que são duas colunas.
- Quais etapas um contrato exige nunca foi governado: a rota é o conjunto de
  linhas que alguém criou à mão. O gatilho diz isso por escrito
  (*"só etapa REGISTRADA conta"*).
- `created_by IS NULL` deixa a SoD passar, deliberadamente, para não tornar
  contrato legado inaprovável. Documentado na própria função.

## 2. Demais domínios — mapeados, NÃO migrados

| domínio | tabela / coluna | linhas | motor? |
|---|---|---|---|
| Deliberações | `deliberations`, `deliberation_votes` | 0, 0 | votação por estágio em `jsonb`; sem uso |
| Ponto / Jornada | `journey_balance_approvals` | 0 | decisão simples `decided_by`; sem uso |
| Ponto / Apontamento | `time_entries.approved_by`, `auto_approved` | 0 | coluna, não motor |
| Diárias | `allowance_weeks`, `allowance_adjustments`, `allowance_eligibility_overrides`, `allowance_payment_batches` | — | colunas `approved_by`; gatilhos protegem linha aprovada |
| Folha | `payroll_batch`, `payroll_closing_batches`, `payroll_attachments`, `payroll_email_packages`, `payroll_generated_reports` | — | colunas `approved_by` |
| Finanças | `ledger_entry.approved_by/approved_at` | — | coluna |
| Fiscal | `fiscal_documents.approved_by/approved_at/authorized_at` | — | estado do documento + portão de produção |
| Projetos | `project_allocations.approved_by`, `allocation_rule.approved_by` | — | coluna |
| Contratos (docs) | `contract_documents.approved_by/approved_at` | — | coluna |

Nenhum deles é um motor com política, ordem, alçada ou histórico. São **colunas
de carimbo**. Migrá-los exigiria a mesma auditoria de regra real que Contratos
exigiu — e a §7 diz explicitamente para não fazer isso agora.

Permissões pré-existentes que continuam válidas e intocadas:
`contracts.approve`, `finance.approve`, `fiscal.approve`,
`deliberations.approve`, `minutes.approve`, `risks.approve_mitigation`,
`people.timesheet_approve`, `people.attendance_approve`,
`allowances.finance_approve`, `allowances.override_approve`.

## 3. A conclusão que bloqueia o corte

Não existe **uma única aprovação de contrato real** no banco: as três linhas
são de um contrato `demo`.

Não existe, em lugar nenhum — banco, repositório ou documento — **alçada,
limite por valor, quórum, delegação ou aprovador nomeado**.

O que É autoritativo e foi preservado:

```text
vocabulário de etapas   juridico, financeiro, comite, diretoria
ordem entre elas        contract_approval_step_order()
SoD da Fase 0           quem cadastrou o contrato não decide
```

A §34 diz o que fazer com isso: completar a infraestrutura, validar com
política e organização **descartáveis**, e **PARAR** antes de declarar corte
real. Foi o que se fez. `approval_engine_cutover` está vazia em produção.

Para desbloquear é preciso o que código nenhum produz: alguém com autoridade
declarando quais etapas cada contrato exige, sob que valor, e quem decide.
