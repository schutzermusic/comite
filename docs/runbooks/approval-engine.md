# Motor de Aprovação da Plataforma — runbook

Entregue na Fase 5 dos Contratos V2. Migrations **125–129**.

Plataforma é dona. Contratos é o **piloto**, não o dono.

---

## 1. O que o motor responde

```text
QUE decisão foi pedida?     approval_requests
POR QUE?                    request_reason, decision_purpose
QUEM podia decidir?         approval_request_steps (elegibilidade COPIADA)
EM QUE ORDEM?               stage_no, approval_request_stages
SOB QUE ALÇADA?             approval_decisions.authority_*
QUE VERSÃO governou?        policy_key + policy_version_no (congelados)
O QUE aconteceu?            approval_decisions (append-only)
QUAL o desfecho?            approval_requests.status
```

`status` é **projeção**. A verdade histórica é `approval_decisions`.

---

## 2. As duas invariantes que não se negociam

**A decisão é uma transação.** Travar o pedido, validar, reavaliar
elegibilidade/SoD/alçada/delegação, reconferir a impressão digital do sujeito,
gravar a decisão imutável, apurar quórum, progredir, finalizar e emitir o fato —
tudo junto ou nada. Não existe caminho de escrita direto: `authenticated` só tem
`SELECT` em pedidos, etapas e decisões.

**O ator vem de `auth.uid()`.** `approval_decide` não tem parâmetro de ator, e
isso não é esquecimento. IA e sistema não decidem.

---

## 3. Fluxo normal

```text
approval_request_create(org, subject_type, subject_id, action_type, purpose, …)
   → CREATED | EXISTING | NO_POLICY | SUBJECT_TYPE_UNSUPPORTED | SUBJECT_NOT_FOUND
approval_decide(step_id, decision, idempotency_key, reason?, delegation_id?)
   → RECORDED | IDEMPOTENT_REPLAY
approval_request_cancel(request_id, reason)
```

`NO_POLICY` é **resposta**, não erro. Ausência de política não é aprovação, e
cabe ao domínio decidir o que fazer com ela.

`idempotency_key` deve ser **estável para a mesma intenção do usuário**. Um UUID
novo a cada clique derrota o mecanismo: a retentativa deixa de ser retentativa.

---

## 4. Códigos de recusa

| código | significado |
|---|---|
| `SOD_REQUESTER` | quem pediu não decide |
| `SOD_SUBJECT_CREATOR` | quem cadastrou o objeto não decide esta etapa |
| `SOD_INCOMPATIBLE_STEP` | já decidiu outra etapa do mesmo `sod_group` |
| `NOT_ACTIVE_MEMBER` | não é membro ativo do inquilino |
| `MISSING_ROLE` / `MISSING_PERMISSION` / `NOT_NAMED_APPROVER` | não elegível |
| `AUTHORITY_AMOUNT_UNKNOWN` | valor desconhecido e a etapa exige alçada |
| `AUTHORITY_CURRENCY_MISMATCH` | moedas diferentes — **não há conversão** |
| `AUTHORITY_LIMIT_EXCEEDED` | acima do teto |
| `DELEGATION_*` | delegação inválida, revogada, vencida ou fora de escopo |
| `SUBJECT_CHANGED` | o objeto mudou depois da abertura do pedido |
| `NO_ELIGIBLE_APPROVER` | nenhuma pessoa elegível — o pedido **não** é criado |
| `NOT_CUT_OVER` | a ação ainda é governada pelo motor legado |

`NO_ELIGIBLE_APPROVER` **não** cai no Admin. Resolver o impasse concedendo a
decisão a quem a política não escolheu é pior que o impasse.

---

## 5. A fronteira de corte

`approval_engine_cutover`, por `(organização, subject_type, action_type)`.

```text
SEM linha  → escreve o motor LEGADO; o compartilhado recusa abrir pedido
COM linha  → escreve o COMPARTILHADO; o legado fica somente-leitura
```

Nunca os dois. Dois gatilhos garantem isso, um de cada lado.

**Hoje a tabela está VAZIA em produção.** A aprovação de contrato continua no
fluxo anterior. Ver `deferred-items.md` para por quê.

### Para cortar (quando houver regra real provada)

1. criar a política e a versão, com estágios e etapas;
2. `SELECT approval_policy_activate(<version_id>)` — valida e barra ambiguidade;
3. conferir o portão da §63: regras identificadas, nenhum limite inventado,
   nenhum aprovador inventado, história legada preservada;
4. inserir a linha em `approval_engine_cutover` com justificativa;
5. a partir daí `contract_approvals` recusa escrita nova e **continua legível**.

Não há passo para apagar a tabela legada, e não deve haver.

---

## 6. Expiração

Duas metades, e a distinção importa:

- **Semântica** — `approval_decide` recusa decisão vencida por conta própria.
  Não depende de agendador. Atraso de fila não concede autoridade.
- **Projeção** — o trabalho `platform.approvals.expire` (fila `apex_jobs` da
  Fase 4) materializa o `EXPIRED`. Chave por `(organização, hora)`.

Expirado **não é** rejeitado. Rejeitado é um parecer; expirado é a ausência de
parecer dentro do prazo.

---

## 7. Eventos emitidos

```text
approval.request.created           approval.request.rejected
approval.stage.opened              approval.request.returned_for_correction
approval.decision.recorded         approval.request.cancelled
approval.request.approved          approval.request.expired
                                   approval.request.superseded
```

Todos na mesma transação da mutação. `approval.request.approved` carrega
`downstream_execution: "not_started"`: **APPROVED é decisão, não execução**. Um
consumidor que falhe não devolve o pedido para `PENDING`.

---

## 8. Verificação e diagnóstico

```bash
# reexecuta a bateria inteira (133 asserções) contra o schema aplicado; ROLLBACK
node scripts/verify-contracts-v2-phase5.mjs

# fumaça em produção, organização descartável, apagada ao final
npx tsx scripts/smoke-approval-engine.ts

# concorrência real (duas conexões)
npx vitest run tests/integration/platform-approval-engine-live.test.ts

# a fronteira escrita no código
npx vitest run tests/integration/contracts-phase5-security-contract.test.ts
```

### Armadilha conhecida: o pooler

`SUPABASE_DB_URL` aponta para o PgBouncer em modo **transação** (porta 6543).
Um `set_config('request.jwt.claims', …, false)` de sessão pode não estar lá na
instrução seguinte, e o sintoma não é erro de conexão — é `auth.uid()`
devolvendo **outra pessoa**. Passe a identidade na MESMA instrução:

```sql
WITH actor AS (SELECT set_config('request.jwt.claims', $1, true))
SELECT public.approval_decide($2,$3,$4) FROM actor
```

---

## 9. Consultas úteis

```sql
-- fila do inquilino
SELECT request_id, subject_label, policy_key, policy_version_no,
       current_stage_no, open_hours
  FROM approval_request_read_model WHERE status='PENDING' ORDER BY requested_at;

-- por que ALGUÉM não pode decidir (só o próprio, pelo navegador)
SELECT * FROM approval_step_eligibility_for_viewer('<step_id>');

-- histórico legado, declarado como legado
SELECT * FROM contract_approvals_legacy_history WHERE contract_id = '<id>';
```
