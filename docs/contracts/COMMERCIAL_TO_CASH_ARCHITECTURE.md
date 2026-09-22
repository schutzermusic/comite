# Comercial → Trabalho autorizado → OS interna → Projeto → Medição → Faturamento

> Migrations 197–209. Este documento explica **por que** o desenho é este.
> O que cada objeto faz está nos comentários das próprias migrations.

---

## 1. O problema

Até a migration 196, tudo que executava pendia de `contracts`:

- `project_measurements.contract_id` era `NOT NULL`;
- a regra de medição morava em `contract_measurement_requirements`, ligada a contrato;
- o direito de faturar nascia de `contract_billing_events`, ligado a contrato.

Enquanto todo trabalho autorizado vinha de contrato formal, isso era **verdade
observada**, não modelo. Deixou de ser: a Insight executa trabalho autorizado
por **proposta aceita**, por **pedido de compra** e por **autorização formal do
cliente** — sem instrumento contratual.

As duas saídas óbvias eram ruins:

| Saída | Por que não |
|---|---|
| Criar um contrato de mentira para o trabalho caber na coluna | O dossiê passaria a exibir um contrato que ninguém assinou, e a carteira contaria um instrumento inexistente |
| Criar `proposal_measurements` / `proposal_approvals` / `proposal_billing` | Duas máquinas de estado para a mesma pergunta, duas filas de aprovação, dois lugares para "o cliente aceitou?" |

## 2. A saída: trocar o âncora, não duplicar o motor

`commercial_engagements` é o **pai neutro**: representa trabalho autorizado,
seja qual for o papel que o autorizou. O contrato formal deixa de ser o pai e
passa a ser **uma** das fontes de autorização — a mais forte quando existe,
ausente quando não existe.

```
commercial_engagements                       ← o pai neutro
  └── commercial_engagement_authorizations   ← contrato | proposta aceita | pedido | autorização
        ├── formal_contract      → contracts
        ├── accepted_proposal    → commercial_proposal_revisions (status = ACCEPTED)
        ├── customer_po          → contract_documents / referência externa
        └── customer_authorization
  └── engagement_project_links   ← o vínculo generalizado
  └── internal_service_orders    ← autorização OPERACIONAL da Insight
        └── projects
              └── project_measurements   ← A MESMA tabela de sempre
                    └── contract_billing_events  ← O MESMO motor de sempre
```

`project_measurements.engagement_id` é `NOT NULL` **sempre**; `contract_id`
virou opcional. As FKs compostas antigas continuam valendo para toda linha que
tenha contrato; as novas valem para todas.

## 3. Uma fonte REGE; as outras ficam registradas

`commercial_engagement_authorizations.governing` — uma por trabalho, garantida
por índice parcial. Uma fonte nova **nunca** passa a reger por ter chegado.

Quando um contrato formal chega depois de uma proposta aceita já reger
(cenário D do escopo), ele:

1. entra no **mesmo** trabalho autorizado (nenhuma segunda relação de negócio);
2. entra com `governing = false`;
3. é **confrontado** com a fonte regente, e a divergência de valor abre como `BLOCKING`;
4. só passa a reger por `commercial_engagement_set_governing`, que **exige motivo escrito**.

O confronto tem um caminho só (migration 208/209): o gatilho de inserção de
contrato e a porta manual chamam a mesma
`commercial_authorization_detect_divergences`.

## 4. Nada de fato vira regra sem âncora e sem gente

`commercial_extracted_facts` guarda o que a leitura assistida encontrou, com
documento, revisão, página, seção, trecho literal e confiança.

- `provenance_state = 'ANCHORED'` exige **página E trecho literal** — e é
  derivado por `CHECK`, nunca informado pelo provedor;
- `commercial_fact_promotable(id)` só é verdadeiro com âncora **e** confirmação
  humana.

É assim que *"never fabricate missing rules"* deixa de ser recomendação e vira
constraint. Um fato que a IA deduziu sem apontar onde leu continua visível e é
estruturalmente incapaz de virar regra de medição ou condição de faturamento.

## 5. Em análise ≠ autorizado

Toda entrada nasce `UNDER_ANALYSIS`, inclusive o contrato recém-cadastrado
(migration 205). Enquanto está em análise:

- aparece na Carteira — alguém precisa olhar;
- **não** entra em valor autorizado nem em backlog;
- `authorized_value` é `NULL`, e `ce_value_needs_authorization` impede que seja
  preenchido antes da revisão.

A promoção a `AUTHORIZED` é ato humano com permissão própria, e o valor é
**derivado** da fonte regente — nunca digitado à parte.

> Os KPIs antigos não mudaram: eles leem `contracts`, e `contracts` continua com
> o status que a pessoa informou. Quem espera revisão é o número novo.

## 6. O que a Apex pode e o que não pode

| Pode | Não pode |
|---|---|
| classificar, extrair, comparar | aceitar proposta pelo cliente |
| explicar, pré-preencher | aceitar medição |
| recomendar e preparar rascunho | criar aceite do cliente |
| sinalizar ausência de regra | conceder elegibilidade de faturamento |
| detectar divergência | escolher entre fontes conflitantes |

Isto não é disciplina de código. `commercial_proposal_revision_record_outcome`
recusa ator nulo; `project_measurement_accept` recusa aceite interno sem pessoa
autenticada; `internal_service_order_issue` bate no gatilho de divergência;
`commercial_engagement_set_governing` exige motivo escrito.

## 7. Navegação

**Pós-venda** passou de oito destinos (um por objeto de domínio) para cinco
**fases de trabalho**:

`Visão Geral · Carteira · Ordens de Serviço · Medições & Aprovações · Faturamento`

Contrato, proposta, pedido, obrigação, aditivo, renovação, risco e documento
não sumiram: deixaram de ser endereço e passaram a ser **contexto dentro do
item da carteira**. Os slugs antigos continuam resolvendo, e resolvem no
contexto certo (`resolvePostSaleView`).

**Comercial** (pré-venda) tem seis áreas e para de crescer aí:

`Visão Geral · Contas & Contatos · Oportunidades · Follow-ups · Propostas · Forecast`

## 8. O que foi REUSADO em vez de recriado

| Precisava de | Reusou |
|---|---|
| Cadastro de conta/cliente | `parties` + `party_roles` |
| Cobrança do que ficou combinado | `apex_followups` (156/157/162/163) |
| Extração de documento | `ApexAIGateway` + `apex_jobs` + `contract_onboarding_intakes` (generalizada com `document_context`) |
| Proveniência de IA | colunas da 152 |
| Acervo de documento canônico | `contract_documents` (generalizada para pender do pai) |
| Medição, revisão, aceite, faturamento | `project_measurements` e `contract_billing_events`, intactos |

Nenhuma tabela paralela de medição, aprovação ou faturamento foi criada — e a
prova E2E verifica isso explicitamente.

## 9. Como verificar

```bash
node scripts/commercial/e2e-proof.mjs        # 64 provas, cenários A–D, sempre ROLLBACK
node scripts/commercial/security-audit.mjs   # RLS, RBAC, inquilino, fabricação
```

`e2e-proof.mjs` roda contra **dados reais**, dentro de uma transação, e sempre
termina em `ROLLBACK`. Nenhum estado de produção é alterado.

---

# Endurecimento de produção (migrations 211, sessão de estabilização)

## 10. A alçada do módulo Comercial

`/comercial` respondia **"Esta ação exige: commercial.view"** para todo mundo,
inclusive para `owner_admin`.

Causa: as onze permissões `commercial.*` foram cadastradas (198/199/200) e
nenhuma foi concedida a papel. A 192 estabeleceu, com razão, que conceder
permissão a papel é ato de quem administra o inquilino — mas aquilo valia para
uma chave NOVA dentro de um módulo que já abria. Um MÓDULO novo sem grant não
abre para ninguém, e a tela `/roles` desta base ainda é mock: não havia
caminho para conceder.

A 211 concede espelhando a alçada que cada papel já exerce:

| Papel | Recebe | Porque |
|---|---|---|
| `owner_admin` | os 11 | administra o inquilino; já detém os outros 19 módulos |
| `ceo_diretoria` | 4 | dirige e decide preço |
| `juridico_contratos` | 10 | já cria contrato; governa proposta, documento e OS |
| `gestor_projetos` | 3 | já cria projeto; é a passagem OS → Projeto |

`financeiro`, `engenharia_pcp`, `rh` e `ponto_field_worker` **não recebem
nada**. Ver contrato assinado não é ver funil de vendas com preço e
probabilidade.

## 11. O portão de ambiente do gate de sessão

`requireCommercialSession` lia os papéis **sem filtrar pela organização**,
enquanto `current_user_has_permission` — o resolvedor que a RLS usa — exige
`user_roles.organization_id = current_user_organization_id()`.

Numa rota de leitura a diferença seria só desagradável. Numa de ESCRITA era um
furo: as funções governadas rodam pelo `service_role`, que não passa por RLS.
Alguém com papel na organização A, operando na B, escreveria na B.

Corrigido: a organização ativa é resolvida **antes** da permissão, a consulta
é escopada por ela, e o resultado é conferido contra o próprio
`current_user_has_permission` — para que portão e RLS nunca discordem, e para
que `user_permission_overrides` valha nos dois.

## 12. Emissão fiscal real: fecha por padrão

`src/lib/fiscal/server/issuance-guard.ts`.

Uma rodada de suíte viva deixou 17 documentos fiscais no banco. O inventário
mostra o que eles são: `homologation`, provedor `sandbox`, sem
`provider_document_id` e sem chave de acesso. **Nenhuma NFS-e real foi
emitida.** O único motivo, porém, foi a ausência de credencial no ambiente — e
ausência de credencial não é controle.

O portão vem **antes** da leitura de qualquer segredo em
`resolveDocumentProvider`, e:

* fecha por padrão (`ALLOW_REAL_FISCAL_ISSUANCE` ausente = bloqueado);
* é de servidor — sem `NEXT_PUBLIC_`, de propósito;
* sob runner de teste permanece fechado **mesmo com a variável ligada**;
* não toca sandbox nem homologação, que continuam inteiros.

Ele não é o módulo Fiscal e não muda a máquina de estados fiscal.

## 13. Higiene das suítes vivas

O acúmulo de fixture (organizações, contratos, recebíveis) tinha uma causa
concreta: o `ON DELETE RESTRICT` da 197 e o gatilho append-only da 200
abortavam a varredura de inquilino no meio. As migrations **207** e **210**
corrigiram as duas.

A prova é medida, não afirmada: `scripts/commercial/fixture-drift-probe.mjs`
fotografa as contagens antes e depois de uma suíte. Hoje a diferença é zero.
