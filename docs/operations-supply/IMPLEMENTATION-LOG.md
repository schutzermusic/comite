# Operações + Supply Chain — Log de implementação

Uma entrada por wave: o que entrou, migration, invariantes, provas e dívida.
Fonte: `plan/insight-apex-ops-supply-md/`. Fronteiras: `00-BOUNDARY-REPORT.md`.

---

## Wave B — Shell de Operações + OS interna (migration 230)

**Aplicada no banco hospedado** (`scripts/operations/apply-230.mjs --apply`, 60/60 provas em ensaio e novamente no apply; provas sempre desfeitas).

### Entrou
- **230_operations_service_orders.sql** — estende a OS canônica (200), sem novo enum:
  - proveniência exata do pacote (`source_context_acceptance_id`, revisões regentes de PT/PC/combinada), capturada por gatilho para TODO caminho de criação (inclusive o fechamento comercial da 213);
  - `internal_service_order_items` (conteúdo estruturado com proveniência por linha: fato, página, trecho, item de blueprint, modelo, confiança; confirmação humana distinguível da leitura);
  - `internal_service_order_revisions` (append-only; revisão 1 gravada na emissão; emenda = nova revisão);
  - `internal_service_order_issue_exceptions` (livro append-only da exceção governada);
  - imutabilidade pós-emissão de cabeçalho e linhas (só a emenda abre a janela, por OS, dentro da transação);
  - portão de emissão ampliado: bloqueante não coberto por exceção + linha lida pendente de revisão + autorização regente;
  - confronto idempotente (não duplica divergência) com regras novas: pacote mudou (defensiva — o banco já impede segunda revisão aceita), entregável/dependência/exclusão da PT retirada na OS;
  - funções governadas: gerar do pacote (idempotente pelo aceite), importar PDF (idempotente pelo hash), aplicar leitura, semear do pacote, editar rascunho, linha manual, revisão em lote, exceção (permissão conferida NO BANCO via `apex_actor_has_permission`), emenda, divergência candidata (IA/humana);
  - eventos de domínio (`operations.service_order.created|issued|project_linked|cancelled|amended`) na mesma transação;
  - permissões `operations.view`, `operations.service_orders.override`, `operations.planning.view|manage` com concessões pelo critério da 211;
  - backfill inequívoco da 1 OS real existente (proveniência + revisão BACKFILL).
- Tarefa de IA `SERVICE_ORDER_DIVERGENCE_REVIEW` (confronto assistido; só abre candidatas).
- Rotas `/api/operations/overview`, `/api/operations/service-orders` (lista, pacotes, gerar, importar, workspace, rascunho, linhas, confronto, emissão/exceção, emenda, semear).
- Telas `/operacoes` (Visão Geral), `/operacoes/ordens-servico` (fila + Gerar/Importar), `/operacoes/ordens-servico/[id]` (Resumo, Escopo, Materiais & Recursos, Divergências, Documentos, Projeto, Histórico).
- Sidebar: grupo **Operações** (Visão Geral, Ordens de Serviço, Projetos, Mapa). Projetos virou destino dentro de Operações. A fase "Ordens de Serviço" do pós-venda continua como visão contextual das mesmas OS, com atalho para o workspace.

### Invariantes provados
INV-01 (FK composta em toda tabela nova; aceite de outro inquilino = "não encontrado"), INV-03, INV-04, INV-05, INV-15 (exceção com ator + permissão verificada), INV-16 (linha lida nasce pendente e segura a emissão), INV-19/20.

### Provas
- `scripts/operations/apply-230.mjs` — 60/60.
- `scripts/commercial/e2e-proof.mjs --with-migrations 230` — 65/65; `discovery-execution-proof --with-migrations 230` — verde; `commercial/security-audit --with-migrations 230` — limpa.
- `scripts/operations/security-audit.mjs` — 42/42.
- Unidade: `operations-service-orders`, `operations-overview-rules`, `operations-service-order-routes` (+ gateway atualizado) — suíte completa 2858/2858.
- Integração viva (somente leitura): `operations-service-orders-live` — 8/8.
- E2E: `operations-service-orders.spec.ts` 8/8; `commercial-module.spec.ts` 17/17 (sem o teste 11, que grava override temporário no usuário QA).

### Dívida
- `project-contract-projection-live.test.ts` falha por evolução dos dados reais (marcos agora `OCCURRED`) — pré-existente, fora do escopo.
- Confronto assistido e leitura do PDF chamam o provedor real quando usados em produção; nos testes, o gateway é simulado.
- Semear do pacote depende de fatos lidos das revisões; pacote sem leitura gera OS sem linhas (a tela oferece "Trazer escopo do pacote" quando houver fatos).

---

## Wave C — Workspace do projeto (sem migration)

### Entrou
- Abas do projeto na ordem do plano: **Visão Geral** (nova, padrão), **Cronograma / Planejamento** (o Gantt existente; `?tab=timeline` preservado para todos os links), Financeiro, Contexto Contratual, Medições & Evidências, **Timeline** (nova, `?tab=activity`), Riscos, Documentos, Equipe, Apontamentos.
- Visão Geral do projeto (`/api/operations/projects/[id]/overview`): saúde DERIVADA com motivos (`projects/health.ts`), próximo marco, bloqueios críticos, avanço físico (folhas ponderadas por duração), medições por fila, equipe alocada, OS vinculadas e exposição financeira só com `current_user_can_view_project_financials()`.
- Timeline (`/api/operations/projects/[id]/timeline`): fluxo cronológico montado das histórias canônicas — fatos de domínio da OS, história do engajamento, história de medição, atrasos de cronograma, riscos, alocações e documentos — cada linha aponta para o registro. Nenhuma tabela de eventos nova.
- **Operações → Medições & Evidências** (`/operacoes/medicoes`): fila de portfólio da medição canônica por quem tem o próximo passo; "Aprovada — enviar ao cliente" separada de "Aguardando aceite" e de "Aceita — elegível a faturamento"; valor só com leitura financeira ("Restrito", nunca zero).

### Invariantes
INV-02 (nenhum dado copiado para o projeto), INV-18 (medição continua uma só; a fila é recorte), visibilidade financeira pelo mesmo resolvedor da 183.

### Provas
- Unidade: `operations-project-360` (11) — suíte completa 2869/2869.
- E2E: `operations-project-workspace.spec.ts` 6/6 (inclui prova de que as abas novas não entram em laço de requisições).
- `projects-timeline-stability.spec.ts` falha no clique do botão "Entrar" (a tela de login anima; problema pré-existente documentado no spec comercial). A mesma verificação de laço foi coberta no spec da wave.

### Dívida
- Seção "Materiais & Supply" do projeto entra nas waves D/F (quando existirem requisitos e cobertura).

---

## Wave D — Planejamento (migration 231)

**Aplicada no banco hospedado** (`scripts/operations/apply-231.mjs --apply`, 29/29 provas).

### Entrou
- **231_operations_planning_requirements.sql**:
  - Nenhuma tabela de "plano de execução": o plano É o cronograma canônico (`project_timeline_items`).
  - `project_requirements` — MATERIAL, EQUIPMENT, VEHICLE, WORKFORCE, EXTERNAL_SERVICE, DOCUMENT, CUSTOMER_DEPENDENCY, OTHER; atividade do MESMO projeto e inquilino (FK composta `(org, project, activity)`; atividade apagada → `SET NULL (activity_id)`, o requisito volta a ser do projeto); fonte obrigatória (ACTIVITY, SERVICE_ORDER, MANUAL, IMPORTED_PLAN, AI_PROPOSAL com provedor/modelo); estado só do PLANO (PLANNED → CONFIRMED → CANCELLED/SUPERSEDED); confirmar exige data (e quantidade para material/serviço externo); cancelar exige motivo; substituir exige substituto vivo.
  - Cobertura de material NÃO é gravada (derivada do Supply). "Atendido" é ato nomeado com nota/evidência, só para tipos sem domínio de suprimento.
  - `project_requirement_history` (append-only) e eventos `operations.requirement.*` (com `project_id`, entram na Timeline do projeto).
  - Importação idempotente das linhas confirmadas da OS emitida do projeto.
- Rotas `/api/operations/planning`, `/api/operations/projects/[id]/requirements(+/import)`, `/api/operations/requirements(/[id], /transition, /satisfy)`; leitura por `operations.planning.view` OU `projects.view` (espelho da RLS), escrita só com `operations.planning.manage`.
- UI: painel de requisitos + matriz de prontidão por atividade sob o Gantt (aba Cronograma / Planejamento); tela **Operações → Planejamento** (exceções de plano, prontidão por projeto, necessidades por data).
- Prontidão derivada (`planning/readiness.ts`): material lê cobertura (ponto único `planning/coverage.ts`, preenchido pelo Supply na wave F); o pior requisito decide a atividade; exceções: dependência vencida, necessidade depois do início, não confirmado perto do início, falta perto da necessidade.

### Invariantes
INV-06 (proveniência obrigatória), INV-01 (FK composta de projeto/atividade/OS), INV-02 (cobertura derivada), AI não confirma requisito (confirmação sempre tem ator humano).

### Provas
- `apply-231` 29/29; `security-audit` 57/57.
- Unidade `operations-planning` (14) — suíte 2883/2883.
- Integração viva `operations-planning-live` 5/5 (+ OS 8/8).
- E2E `operations-planning.spec.ts` 3/3 (criação interceptada: prova o contrato enviado sem escrever no banco); regressão Operações 14/14.

---

## Wave E — Mapa de Operações (sem migration)

### Entrou
- `/operacoes/mapa` (menu: Operações → Mapa de Operações): mapa 2D com painel sincronizado — pino por projeto no **local canônico** (`project_canonical_location` vigente; sem ele, centro da cerca, dito assim), cercas de obra (`project_geofences`, raio real), equipe (último `location_evidence` em 24 h, SÓ com `people.attendance_view`). Nenhuma coordenada nova é guardada.
- Saúde do pino (`mapHealth`): OS com bloqueante (mesma regra do portão), risco material, material confirmado sem cobertura em 14 dias ou 4+ atividades vencidas → crítico; atividade crítica ou vencida → atenção; sem cronograma → desconhecido.
- Painel: recorte (ativos / com alerta / todos), cliente, UF, camadas; projeto selecionado mostra status, próximo marco, OS, equipe no local, alertas e o caminho ao workspace. Projeto sem local confirmado aparece na lista, não no mapa.
- Estoques entram quando o domínio de estoque existir (wave G). Veículos: a plataforma não tem domínio de frota com posição — o mapa diz isso em vez de inventar.
- deck.gl **intercalado** no contexto WebGL do maplibre (`MapboxOverlay`): um contexto só (o canvas separado disparava, no duplo-mount do React em dev, leitura de limites de device destruído). O globo 3D existente continua acessível ("Vista 3D").

### Provas
- Unidade `operations-map` (4) — suíte 2887/2887.
- E2E `operations-map.spec.ts` (inclui 390 px sem rolagem horizontal e zero `pageerror`); regressão de Operações 18/18 com `--workers=1` (o servidor dev compila sob demanda; em paralelo, logins disputam).

---

## Wave F — Fundação de Supply (migration 232)

**Aplicada no banco hospedado** (`scripts/operations/apply-232.mjs --apply`).

### Entrou
- **232_supply_foundation.sql**:
  - 14 permissões de Supply (`supply.*`, `inventory.*`, `procurement.*`, `receiving.*`, `suppliers.*`) com concessão por papel (owner_admin tudo; ceo/financeiro aprovam; engenharia_pcp planeja, movimenta, cota, emite e recebe; gestor_projetos vê, reserva e requisita; jurídico só vê).
  - `supply_items` — cadastro mestre por inquilino (código único em maiúsculas, unidade, rastreio NONE/LOT/SERIAL, ativo). Código e unidade de item em uso são imutáveis.
  - `project_requirements.item_id` + gatilho `project_requirement_item_guard`: item do mesmo inquilino, ativo, unidade igual à do item; material CONFIRMADO exige item. O requisito continua sendo o de Operações (sem demanda paralela).
  - Visão `supply_requirement_coverage` (security_invoker): cobertura por requisito, **derivada** — nesta wave sem fontes (falta = requerido); estoque, compra e recebimento a alimentam nas waves G–I.
  - Correção dos FKs compostos da 230 (`isoi_blueprint/fact/document`) para `SET NULL (coluna)`.
- `src/lib/supply/*` (cobertura, risco, alternativas, leitura, serviço, validação); rotas `/api/supply/{overview, material-planning, items}`.
- UI: grupo **Supply Chain** no menu (Visão geral, Planejamento de Materiais); aba **Materiais & Supply** no workspace do projeto; seletor de item no painel de requisitos; KPI "material sem cobertura" na visão de Operações e no mapa lendo a MESMA visão.

### Invariantes
INV-02 (cobertura derivada, nunca digitada), INV-01 (item e requisito do mesmo inquilino), unidade coerente com o item.

### Provas
- `apply-232` (provas em SAVEPOINT revertido).
- Unidade `supply-coverage` (12) — suíte 2898/2898.
- Integração viva 16/16 (`supply-live` + OS + planejamento).
- E2E `supply-foundation.spec.ts` 4/4; regressão Operações + Supply 22/22 (`--workers=1`).

---

## Wave G — Estoque (migration 233)

**Aplicada no banco hospedado** (`scripts/operations/apply-233.mjs --apply`, 69/69 provas; `security-audit` 132/132).

### Entrou
- **233_inventory_ledger_reservations.sql**:
  - `inventory_locations` (almoxarifado, canteiro do projeto, veículo, quarentena, zona, posição; hierarquia sem ciclo; canteiro exige projeto; coordenadas opcionais).
  - `inventory_movements` — **livro append-only** (UPDATE recusado a todos; DELETE pela regra canônica). Sinal pelo tipo; motivo obrigatório em ajuste/correção/devolução; lote/série conforme o item; em mão do lote nunca negativo; número de série no máximo uma vez; idempotente por chave.
  - `inventory_reservations` — nasce de requisito MATERIAL confirmado, mesmo item e projeto; identidade imutável; estado coerente com o saldo em aberto (CHECK). **Checagem atômica**: trava da linha do requisito + trava consultiva `(inquilino, item, local)`; disponível = em mão − reservado; requisito nunca sobre-coberto (reservado + consumido + trânsito + transferências pedidas ≤ requerido).
  - Transferências (`inventory_transfers` + linhas): REQUESTED → APPROVED → IN_TRANSIT → PARTIALLY_RECEIVED → RECEIVED → CLOSED (CANCELLED só antes do despacho). Despacho posta TRANSFER_OUT e não leva saldo reservado de outra obra; linha com reserva de origem converte reserva em trânsito sem dupla contagem; recebimento parcial idempotente posta TRANSFER_IN e reserva no destino até a necessidade restante (quarentena não reserva); encerrar com perda exige motivo.
  - Contagens: foto do esperado pelo livro (`seq`); postar aplica a diferença como COUNT_CORRECTION; linha cujo item se moveu depois da foto é recusada (reconte); uma contagem aberta por local.
  - Entrega à obra (ISSUE_TO_PROJECT consome a reserva) e devolução (volta como estoque livre).
  - Todo ato recheca a permissão do ator nomeado no banco (`apex_actor_has_permission`) e emite evento `supply.inventory.*` / `supply.transfer.*` (com `project_id`).
  - Visões derivadas: `inventory_position` (em mão, reservado, disponível, em inspeção, entrando) e `supply_requirement_coverage` com reservado/consumido/em trânsito reais — mesmo contrato da 232.
- Rotas `/api/supply/inventory` (+ `locations`, `adjustments`, `reservations(/[id])`, `transfers(/[id])`, `counts(/[id])`), recusas do banco traduzidas (`inventoryErrorMessage`), auditoria por ato.
- UI: **Supply Chain → Estoque** (Posição | Reservas | Movimentações | Transferências | Inventário | Locais) com exceções (reservado acima do físico, reserva sem demanda viva, acima da necessidade, transferência atrasada, contagem esquecida); gaveta da demanda com **estratégia explicável** (reservar / transferir / comprar) e atos governados; camada **Estoques** no Mapa de Operações.

### Invariantes
INV-08/09 (reserva atômica; disponível ≠ em mão), INV-10 (livro imutável), INV-07 (cobertura multi-fonte sem dupla contagem), INV-01 (FKs compostas por inquilino).

### Provas
- `apply-233` 69/69 — inclui prova de concorrência com uma segunda conexão (a trava do saldo fica detida pela transação da reserva).
- Unidade `supply-inventory` (13) — suíte 2910/2910.
- Integração viva 21/21 (saldo de lote nunca negativo, série única, disponível = em mão − reservado, equação da cobertura, recebido ≤ despachado).
- E2E `supply-inventory.spec.ts` 6/6 (escritas interceptadas; contrato enviado provado); regressão Operações + Supply 28/28.

---

## Wave H — Compras & Fornecedores (migration 234)

**Aplicada no banco hospedado** (`scripts/operations/apply-234.mjs --apply`, 67/67 provas; `security-audit` 212/212).

### Entrou
- **234_procurement_suppliers_orders.sql**:
  - **Fornecedor = papel de parte** (`parties` + `party_roles.role = 'supplier'`, já no vocabulário da 102) + `supplier_profiles` só com o que é de compras (homologação, categorias, condição e prazo padrão). Cadastro reusa a parte pelo CNPJ (idempotente). Suspender/bloquear exige motivo; restrito não é convidado nem recebe pedido emitido. Leitura de partes-fornecedor por `suppliers.view`/`procurement.view` via função definidora (evita recursão de RLS entre `parties` e `party_roles`). A tabela legada `supplier` não é usada.
  - **Requisição da falta** com rastro por requisito (`purchase_requisition_line_requirements`); requisitos do mesmo item consolidados numa linha com rastro; a mesma falta não é requisitada duas vezes. Requisição manual é exceção com justificativa.
  - **Cotação** (convidados, propostas versionadas e imutáveis — nova versão substitui), **decisão** append-only com justificativa, recomendação seguida ou não, e foto da comparação; a decisão gera o **pedido em rascunho** de forma idempotente, alocando a quantidade aos requisitos por data de necessidade.
  - **Pedido de compra** DRAFT → APPROVAL_REQUIRED → APPROVED → ISSUED → (235: PARTIALLY_RECEIVED/RECEIVED) → CLOSED/CANCELLED; total **derivado** (linhas + frete + impostos); linhas só mudam em rascunho; histórico append-only com evento `supply.purchase_order.*`.
  - **Aprovação sem motor paralelo**: o pedido é novo sujeito do Motor de Aprovação da plataforma (`approval_subject_resolve` ganhou o ramo `purchase_order`, os demais copiados sem alteração). Com política → decisão no motor, desfecho aplicado conferindo a impressão digital (`purchase_order_apply_approval`). Sem política → regra da 141: aprova só quem tem **alçada de compra declarada com evidência** (`procurement_approval_authorities`: papel/pessoa, teto, moeda, escopo), nunca quem criou ou submeteu (SoD); sem alçada, o pedido não é aprovável. Ninguém declara alçada para si. Nova permissão `procurement.authorities.manage` (owner_admin).
  - Rotas `approval.request.approved/rejected → procurement.purchase_order.apply_approval` semeadas **desligadas** (ligar na publicação do handler); até lá, ato explícito "sincronizar desfecho".
  - Cobertura: `on_order_qty` (alocação de pedido emitido − recebido) e `requested_qty` (requisição viva sem pedido emitido) entram no contrato da 232; reservar estoque para o que já está em pedido é recusado (cobertura comprometida inclui em pedido).
- Handler `procurement.purchase_order.apply_approval` no registro de jobs da plataforma.
- Rotas `/api/supply/procurement` (+ `requisitions`, `rfqs`, `purchase-orders`, `authorities`, `roles`) e `/api/supply/suppliers`; recusas traduzidas.
- UI: **Supply Chain → Compras** (Solicitações | Cotações | Aprovações | Pedidos) com comparação além do preço (custo total posto, chegada × necessidade, conformidade, homologação) e recomendação explicável; painel de política do motor no pedido (mesmas RPCs do Contratos); alçadas declaradas; **Fornecedores**; "Requisitar compra" na gaveta da falta; fatos de Supply na Timeline do projeto.

### Invariantes
INV-11 (pedido emitido não aumenta estoque — só "em pedido"), INV-07 (cobertura multi-fonte sem dupla contagem), aprovação governada (motor ou alçada declarada + SoD + impressão digital), fornecedor = papel de parte, INV-01 (FKs compostas; `roles` é catálogo global, tratado explicitamente pela auditoria).

### Provas
- `apply-234` 67/67 — inclui leitura real como `authenticated` (sem recursão de RLS).
- Unidade `supply-procurement` (14) — suíte 2922/2922.
- Integração viva 24/24.
- E2E `supply-procurement.spec.ts` 6/6; regressão Operações + Supply 34/34 (por spec; em lote único o servidor de desenvolvimento satura compilando rotas).

### Dívida registrada
- Ligar as rotas `approval.request.* → procurement.purchase_order.apply_approval` na publicação.
- Pedido governado por política cancelado com pedido de aprovação PENDENTE no motor: o desfecho posterior é ignorado (idempotente), mas o pedido do motor não é cancelado automaticamente.
- Hidratação do shell do app falha em 390 px em todas as telas (pré-existente).

---

## Wave I — Recebimento & Logística (migration 235)

**Aplicada no banco hospedado** (`scripts/operations/apply-235.mjs --apply`, 45/45 provas; `security-audit` 239/239).

### Entrou
- **235_receiving_logistics.sql**:
  - **Só o recebimento põe material no estoque** (INV-11): `goods_receipt_post` contra pedido EMITIDO, com o pedido travado (recebimentos concorrentes na mesma linha serializam). Por linha: aceito ≤ em aberto (acima é recusado), rejeitado/avariado à parte com motivo (não entra no estoque e segue esperado), lote/série (um número por unidade). Posta `RECEIPT` apontando a linha do recebimento (o livro agora exige), aloca o aceito aos requisitos do pedido por data de necessidade (`goods_receipt_line_requirements`, INV-13) e reserva no local o que chegou, até a necessidade. Parcial é primeira classe: pedido PARTIALLY_RECEIVED, saldo continua "em pedido" (INV-12). Idempotente pela chave.
  - **Inspeção**: recebido em QUARENTENA fica "em inspeção" — não reservável nem disponível, mas conta como **entrando** (nova coluna `inspection_qty` anexada ao contrato da cobertura) e como comprometido: ninguém recompra nem reserva de novo o que está esperando decisão. `goods_receipt_inspect` decide todas as unidades (série a série quando rastreado): aprovado vai ao destino pelo **fluxo canônico de transferência** (reservando até o que cada requisito ainda comporta), rejeitado sai com motivo e volta a ser esperado do fornecedor (recebido e alocação recuam).
  - **Logística de entrada**: `inbound_shipments` (transportadora, veículo, rastreio, ETA, trânsito, chegada; só avança; RECEIVED vem do recebimento).
  - **Evidência**: `goods_receipt_evidence` (foto/romaneio/nota) — upload assinado em caminho gerado pelo servidor dentro do inquilino; no registro o servidor baixa o objeto, confere tamanho e calcula o hash.
  - **Encerrar pedido** (`purchase_order_close`): recebido → encerrado; com saldo, só com motivo (o saldo deixa de ser esperado e a falta volta ao plano); recusado com inspeção pendente.
  - **Finanças sem livro paralelo** (INV-17): visão `purchase_order_receipt_basis` (pedido × recebido × rejeitado × em aberto, com valores) como base do 3-way match; evento `supply.goods_receipt.posted` como gancho; `supply.goods_receipt.project_received` por projeto para a Timeline.
  - **Pontualidade do fornecedor** derivada: `supplier_delivery_performance` (linhas prometidas, no prazo, atraso médio, rejeições) — alimenta Fornecedores e a comparação de propostas.
- Rotas `/api/supply/receiving` (+ `receipts`, `receipts/[id]` inspeção, `receipts/[id]/evidence`, `shipments`); "Encerrar pedido" em Compras.
- UI: **Supply Chain → Recebimentos & Logística** (Entradas por fila — atrasados, hoje, em trânsito, parciais, divergências, próximos, concluídos — | Recebimentos | Inspeção | Desempenho de entrega), recebimento de campo pensado para celular (aceito/rejeitado com motivo, lote/série, local, embarque, foto), inspeção série a série, logística do embarque; "em inspeção" na régua de cobertura.

### Invariantes
INV-11, INV-12, INV-13, INV-16 (nenhum recebimento sem ato humano nomeado), INV-17, INV-10 (recebimento e rastro são fatos; só a decisão de inspeção muda, uma vez).

### Provas
- `apply-235` 45/45 (pedido emitido pelo caminho governado inteiro; parcial; acima do aberto; rejeição; série; quarentena; inspeção; recompra e re-reserva recusadas durante a inspeção; 3-way; pontualidade; evidência; fronteiras).
- Unidade `supply-receiving` (9) — suíte 2929/2929.
- Integração viva 27/27.
- E2E `supply-receiving.spec.ts` 5/5; regressão Operações + Supply 39/39 (por spec).

### Ajustes de teste
- Fixtures simulados de demanda atualizados para o contrato de cobertura com `inspection`; formatador de quantidade tolerante a valor ausente.
- `operations-service-orders.spec` (wave B): "Failed to fetch" (aborto de rede provocado pelo próprio spec) não conta como erro de runtime.

---

## Wave J — Inteligência autônoma, explicável e governada (migration 236)

**Aplicada no banco hospedado** (`scripts/operations/apply-236.mjs --apply`, 25/25 provas; `security-audit` 257/257).

### Entrou
- **Motor de sinais** (`src/lib/supply/intelligence.ts`, `supply-signals.v1`) — determinístico, explicável, testado: observa cobertura, estoque livre, entradas, pedidos, requisições, pontualidade e inspeções e produz sinais com **evidência (com a origem de cada número)**, **justificativa** e **um ato recomendado**:
  - **Estoque disponível** (primeiro o que a empresa já tem): reservar no canteiro do projeto, ou transferir de outro local com **simulação de transferência** — prazo pela média histórica do par de locais (senão do destino; sem histórico, estimativa padrão declarada), chegada contra a necessidade; custo de frete não cadastrado não é estimado. O mesmo saldo nunca é oferecido a dois requisitos.
  - **Falta sem cobertura** → requisitar compra do que resta (descontado o já requisitado).
  - **Chega depois da necessidade** (necessidade = data do requisito ou início da atividade, o que vier antes) → acompanhar a antecipação.
  - **Entrega atrasada**, **fornecedor pouco pontual** (≥ 3 entregas no histórico, < 80% no prazo), **decisão de compra parada** perto da necessidade, **inspeção esquecida**.
  - Na mesma gravidade, a ordem é a da estratégia: estoque antes de compra.
- **236_supply_intelligence.sql**: livro `supply_signals` (+ histórico append-only, leituras registradas). A leitura (sistema, sem ator humano) **abre, atualiza e resolve sozinha** o que deixou de ser verdade; reabre quando a condição volta ou persiste depois da ação; descartada continua descartada enquanto a condição for a mesma. **Executar** chama o **mesmo ato governado** (reservar, pedir transferência, requisitar) com a identidade de quem aceitou — alçada, disponibilidade, sobre-cobertura e idempotência reconferidas no banco; **descartar** exige motivo; **acompanhar** abre o **acompanhamento do Apex (156)**, cujas origens ganharam `project_requirement`, `purchase_order`, `inventory_transfer`, `goods_receipt` pela função canônica (206/212), com a alçada do domínio de Supply.
- Rotas `/api/supply/intelligence` (+ `sweep`, `signals/[id]`), trabalho `supply.intelligence.sweep` registrado (agendamento é passo de publicação).
- UI: **Recomendações da Apex** na Visão Geral de Supply e na aba Materiais do projeto (cartões com evidência, justificativa e ato; leitura refeita quando velha); a Visão Geral ganhou o fluxo de compras/recebimento (em pedido aberto, entradas atrasadas, divergências, decisões paradas); decisões aparecem na Timeline do projeto.

### O que a Apex NÃO faz
Não recebe material, não consome estoque, não aprova nem emite compra, não decide sozinha (INV-15, INV-16). Recomendação é linha do livro, com versão do motor, evidência e desfecho humano.

### Provas
- `apply-236` 25/25 (abre/atualiza/resolve/reabre; descarte com motivo e persistente; execução pelo ato governado com recheque de alçada e de cobertura; requisição com a recomendação como justificativa; origens de Supply no acompanhamento sem perder as anteriores; coerência de ator no histórico).
- Unidade `supply-intelligence` (12) — suíte 2941/2941.
- Integração viva: leitura da Apex sobre o banco real sem escrever (todas as consultas do coletor casam com o esquema) + invariantes do livro; **contrato rota → RPC** para 36 rotas de escrita de Operações e Supply contra `pg_proc` (com teste de mutação confirmando que pega divergência).
- E2E `supply-intelligence.spec.ts` 4/4; regressão Operações + Supply 43/43 (por spec).

### Correções encontradas nesta wave
- `fix(supply)` 77fab60: esquemas de ação de **transferência** e **contagem** quebrados por uma substituição global na Wave I (a rota de transferência nem carregava) — achado pelo teste de contrato.
- `test(operations-supply)` bd0d073: testes desta branch trocaram `SET SESSION default_transaction_read_only` (vazava pelo pooler em modo transação e derrubava um teste de Contratos) por transação `READ ONLY` + `ROLLBACK`; conexões do pool marcadas foram restauradas ao padrão.

---

## Caminho dourado ponta a ponta (prova, sem migration)

`node scripts/operations/golden-path.mjs` — uma transação no banco real, **sempre revertida**: pacote aceito (PT+PC) → OS gerada, revisada (com linha de material) e emitida → projeto a partir da OS → requisitos importados da OS (repetir não duplica) → material com item e confirmado → falta de 1000 → 300 reservados do estoque → requisição da falta → cotação → proposta → decisão → pedido → sem alçada não aprova → alçada declarada → rejeição volta ao rascunho → aprovação por outra pessoa → emissão (idempotente) → recebimento parcial (idempotente; acima do aberto recusado; pedido recebido não cancela) → recebimento final → requisito coberto → entrega à obra → fatos na Timeline do projeto → fronteira de inquilino. **16/16.**

---

## Mapa de Operações volta a ser o mapa 3D anterior (pedido do usuário)

- O item **Operações → Mapa de Operações** e o atalho "Abrir mapa" da Visão Geral de Operações voltam a abrir `/projetos/operations-3d`, o mapa 3D que já existia — mesma rota, mesmo ícone e mesma alçada (`projects.view`) de antes da branch.
- O mapa 2D da Wave E (`/operacoes/mapa`, `/api/operations/map`, `src/lib/operations/map.ts`, componentes e testes) foi removido para não haver dois mapas. Saíram junto a camada de estoques (Wave G) e o realce de falta de material que só existiam nele; o código segue no histórico (a2032cc, a12966c).
- Provas: unidade `operations-navigation` (2) — suíte 2939/2939; E2E `operations-map.spec.ts` agora prova que menu e atalho levam ao mapa 3D e que o item fica marcado como página atual.

---

## Prontidão de produção — QA isolado, migrations 237/238 e camada de aplicação

**237 e 238 NÃO estão aplicadas no banco hospedado** — aplicar é passo de deploy (ver runbook abaixo).

### QA isolado (8927e3b, 2b660d6)
- Pilha Supabase local (`qa/supabase`, projeto `apex-qa`, portas 554xx) com o esquema `public` de produção restaurado de um dump **somente-esquema** + catálogo global; paridade conferida objeto a objeto. Nenhuma linha de negócio sai de produção.
- `scripts/qa/seed.mjs`: organização pelo `organization_provision` real, um usuário real por papel (titular, gestor, engenharia, compras, almoxarifado, financeiro, jurídico, RH) e um segundo inquilino para isolamento.
- `scripts/qa/scenario.mjs`: operação realista pelas funções governadas (pacotes aceitos → OS → projetos; OS em rascunho, com divergência bloqueante e **importada de PDF** com leitura e confronto; cronograma; requisitos de todos os tipos; estoque, reserva, transferência, compra, recebimento parcial, quarentena; medições em todas as raias; risco; leitura da Apex). O pacote aceito vem de `scripts/qa/lib/commercial.mjs`, o mesmo das provas vivas.
- Todo escritor passa pelo guarda que recusa endereço não-local. `serve.mjs` serve build de produção (:9102) ou `--dev` (:9103) contra o QA.

### Migration 237 (f3bfe8d) — 54/54 no QA (aplicada) e 54/54 em ensaio revertido no hospedado
Re-checagem de permissão no banco em toda escrita de Operações; papéis de sistema `compras` e `almoxarifado` (segregação real); ciclo de aprovação do pedido (cada submissão abre sua requisição no motor; cancelar cancela a pendente; rotas de desfecho semeadas desligadas e ativadas só por worker capaz; reconciliação periódica); agendamento de `supply.intelligence.sweep` por inquilino/hora; quarentena só sai pela inspeção; evidência presa à pasta do recebimento do inquilino; alçada honra categoria; item em uso preserva código/unidade/rastreio; RESTRICT → NO ACTION (230–232); grants de leitura nas visões; helper vazado revogado; índices de caminho quente.

### Migration 238 (7e1dace) — 8/8 no QA
Idempotência relida **sob a trava** em `goods_receipt_post` e `inventory_reserve` (duplo envio com a mesma chave responde replay, não 422); reconciliação de aprovação chaveada pelo último desfecho pendente.

### Camada de aplicação (cb3dbbc, 50cab06)
Sobreposições DENY valem para o conjunto inteiro de permissões; RPC governada com SQLSTATE preservado (42501→403, regra→422) e retentativa em 40P01/40001/23505-de-idempotência; `sync` exige permissão de ato; varredura da Apex tudo-ou-nada (nada de "resolvido" falso); follow-up sem órfão; evidência com tipo compatível e assinatura de conteúdo conferida no servidor (HEIC/WEBP convertidos para JPEG no aparelho); hash do PDF da OS calculado no servidor; produtores agendados (varredura e reconciliação); testes vivos em `BEGIN READ ONLY`, nunca `SET SESSION`. Hidratação do shell a 390 px corrigida na origem (`useSyncExternalStore` no `useIsMobile`).

---

## Provas vivas no QA isolado — navegador/API → banco, sem interceptação

`npx playwright test -c playwright.qa.config.ts` (o global-setup recusa endereço não-local e entra com cada papel pela tela real de login). No build de produção do QA: execução completa **47/47**, e a suíte `service-order-governance`, acrescentada depois, **3/3** no mesmo build.

| Suíte | Projeto | O que prova |
|---|---|---|
| `golden-path` (8) | desktop | Pacote aceito → OS gerada, revisada e emitida → projeto → atividade no cronograma → necessidade de material confirmada (falta derivada) → reserva do estoque → requisição do resto → cotação com 2 fornecedores, 2 propostas, decisão → submissão (compras) → aprovação por alçada (financeiro) → emissão → recebimento parcial para inspeção → inspeção e liberação (reserva cresce) → entrega à obra. Estado persistido conferido após cada transição, até a sequência inteira do livro-razão terminando em `ISSUE_TO_PROJECT`. |
| `service-order-governance` (3) | desktop | Importar OS em PDF (Storage do inquilino, hash calculado no servidor, OS em rascunho); jurídico decide bloqueante (fonte que prevalece + justificativa); titular emite sob exceção nomeada (livro com pessoa, permissão e motivo; divergência segue aberta). |
| `roles-ui` (9) | desktop | 8 papéis × 6 telas: cada ato oferecido **exatamente** quando `role_permissions` concede; sem leitura, a recusa nomeada e nenhuma linha; titular de outro inquilino não lista nem abre a OS deste. |
| `roles-api` (12) | api | 8 papéis × 17 escritas + 5 leituras com 403 esperado derivado do RBAC do banco; RLS recusa escrita direta e função protegida; leitura segue o RBAC; DENY vence o papel; outro inquilino não age. |
| `concurrency` (7) | api | Sobreposição FORÇADA (terceiro cliente segura a trava): reservas no mesmo saldo, mesma reserva 2×, recebimentos no mesmo aberto (chaves iguais e diferentes), despachos, entrega dupla, contagem sobre retrato vencido. |
| `approvals` (4) | api | Cancelamento cancela a aprovação pendente; aprovação do motor chega ao pedido pela rota de evento ativada pelo worker capaz num dreno real; rejeição → nova submissão abre nova requisição; com rotas desligadas, a reconciliação aplica o desfecho. |
| `evidence` (3) | api | Upload assinado → Storage canônico → vínculo → leitura; recusas (sem alçada, outro inquilino, caminho alheio, conteúdo falso — removido). |
| `intelligence` (2) | api | Dreno agenda uma varredura por inquilino/hora; a varredura abre sinal com evidência e ato recomendado sem criar nada. |
| `receiving-mobile` (2) | mobile | Recebimento em campo no Pixel 7 com avaria, quarentena e foto WEBP convertida; inspeção com liberação para o canteiro. |

As especificações de tela de Operações/Supply (`tests/operations-*.spec.ts`, `tests/supply-*.spec.ts`) rodam contra o QA com `playwright.e2e-qa.config.ts`; nelas as escritas continuam interceptadas por desenho (provam o contrato da tela) — a prova de escrita real é a tabela acima.

---

## Operações & Supply V2 — UI/UX

Camada de composição `src/components/ax` sobre os tokens da plataforma (sem segundo design system): cabeçalho de comando, faixa de sinais, planos contínuos, fila por exceção, cadeia causal, cobertura empilhada, etapas que são navegação, painel lateral acessível (Radix), Apex embutida. URL como estado (`?tab`, `?focus`, `?lane`, `?project`, `?req`, `?po`…). Telas:

- **Visão Geral de Operações** (36dda52) — centro de comando: sinais, fila de decisão, fluxo da autorização, horizonte, saúde por projeto.
- **Ordens de Serviço** (38f175c, 0da9467) — a ponte Comercial → Operação na fila e no workspace; **comparação OS × PT × PC** por dimensão (conflito/incerto/faltando/adicional/alinhado, proveniência recolhida, ações por linha); OS importada resolve o pacote regente pela autorização; painel OS → projeto mostra o que o projeto herda.
- **Planejamento** (825114d) — frentes: atividade → necessidades → data que vale (min(declarada, início)) → cobertura → exceção; faixa de prontidão em 5 dimensões; horizonte de 30 dias.
- **Medições & Evidências** (68a85c3) — raias como fluxo com dono do próximo passo; "aprovada para envio" nunca se confunde com aceite.
- **Workspace do projeto** (d862157) — o projeto num olhar (estado, período, avanço, saúde com motivo, próximo marco, OS, contrato só com leitura financeira e valor real); abas na URL, incluindo Apontamentos.
- **Mapa de Operações 3D** (eab70f5) — o globo Cesium com painel operacional (prioridade; projeto com saúde, frentes, OS, travas); `?project=` voa até o projeto; marcadores acompanham a lista. **Uma regra de saúde** (`deriveProjectHealth`) para Visão Geral, mapa e projeto.
- **Supply**: torre de controle (76a24f4), planejamento de materiais (be95c2f), recebimento mesa/campo (1bdb652), compras (eeadf28), estoque (54b050b), fornecedor 360 (4f4676e).
- Acessibilidade na origem: campos HUD nomeados pelos rótulos (c371e8a).

---

## Cobertura: uma regra só para estoque e compras (migration 246)

**Ensaio no QA: 54/54 provas (`apply-246.mjs --target=qa`, revertido); `security-audit --with-migrations 246` 372/372.** Aplicar no QA é passo do integrador (o QA é compartilhado com o worktree de Governança); no hospedado, passo de deploy. Regra e contrato: `COVERAGE-SEMANTICS.md`.

### Defeito
Requisito de 500 m, 100 reservados, transferência de 150 m **pedida** → a requisição da falta comprou 400 (650 prometidos contra 500, todos os `qa-flx-*`). Na ordem inversa, transferência/reserva passavam por cima da requisição aberta (`qa-scn-tucurui`: 1.450 contra 1.200). Duas regras canônicas discordavam: a visão de cobertura (compras) ignorava REQUESTED/APPROVED; `inventory_requirement_committed` (estoque) ignorava a requisição aberta.

### Entrou
- **Visão `supply_requirement_coverage`**: `pending_transfer_qty` (pedidas/aprovadas **sem** reserva de origem) e `purchasable_qty = GREATEST(falta − requisitado − pendente, 0)` **anexadas ao fim**; as 18 colunas e a `shortage_qty` bruta intactas; `security_invoker`, comentário e grants reaplicados.
- **Requisição da falta** (`purchase_requisition_from_shortage`, mesma assinatura): compra só o comprável; comprável zero por transferência pendente → recusa própria que nomeia as TRs ("…dispatch or cancel the transfer, or request a coverage exception."); coberto por requisições → a mensagem de sempre. Trava todos os requisitos em ordem de uuid **antes** de gravar e relê a chave **sob** a trava (padrão da 238). Resposta ganha `requisitioned_qty`, `override` e `requirements[]` (`requisitioned_qty`, `purchasable_qty`, `pending_transfer_qty`, `pending_transfers[]`) — a mesma na repetição (`purchase_requisition_shortage_outcome`, lida do rastro e do livro).
- **Exceção de cobertura governada**: `coverage_override: { reason }`; permissão nova `procurement.coverage_override` conferida no banco (owner_admin e ceo_diretoria, **não** compras; 42501 sem ela); motivo ≥ 20 caracteres; compra `falta − requisitado` (o pendente, declarado); uma linha por requisito excecionado no livro append-only **`procurement_coverage_exceptions`** (transferências, pendente, comprável antes, requisitado, motivo, pessoa, permissão) + evento `supply.requisition.coverage_exception` causado pela submissão. Exceção pedida onde não há pendente não vira exceção (nada a declarar). O sinal da Apex nunca a usa.
- **Guarda simétrica**: `supply_requirement_claimed` = comprometido + requisitado; `inventory_reserve` e `inventory_transfer_request` recusam o que passaria do requisito ("over-cover the requirement … by open purchase requisitions"). Para trocar compra por estoque, cancela-se a requisição. O pedido de transferência trava os requisitos em ordem canônica.
- **Inalterados**: tetos de recebimento (`inventory_transfer_receive`, `goods_receipt_post`, `goods_receipt_inspect`) — a liberação da inspeção segue no comprometido, para não travar a entrada física num requisito já sobre-coberto pela regra antiga. Nenhum dado existente é revalidado.

### Provas (`apply-246`, sempre revertidas)
500/100/150 pedida → pendente 150, comprável 250, requisição 250, segunda recusada nomeando a TR · aprovada idem · cancelada devolve 150 ao comprável · despachada vira em trânsito (comprável = falta − requisitado) · encerrada sem receber volta ao comprável · requisição primeiro → transferência e reserva por cima recusadas · travas fora de ordem · exceção: compras 42501, motivo curto/ausente 23514, titular compra 400 com uma linha no livro + evento, livro não se reescreve · repetição devolve a mesma resposta (inclusive a da exceção) e não passa por cima da permissão · sinal REQUISITION segue a regra padrão mesmo com `coverage_override` nos ajustes · inspeção ainda libera num requisito já sobre-coberto · navegador não executa nada novo; livro governado; visão com as 18 colunas intactas.

### Para quem integra
`node scripts/operations/apply-246.mjs --target=qa --apply` (sem spec rodando: `CREATE OR REPLACE VIEW/FUNCTION` trava por instantes) → `security-audit --target=qa`. `qa:build` já encadeia a 246. Um `qa:build` a partir de outro worktree sem a 246 apaga a permissão e a tabela até reaplicar. `tests/qa-live/dashboard-supply-flow.spec.ts` passo 2 muda: com a transferência de 150 pedida, a requisição leva 250 (não 400).

---

## Cobertura: a requisição decide com valores brutos (migration 247)

**Ensaio no QA: 34/34 provas (`apply-247.mjs --target=qa`, revertido); `security-audit --with-migrations 247` 374/374.** Para a frente: a 246 já está aplicada no QA compartilhado e o runner não reaplica versão registrada.

### Defeito (revisão adversarial da 246)
A visão anexou pendente e comprável como `numeric(18,4)`; a falta segue sem escala, e a requisição da falta misturava as duas coisas.
- **Reserva 99,99996 + 150 pedidos em 500:** a exceção levava 400,00004 contra um comprável de 250,0000. O livro recusava a própria linha (`pcx_is_an_exception`, erro cru).
- **Reserva 99,99994:** a requisição padrão levava 250,0001, e o requisito ficava reclamado 500,00004 contra 500.
- **Falta ínfima sem pendente:** a recusa "covered by pending internal transfer(s)" saía com a lista vazia.

### Entrou
`purchase_requisition_from_shortage`, com a mesma assinatura e a partir do corpo implantado da 246:
- o pendente passa a ser a soma **bruta** das linhas (o predicado da visão);
- o comprável é `GREATEST(descoberto − pendente, 0)`, calculado ali mesmo;
- o livro de exceções grava esses brutos;
- a recusa que nomeia transferências só sai com pendente > 0.

Mensagens, exceção governada, travas e idempotência ficam como na 246. A visão não muda: as colunas anexadas seguem como valores de **exibição**.

A prova (6) da `apply-246` foi reclassificada ("grava as duas linhas"): numa transação só, ela não observa a ordem das travas. A `apply-247` confere no fonte que o laço de travas de `inventory_transfer_request` é ordenado e fecha antes de gravar a transferência.

### Provas (`apply-247`, sempre revertidas)
- **Arredondamento:**
  - a exceção com 99,99996 passa: 400,00004 requisitados, e o livro fecha a CHECK com 250,00004 + 150;
  - a requisição padrão com 99,99994 leva 250,00006, e o reclamado fecha exatamente em 500;
  - a falta de 0,00004 sem pendente é requisitada, sem a recusa de transferência.
- **Regressão da 246:**
  - 500/100/150 → 250, depois a recusa que nomeia a TR;
  - cancelar a transferência devolve 150;
  - compras recebe 42501 na exceção, e o titular com motivo gera a linha no livro e o evento;
  - a repetição idempotente devolve a mesma resposta, inclusive sob exceção.
- **Grants:** EXECUTE só do `service_role`.

### Para quem integra
`node scripts/operations/apply-247.mjs --target=qa --apply` (sem spec rodando), depois `security-audit --target=qa`. O `qa:build` já encadeia a 247 depois da 246.

### Aplicadas no QA (2026-09-26)
246 (54/54) e 247 (34/34) aplicadas e registradas; `security-audit --target=qa` 374/374; as funções novas e reescritas só executáveis pelo `service_role`. Contra o `next dev` em :9103, sobre o QA com a 247:
- `dashboard-supply-flow.spec.ts` **13/13** — o fluxo completo (a solicitação do passo 2 leva **250**, não 400; o financeiro aprova no Dashboard) e as regressões da regra: sem dupla cobertura; transferência cancelada e transferência perdida no caminho voltam ao descoberto; aprovada segue pendente e despachada reduz a compra (nem a exceção compra de novo o que já saiu); compra ∥ compra e compra ∥ transferência ∥ reserva sob `forcedOverlap` nunca passam do requerido; a mesma chave concorrente dá uma solicitação só; exceção: Compras 403, titular com motivo pelo Dashboard → livro, evento e auditoria, e a tela diz depois que o pendente já foi comprado (chega em dobro se despachado).
- `golden-path.spec.ts` **8/8**; `concurrency.spec.ts` 7/7; `roles-api` + `intelligence` 14/14. Unitários 3.850/3.850.

**Achado da revisão, anterior à 246** (`purchase_order_cancel` reabria a requisição inteira sem travar o requisito nem conferir o reclamado — pedido parcial emitido, nova requisição do resto, pedido cancelado → reclamado 140 contra 100): tratado na migration 248, seção seguinte.

---

## Compras: quantidades coerentes — pedido parcial, cancelamento, reabertura (migration 248)

**Ensaio no QA: 92/92 provas (`apply-248.mjs --target=qa`, revertido); `security-audit --target=qa --with-migrations 248` 390/390.** Aplicada no QA em 2026-09-26 (92/92 no `--apply`; auditoria 390/390); resultados vivos na seção da 249. Contrato congelado (v2, depois da revisão adversarial); regra em `COVERAGE-SEMANTICS.md`, seção 248.

### Defeito
- **Cancelamento de pedido parcial emitido:** RC-A 100, proposta 60, pedido de 60 emitido → a emissão dava a linha por atendida sem olhar quantidade, os 40 viravam compráveis e a RC-B os requisitava; cancelar o pedido devolvia a RC-A INTEIRA ao requisitado — 140 reclamados contra 100, e a recotação da RC-A pedia 100 de novo. O mesmo com reserva ou transferência no lugar da RC-B, com linha de dois requisitos e com requisição de duas linhas.
- **Cotação velha de requisição cancelada** virava pedido e era emitida (200 contra 100); a decisão não travava a requisição, então a corrida decisão ∥ cancelamento de requisição também chegava lá.
- **Linha que a proposta vencedora não cotou** ficava presa: nem nova cotação ("already in a live RFQ"), nem nova requisição.
- **Requisito cancelado, replanejado ou reduzido** depois do pedido era recomprado inteiro no cancelamento.

### Entrou
- **Livro append-only `procurement_requisition_releases`** (o que deixou de ser demanda aberta de uma alocação): estágio `PO_ISSUED`/`PO_CANCELLED`, causa `NOT_ORDERED`/`COVERED`/`REQUIREMENT_INACTIVE`, quantidade `numeric` sem escala (> 0), motivo; uma linha por (pedido, alocação, estágio); FKs de inquilino; `operations_reject_history_rewrite` + `contracts_reject_history_erasure`; RLS com o MESMO predicado das alocações (a visão de cobertura lê os dois com os mesmos olhos); `authenticated` só lê. Sem coluna de ator: quem agiu fica no histórico do pedido e no evento.
- **Visão `purchase_requisition_open_allocations`** (security_invoker): alocado, liberado e aberto = alocado − liberado, brutos. Aberto 0 não é demanda viva para nenhum leitor.
- **Requisitado = aberto:** `procurement_requested_open` e o CTE `requested` de `supply_requirement_coverage` (as 20 colunas, tipos, ordem, grants e comentário intactos).
- **Emissão** (`purchase_order_issue`): trava as requisições do pedido (uuid, instrução própria) e recusa requisição que não está mais em busca (`Requisition % is %: this order can no longer be issued.`); libera o que a requisição pediu e o pedido não pediu (`PO_ISSUED`/`NOT_ORDERED`, sem mexer no reclamado); PEDIDA numa instrução posterior, só com linhas de aberto > 0; evento `supply.requisition.released`; resposta ganha `released[]` por requisito (item e unidade). Repetição inalterada.
- **Cancelamento** (`purchase_order_cancel`): trava PO → aprovação → requisitos (FOR NO KEY UPDATE, uuid) → requisições (uuid) → cotação; por requisito, ANTES de o pedido mudar de estado, orçamento = `GREATEST(capacidade − (reclamado − próprio), 0)` (capacidade = required se CONFIRMADO de material/serviço, senão 0); reabre até o orçamento pela requisição mais antiga e libera o resto (`COVERED`/`REQUIREMENT_INACTIVE`). A requisição fica no estado que as linhas dizem (ENCERRADA quando nada ficou aberto — primeiro produtor de CLOSED). Histórico: transição `cancelled`, chaves da 237 + `requirements` e `requisitions`; a repetição devolve esse desfecho gravado (anterior à 248: listas vazias); evento por (requisição, projeto).
- **Decisão** (`procurement_decide`): trava as requisições ANTES da cotação; linha de requisição morta ou sem aberto não vira pedido (vai em `not_ordered`); nenhuma linha possível → `No line of this quotation can become an order: its requisitions were cancelled or closed.`; aloca só aberto > 0 (nunca 0).
- **Cotação** (`procurement_rfq_create`): trava as requisições antes de ler; cota o aberto e a data das alocações abertas; linha toda liberada → `Requisition line is fully released: nothing left to source.`; cotação viva = ABERTA ou DECIDIDA cujo pedido não cancelado tem linha para ela (a linha não cotada volta à cotação).
- **Cancelamento de requisição**: ENCERRADA → `Requisition is CLOSED: nothing to cancel.`; sob a trava dela, a cotação ABERTA que só ficou com requisições mortas é cancelada (`Solicitação <n> cancelada`); resposta ganha `rfqs_cancelled`.
- **Fixtures**: `issuedPurchaseOrder` aceita `quantities` (proposta parcial; sem ela, como sempre); `homologatedSupplier` e `purchaseOrderFromLines` (cotação → proposta → decisão → aprovação → emissão a partir de linhas existentes, parando em qualquer estágio).

### Provas (`apply-248`, sempre revertidas)
- **Casos do contrato:** a (emissão libera 40; cancelamento reabre 60; reclamado 100; nova cotação 60; total pedido 100) · b (reabre 60, 40 compráveis, reclamado 60) · c (cheio: reabre 100, contrato da apply-234) · d1–d4 (antes da emissão: nada muda) · d5 (requisito PLANNED/CANCELLED com pedido não emitido: libera tudo, ENCERRADA) · e1/e1b/e2 · f1/f2 (f2 termina EM COTAÇÃO) · f3 (linha não cotada volta à cotação) · g · h2/h3 · K1 (reabre 0, ENCERRADA) · K2-60/K2-100/K2 despachada (exceção não atravessa o cancelamento: reclamado = requerido, livro de exceções intacto, liberação COVERED) · j1 (80) · forma de Tucuruí sintética (1450 → 1200) · X3/X5/X12 (legado)/X13/X14 · arredondamento (33,33333 e 0,00003 exatos, nunca acima do requerido) · B1 nas duas formas (a decisão não aborta) · B2 (decisão mista pede só a linha viva; cancelar a última requisição viva cancela a cotação) · B7 (ENCERRADA não se cancela) · cotação velha (decisão recusa; emissão recusa pedido de requisição morta).
- **E mais:** repetição da emissão e do cancelamento (inclusive o anterior à 248); chaves da 237 sob POLÍTICA do motor; `/has receipts/`; grants e search_path; livro append-only com RLS (o navegador lê como o servidor e não grava); eventos por pedido, estágio e projeto (requisição de dois projetos → um evento por projeto); ordem das travas conferida no fonte (as seis funções reescritas e os escritores que já travavam requisitos em ordem de uuid); as 20 colunas da visão; neutralidade — a regra nova sobre os 207 pedidos canceláveis do QA (menos a demo de Tucuruí), cada um desfeito: nenhum reclamado sobe, requisito são sem liberação nem mudança. Os dois pedidos APROVADOS de requisitos `qa-flx-*` já sobre-cobertos antes da 246 (650 contra 500) desceriam a 500 (liberação COVERED de 150) — o invariante do legado é "nunca acima do que era".

### Para quem integra
1. `node scripts/operations/apply-248.mjs --target=qa --apply` sem spec rodando (a migration troca a visão de cobertura e cria FKs para requisições, pedidos e requisitos: leitores da visão e escritores dessas tabelas esperam até o COMMIT). O `qa:build` já encadeia a 248 depois da 247.
2. `node scripts/operations/security-audit.mjs --target=qa` (390/390 esperado).
3. O TS da 248 (rota do pedido, Compras, Dashboard, Apex, linha do tempo) e o `tests/qa-live/dashboard-supply-flow.spec.ts` dependem da migration aplicada (`global-setup` exige a ponta 248).

### Fora desta entrega (escopo congelado pelo usuário; acompanhamentos próprios)
- **Impasse de travas do recebimento**, inclusive cancelamento ∥ `goods_receipt_post`/`goods_receipt_inspect`/`inventory_transfer_receive` de OUTRO pedido com ≥ 2 requisitos em comum: o recebimento trava requisitos na ordem dele; o PostgreSQL aborta um lado e o `governedRpc` repete o 40P01 (até 3 vezes). Conserto: o recebimento pré-travar os requisitos em ordem de uuid.
- **Proposta acima da quantidade cotada** (a linha do pedido passa da alocação; o excedente fica sem requisito).
- **Edição de requisito comprometido** (quantidade/item/estado sem conferir o reclamado): a 248 só não recompra além da capacidade no cancelamento.

---

## Compras: ordem das travas e varredura da cotação sob trava (migration 249)

**Resultados:**
- ensaio no QA: 47/47 provas (`apply-249.mjs --target=qa`, revertido);
- `security-audit --target=qa --with-migrations 249`: 396/396.

**Estado:** aplicada no QA em 2026-09-26, depois da 248 (47/47 no `--apply`; auditoria 396/396; ponta 249). As correções da revisão da 248 vêm aqui, para a frente, como 246 → 247, porque a 248 já estava no QA compartilhado. Regra em `COVERAGE-SEMANTICS.md`, seção 248 ("Lock order (migration 249)").

### Defeito (revisão da 248, provado num clone do QA com COMMIT real)
- **Cancelamento de requisição ∥ cancelamento de requisição, com uma cotação ABERTA compartilhada.** Cada varredura rodava no próprio retrato e via a outra requisição ainda EM COTAÇÃO. As duas confirmavam e a cotação ficava ABERTA para sempre, só com requisições canceladas:
  - a repetição do cancelamento voltava antes da varredura;
  - a decisão recusava;
  - proposta e e-mail ao fornecedor continuavam aceitos.
- **Impasse emissão ∥ requisição da falta.** A chave estrangeira do livro de liberações travava os requisitos FOR KEY SHARE, um a um e na ordem das alocações, com as requisições já na mão. A requisição da falta trava FOR UPDATE em ordem de uuid.
- **Impasse a três.** O cancelamento segura um requisito e espera a requisição. A emissão (ou a decisão) segura a requisição e espera outro requisito pela chave estrangeira. A requisição da falta segura esse requisito e espera o do cancelamento.

### Entrou
Os corpos implantados (`pg_get_functiondef`) foram mantidos, com as mesmas assinaturas, recusas e comportamento; as mudanças estão marcadas "249".
- **`purchase_requisition_cancel`:**
  - depois de cancelar a requisição, trava as cotações ABERTAS dela (uuid) numa instrução própria e varre numa instrução posterior, com retrato novo: quem chega depois espera o COMMIT do outro e fecha a cotação;
  - a repetição (requisição já CANCELADA) trava e varre do mesmo jeito e devolve `rfqs_cancelled`, sem novo evento. É ela que conserta uma cotação deixada aberta antes da 249.
- **`purchase_order_issue`:** logo depois do pedido (e da repetição e das conferências de APROVADO, impressão digital e fornecedor), trava FOR KEY SHARE (uuid), antes das requisições, os requisitos das alocações abertas das linhas do pedido **com resto a liberar** (aberto > pedido) — exatamente os alvos da chave estrangeira das liberações. Emissão por inteiro não libera nada e segue sem trava de requisito, como na 248 (não entra na fila do recebimento).
- **`procurement_decide`:** antes das requisições, trava FOR KEY SHARE (uuid) os requisitos das alocações abertas das linhas da cotação.
- **Ordem das travas:** [pedido] → requisitos (uuid) → requisições (uuid) → cotação. Nenhuma função segura requisição esperando requisito. O aberto só diminui (livro append-only), então o conjunto pré-travado cobre o das inserções.
- **`lib/registry.mjs`:** entrada 249 com as três assinaturas.
- **`qa:build`:** encadeia a 249 depois da 248.

### Provas (`apply-249`, sempre revertidas)
- **Governança e fonte:**
  - as três reescritas continuam só do servidor (DEFINER, `search_path` fixo, EXECUTE só do `service_role`);
  - têm as MESMAS recusas (SQLSTATE e mensagem) da 248, lidas no fonte antes da migration, na mesma transação;
  - toda linha de código da 248 continua lá, menos a volta antecipada da repetição.
- **Ordem das travas, no fonte:**
  - cancelamento: pedido → aprovação → requisitos NO KEY UPDATE → requisições → regra → estado → cotação; a trava cobre os requisitos de C (alocações abertas) e o retrato de C só vê requisitos travados;
  - emissão: pedido → conferências → requisitos KEY SHARE → requisições → liberações → PEDIDA;
  - decisão: requisitos KEY SHARE (a primeira trava) → requisições → cotação → alocações;
  - cotação: só requisições;
  - cancelamento de requisição: requisição → cotações numa instrução própria → varredura depois, e nenhuma volta antes dela;
  - requisição da falta, transferência e reserva: FOR UPDATE (uuid);
  - prefixo global: nenhum requisito é travado depois de uma requisição.
- **Varredura:**
  - a última requisição viva cancelada fecha a cotação, e a cotação fechada recusa proposta e decisão;
  - a repetição conserta a cotação deixada ABERTA, montada por escrita direta dentro do SAVEPOINT;
  - as repetições seguintes não varrem nada e não emitem evento;
  - com outra requisição ainda viva, a repetição não varre;
  - as recusas de sempre continuam: pedido vivo, motivo em branco, inexistente, ENCERRADA.
- **Emissão e decisão de sempre:**
  - caso (a): emissão de 60 libera 40; repetição; cancelamento reabre 60, reclamado 100;
  - decisão mista (B2) com `not_ordered`, mais a repetição;
  - emissão recusa o pedido de requisição cancelada.
- **Lacunas da revisão da 248:**
  - 1, salvaguarda do legado PEDIDA: RC-A PEDIDA com X aberta 60 sem pedido, RC-B 40 e RC-C 60. Cancelar o PO-B libera 60 COVERED na alocação de X, o reclamado fica em 100 (não 160) e a RC-A passa a AGUARDANDO.
  - 4, demo B: os dois pedidos emitidos e o R1 cancelado. O cancelamento libera 100 como REQUIREMENT_INACTIVE e a RC-A segue PEDIDA.
  - 4, demo D: o cancelamento deixa a RC-A EM COTAÇÃO e a emissão do PO-B a leva a PEDIDA.
  - 5, orçamento que aperta: transferência pendente de 30, RC-A com 70 e RC-B com 30 por exceção, pedido cheio, reclamado 130 e orçamento 70.
    - A mais antiga fica com a reabertura; a mais nova fica com a linha COVERED de 30. Reclamado 100.
    - Por construção, a ordem por data e a ordem por uuid da alocação discordam.
  - 6: cotar uma linha toda liberada dá 23514 com a mensagem exata; a outra linha segue cotável com 50.
- **Neutralidade:** a repetição sobre as 4 requisições canceladas do QA (menos a demo de Tucuruí), cada uma desfeita, não varre nada. O QA não tem cotação aberta só de requisições mortas. Tucuruí está intacta.
- **Mutação (runner de sabotagem, sempre revertido):** cada sabotagem abaixo derruba ao menos uma prova.
  - Da revisão (s1–s7): sem o ramo PEDIDA, sem a salvaguarda, ordem do orçamento invertida (ou só por uuid), sem a recusa da linha toda liberada, a trava de requisitos do cancelamento apontada para um conjunto vazio, a decisão sem o filtro do aberto, e a PEDIDA da emissão contando linha liberada. As duas do meio caem só no fonte; a corrida que depende da trava do cancelamento é a do qa-live.
  - Da 249: sem a trava das cotações, repetição que volta antes da varredura, e emissão ou decisão sem a pré-trava ou com ela depois das requisições.

### Corridas com COMMIT real (clone descartável do QA)
O clone foi feito assim:
- `pg_dump` dos esquemas `public`, `auth` e `supabase_migrations` do QA (ponta 248);
- restaurado num cluster PostgreSQL 17.11 em `/tmp/claude-501/pg249`;
- **apagado depois**.

As corridas rodaram primeiro com a 248 e depois com a 249 aplicada por cima. Uma sessão de tempo segurou uma linha para abrir a janela, como na revisão.

| Corrida | 248 | 249 |
|---|---|---|
| cancelamento de RC ∥ cancelamento de RC, cotação compartilhada (A segura 2 s e B entra 1 s depois; ou as duas seguram 2 s juntas) | as duas devolvem `rfqs_cancelled: []` e a cotação fica ABERTA | 4/4: a segunda espera a trava da cotação e a cancela (`Solicitação <RC> cancelada`) |
| repetição do cancelamento sobre as duas cotações deixadas abertas pela 248 | — | fecha as duas (`replayed: true` com `rfqs_cancelled`). A repetição seguinte devolve `[]`; decisão e proposta recusadas |
| emissão ∥ requisição da falta. Forma do revisor: uma linha com R1 100 + R2 50, pedido de 20, 1ª liberação no r_hi, alocação do r_lo segura 3 s | 40P01 na emissão (2 processos) | 2/2 sem impasse. A emissão libera 100 + 30; R1 fica 200/200 e R2 100/100 |
| cancelamento ∥ emissão ∥ requisição da falta (r2 < r1) | 40P01 a três | 2/2 sem impasse; r1 100/100, r2 100/100 |
| cancelamento ∥ decisão ∥ requisição da falta | 40P01 a três | 2/2 sem impasse; r1 100/100, r2 100/100 |
| emissão ∥ cancelamento com RC compartilhada, nas duas ordens | — | sem impasse; r1 100/100, r2 50/50, RC-A EM COTAÇÃO |
| decisão ∥ cancelamento de requisição, nas duas ordens | — | Cancelamento primeiro: a varredura fecha a cotação e a decisão recusa (`RFQ is CANCELLED.`). Decisão primeiro: o cancelamento recusa (`already has a purchase order`) |
| decisão ∥ cancelamento com dois requisitos em comum, nas duas ordens | — | sem impasse; 200/200 e 200/200 |
| cancelamento (pedido de 60 de 100) ∥ requisição da falta / reserva / transferência de 40, nas duas ordens | — | 6/6 com reclamado 100/100 |
| recebimento de OUTRO pedido (ordem invertida) ∥ emissão cheia / decisão — **fora do escopo** | sem impasse (a emissão cheia não travava requisito) | com a pré-trava em todas as alocações abertas: 40P01 nos dois. Por isso a pré-trava da emissão foi estreitada ao resto a liberar: a emissão cheia volta a não travar requisito; a decisão segue na classe do recebimento, documentada |

### Para quem integra
1. **Aplicar a 249 no QA:** `node scripts/operations/apply-249.mjs --target=qa --apply`, depois da 248 (que já está aplicada) e sem spec rodando, porque a migration troca três funções que as rotas usam. O `qa:build` já encadeia a 249.
2. **Auditar:** `node scripts/operations/security-audit.mjs --target=qa` deve dar 396/396.
3. **TypeScript:** nada muda. A repetição do cancelamento de requisição passa a trazer `rfqs_cancelled`, uma chave a mais que a rota repassa. O `global-setup` do qa-live deve exigir a ponta 249.

### Resultados vivos (248 + 249 no QA, `next dev` em :9103)
- `dashboard-supply-flow.spec.ts` **21/21**: o fluxo do Dashboard, as regressões da 246 e as da 248/249 (14 pedido parcial → RC-B → cancelamento pela rota: reclamado = requerido, reabre 60, recotação de 60, Compras mostra o aberto e a nota; 15 cancelamento ∥ requisição e ∥ reserva; 16 emissão ∥ cancelamento nas DUAS ordens forçadas; 17 proposta velha de requisição cancelada; 18 corrida no legado — pedido parcial emitido antes da 248, sem liberação — nas duas ordens: reclamado 100; 19 a linha que a proposta não cotou volta a ser cotada pela tela de Compras).
- `golden-path.spec.ts` **8/8**; `approvals` + `concurrency` + `roles-api` + `intelligence` **25/25**; unitários **3.933/3.933**; `tsc` e eslint limpos.
- `tests/integration/ops-supply-route-rpc-contract-live.test.ts` exige SSL (banco hospedado) e não rodou contra o QA; as assinaturas das seis funções reescritas são as mesmas (CREATE OR REPLACE não troca nomes de parâmetro).

### Fora desta entrega (escopo congelado)
- **Impasse do recebimento.** `goods_receipt_post`, `goods_receipt_inspect` e `inventory_transfer_receive` travam requisitos na ordem deles. Com OUTRO pedido de ≥ 2 requisitos em comum, ainda podem cruzar com quem trava em ordem de uuid:
  - o cancelamento (248);
  - pela mesma ordem do recebimento, a pré-trava KEY SHARE da emissão PARCIAL (a que tem resto a liberar) e da decisão (provado no clone). A emissão por inteiro não trava requisito.

  O PostgreSQL aborta um lado e o `governedRpc` repete o 40P01 até 3 vezes. Conserto único: o recebimento pré-travar os requisitos em ordem de uuid.
- **Proposta acima da quantidade cotada.**
- **Edição de requisito comprometido.**

---

## Compras: proposta, decisão e pedido nunca acima do aberto (migration 250)

**Estado:** aplicada no QA em 2026-09-26 (ensaio 40/40 → `--apply` 40/40; `security-audit --target=qa` 402/402; ponta 250). Regra em `COVERAGE-SEMANTICS.md`, seção 250.

### Defeito
A proposta aceitava qualquer quantidade > 0: 150 numa linha de cotação de 100. A decisão criava a linha do pedido com os 150 e alocava aos requisitos só até o aberto (100) — 50 comprados sem requisito, e a cobertura mostrava 100 em pedido. Nada conferia a quantidade de novo na decisão nem na emissão. Uma segunda decisão, com OUTRA proposta, numa cotação já decidida devolvia o pedido da primeira como "repetição".

### Entrou
- **`procurement_quote_record`:** por linha, quantidade > 0 (`Quote line quantity must be positive.`, 22023); requisição em busca (`Requisition % is %: its line can no longer be quoted.`); cotado ≤ cotável = LEAST(linha da cotação, aberto de agora da linha de requisição) (`Quoted quantity % exceeds the quoteable quantity % (requisition %).`). Uma linha acima recusa a proposta inteira; nada é aparado.
- **`procurement_decide`:** repetição só com a MESMA proposta (`RFQ is already decided on another quote.`); cada linha que vira pedido ≤ aberto de agora, conferido SOB as travas que a decisão já tomava (`Quoted quantity % exceeds the current open quantity % (requisition %): record a new quote.`); nenhuma unidade sem requisito (invariante).
- **`purchase_order_issue`:** cada linha ≤ o que a requisição cobre — Σ alocações do pedido, ou a quantidade da linha manual (`Purchase order line orders % but its requisition covers only %: it cannot be issued.`).
- **Nenhuma trava nova** e nenhum dado reescrito (o QA não tinha proposta viva nem pedido acima do cotado).
- **TypeScript:** português para as sete recusas (e `PROCUREMENT_OWNED` as reserva a compras); a linha da cotação ganha `quoteable`; o formulário de proposta em Compras tem quantidade por linha até o cotável (em branco = o cotável inteiro; acima = erro na linha, sem aparar) e a linha fora do pedido não recebe proposta.
- **`lib/registry.mjs`** (entrada 250) e **`qa:build`** (encadeia a 250).

### Provas e regressões
- **`apply-250.mjs`** (sempre revertida): governança, toda linha da 249 mantida, as recusas novas exatas, nenhuma trava nova, neutralidade no QA, e os casos exata, acima (nada gravado), zero, quantidade padrão, parcial, segunda decisão depois da parcial (60 + 40 = 100), envelhecida, outra proposta em cotação decidida, várias linhas, linha morta, linha manual e a emissão como última barreira. Sabotagem: sem o teto da proposta, 7 provas caem; sem a reconferência da decisão, cai a envelhecida.
- **`dashboard-supply-flow.spec.ts`**, bloco 250 (rotas reais): 20 exata/acima; 21 parcial e segunda decisão; 22 envelhecida; 23 várias linhas e dois fornecedores; 24 decisões concorrentes na mesma cotação, nas duas ordens forçadas — em todas, o invariante: nada pedido acima do requerido e toda unidade com requisito.

### Fora desta entrega
- Impasse de travas do recebimento; edição de requisito comprometido (acompanhamentos próprios).

---

## Supply: uma ordem de travas só — o recebimento entra nela (migration 251)

**Estado:** aplicada no QA em 2026-09-26 (ensaio 19/19 → `--apply` 19/19; `security-audit --target=qa` 408/408; ponta 251). Regra em `COVERAGE-SEMANTICS.md`, seção 251.

### Causa
`goods_receipt_post`, `goods_receipt_inspect` e `inventory_transfer_receive` travavam a chave de estoque (`inventory_lock`) e só depois o requisito, linha a linha e na ordem da necessidade; todo o resto trava requisito antes da chave, e vários em ordem de uuid. Ordens opostas sobre os mesmos requisitos e chaves → 40P01, e a repetição do `governedRpc` era a única defesa.

### Entrou
- **Ordem canônica:** [linha-documento] → requisitos (uuid) → requisições (uuid) → cotação → chaves de estoque (item, local, em ordem) → linhas, alocações, reservas e movimentos.
- **Os três recebimentos** pré-travam, logo depois da linha-documento, todos os requisitos que vão tocar (FOR UPDATE, uuid) e todas as chaves de estoque (em ordem) — a inspeção inclui as chaves da quarentena e do destino da liberação. Nenhuma outra mudança: mesmas assinaturas, recusas, teto de reserva, repetições e eventos. A repetição do 40P01 fica só como defesa.
- **`lib/registry.mjs`** (entrada 251), **`qa:build`** (encadeia a 251), **`global-setup`** (ponta 251).

### Provas e regressões
- **`apply-251.mjs`** (sempre revertida): 19/19 — governança, corpo implantado mantido, ordem no fonte, quem já seguia a ordem, e a semântica em sequência (recebimento com reserva até o teto e repetição; quarentena + inspeção com rejeito e liberação; recebimento de transferência com repetição; dois requisitos numa linha pela necessidade).
- **`concurrency.spec.ts`, bloco 251** — intercalação forçada com COMMIT real, cada função na sua sessão (sem a repetição do governedRpc): recebimento ∥ reserva; recebimento de transferência ∥ reserva; recebimento ∥ cancelamento, emissão parcial e decisão de outro pedido com dois requisitos em comum. **No QA ainda na 250, os cinco deram `deadlock detected` (contador de impasses do banco 1 → 6); na 251, os cinco passam e o contador não se move.**
- **Estresse adversarial** (mesmo arquivo, `STRESS_ROUNDS`): 30 rodadas × 6 escritores simultâneos sobre os mesmos requisitos (metade com o recebimento preso no meio) → 180 atos, 148 aplicados, 32 recusas de domínio (23514), **0 impasse**, contador do banco parado, recebimento uma vez só, reclamado ≤ requerido.

### Fora desta entrega
- Edição de requisito comprometido (acompanhamento próprio).

---

## Requisito com cobertura: editar sem deixar a cobertura inconsistente (migration 252)

**Estado:** aplicada no QA em 2026-09-26 (ensaio 30/30 → `--apply` 30/30; `security-audit --target=qa` 415/415; ponta 252). Regra em `COVERAGE-SEMANTICS.md`, seção 252.

### Defeito
A edição e a mudança de estado do requisito travavam o requisito mas não olhavam a cobertura: quantidade abaixo do reservado/transferido/requisitado/em pedido (100 → 80 com pedido de 100 emitido), item trocado com cobertura do item antigo, e cancelar/substituir/planejar deixando reservas, transferências, requisições e pedidos presos a uma demanda morta.

### Entrou
- **`project_requirement_coverage_footprint`** (só servidor): o reclamado da 246 por parcela (reservado, consumido, transferências pendentes e em trânsito, em pedido, em inspeção, requisitado), com o ativo (= reclamado − consumido) e o texto de cada parcela; **`supply_quantity_text`** (quantidade exata em texto).
- **`project_requirement_upsert`:** quantidade menor que o comprometido → recusa com as parcelas; item trocado com cobertura → recusa; data alterada → fato `operations.requirement.rescheduled` (antes e agora), sem tocar em quantidade nem em compra. Aumento: a cobertura fica, só a diferença vira falta.
- **`project_requirement_transition`:** CANCELADO / SUBSTITUÍDO / PLANEJADO recusados com cobertura ativa (o consumido não impede).
- **TypeScript:** as três recusas em português nas rotas de editar e de mudar o estado do requisito (`requirementCoverageErrorMessage`); título na linha do tempo para a data alterada.
- **`lib/registry.mjs`** (entrada 252), **`qa:build`** (encadeia a 252), **`global-setup`** (ponta 252).

### Provas e regressões
- **`apply-252.mjs`** (sempre revertida): 30/30 — governança, corpo implantado mantido, uma trava só, retrato = reclamado, e os casos de aumento, redução acima e abaixo, item com e sem cobertura, cancelar/planejar/substituir com reserva, transferência, requisição e pedido (e depois da reconciliação), consumido e data. Sabotagem: sem a guarda de redução caem 3 provas; sem a do item, 1; sem a do estado, 5.
- **`concurrency.spec.ts`, bloco 252** (COMMIT real, as duas ordens forçadas na trava do requisito): reduzir ∥ reservar, reduzir ∥ requisitar a falta, editar (quantidade e item) ∥ receber, cancelar ∥ reservar — nenhum impasse, quem chega depois é recusado com o motivo certo, recebimento uma vez só, reclamado ≤ requerido.

### Observado, fora do escopo
- `procurement_number` sorteia 5 dígitos hexadecimais por dia: num dia com centenas de requisições de teste, a primeira tentativa de aplicar a 252 caiu numa colisão de número (`preqn_number_unique`, tudo desfeito); a segunda passou. Não é da regra de cobertura.
- **Caminho dourado, passo 7 (recebimento), falha determinística alheia à 252.** `receiving-read.ts` pede todos os itens de uma vez (`.in('id', …)`). O QA acumulou cerca de 250 itens em aberto, dados descartáveis das rodadas de teste, e a URL passou de ~8 KB. A API local responde 414 (medido: 200 ids passam; 260 dão 414). O erro é ignorado, e as linhas perdem código e unidade ("Chegou bom ()"), de modo que o rótulo `Recebido <código>` some. Os passos 1–6 passam. Fica para uma entrega própria: dividir a busca em lotes e não engolir o erro.

---

## Runbook de deploy

1. **Banco hospedado**: `node scripts/operations/apply-237.mjs` (ensaio revertido) → `--apply`; depois `apply-238.mjs` idem. Conferir `node scripts/operations/security-audit.mjs` (somente leitura) após cada uma.
2. **Worker**: publicar o worker com os handlers `supply.intelligence.sweep` e da reconciliação de aprovação; só então as rotas de desfecho (semeadas desligadas) se ativam pelo dreno.
3. **Papéis**: atribuir `compras` e `almoxarifado` às pessoas reais (a segregação depende disso) e declarar a alçada de compra (`procurement.authorities.manage`) com a evidência (ata/procuração).
4. **App**: deploy da branch só depois de 1–3 — as rotas de escrita governada pressupõem as funções e assinaturas de 237/238.
