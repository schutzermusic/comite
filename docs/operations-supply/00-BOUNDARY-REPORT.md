# Operações + Supply Chain — Relatório de Fronteiras (Wave A)

Fonte arquitetural: `plan/insight-apex-ops-supply-md/00…06`.
Este relatório é o resultado da fase de *discovery* exigida antes de qualquer
mudança estrutural. Ele diz o que já é canônico, o que será estendido, o que
nasce e por quê.

## 1. Estado de partida

| Item | Valor |
|---|---|
| Branch | `feat/operations-supply-chain-foundation` (14 commits à frente de `main`, 0 atrás) |
| HEAD | `d4ed451 Add unified commercial proposal contexts and package acceptance` |
| Árvore suja | somente `plan/insight-apex-ops-supply-md/` (não rastreado, do usuário — não é tocado) |
| Banco hospedado | migrations aplicadas até **217** (`supabase_migrations.schema_migrations`) |
| `main` | migrations até 168; 169–217 foram aplicadas a partir da branch (prática estabelecida via `scripts/apply-*.mjs`) |
| Worktree Fiscal | `feat/fiscal-autonomous-invoicing`, migrations até 168; faixa **220–229 reservada** |
| Baseline de qualidade | `tsc` limpo · 133 arquivos / 2819 testes unitários verdes · `eslint src` com 49 erros **pré-existentes** (nenhum nos arquivos novos) |

**Faixa de migrations desta iniciativa: 230–239.** Nenhuma branch/worktree usa ≥ 218.

## 2. O que já é canônico e será REUSADO (não duplicado)

| Conceito do plano | Entidade canônica existente | Decisão |
|---|---|---|
| Contexto de proposta PT+PC | `commercial_proposals.context_id` + `commercial_proposal_context_acceptances` (217) | Fonte do pacote aceito; a OS guarda o id do aceite e as revisões regentes exatas |
| Autorização do cliente | `commercial_engagement_authorizations` (governing) | Portão de emissão continua lendo daqui |
| **OS interna** | `internal_service_orders` (200) + gatilho `iso_issue_gate` + funções governadas | **Estendida**, não recriada. Estados atuais (`DRAFT, PENDING_CONFIRMATION, ISSUED, IN_EXECUTION, SUSPENDED, CLOSED, CANCELLED`) são mantidos — o plano diz "não crie este enum às cegas" |
| Divergência | `commercial_divergences` (`service_order_id`, severidade INFO/WARNING/BLOCKING) | Escopos ampliados; mesma tabela, mesmo portão |
| Extração com proveniência | `commercial_extracted_facts` (já aceita `INTERNAL_SERVICE_ORDER`, página + trecho + IA) + `document-intelligence.ts` + `ApexAIGateway` | Upload de OS usa o mesmo pipeline |
| Planejamento pré-autorização | `commercial_execution_blueprints` / `_items` (199) | Itens viram conteúdo estruturado da OS, com `blueprint_item_id` como proveniência |
| Fechamento comercial | `commercial_execution_start` (213) cria/emite OS e vincula projeto | Preservado; a proveniência do pacote passa a ser capturada por gatilho para **todos** os caminhos |
| Documento | `contract_documents` (pai: engajamento/proposta/contrato) | OS carregada e evidências de recebimento usam este acervo |
| Projeto | `projects` (id texto, JSONB) + `engagement_project_links` + `contract_project_links` | Handoff OS→Projeto já idempotente (`internal_service_order_bind_project`, `FOR UPDATE`) |
| Cronograma / atividades | `project_timeline_items` (WBS, datas planejadas/reais, marcos, dependências em `project_timeline_dependencies`) | **É o Plano de Execução.** Atividade = linha do cronograma. Nenhuma tabela `execution_plan` paralela |
| Medições | `project_measurements` + histórico, evidências, handoff | Fila global de Operações lê os mesmos ids; nenhum workflow novo |
| Riscos | `risks` (`origin`, `reference_id`, `source_module`) | Aba Riscos e alertas usam esta tabela |
| Equipe / Apontamento | `project_allocations`, `people`, `time_entries`, `attendance_punches`, `location_evidence` | Visões contextuais; nenhuma lógica de ponto paralela |
| Localização | `project_canonical_location` (versionada, com evidência) + `project_geofences` | Mapa de Operações lê estes pontos |
| Fornecedor | `parties` + `party_roles` (`role IN ('customer','supplier')`) | **Fornecedor = papel de parte.** A tabela legada `supplier` (UNIQUE global de CNPJ, 0 linhas) NÃO é usada |
| Aprovação | Motor de plataforma `approval_policies/requests/decide` (125–129) | Compras pluga como novos tipos de sujeito; sem política ⇒ aprovação humana explícita e registrada |
| Eventos | `domain_events` + `emit_domain_event` (119) | Fatos de Operações/Supply emitidos na mesma transação; sem rota ⇒ `ROUTED` com 0 rotas |
| Auditoria | `audit_logs` (append-only) + `logAuditEventServer` | Toda rota de escrita registra |
| Proteção de histórico | `contracts_reject_history_erasure()` | Reusado nos livros novos |
| Sessão/autorização de rota | `requireCommercialSession` (org ativa → papéis → overrides) | Reusado pelas rotas de Operações/Supply |

## 3. O que NASCE, e por quê

| Nova entidade | Por que não cabe numa existente |
|---|---|
| `internal_service_order_items` | A OS só tinha `scope_summary`. Escopo, atividades, entregáveis, requisitos, dependências do cliente e exclusões precisam de linhas com proveniência (fato/blueprint/página) e imutabilidade pós-emissão |
| `internal_service_order_revisions` | Histórico imutável do conteúdo material emitido (INV-20). Emendas pós-emissão criam revisão, nunca reescrita silenciosa |
| `internal_service_order_issue_exceptions` | Caminho governado de exceção (INV-04): quem, qual permissão, quais divergências, por quê. `governance_exceptions` é específico de força de trabalho |
| `project_requirements` | Não existe requisito datado por atividade. Tipos: MATERIAL, EQUIPMENT, VEHICLE, WORKFORCE, EXTERNAL_SERVICE, DOCUMENT, CUSTOMER_DEPENDENCY, OTHER |
| `supply_items` (cadastro de material) | Não existe cadastro de item/material |
| `inventory_locations`, `inventory_movements` (livro), `inventory_reservations`, `stock_transfers(+lines)`, `inventory_counts` | Não existe estoque |
| `purchase_requisitions(+lines, +line_requirements)`, `procurement_rfqs(+suppliers)`, `supplier_quotes(+lines)`, `sourcing_decisions`, `purchase_orders(+lines)`, `procurement_approvals` | Não existe compras |
| `goods_receipts(+lines)`, `inbound_shipments` | Não existe recebimento/logística |

**SupplyRequirement não vira tabela.** O requisito MATERIAL confirmado do
projeto *é* a demanda; a cobertura (reservado, em transferência, comprado,
recebido, falta) é **derivada** por visão das reservas/transferências/pedidos
alocados ao requisito (INV-02, §4 de 03_DOMAIN_MODEL). Não há status manual
que possa contradizer a verdade subjacente.

## 4. Permissões

Vocabulário existente: `módulo.ação` e `módulo.subárea.ação`
(`projects.timeline.edit`, `commercial.service_orders.manage`). A emissão/
confronto de OS continua sob `commercial.service_orders.manage` e o handoff sob
`commercial.service_orders.bind_project` — são as chaves canônicas já usadas
pelo fechamento (213). Novas chaves:

- Operações: `operations.view`, `operations.service_orders.override`,
  `operations.planning.view`, `operations.planning.manage`
- Supply: `supply.view`, `supply.plan`, `inventory.view`, `inventory.manage`,
  `inventory.reserve`, `procurement.view`, `procurement.request`,
  `procurement.source`, `procurement.approve`, `procurement.orders.issue`,
  `receiving.view`, `receiving.receive`, `suppliers.view`, `suppliers.manage`

Concessões seguem o critério da 211: alçada que cada papel **já exerce**.

## 5. Waves

| Wave | Fase | Migration | Entrega |
|---|---|---|---|
| A | Discovery | — | Este relatório |
| B | Shell de Operações + OS | 230 | Menu Operações; Visão Geral; OS: itens, proveniência PT+PC, gerar do pacote, importar PDF (extração), confronto ampliado, exceção governada, imutabilidade + revisões, handoff |
| C | Workspace do projeto | — (read models) | Abas Visão Geral, Timeline (eventos), reorganização Cronograma/Planejamento |
| D | Planejamento | 231 | `project_requirements`, prontidão derivada, Planejamento global, importar requisitos da OS |
| E | Mapa de Operações | — | Mapa com camadas canônicas + painel lateral |
| F | Supply foundation | 232 | Cadastro de itens, cobertura derivada, Planejamento de Materiais, Visão Geral de Supply |
| G | Estoque | 233 | Locais, livro, disponibilidade, reservas atômicas, transferências, consumo/devolução, contagem |
| H | Compras | 234 | Requisição, RFQ/cotações, comparação, aprovação (motor de plataforma), PO, fornecedores (party role) |
| I | Recebimento & Logística | 235 | Inbound, recebimento parcial, divergência, postagem no livro, gancho 3-way match |
| J | Inteligência | 236 (se necessário) | Falta, risco de supply, estoque alternativo, simulação de transferência, sourcing, ETA — explicável e governado |

Cada wave: migration com ensaio transacional + provas em SAVEPOINT desfeitas
(`scripts/operations/apply-2xx.mjs`), serviços, rotas governadas, UI, testes
unitários, provas de banco, spec Playwright (escritas bloqueadas), auditoria de
segurança, `git diff --check`, commit atômico e push.

## 6. Regras que valem em todas as waves

- Escrita protegida só por função `SECURITY DEFINER` negada a `anon`/`authenticated`, com ator humano nomeado; a rota decide a permissão com o cliente autenticado e só então chama pelo service role.
- Toda FK entre entidades de domínio é **composta com `organization_id`** (tenant coerente por construção, INV-01).
- Livros (`*_history`, `*_revisions`, `inventory_movements`, recebimentos postados, aprovações) são append-only; correção é lançamento reverso.
- Nenhum dado fictício em tela de produção; estado vazio explica o fluxo e oferece a próxima ação.
- IA extrai, compara, recomenda; nunca emite OS, aprova compra, recebe mercadoria ou consome estoque.
