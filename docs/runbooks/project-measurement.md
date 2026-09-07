# Runbook — Medição de Projeto (Contracts V2, Fase 6)

Migrations 130–134. Este documento é operacional: o que rodar, o que olhar
quando algo parecer errado, e o que **não** fazer.

---

## 1. A cadeia, em uma tela

```text
regra contratual        contract_measurement_requirements   (Contratos)
  ↓  mapeamento GOVERNADO
etapa de cronograma     contract_measurement_rule_timeline_mappings
  ↓  materialização determinística
medição PLANEJADA       project_measurements                 (Projetos)
  ↓  evidência
pacote                  project_measurement_evidence + _requirements
  ↓  prontidão
READY / BLOCKED / INCOMPLETE / NOT_APPLICABLE / UNKNOWN
  ↓  submissão
SUBMITTED
  ↓  aceite AUTORITATIVO (nunca automático)
ACCEPTED  →  projects.measurement.accepted  →  Fase 7
```

---

## 2. Habilitar medição para um contrato

Nada acontece sozinho, e a ordem importa. Cada passo é uma pré-condição real
do seguinte — pular um faz a prontidão devolver `UNKNOWN`, que é o
comportamento correto, não uma falha.

1. **Vincular projeto ao contrato.** Sem linha em `contract_project_links`, a
   medição nem pode ser inserida — a FK composta recusa. Não há casamento por
   nome nem por cliente, por desenho.

2. **Cadastrar a regra de medição** em `contract_measurement_requirements`,
   com a proveniência contratual (cláusula, documento ou referência) e a
   semântica:

   | coluna | o que declara | deixar `UNKNOWN` significa |
   |---|---|---|
   | `cadence` | de quanto em quanto tempo | nenhum candidato é criado |
   | `measurement_basis` | quantidade, percentual, marco, monetário | prontidão fica UNKNOWN |
   | `accumulation_mode` | incremental ou cumulativa | prontidão fica UNKNOWN |
   | `aggregation_mode` | como várias medições somam num marco | valor agregado fica UNKNOWN |

   `UNKNOWN` é a resposta honesta enquanto ninguém leu o contrato. Preencher
   com um palpite é pior que deixar em branco: um `INCREMENTAL` presumido soma
   errado e o erro cresce a cada mês.

3. **Mapear a regra a uma etapa do cronograma**, com
   `mapping_source = 'explicit'` e `review_state = 'accepted'`. Proposta de
   sistema (`system_proposed`) fica visível e **inerte** até um revisor humano
   aceitá-la — o CHECK `cmrtm_proposal_needs_review` recusa o contrário.

4. **Materializar os candidatos:**

   ```sql
   SELECT project_measurements_materialize('<organization_id>');
   ```

   Idempotente. Rodar de novo no mesmo dia cria zero.

---

## 3. Rotina agendada

Dois tipos de trabalho, na fila que já existe (`apex_jobs`):

```sql
-- enfileira a reconciliação de candidatos por inquilino
SELECT projects_enqueue_measurement_reconciliation(current_date, 180);

-- recomputo incremental de prontidão
SELECT projects_recompute_measurement_readiness('<org>', now() - interval '1 day', 200);
```

Ambos são limitados por desenho: horizonte máximo de 730 dias, limite máximo
de 2000 medições por chamada, e `changed_since` para não varrer a carteira
inteira a cada tique.

---

## 4. Diagnóstico — a prontidão não fica pronta

Chame o resolvedor canônico e leia as razões:

```sql
SELECT project_measurement_readiness('<measurement_id>');
```

| razão | o que fazer |
|---|---|
| `RULE_UNRESOLVED` | a regra sumiu, foi removida por aditivo, ou está fora de vigência para o período |
| `TIMELINE_MAPPING_UNRESOLVED` | falta mapeamento **aceito** — proposta pendente não conta |
| `OCCURRENCE_UNRESOLVED` | a ocorrência não pôde ser identificada; não force, investigue a cadência |
| `MEASUREMENT_SEMANTICS_UNKNOWN` | a regra não declara base ou acumulação |
| `MEASUREMENT_VALUE_MISSING` | falta quantidade ou valor apurado na medição |
| `EXECUTION_NOT_OBSERVED` | nenhuma evidência vinculada |
| `MISSING_REQUIRED_REPORT` / `_DOCUMENT` / `_EVIDENCE` | o pacote está incompleto |
| `REQUIREMENT_CERTAINTY_UNKNOWN` | a regra não diz se exige — **lacuna contratual**, não tarefa operacional |
| `OBLIGATION_BLOCKING` | há obrigação com `blocks_billing` em aberto no contrato |
| `WAITING_CUSTOMER_ACCEPTANCE` | já submetida; a bola está com quem aceita |

O cache em `project_measurement_readiness_cache` carrega `computed_at`. Se ele
divergir de `project_measurements.updated_at`, o cache está velho — recompute:

```sql
SELECT project_measurement_recompute_readiness('<measurement_id>');
```

---

## 5. Registrar aceite

Pela RPC, sempre. Não existe caminho de escrita direto — `authenticated` só tem
SELECT nas tabelas de medição.

```sql
-- interno: o ator é a pessoa autenticada, e a RPC o lê sozinha
SELECT project_measurement_accept('<id>', 'internal_reviewer', NULL, 250000, 'BRL');

-- externo: exige PROVENIÊNCIA (parte, documento ou referência)
SELECT project_measurement_accept('<id>', 'signed_bulletin', NULL, 250000, 'BRL',
                                  NULL, 'Boletim de medição 001/2026');
```

**A RPC não tem parâmetro para "quem aceitou".** Se alguém tentar acrescentar
um, ele não existe do outro lado.

### Se o aceite estiver errado

Não existe rollback. A correção é supersessão governada:

```sql
SELECT project_measurement_supersede('<id>', 'motivo registrado');
```

A medição antiga permanece **aceita** na história, marcada como `SUPERSEDED`, e
nasce uma revisão nova em `PLANNED` — sem herdar nenhum fato de aceite. Quem
auditar vê as duas, que é o ponto.

---

## 6. Valor medido — a precedência

```text
1. medição canônica ACEITA
2. contract_milestones.measured_amount  (legado)
3. UNKNOWN
```

```sql
SELECT * FROM contract_milestone_measured_amount('<org>', '<milestone_id>');
```

Devolve o valor **e a fonte**. `billing_amount` nunca entra — nem como último
recurso. Ele é o previsto, e previsto não é apurado.

`UNKNOWN` não é R$ 0. Zero afirma que se mediu e deu zero.

---

## 7. Limpeza de dados descartáveis

Depois de qualquer teste ou fumaça contra produção:

```bash
node scripts/cleanup-contracts-v2-phase6-disposable.mjs           # ensaio
node scripts/cleanup-contracts-v2-phase6-disposable.mjs --apply   # apaga
```

`DELETE FROM organizations` **não basta**: `projects` e `tasks` referenciam a
organização sem cascata, o delete falha, e num bloco com try/catch em volta ele
falha em silêncio. O script varre toda tabela com `organization_id`, em passes,
e confere a ausência no fim.

---

## 8. O que NÃO fazer

- **Não** semear política de aceite no Motor de Aprovação sem governança real
  documentada. `approval_engine_cutover` está vazia para `project_measurement`
  de propósito. Uma alçada inventada é indistinguível de uma real depois que
  alguém decide contra ela.
- **Não** usar `billing_amount` como valor medido, em lugar nenhum, por
  nenhuma razão. Há regressão permanente cobrindo isso.
- **Não** apagar `contract_milestones.measured_amount` nem `billing_amount`.
- **Não** editar medição aceita direto na tabela. O gatilho recusa
  (`ACCEPTED_IMMUTABLE`), e contorná-lo pelo dono do banco destruiria a
  auditoria.
- **Não** criar medição, contrato ou projeto de demonstração no inquilino real
  para mostrar a tela funcionando.
- **Não** escrever Fiscal ou Financeiro a partir de medição. Isso é Fase 7.

---

## 9. Verificação rápida de saúde

```sql
SELECT
  (SELECT count(*) FROM project_measurements)                            AS medicoes,
  (SELECT count(*) FROM project_measurements WHERE status='ACCEPTED')    AS aceitas,
  (SELECT count(*) FROM project_measurements
     WHERE occurrence_state='unresolved')                                AS ocorrencia_indefinida,
  (SELECT count(*) FROM project_measurement_readiness_cache
     WHERE overall='UNKNOWN')                                            AS prontidao_desconhecida,
  (SELECT count(*) FROM domain_events
     WHERE event_type='projects.measurement.accepted')                   AS fatos_de_aceite,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE table_schema='public' AND privilege_type='TRUNCATE'
       AND grantee IN ('anon','authenticated'))                          AS truncate_navegador;
```

`truncate_navegador` tem de ser **0**. Sempre.

Um número alto em `prontidao_desconhecida` normalmente não é defeito de
software: é semântica contratual não declarada. Comece pelo passo 2.
