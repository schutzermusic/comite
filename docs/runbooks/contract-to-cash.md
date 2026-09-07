# Contrato-a-caixa — runbook operacional (Fase 7)

Este documento descreve o que a Fase 7 entregou, o que ela deliberadamente
NÃO entregou, e o que precisa ser configurado por gente antes de a cadeia
funcionar de ponta a ponta com dado real.

Migrations: **135–139**. Registro de migrations na ponta **139**.

---

## 1. A cadeia, e os donos de cada elo

```text
medição ACEITA (Projetos)
   → candidato / direito de faturar (Contratos)
   → elegibilidade com motivos (Contratos)
   → liberação governada (Contratos, por pessoa)
   → pedido de documento fiscal (ponte)
   → rascunho e autorização de NFS-e (Fiscal)
   → Contas a Receber (Finanças)
   → liquidação (Finanças)
   → conciliação bancária (Finanças)
   → modelo de leitura contrato-a-caixa (Contratos lê)
```

Duas regras absolutas, escritas no esquema e provadas por teste:

- **Contratos nunca escreve `fiscal_documents`.** Ele grava um PEDIDO
  (`contract_billing_fiscal_requests`); quem cria rascunho é o serviço do
  Fiscal (`src/lib/fiscal/server/billing-intake.ts`).
- **Contratos nunca escreve Finanças.** Contas a Receber, liquidação,
  conciliação e razão são criados por funções de Finanças, inalcançáveis pelo
  navegador.

---

## 2. Procedência do valor — a regra que não tem exceção

Todo valor faturável carrega a FONTE:

| `amount_source`              | Significado                                              |
|------------------------------|----------------------------------------------------------|
| `ACCEPTED_MEASUREMENT`       | Medição canônica aceita (Fase 6)                          |
| `LEGACY_MEASURED_AMOUNT`     | `contract_milestones.measured_amount`, legado             |
| `FIXED_CONTRACT_ENTITLEMENT` | Regra em `contract_billing_entitlement_rules`             |
| `GOVERNED_ADJUSTMENT`        | Ajuste comercial explícito                                |
| `UNKNOWN`                    | Não apurado — nunca faturável                             |
| `LEGACY_UNKNOWN`             | Linha anterior à Fase 7, origem não registrada            |

**`billing_amount` não é degrau da precedência.** Ele é o PREVISTO em contrato.
Para que um previsto vire direito, é preciso cadastrar linha em
`contract_billing_entitlement_rules`, com cláusula, documento ou referência
contratual — o CHECK `cber_provenance_required` recusa regra sem origem.

A tela nunca escreve número sem a fonte ao lado. Fonte `UNKNOWN` aparece como
**"Não apurado"**, e não como `R$ 0,00`.

---

## 3. Elegibilidade — o que responde "por que não posso faturar?"

`contract_billing_eligibility_resolve(billing_event_id)` devolve estado e
MOTIVOS legíveis por máquina. Estados: `ELIGIBLE`, `BLOCKED`, `INCOMPLETE`,
`NOT_APPLICABLE`, `UNKNOWN`, `LEGACY`.

Cada motivo carrega `blocking`:

- **bloqueante** — falta DIREITO contratual. Enquanto existir um, o estado
  nunca é `ELIGIBLE`.
- **informativo** — o direito existe, mas o próximo estágio (emissão fiscal,
  lançamento contábil) está sem configuração.

Fontes reais de bloqueio, nenhuma inventada:

- `contract_billing_conditions.condition_type` (extraído do contrato, Fase 2);
- `contract_obligation_definitions.blocks_billing` (extraído, Fase 3);
- `project_measurements.status` e `acceptance_source` (Fase 6);
- `contracts.counterparty_party_id` (parte canônica, Fase 1).

`RETENTION_APPLIES` e `DISPUTE_OPEN` existem no vocabulário e **nunca são
emitidos**: não há esquema de retenção, glosa ou disputa no repositório.
Modelá-los sem semântica real seria inventar.

---

## 4. Liberação — o ato governado

`contract_billing_release(billing_event_id, note)`:

- exige **pessoa autenticada** (`auth.uid()`); sistema, rotina e IA não liberam;
- exige a permissão `contracts.billing.release`;
- recomputa a elegibilidade NO ATO;
- consulta o Motor de Aprovação compartilhado. **Sem política real** (é o caso
  hoje, em todos os inquilinos), a liberação segue por permissão e o estado vai
  direto a `RELEASED`. **Com política**, o estado vai a `PENDING_RELEASE` e a
  decisão é aplicada por handler, conferindo a impressão digital.

A liberação grava uma **impressão digital** dos fatos exatos. Mudança material
depois disso não reescreve o valor: obriga supersessão
(`contract_billing_supersede`), que preserva o direito antigo.

---

## 5. CONFIGURAÇÃO OBRIGATÓRIA — o que falta para a cadeia rodar

Nenhum destes é semeado. Todos exigem decisão humana registrada.

### 5.1 Base do valor do recebível — `finance_receivable_basis_policies`

**Sem esta linha, nenhum Contas a Receber é criado.** A recusa é
`AR_BASIS_UNCONFIGURED`, e é deliberada: `service_amount_cents` não é,
automaticamente, o que entra em caixa — retenção na fonte, deduções e
descontos mudam o valor.

```sql
INSERT INTO finance_receivable_basis_policies
  (organization_id, contract_id, basis, justification, declared_by)
VALUES
  ('<org>', NULL,            -- NULL = política da organização
   'NET_OF_WITHHOLDING',     -- ou GROSS_SERVICE_AMOUNT
                             -- ou NET_OF_WITHHOLDING_AND_DISCOUNTS
   'Contratos de serviço com ISS retido na fonte pelo tomador.',
   '<user_id>');
```

Política de CONTRATO vence a da organização. Escolher errado aqui produz
títulos que nunca fecham — a decisão é do responsável fiscal/contábil.

### 5.2 Mapeamento contábil — `finance_posting_rules`

Sem ele, `ledger_posting_state = 'PENDING_CONFIGURATION'` e nenhum
`ledger_entry` é criado. O título de Contas a Receber continua válido: são
requisitos separados.

```sql
INSERT INTO finance_posting_rules
  (organization_id, purpose, category_id, cost_center_id, business_unit_id,
   justification, declared_by)
VALUES ('<org>', 'AR_RECOGNITION', '<management_category>',
        '<finance_cost_centers.id>', '<business_unit.id>',
        'Reconhecimento de receita de serviço.', '<user_id>');
```

O centro de custo é o **canônico** (`finance_cost_centers`). O `cost_center`
legado não é aceito.

### 5.3 Fiscal

Estabelecimento ativo, perfil fiscal da contraparte, catálogo de serviço e
configuração de provedor. Sem eles o pedido termina em
`BLOCKED_BY_CONFIGURATION`, com os bloqueios nomeados na própria linha.

Quando houver **mais de um** serviço ativo no estabelecimento, a ponte NÃO
escolhe: devolve `FISCAL_SERVICE_SELECTION_REQUIRED`. A escolha define a
tributação e é do Fiscal.

### 5.4 Direito contratual fixo — `contract_billing_entitlement_rules`

Só necessário quando o faturamento não vem de medição.

---

## 6. Recebimento e conciliação — coisas diferentes

**Pago é derivado.** `finance_receivables` não tem coluna de valor pago. A
visão `finance_receivable_balances` calcula `paid_amount_cents`,
`open_amount_cents` e `derived_status` a partir das liquidações válidas
(pagamentos menos os estornados).

- `finance_settlement_record(...)` — registra recebimento. Recusa valor acima
  do saldo com `OVERPAYMENT_REVIEW_REQUIRED`: não há modelo de crédito não
  alocado, e absorver a diferença em silêncio seria pior que recusar.
- `finance_settlement_reverse(...)` — estorna com uma LINHA NOVA. A original
  permanece.
- `finance_payment_source_import(...)` — importa evidência de caixa (OFX, CNAB,
  API, ERP, provedor, comprovante). Idempotente por id externo ou por
  impressão determinística.
- `finance_reconciliation_record(...)` — confere a liquidação contra a
  evidência. Só `DETERMINISTIC_SOURCE_ID` e `MANUAL_GOVERNED` fecham.
  Casamento por semelhança vive em `finance_reconciliation_candidates` e
  **nunca** fecha sozinho.

Registrar pagamento responde "alguém disse que pagou". Conciliar responde "o
banco confirma". A tela mostra as duas separadamente.

---

## 7. Cancelamento, substituição e supersessão

Nada é apagado.

| Evento                        | Efeito                                                    |
|-------------------------------|-----------------------------------------------------------|
| NFS-e cancelada               | alocação vira `CANCELLED`; título vira `CANCELLED`         |
| NFS-e substituída             | alocação vira `REPLACED`, lineage preservada               |
| Faturamento cancelado         | `release_state = 'CANCELLED'`, com motivo obrigatório      |
| Faturamento superado          | sucessor novo apontando para o antigo                      |
| Liquidação estornada          | linha nova de `REVERSAL`; a original permanece             |

As liquidações de um título cancelado **permanecem**: o dinheiro entrou de
verdade, e estornar caixa é outro ato.

---

## 8. Operação diária

```bash
# Ensaio completo (ROLLBACK) — reexecutável a qualquer momento
node scripts/apply-contracts-v2-phase7.mjs

# Provas de concorrência e atomicidade (duas conexões)
npx vitest run tests/integration/contracts-phase7-live.test.ts --no-file-parallelism

# Contrato de segurança (lido do arquivo)
npx vitest run tests/integration/contracts-phase7-security-contract.test.ts
```

Saúde operacional por inquilino:

```sql
SELECT * FROM contract_to_cash_health;
```

Colunas: elegível sem liberar, liberado sem pedido fiscal, fiscal bloqueado por
configuração, nota autorizada sem título, razão bloqueado por configuração,
títulos vencidos e anomalia de saldo negativo.

---

## 9. O que a Fase 7 NÃO fez

- **Retenção, glosa e disputa** — sem semântica real no repositório. O modelo
  de leitura devolve `NOT_APPLICABLE` para as três.
- **Write-off** — sem processo real. A §76 manda deferir.
- **Crédito não alocado / excesso de pagamento** — recusado, não absorvido.
- **Parcelamento estruturado** — o esquema suporta N parcelas; a ponte cria UMA,
  com o vencimento do documento fiscal. `contracts.payment_terms` é texto livre
  e a §39 proíbe derivar data dele.
- **Reconciliação automática com banco real** — não há fonte. O modelo existe e
  é testado com evidência descartável.
- **Módulo de Finanças** — a interface de Finanças continua servida por dados em
  memória. A Fase 7 não a reescreveu: criou o caminho canônico ao lado, e a
  §128 autoriza a coexistência.
- **`apar_title`** — endurecida (organização, RLS, FKs) mas **não** ampliada. O
  caminho novo usa `finance_receivables`.

---

## 10. Defeito legado conhecido

`apar_title.project_id` e `ledger_entry.project_id` são `uuid`; `projects.id`
é `text`. As colunas nunca puderam referenciar projeto nenhum. As duas tabelas
estão vazias, então converter seria seguro — e não foi feito porque a coluna é
lida por código de folha e rateio fora do escopo auditado desta fase. O caminho
canônico (`finance_receivables.project_id`) nasce `text`, com FK composta real.
