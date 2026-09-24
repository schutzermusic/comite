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
