# Insight Apex — Workflow Medição → Aceite → Faturamento → Financeiro

## Objetivo

Implementar um workflow único e governado:

**Projeto → Medições & Evidências → Pré-análise Apex → Contratos/Aprovações → Aceite da Contratante → Faturamentos → Financeiro/NF → Recebível**

Não criar sistemas paralelos. Reutilizar as fontes canônicas já existentes para contratos, marcos, timeline, medições, documentos, faturamento, notificações e financeiro.

---

## Responsabilidades

### Gestão de Projetos
Responsável por:
- execução operacional;
- cronograma;
- evidências;
- relatórios técnicos;
- preparação da medição.

### Gestão de Contratos
Responsável por:
- revisão contratual da medição;
- conferência das exigências do contrato;
- solicitar correções;
- aprovar pacote para envio;
- enviar ao cliente;
- registrar aceite externo da contratante.

### Contratos → Faturamentos
Responsável por:
- verificar elegibilidade contratual;
- expor o marco como pronto para faturar quando todos os requisitos forem satisfeitos.

### Financeiro
Responsável por:
- emissão da NF;
- criação/acompanhamento do recebível;
- vencimento;
- liquidação;
- caixa.

---

## 1. Projetos → Medições & Evidências

Para cada marco contratual com mapping aceito, mostrar um work item operacional com:

- marco/evento contratual;
- atividade/EDT vinculada;
- data prevista;
- execução;
- exigências contratuais;
- documentos/evidências;
- status da medição;
- análise contratual;
- aceite da contratante;
- elegibilidade para faturamento.

### Evidências

Cada evento deve permitir upload de PDFs/documentos como:
- relatório de medição;
- relatório técnico;
- ensaio;
- inspeção;
- Databook;
- protocolo;
- relatório fotográfico;
- outros documentos comprobatórios.

Usar **um único registro documental**. O mesmo `document_id` deve aparecer em Medições & Evidências e em Projeto → Documentos. Não duplicar arquivo físico.

---

## 2. “O que falta” — requisitos estruturados

Para cada medição, mostrar as exigências contratuais reais daquele marco.

Exemplo:

- atividade executada;
- relatório técnico;
- ensaio obrigatório;
- assinatura;
- relatório de medição;
- aceite da contratante.

Classificar requisitos como:
- operacional;
- documental;
- medição;
- aprovação interna;
- aceite externo.

Não inventar requisitos genéricos.

---

## 3. Pré-análise automática do Apex

Após upload de evidência, processar o documento e comparar com as exigências estruturadas daquele marco.

Verificar, quando possível:
- tipo do documento;
- contrato/projeto citado;
- datas;
- equipamento/serviço;
- entregável;
- resultados de ensaio;
- assinaturas;
- identificadores obrigatórios;
- informações exigidas pelo contrato.

Retornar:

- **REQUISITOS ATENDIDOS**
- **REQUISITOS NÃO ATENDIDOS**
- **INFORMAÇÃO NÃO LOCALIZADA**
- **INCONSISTÊNCIAS**
- **REVISÃO HUMANA NECESSÁRIA**

Exemplo:

`4/5 requisitos verificáveis atendidos`

A pré-análise **não é aceite contratual** e não deve aprovar automaticamente informação incerta.

---

## 4. Envio do Projeto para Contratos

Ação:

**ENVIAR PARA ANÁLISE CONTRATUAL**

Após envio:

`AGUARDANDO ANÁLISE CONTRATUAL`

O mesmo estado deve aparecer em:
- Projeto → Medições & Evidências;
- Projeto → Contexto Contratual;
- Contratos → Aprovações.

Não criar cópias do marco/medição.

---

## 5. Contratos → Aprovações

Criar/usar uma fila específica para medições:

- Aguardando análise
- Em análise
- Correção solicitada
- Reenviada
- Aprovada para envio
- Aguardando aceite da contratante
- Correção solicitada pela contratante
- Aceite recebido

Cada item deve mostrar:
- contrato;
- projeto;
- marco;
- valor, se autorizado;
- atividade vinculada;
- documentos;
- exigências do contrato;
- resultado da pré-análise Apex;
- pendências/inconsistências;
- data de envio;
- SLA;
- histórico.

---

## 6. Decisão da Gestão de Contratos

### Solicitar correção ao Projeto

Exigir motivo e itens a corrigir.

Status:

`CORREÇÃO SOLICITADA`

Notificar o Gestor do Projeto.

O mesmo item volta ao Projeto, com a lista exata de correções. O gestor corrige os documentos e usa:

**REENVIAR PARA ANÁLISE**

Não criar nova medição.

### Aprovar para envio ao cliente

Status:

`APROVADA PARA ENVIO AO CLIENTE`

Isso significa apenas que o pacote interno está pronto. Não significa aceite da contratante.

---

## 7. Envio e aceite da Contratante

Ação da Gestão de Contratos:

**ENVIAR PARA ACEITE DA CONTRATANTE**

Registrar:
- responsável interno;
- contato/cliente;
- data de envio;
- referência da comunicação;
- documentos enviados;
- prazo/SLA quando aplicável.

Status:

`AGUARDANDO ACEITE DA CONTRATANTE`

Quando o cliente responder, usar:

**REGISTRAR ACEITE DA CONTRATANTE**

Nunca usar um simples “Aceitar” interno.

Registrar:
- contratante;
- aprovador/contato, quando conhecido;
- data;
- protocolo/referência;
- observação;
- PDF/e-mail/comprovante;
- usuário interno que registrou.

O sistema deve representar: **“usuário X registrou que a contratante Y aceitou”**.

Se o cliente pedir correção:

`CORREÇÃO SOLICITADA PELA CONTRATANTE`

Encaminhar para Projeto quando a correção for operacional.

---

## 8. Elegibilidade e Faturamento

Após o aceite externo, recalcular o estágio canônico.

Não considerar elegível apenas porque houve aceite. Respeitar todas as exigências contratuais.

Quando tudo estiver satisfeito:

`ELEGÍVEL PARA FATURAR`

Expor em:

**Contratos → Faturamentos**

Mostrar:
- medição;
- evidências;
- análise contratual;
- aceite;
- valor;
- elegibilidade.

Não criar evento de faturamento antes das condições governadas.

---

## 9. Financeiro / NF

Quando legitimamente autorizado, criar/expor trabalho para o responsável financeiro:

`NF A EMITIR`

Mostrar:
- cliente;
- contrato;
- projeto;
- marco;
- valor autorizado;
- referência do aceite;
- documentos;
- instruções de faturamento;
- prazo/termos vindos de fonte autoritativa.

Financeiro controla:

**NF → Recebível → Vencimento → Liquidação → Recebido**

Contratos e Projetos não podem fabricar recebimento.

---

## 10. Estados principais

Reutilizar vocabulário canônico existente. Conceitualmente:

`EM PREPARAÇÃO`
→ `PRÉ-ANÁLISE`
→ `AGUARDANDO ANÁLISE CONTRATUAL`
→ `EM ANÁLISE`
→ `CORREÇÃO SOLICITADA` / `APROVADA PARA ENVIO`
→ `AGUARDANDO ACEITE DA CONTRATANTE`
→ `ACEITE RECEBIDO`
→ `ELEGÍVEL PARA FATURAR`
→ `NF A EMITIR`
→ `FATURADO`
→ `RECEBIDO`

Não criar segunda state machine se a atual puder ser reutilizada/estendida.

---

## 11. Responsáveis

Resolver usuários por assignments autoritativos já existentes.

Precisamos conceitualmente de:
- Project Manager;
- Contract Manager;
- Billing owner;
- Finance owner.

Não fazer fuzzy matching por nome.

Se não houver responsável:

`RESPONSÁVEL NÃO DEFINIDO`

e encaminhar para fila/departamento autorizado, sem adivinhar.

---

## 12. Notificações obrigatórias

Todo handoff relevante deve gerar:

1. **notificação in-app**
2. **e-mail via infraestrutura Resend existente**

Reutilizar `create_notification`/serviço atual. Não criar outro notification engine.

Eventos relevantes:

- evidência/pendência detectada → Gestor do Projeto;
- enviado para análise → Gestor de Contratos;
- correção solicitada → Gestor do Projeto;
- reenviado → Gestor de Contratos;
- aprovado para cliente → Gestor de Contratos;
- cliente sem resposta/SLA → Gestor de Contratos;
- cliente pediu correção operacional → Projeto + Contratos;
- aceite recebido → Gestão de Contratos;
- elegível para faturar → Billing/Finance responsável;
- NF a emitir → Financeiro;
- NF emitida / recebido → interessados autorizados.

Não notificar todo o departamento por padrão.

Notificação deve ter contexto e link direto para o item.

---

## 13. SLA e auditoria

Para etapas relevantes, suportar:
- `due_at`;
- warning thresholds;
- overdue;
- escalonamento quando configurado;
- deduplicação de notificações.

Cada transição deve registrar:
- estado anterior;
- novo estado;
- ator;
- timestamp;
- motivo/comentário;
- origem;
- documentos relacionados;
- referência externa do cliente quando houver.

---

## 14. Segurança e autonomia

O Apex pode automaticamente:
- analisar documentos;
- comparar com requisitos;
- apontar faltas/inconsistências;
- rotear trabalho;
- notificar;
- controlar SLA;
- recalcular elegibilidade.

O Apex **não pode** automaticamente:
- inventar evidência;
- declarar medição concluída sem fato autoritativo;
- fingir aceite do cliente;
- aprovar inferência contratual incerta;
- fabricar evento de faturamento;
- fabricar NF;
- fabricar recebível/pagamento.

Preservar RLS, RBAC, tenant isolation e permissões financeiras.

---

## 15. Navegação

### Projeto → Medições & Evidências
- Ver no cronograma
- Ver documentos
- Ver contexto contratual
- Ver aprovação

### Contratos → Aprovações
- Ver medição
- Ver evidências
- Ver cronograma
- Ver contrato

### Contratos → Faturamentos
- Ver aceite
- Ver medição
- Ver evidências

### Financeiro
- Ver autorização
- Ver contrato
- Ver documentação

Sempre usar IDs canônicos.

---

## 16. Validação com JA10182283/2025

Usar o cenário real existente, sem mock.

Preservar:
- marcos existentes;
- mappings aceitos;
- Medições & Evidências;
- documentos canônicos;
- Contexto Contratual;
- Faturamentos;
- Resend;
- notificações in-app.

Usar rollback para testes que criariam aprovações/evidências/eventos financeiros falsos.

---

## Antes de implementar

Inspecionar:
1. workflow/estado atual de medições;
2. modelo de aprovação/aceite;
3. notificações/outbox;
4. assignments de responsáveis;
5. Resend;
6. `create_notification`;
7. políticas/SLA existentes;
8. derivação de billing eligibility.

Reutilizar arquitetura canônica antes de criar qualquer coisa nova.

---

## Acceptance Criteria

- [ ] Evidência é pré-analisada contra requisitos reais do marco.
- [ ] Pendências aparecem antes do envio para Contratos.
- [ ] Projeto envia medição para análise contratual.
- [ ] Contratos → Aprovações recebe o mesmo item.
- [ ] Contratos pode solicitar correção.
- [ ] Projeto vê a correção e reenvia o mesmo item.
- [ ] Contratos aprova para envio ao cliente.
- [ ] Projeto acompanha o status.
- [ ] Aceite externo é registrado com comprovação.
- [ ] Elegibilidade depende das regras canônicas.
- [ ] Item elegível chega a Faturamentos.
- [ ] Financeiro recebe a tarefa de NF.
- [ ] Handoffs geram in-app + e-mail.
- [ ] Destinatário é o usuário responsável.
- [ ] SLA/reminders são deduplicados.
- [ ] Histórico completo e auditável.
- [ ] Documentos continuam single-instance.
- [ ] Sem state machine paralela.
- [ ] Sem notification engine paralelo.
- [ ] Sem aceite, faturamento, NF ou recebimento fabricados.
- [ ] RLS/RBAC/tenant isolation preservados.
- [ ] Tests/typecheck/lint/build passam.

---

## Final Return

Retornar somente:

1. arquitetura reutilizada;
2. estados implementados;
3. mudanças em Medições & Evidências;
4. pré-análise automática;
5. fila de Contratos → Aprovações;
6. correção/reenvio;
7. fluxo de aceite da contratante;
8. elegibilidade/faturamento;
9. handoff para Financeiro/NF;
10. resolução de responsáveis;
11. notificações in-app/e-mail;
12. SLA/escalonamento;
13. auditoria;
14. migrations/arquivos alterados;
15. validação JA10182283;
16. RLS/RBAC;
17. testes/build;
18. fabrication audit;
19. dívida restante;
20. FINAL VERDICT: READY / NOT READY.
