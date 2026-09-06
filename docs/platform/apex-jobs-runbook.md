# Apex Jobs — runbook do trabalhador e do grafo de eventos

Infraestrutura da Fase 4 (migrations 119–122). Este documento é operacional: o
desenho e as razões estão em `plan/contracts-v2/architecture.md` §11.1 e nos
cabeçalhos das próprias migrations.

---

## 1. O que existe

| Peça | Onde |
| --- | --- |
| Fatos duráveis | `domain_events` (119) |
| Registro estático de rotas | `apex_event_routes` (119) — hoje vazio |
| Provedores dinâmicos de rota | `apex_dynamic_route_providers` (120) |
| Fila de trabalho | `apex_jobs` (120), lote corrigido na 124 |
| Vínculo de ativação de obrigação | `contract_obligation_event_bindings` (121) |
| Pedido durável de extração | `contract_clause_extraction_requests` (122) |
| Trabalhador | `src/lib/platform/jobs/worker.ts` |
| Entrada de execução | `POST /api/platform/jobs/drain` |
| Saúde | `GET /api/platform/jobs/health` |
| Agendador | `.github/workflows/apex-jobs.yml` (`*/10 * * * *`) |
| Caminho rápido | `after()` — `src/lib/platform/jobs/fast-path.ts` |

---

## 2. Configuração necessária

Sem estes dois, a cadência de dez minutos **não roda** — o workflow falha alto
em vez de fingir que drenou:

| Nome | Onde | O quê |
| --- | --- | --- |
| `APEX_JOBS_SECRET` | GitHub → *Secrets* **e** Vercel → *Environment Variables* | O mesmo valor nos dois lados. Segredo PRÓPRIO da plataforma — não reutilize `CRON_SECRET`, que é do Ponto: compartilhá-lo faria quem pode acordar o cron do Ponto poder drenar a fila do Apex. |
| `APEX_SITE_URL` | GitHub → *Variables* | Origem pública do app, sem barra final. |

Enquanto `APEX_JOBS_SECRET` não estiver na Vercel, a rota responde **503** —
ela se recusa a rodar sem portão, em vez de rodar aberta.

Fallback declarado: se `APEX_JOBS_SECRET` não existir no servidor, a rota aceita
`CRON_SECRET`. Isso existe para que um ambiente ainda não migrado não fique com
a fila parada e sem explicação; não é o estado desejado.

---

## 3. Operação normal

Uma passagem faz, nesta ordem:

```text
1. ceifa concessões vencidas       trabalho abandonado volta a ser visível
2. roda produtores agendados       o que nasce do tempo entra na fila
3. roteia eventos não roteados     o que nasce de fato vira trabalho
4. reivindica e executa            até 25 trabalhos ou 50 segundos
```

Se sobrar trabalho, a passagem **para de propósito**. O que sobra é durável e a
próxima batida continua. Contadores da resposta:

```json
{"reaped_released":0,"reaped_dead_lettered":0,"producers_enqueued":1,
 "events_routed":1,"events_routing_failed":0,"jobs_created":1,"claimed":2,
 "completed":2,"retried":0,"dead_letter":0,"stale_completions":0,
 "duration_ms":6747,"stopped_early":false}
```

Disparo manual:

```bash
curl -sS -X POST "$SITE_URL/api/platform/jobs/drain" \
  -H "Authorization: Bearer $APEX_JOBS_SECRET" \
  -H "x-apex-trigger: manual"
```

Saúde:

```bash
curl -sS "$SITE_URL/api/platform/jobs/health" -H "Authorization: Bearer $APEX_JOBS_SECRET"
```

---

## 4. Como ler a saúde

| Campo | Quando preocupa |
| --- | --- |
| `due_pending_jobs` | Cresce sem parar entre batidas → o agendador não está rodando. |
| `oldest_pending_age_seconds` | Muito acima de 600s → idem. |
| `processing_jobs` | Estável e alto → trabalho travado; ver `expired_leases`. |
| `expired_leases` | > 0 logo depois de uma batida → o ceifador não está alcançando o volume. |
| `dead_letter_jobs` | Qualquer crescimento merece inspeção. Não some sozinho, de propósito. |
| `unrouted_events` | Cresce → o roteamento não está rodando, ou o lote é pequeno demais. |
| `failed_routing_events` | > 0 → há consumidor numa versão de schema diferente da do fato. |

`failed_routing_events` **não** é lixo: é um consumidor que ficou para trás de
uma mudança de schema. O evento continua lá, esperando decisão explícita.

---

## 5. Carta morta

`DEAD_LETTER` é estado de **infraestrutura**. Ele diz que o Apex não conseguiu
executar um trabalho — **nunca** que uma obrigação contratual foi descumprida.
Nenhum relatório de negócio deve ler esta coluna.

Inspecionar (sem payload, só o necessário para decidir):

```sql
SELECT * FROM public.apex_jobs_dead_letters(50);
```

Reprocessar, depois de entender a causa:

```sql
SELECT public.apex_jobs_replay('<job_id>', 3);
```

O reprocessamento devolve o trabalho à fila **sem apagar a falha anterior** — a
história do erro é o que explica por que alguém reprocessou. Cartas mortas não
são apagadas automaticamente.

---

## 6. Sintomas e causas

**A fila não anda.**
Confira, nesta ordem: o workflow rodou (aba Actions)? `APEX_JOBS_SECRET` está
nos dois lados? A rota responde 503 (segredo ausente) ou 401 (segredo
divergente)? Nada disso perde trabalho — só o adia.

**Um trabalho fica voltando.**
`last_error_code` diz o quê. Se for `http_429` ou `transient`, é o provedor e o
recuo exponencial está fazendo o trabalho dele. Se for `unclassified`, a falha
não foi reconhecida e o padrão é NÃO repetir — o trabalho já está em carta morta
na primeira tentativa, por desenho.

**Um trabalho ficou `PROCESSING` para sempre.**
Não fica: o ceifador o devolve quando a concessão vence (300s por padrão). Se
persistir, `expired_leases` na saúde vai mostrar.

**Um lote maior que o pedido.**
Não acontece mais desde a 124, e a causa vale ser lembrada: uma subconsulta com
`LIMIT` do lado interno de um laço aninhado é REEXECUTADA por linha externa, e
com `SKIP LOCKED` cada reexecução devolve outras tantas. A seleção agora é uma
CTE `AS MATERIALIZED`. Se algum dia o lote voltar a estourar, olhe o plano antes
de olhar o código.

**Duas batidas ao mesmo tempo.**
Seguras. A reivindicação usa `FOR UPDATE SKIP LOCKED` e devolve conjuntos
disjuntos; a idempotência de trabalho impede que dois roteamentos criem dois
trabalhos.

**Um trabalhador concluiu algo que outro estava fazendo.**
Não pode: concluir exige o `lock_token` corrente, e o ceifador invalida o antigo.
Um trabalhador que dormiu recebe `false` e registra `stale_lease`.

---

## 7. Nomes: fatos e trabalhos

**Fato** (`domain_events.event_type`) — o que JÁ aconteceu:

```text
<domínio>.<entidade>.<fato_no_passado>
contracts.obligation.instance_activated
```

**Trabalho** (`apex_jobs.job_type`) — o que ainda PRECISA acontecer:

```text
<domínio>.<entidade>.<imperativo>
contracts.obligations.materialize
```

Regras que não se negociam por conveniência:

- a versão é a coluna `schema_version` / `payload_version`, **nunca** um sufixo
  `_v2` no nome;
- a chave de idempotência é identidade de NEGÓCIO
  (`obligation-instance:<id>:history:<id>`, `contracts-obligation-materialize:<org>:<YYYY-MM-DD>`),
  nunca um UUID aleatório e nunca o relógio atual;
- payload é **referência**, não conteúdo: ids, no máximo 16 KB, e o banco recusa
  qualquer chave com nome de segredo em qualquer profundidade;
- passagem de tempo não é fato. Não existe evento "ficou vencida": a Fase 3
  deriva urgência de (estado, prazo, data da pergunta).

Para adicionar um fato novo: declare o tipo em
`src/lib/platform/events/registry.ts` com schema versionado, e emita-o na MESMA
transação da mutação autoritativa — gatilho na tabela de domínio, ou chamada a
`emit_domain_event` de dentro da transação. Nunca um segundo `INSERT` depois do
`COMMIT`.

Para adicionar um trabalho novo: declare o tipo e o schema em
`src/lib/platform/jobs/registry.ts`, escreva o handler em `handlers.ts`
declarando por escrito **em que a repetição deixa de ter efeito** — a entrega é
at-least-once — e ligue-o por rota estática (`apex_event_routes`) ou por
produtor agendado (`producers.ts`).

---

## 8. Verificar depois de um deploy

```bash
npx tsx scripts/smoke-apex-jobs.ts
```

Ele cria uma organização DESCARTÁVEL, atravessa fato → rota → trabalho →
handler → efeito → fato causal, exercita a materialização agendada e o pedido de
extração, e apaga tudo. Nenhum dado de negócio é fabricado em inquilino real.
