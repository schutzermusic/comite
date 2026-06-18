# Plano de Modernização do Módulo de Contratos (Control Room)

Este documento descreve os requisitos e a arquitetura para a modernização completa do módulo de **Contratos**, transformando-o em uma **Contract Control Room** conectada aos demais módulos do ecossistema SaaS.

---

## ━━━━━━━━━━━━━━━━━━
## 1. MODERNIZE THE CONTRACTS PAGE UI
## ━━━━━━━━━━━━━━━━━━

A interface da página principal de **Gestão de Contratos** será reestruturada para refletir um cockpit executivo/Glass HUD.

### Melhorias Visuais:
- **Glass HUD / Cockpit Executivo**: Uso intensivo de glassmorphism, sombras neon e texturas sutis (como fibra de carbono ou metal escovado) baseadas na identidade visual da marca.
- **Grades Alinhadas**: Ajuste nos espaçamentos (`gap` e `padding`) e altura dos cards para consistência e aproveitamento ideal da tela em diferentes níveis de zoom (80%, 100%, 125%).
- **Filtros Compactos**: Otimização do espaço vertical ocupado pela barra de filtros, utilizando um grid responsivo e chips de filtros ativos.
- **Conectividade Visual**: Layout de lista e detalhe melhor integrado, com transições suaves e estados visuais claros para indicar urgência (alto risco, vencimento próximo, pendência documental).
- **Sem Overflow**: Garantia de rolagem limpa e adaptabilidade a telas pequenas (notebooks e dispositivos móveis).

---

## ━━━━━━━━━━━━━━━━━━
## 2. EXECUTIVE KPI STRIP
## ━━━━━━━━━━━━━━━━━━

A faixa de KPIs no topo da página será reconstruída para exibir métricas cruciais de governança com estilo glass premium e alturas consistentes.

### KPIs Requeridos:
1. **Exposição Total** (Valor total acumulado dos contratos ativos)
2. **Backlog Contratual** (Saldo pendente de faturamento)
3. **Valor Faturado** (Total executado financeiramente)
4. **Saldo a Faturar** (Saldo remanescente de faturamento)
5. **Contratos a Vencer** (Contratos com término nos próximos 30/90 dias)
6. **Alto Risco** (Quantidade de contratos classificados como risco alto)
7. **Documentos Faltantes** (Quantidade de pendências de arquivos essenciais)
8. **Em Revisão Jurídica** (Contratos em fluxo de análise jurídica)
9. **SLA Médio de Aprovação** (Tempo médio de trâmite de aprovação)

Cada card contará com ícone contextualizado, rótulo de baixo contraste, valor de destaque, severidade por status (cores do tema) e tooltip descritiva.

---

## ━━━━━━━━━━━━━━━━━━
## 3. FILTERS AND GOVERNANCE CONTROLS
## ━━━━━━━━━━━━━━━━━━

A área de filtros será otimizada para ser compacta e altamente interativa.

### Filtros Existentes:
- Busca textual (código, título, contraparte, projeto)
- Empresa vinculada
- Projeto vinculado
- Status do contrato
- Nível de risco
- Vencimento do contrato
- Tipo de contrato

### Novos Filtros Rápidos (Quick Filters):
- **Alto risco** (Risco = high)
- **Vencendo em 30 dias** (Expiração <= 30 dias)
- **Sem projeto** (Sem projeto associado)
- **Sem faturamento** (Sem lançamentos faturados)
- **Em revisão jurídica** (Status = legal_review)
- **Documentos pendentes** (Documentos obrigatórios ausentes)
- **Saldo a faturar** (Saldo restante > 0)
- **Sem análise IA** (Nenhuma análise realizada)

Os filtros aplicarão reatividade imediata na lista de contratos, nos KPIs e nos dashboards associados.

---

## ━━━━━━━━━━━━━━━━━━
## 4. CONTRACT LIST / CONTROL ROOM
## ━━━━━━━━━━━━━━━━━━

A lista principal de contratos será modernizada para exibir informações de controle em nível de linha/card.

### Atributos por Contrato:
- Código do contrato (ex: CTR-001)
- Título do contrato e Tipo (ex: Prestação de Serviços)
- Cliente/Empresa (Contraparte)
- Projeto vinculado (com link de navegação)
- Responsável interno (Owner)
- Exposição financeira (Valor Total, Valor Faturado e Saldo a Faturar)
- Progresso financeiro (%) representado por barra de progresso colorida
- Nível de risco e Score de risco (ex: 78/100)
- Status de aprovação/ciclo de vida
- Status de renovação/expiração (dias restantes)
- Indicadores visuais para:
  - Alto risco
  - Vencido ou vencendo em breve
  - Falta de documentos
  - Falta de vínculo com projeto
  - Faturamento pendente
  - Revisão jurídica pendente

---

## ━━━━━━━━━━━━━━━━━━
## 5. CONTRACT DETAIL PANEL / DOSSIER
## ━━━━━━━━━━━━━━━━━━

Ao selecionar um contrato, a lateral ou área de detalhes exibirá o **Dossiê do Contrato**, estruturado nas seguintes seções:

- **A. Identidade do Contrato**: Código, título, tipo, status atual, contraparte, responsável, data de criação e vigência (início/fim).
- **B. Vínculos e Relações**: Projeto associado, centro de custo, conta/razão financeira, eventos de faturamento vinculados, riscos associados, documentos anexos, tarefas e reuniões da agenda.
- **C. Exposição Financeira**: Valor total, faturado, saldo, nível de exposição, margem estimada (se aplicável) e status de reconhecimento de receita.
- **D. Workflow de Aprovação**: Rota de aprovação com status de cada alçada (Jurídico, Financeiro, Comitê e Diretoria).
- **E. Inteligência de IA**: Cláusulas analisadas, score de risco da IA, cláusulas ausentes, penalidades extraídas, obrigações identificadas e conformidade.
- **F. Ações Rápidas**:
  - Abrir dossiê completo (página de detalhes dedicada)
  - Vincular/desvincular projeto existente ou criar novo a partir do contrato
  - Vincular faturamento ou criar evento de faturamento
  - Criar tarefa na agenda ou criar risco associado
  - Enviar para revisão do jurídico
  - Exportar PDF do dossiê
  - Anexar novos documentos

---

## ━━━━━━━━━━━━━━━━━━
## 6. TABS STRUCTURE
## ━━━━━━━━━━━━━━━━━━

Organização das seções internas do módulo em abas de governança:

1. **Visão Geral**: Dashboards executivos, resumo do contrato selecionado e próximos marcos.
2. **Contratos**: Cockpit principal com lista, tabela de governança e modos de visualização (Tabela / Cards / Kanban de Risco).
3. **Análise IA**: Detalhamento da extração de inteligência documental e auditoria de cláusulas por IA.
4. **Renovações**: Linha do tempo de expiração e radar de vencimentos.
5. **Obrigações**: Checklist de obrigações contratuais com responsáveis e status de entrega de evidências.
6. **Riscos & Cláusulas**: Mapa de riscos contratuais, cláusulas de alta exposição e planos de mitigação.
7. **Documentos**: Repositório de arquivos categorizados (contrato assinado, aditivos, apólices, certidões) com status de validade.
8. **Auditoria**: Log completo de ações executadas no contrato (criação, upload, alterações de status, aprovações).

---

## ━━━━━━━━━━━━━━━━━━
## 7. LINK WITH PROJETOS
## ━━━━━━━━━━━━━━━━━━

- **Vínculo Bidirecional**: Um contrato pode estar associado a um ou mais projetos. O projeto herda o valor total do contrato, dados da contraparte e contexto de faturamento.
- **Ação "Criar Projeto"**: Gera um projeto na base do Supabase contendo escopo, valor e vigência herdados do contrato.
- **Vínculo de Existentes**: Permite associar o contrato a um projeto já cadastrado.
- **Detecção de Duplicados**: Avisa se houver possível duplicidade (mesmo código, cliente ou título semelhante).
- **Custos Sem Projeto**: Lançamentos financeiros lançados antes da criação do projeto ficam alocados temporariamente como pendentes até que o vínculo do projeto seja estabelecido.

---

## ━━━━━━━━━━━━━━━━━━
## 8. LINK WITH FINANCEIRO
## ━━━━━━━━━━━━━━━━━━

- O contrato atua como a origem comercial e jurídica, enquanto o módulo Financeiro executa os lançamentos.
- **Lançamentos Vinculados**: Exibição de contas a receber (faturas) e lançamentos de diário vinculados ao contrato pelo campo `contract_id` no livro razão.
- **Custos Pendentes**: Custos com `contract_id` mas sem `project_id` aparecem para alocação pendente de projeto.
- **Ações**: Criar evento de faturamento, vincular lançamento, abrir contas a receber e gerar curvas de faturamento real x previsto.

---

## ━━━━━━━━━━━━━━━━━━
## 9. LINK WITH FATURAMENTO
## ━━━━━━━━━━━━━━━━━━

Integração com o fluxo de faturamento (milestones/cronograma físico-financeiro):
- **Marcos de Faturamento**: Datas previstas de emissão de NF e valores acordados.
- **Eventograma**: Cronograma planejado vs realizado de faturamento.
- **Alertas**: Notificação de faturamento atrasado, retenções contratuais e amortizações de adiantamento.

---

## ━━━━━━━━━━━━━━━━━━
## 10. LINK WITH RISCOS
## ━━━━━━━━━━━━━━━━━━

- **Geração de Riscos**: Criação de riscos (legais, operacionais, financeiros) diretamente a partir de cláusulas ou pendências do contrato.
- **Visualização**: Exibição dos riscos contratuais no dossiê de detalhes e listagem unificada no módulo de Riscos geral.
- **Métricas**: Score de risco total e contagem de mitigações pendentes.

---

## ━━━━━━━━━━━━━━━━━━
## 11. LINK WITH AGENDA & TAREFAS
## ━━━━━━━━━━━━━━━━━━

- **Tarefas de Agenda**: Criação automática ou manual de tarefas ligadas a marcos contratuais (lembrete de renovação, prazo de revisão jurídica, entrega de garantia).
- **Atribuição**: Exclusiva para membros internos da organização.
- **Notificações**: Alertas em tempo real no app e envio de e-mails para responsáveis internos quando uma tarefa contratual é criada ou expira.

---

## ━━━━━━━━━━━━━━━━━━
## 12. DOCUMENT MANAGEMENT
## ━━━━━━━━━━━━━━━━━━

- **Repositório Categorizado**: Armazenamento no bucket `contract-files` do Supabase para contrato principal, aditivos, apólices de seguro, garantias bancárias e ordens de compra.
- **Validade e Status**: Monitoramento de documentos válidos, expirados, expirando nos próximos dias, ausentes ou rejeitados na aprovação.
- **Ações**: Upload, substituição, marcação de obrigatoriedade e exportação do dossiê em PDF consolidado.

---

## ━━━━━━━━━━━━━━━━━━
## 13. AI CONTRACT ANALYSIS
## ━━━━━━━━━━━━━━━━━━

- **Campos de IA**: Extração de partes, valor total, datas de vigência, prazos de renovação, multas, obrigações de SLA e conformidade.
- **Estado Pendente de Backend**: Exibição clara do aviso `"Análise IA pendente de backend"` quando o motor de processamento real não estiver conectado, evitando dados simulados enganosos.

---

## ━━━━━━━━━━━━━━━━━━
## 14. ENTERPRISE WORKFLOW
## ━━━━━━━━━━━━━━━━━━

- **Ciclo de Vida do Contrato**: Estados como rascunho (`draft`), em revisão (`under_review`), revisão jurídica (`legal_review`), revisão financeira (`finance_review`), comitê (`committee_review`), aprovado (`approved`), ativo (`active`), suspenso (`suspended`), expirado (`expired`), cancelado (`cancelled`) e encerrado (`closed`).
- **Workflow de Aprovação**: Roteiro configurável com responsáveis de cada alçada (Jurídico, Financeiro, Comitê, Diretoria) exibindo SLA, datas de aprovação e justificativas de rejeição.

---

## ━━━━━━━━━━━━━━━━━━
## 15. DASHBOARDS / ANALYTICS
## ━━━━━━━━━━━━━━━━━━

- **Gráficos Executivos**:
  - Contratos por status (distribuição)
  - Exposição financeira por nível de risco
  - Faturamento planejado vs realizado (curva/barras)
  - Radar de renovações mensais
  - Mapa de obrigações por status (atrasadas, pendentes, concluídas)
  - Matriz de risco vs valor contratual
- **Layout Limpo**: Sem excesso de elementos e cores harmonizadas com o tema do dashboard.

---

## ━━━━━━━━━━━━━━━━━━
## 16. PDF EXPORT
## ━━━━━━━━━━━━━━━━━━

- Geração de relatório PDF estruturado com capa do sistema, resumo executivo, dados financeiros, obrigações, riscos, documentos e log de auditoria.
- Utilização de folha de estilo específica para impressão (`@media print`), ocultando barras laterais e cabeçalhos de navegação.

---

## ━━━━━━━━━━━━━━━━━━
## 17. DATA MODEL / SUPABASE
## ━━━━━━━━━━━━━━━━━━

Abaixo estão as tabelas a serem validadas e criadas via migrações seguras no Supabase:

- `contract_obligations` (Obrigações contratuais a cumprir)
- `contract_billing_events` (Marcos físico-financeiros de faturamento)
- `contract_documents` (Controle detalhado de garantias, apólices e anexos)
- `contract_approvals` (Histórico e controle de workflow de aprovação por alçada)
- `contract_risks_links` (Vínculo de muitos-para-muitos entre contratos e tabela de riscos gerais)
- `contract_project_links` (Vínculo de muitos-para-muitos entre contratos e projetos)
- `contract_ai_analysis` (Resultados da análise documental por IA)
- `audit_logs` (Logs de auditoria de governança, utilizando a estrutura central já existente)

Todas as tabelas serão protegidas por políticas de segurança Row Level Security (RLS) baseadas em escopo de organização (`organization_id`).

---

## ━━━━━━━━━━━━━━━━━━
## 18. RBAC
## ━━━━━━━━━━━━━━━━━━

Implementação rigorosa das permissões do módulo:
- `contracts.view` (Visualizar lista e detalhes de contratos)
- `contracts.create` (Adicionar novo contrato)
- `contracts.edit` (Editar campos e metadados de contratos)
- `contracts.delete` (Exclusão lógica de contratos)
- `contracts.approve` (Aprovar alçada no workflow)
- `contracts.legal_review` (Revisar na alçada jurídica)
- `contracts.finance_review` (Revisar na alçada financeira)
- `contracts.documents.upload` (Fazer upload de documentos anexos)
- `contracts.ai_analyze` (Disparar extração/auditoria de IA)
- `contracts.export` (Exportar dossiê e relatórios em PDF/Planilhas)
