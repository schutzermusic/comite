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
