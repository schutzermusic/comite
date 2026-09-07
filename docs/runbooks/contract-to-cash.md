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
- exige a permissão `contracts.billing.release` — que é **capacidade**, não
  autoridade;
- exige que o faturamento seja do inquilino de quem chama (migration 140);
- recomputa a elegibilidade NO ATO;
- exige **governança real**, por uma de duas vias:
  1. **política do Motor de Aprovação** para
     `(contract_billing_event, release, RELEASE)` → estado vai a
     `PENDING_RELEASE` e a decisão é aplicada por handler, conferindo a
     impressão digital;
  2. **autoridade declarada** em `contract_billing_release_authorities`, com
     evidência (ata, procuração, carta de delegação, cláusula, política
     interna) → estado vai a `RELEASED`, e a linha de história registra **qual**
     autoridade sustentou o ato.

Sem nenhuma das duas, a chamada recusa com `RELEASE_AUTHORITY_NOT_CONFIGURED`.

> **Estado atual em produção: governança de liberação NÃO CONFIGURADA.**
> Não há política de aprovação em inquilino nenhum e a tabela de autoridade
> está vazia. Um faturamento pode estar `ELIGIBLE` e continuar não liberável —
> as duas coisas são distintas, e a tela diz isso por extenso.

### Por que não basta ter a permissão

A migration 136 concedia `contracts.billing.release` e `contracts.billing.adjust`
a três papéis globais (`owner_admin`, `juridico_contratos`, `financeiro`) na
própria migration, e aceitava `current_user_is_admin()` como caminho
alternativo. Isso deduzia **autoridade comercial** do NOME de papéis criados por
uma seed genérica de RBAC.

Liberar faturamento é declarar a um cliente que ele deve. Quem pode fazer isso,
em nome de qual organização e até que valor, é decisão de governança — e a
auditoria da fase já tinha estabelecido que ela não existe em lugar nenhum
(zero políticas, zero alçadas, zero aprovadores nomeados). A migration 141
desfez as concessões, removeu o desvio de administrador e transformou a
ausência num **bloqueio nomeado**.

O vocabulário das permissões permanece: capacidade continua existindo e
continua sendo pré-requisito. O que deixou de existir é a autoridade por
dedução.

### Como configurar a autoridade

Uma pessoa com administração da organização declara a linha:

```sql
INSERT INTO contract_billing_release_authorities
  (organization_id, contract_id, grantee_kind, grantee_user_id,
   max_amount, currency, source_kind, source_reference, justification, declared_by)
VALUES
  (:org, NULL, 'USER', :user_id,
   500000.00, 'BRL', 'BOARD_RESOLUTION', 'Ata 12/2026, art. 3º',
   'Delegação de alçada comercial até R$ 500 mil', :declared_by);
```

- `contract_id` nulo vale para a organização inteira; preenchido restringe ao
  contrato. A declaração mais específica vence.
- `grantee_kind` é `ROLE` **ou** `USER`, nunca os dois — para que revogar uma
  não revogue a outra.
- `max_amount` nulo significa **não declarado**, e a resolução o trata como sem
  teto porque a declaração é explícita e alguém a assinou. Com teto, a moeda
  tem de bater: comparar 10.000 USD com um teto em BRL exigiria política de
  câmbio, que a Fase 7 não inventa.
- `source_kind`, `source_reference` e `justification` são **obrigatórios**: a
  tabela existe para guardar a evidência, não a intenção.
- Quem **declara** não é quem **exerce**: a escrita exige administração da
  organização, e não `contracts.billing.release`. Um outorgado que pudesse
  ampliar a própria autoridade tornaria a declaração prova de nada.

Revogar é `active = false` com `revoked_at`, `revoked_by` e
`revocation_reason` — a linha permanece.

O modelo de leitura expõe `release_governance_state` por evento:
`APPROVAL_POLICY`, `DECLARED_AUTHORITY` ou `NOT_CONFIGURED`. A interface
consulta essa coluna **antes** de oferecer o botão de liberar.

A liberação grava uma **impressão digital** dos fatos exatos. Mudança material
depois disso não reescreve o valor: obriga supersessão
(`contract_billing_supersede`), que preserva o direito antigo.

Cancelar e superar um faturamento **já liberado** exigem a mesma autoridade
declarada. Cancelar um candidato que nunca foi liberado exige só a permissão —
não é ato comercial, é higiene de fila.

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

---

## 15. Fronteira de inquilino das funções SECURITY DEFINER

As migrations 136–138 criaram funções `SECURITY DEFINER` que buscavam a linha
pelo UUID sem conferir o inquilino de quem chamava. Dentro de `SECURITY
DEFINER` a RLS **não se aplica** — a função roda como dona da tabela. Seis
funções vazavam dados entre organizações, e duas delas **escreviam**.

A migration 140 fechou isso. As regras, para toda função nova da cadeia:

- resolver o inquilino do chamador com `apex_browser_organization()`;
- **nunca** usar `current_user` para isso — dentro de `SECURITY DEFINER` ele é
  a dona da função, não quem chamou. A identidade que sobrevive é a
  reivindicação JWT que o PostgREST grava do token verificado;
- responder a divergência de inquilino com a **mesma forma** que a ausência
  genuína produz — duas respostas distintas contariam, a quem tem um UUID na
  mão, que aquele registro existe em algum lugar;
- perfil ausente **nega** (`TENANT_UNRESOLVED`); comparar contra `NULL` e
  seguir é como o furo nasce;
- revogar EXECUTE de `anon` **e** `authenticated` explicitamente. `REVOKE ...
  FROM PUBLIC` não basta: o projeto concede EXECUTE aos dois papéis por
  `ALTER DEFAULT PRIVILEGES` quando a função nasce, e foi assim que
  `contract_billing_fingerprint` e `fiscal_documents_emit_lifecycle` ficaram
  executáveis por `anon` em produção.

`contract_billing_recompute_eligibility` saiu inteiramente do alcance do
navegador: ela **muta** (estado, história, fato). Quem materializa a projeção
são os caminhos governados — a liberação, que recomputa dentro da própria
transação, e o trabalho de fila que reage à medição aceita. A tela usa
`contract_billing_eligibility_resolve`, que é somente-leitura.

Prova permanente: `tests/integration/contracts-phase7-cross-tenant-live.test.ts`
— duas organizações, chamadas emitidas como `authenticated` de verdade, e toda
RPC exposta tentada com UUID alheio, em leitura e em escrita.
