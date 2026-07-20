# Insight Apex — Módulo de Diárias de Campo

> Documento de arquitetura funcional, regras de negócio, UI/UX, integrações, segurança, rollout e prompt para Claude Opus.
>
> Objetivo: automatizar a geração semanal de diárias de alimentação para colaboradores em campo, reduzindo o risco de pagar pessoas que não estarão efetivamente nas obras, sem exigir transferências manuais todos os dias.

---

# 1. Visão geral

Atualmente, as diárias são preparadas manualmente, normalmente na sexta-feira, para cobrir a semana seguinte.

O principal risco operacional é gerar diárias para pessoas que:

- já foram desmobilizadas;
- estão de férias ou afastadas;
- não possuem alocação ativa;
- foram transferidas de obra;
- não estão previstas na escala;
- pertencem a outro projeto;
- já receberam a diária;
- não compareceram ao campo;
- possuem dados bancários incorretos ou não validados.

A solução deve manter a rotina operacional atual de sexta-feira, mas substituir a planilha manual por um motor de elegibilidade, revisão por exceção, geração de lote e conciliação posterior.

Fluxo macro:

```text
Quinta-feira
→ sistema gera automaticamente a prévia da próxima semana

Quinta e sexta-feira
→ gestores revisam apenas exceções

Sexta-feira
→ Financeiro aprova um único lote semanal

Durante a semana
→ jornada, geolocalização e apontamentos confirmam a execução

Próxima sexta-feira
→ divergências entram como ajuste, compensação ou análise
```

---

# 2. Posição no menu

Adicionar em:

```text
Pessoas & Custos
├── Visão Geral
├── Fechamento da Folha
├── Capacidade e Alocação
├── Pessoas
├── Jornada
├── Diárias
├── Aprovações de Horas
├── Custo de MO
├── Governança
├── Inteligência
├── Geofences
└── Ponto Oficial
```

Nome no menu:

```text
Diárias
```

Título da página:

```text
Diárias de Campo
```

Isso evita confusão com hotel, hospedagem ou viagens administrativas.

---

# 3. Princípio central

A diária não deve ser gerada apenas porque o colaborador está cadastrado em um projeto.

A elegibilidade deve considerar:

```text
Vínculo ativo
+ alocação válida
+ obra elegível
+ escala prevista
+ mobilização vigente
+ ausência de férias ou afastamento
+ ausência de duplicidade
+ política de diária aplicável
= diária prevista
```

Após o pagamento antecipado, a execução real deve ser conciliada com:

```text
Jornada
+ geolocalização
+ geofence
+ apontamento
+ obra efetivamente registrada
= diária confirmada
```

---

# 4. Modelo operacional recomendado

## 4.1. Planejamento semanal na quinta-feira

O sistema gera uma prévia automática da semana seguinte.

Exemplo:

```text
Semana: 27/07/2026 a 02/08/2026
Colaboradores previstos: 82
Diárias previstas: 410
Valor previsto: R$ 18.450,00
```

Cada colaborador deve ser avaliado por dia.

| Colaborador | Projeto | Seg | Ter | Qua | Qui | Sex | Total |
|---|---|---:|---:|---:|---:|---:|---:|
| Carlos Santos | CEMIG | R$ 45 | R$ 45 | R$ 45 | R$ 45 | R$ 45 | R$ 225 |
| Marcos Lima | ENEL | R$ 45 | R$ 45 | — | — | — | R$ 90 |
| João Alves | CEMIG | — | — | R$ 45 | R$ 45 | R$ 45 | R$ 135 |

O sistema nunca deve criar apenas:

```text
Carlos Santos — Semana 30 — R$ 225
```

Internamente, deve criar registros individuais:

```text
Carlos Santos — 27/07 — R$ 45
Carlos Santos — 28/07 — R$ 45
Carlos Santos — 29/07 — R$ 45
Carlos Santos — 30/07 — R$ 45
Carlos Santos — 31/07 — R$ 45
```

Isso permite alterar somente um dia sem reprocessar a semana inteira.

## 4.2. Revisão por exceção

O gestor não deve conferir manualmente todos os nomes.

A tela deve destacar apenas:

```text
3 colaboradores sem alocação válida
2 com desmobilização prevista
1 em férias
4 adicionados recentemente
2 com mudança de obra
1 com conflito de escala
```

Os registros limpos podem ser considerados aptos automaticamente para o lote, conforme política.

## 4.3. Aprovação na sexta-feira

O Financeiro aprova um único lote semanal.

```text
Lote: DIARIAS-2026-W31
Período: 27/07 a 02/08
Colaboradores: 82
Diárias: 410
Valor total: R$ 18.450,00
```

A execução pode ocorrer por:

- Pix em lote;
- arquivo bancário;
- API bancária;
- cartão ou carteira corporativa;
- sistema de benefícios;
- exportação para ferramenta financeira existente.

O Financeiro realiza uma operação de lote, não transferências manuais individuais.

## 4.4. Conciliação durante a semana

O sistema compara o planejado com a execução real.

```text
Carlos recebeu 5 diárias: R$ 225
Compareceu em 3 dias: R$ 135
Diferença: R$ 90
```

Status possíveis:

- confirmado;
- divergente;
- compensação pendente;
- justificativa aceita;
- erro operacional;
- mudança emergencial;
- valor não recuperável;
- análise de RH;
- análise financeira.

Não realizar desconto automático sem regra previamente validada por RH, Financeiro e Jurídico.

---

# 5. Regras de elegibilidade

A avaliação deve ocorrer por pessoa, data e política.

```ts
function evaluateDailyAllowance(input: EligibilityInput) {
  if (!input.activeEmployment) {
    return "blocked_inactive_employment";
  }

  if (!input.activeAllocation) {
    return "blocked_no_allocation";
  }

  if (!input.eligibleWorksite) {
    return "blocked_ineligible_worksite";
  }

  if (!input.scheduledToWork) {
    return "blocked_not_scheduled";
  }

  if (input.onLeave) {
    return "blocked_leave";
  }

  if (input.demobilizedBeforeDate) {
    return "blocked_demobilized";
  }

  if (input.alreadyHasAllowance) {
    return "blocked_duplicate";
  }

  if (!input.applicablePolicy) {
    return "blocked_no_policy";
  }

  return "planned_eligible";
}
```

Cada resultado deve guardar o motivo exato.

---

# 6. Classificação automática

## 6.1. Elegível

```text
✓ Vínculo ativo
✓ Alocação válida
✓ Escala confirmada
✓ Obra elegível
✓ Política vigente
✓ Sem férias ou afastamento
✓ Sem desmobilização
✓ Sem duplicidade
```

## 6.2. Em revisão

```text
• Mudança recente de obra
• Escala ainda não confirmada
• Alocação iniciando durante a semana
• Desmobilização sem data definitiva
• Trabalho externo autorizado
• Conflito entre projeto e obra
• Cadastro bancário alterado recentemente
```

## 6.3. Bloqueado

```text
• Vínculo inativo
• Sem alocação ativa
• Férias
• Afastamento
• Desmobilização anterior à data
• Projeto encerrado
• Obra não elegível
• Diária duplicada
• Política inexistente
• Conta de pagamento inválida
```

---

# 7. Estrutura da página

## 7.1. Indicadores superiores

| Indicador | Exemplo |
|---|---:|
| Colaboradores previstos | 82 |
| Diárias previstas | 410 |
| Valor previsto | R$ 18.450 |
| Confirmadas | 374 |
| Aguardando revisão | 24 |
| Bloqueadas | 12 |
| Divergências da semana anterior | 9 |
| Ajustes financeiros | R$ 540 |

## 7.2. Abas internas

```text
Diárias de Campo
├── Planejamento semanal
├── Operação do dia
├── Lotes de pagamento
├── Exceções
├── Políticas
└── Histórico e conciliação
```

---

# 8. Tela — Planejamento semanal

## 8.1. Cabeçalho

```text
Diárias — Semana de 27/07 a 02/08
```

Ações:

- gerar prévia;
- recalcular;
- revisar exceções;
- enviar para gestores;
- aprovar lote;
- exportar;
- comparar com semana anterior;
- visualizar impacto por projeto.

## 8.2. Tabela principal

| Colaborador | Projeto | Obra | Seg | Ter | Qua | Qui | Sex | Total | Status |
|---|---|---|---|---|---|---|---|---:|---|
| Carlos Santos | CEMIG | UHE X | Confirmada | Confirmada | Confirmada | Confirmada | Confirmada | R$ 225 | Elegível |
| Marcos Lima | ENEL | Base Y | Confirmada | Confirmada | Desmobilizado | Bloqueada | Bloqueada | R$ 90 | Parcial |
| João Alves | CEMIG | UHE X | Sem escala | Sem escala | Confirmada | Confirmada | Confirmada | R$ 135 | Elegível |
| Bruno Costa | ENEL | Base Y | Revisão | Revisão | Revisão | Revisão | Revisão | R$ 225 | Conflito |

Estados por dia:

- prevista;
- confirmada;
- bloqueada;
- em revisão;
- sem escala;
- férias;
- afastamento;
- desmobilizada;
- projeto encerrado;
- paga;
- conciliada;
- divergente.

---

# 9. Drawer de evidências

Ao abrir um colaborador ou uma diária:

```text
Diária de Carlos Santos
Data: 27/07/2026
Projeto: Modernização UHE X
Obra: CEMIG — Cachoeira Dourada
Valor: R$ 45,00
```

## Evidências de planejamento

```text
✓ Vínculo ativo
✓ Alocação ativa entre 01/07 e 31/08
✓ Escala confirmada
✓ Obra elegível
✓ Política DIARIA-CEMIG-2026 aplicável
✓ Nenhuma ausência conhecida
✓ Nenhuma diária duplicada
```

## Evidências posteriores

```text
✓ Entrada registrada às 07:42
✓ Biometria validada
✓ Dentro da geofence
✓ Distância: 38 metros
✓ Precisão do GPS: 12 metros
✓ Apontamento realizado no projeto correto
```

## Resultado

```text
Prevista na sexta-feira
Paga em lote
Confirmada por execução real
Sem divergências
```

---

# 10. Política de diária

As regras não devem ficar fixas no código.

| Regra | Exemplo |
|---|---|
| Nome | Diária Alimentação CEMIG |
| Tipo | Alimentação |
| Valor | R$ 45,00 |
| Projeto | CEMIG |
| Obra | UHE Cachoeira Dourada |
| Vigência | 01/07/2026 a 31/12/2026 |
| Exige alocação | Sim |
| Exige escala | Sim |
| Exige vínculo ativo | Sim |
| Bloqueia férias | Sim |
| Bloqueia afastamento | Sim |
| Exige geofence para conciliação | Sim |
| Permite terceiros | Não |
| Permite feriado | Conforme escala |
| Aprovação automática | Sim |
| Gestor de exceção | Responsável da obra |

---

# 11. Modelo de dados

## 11.1. AllowancePolicy

```ts
interface AllowancePolicy {
  id: string;
  organization_id: string;
  company_id?: string;

  name: string;

  allowance_type:
    | "meal"
    | "travel"
    | "lodging"
    | "transport"
    | "other";

  project_id?: string;
  contract_id?: string;
  worksite_id?: string;

  amount: number;
  currency: "BRL";

  effective_from: string;
  effective_until?: string;

  active_employment_required: boolean;
  active_allocation_required: boolean;
  confirmed_schedule_required: boolean;

  block_on_leave: boolean;
  block_on_demobilization: boolean;

  attendance_required_for_reconciliation: boolean;
  geofence_required_for_reconciliation: boolean;

  geofence_tolerance_meters?: number;
  auto_approval_enabled: boolean;

  status: "draft" | "active" | "inactive";

  created_at: string;
  updated_at: string;
}
```

## 11.2. AllowanceWeek

```ts
interface AllowanceWeek {
  id: string;
  organization_id: string;

  week_start: string;
  week_end: string;

  status:
    | "draft"
    | "generated"
    | "manager_review"
    | "hr_validation"
    | "finance_approved"
    | "scheduled"
    | "processing"
    | "paid"
    | "reconciliation"
    | "closed"
    | "cancelled";

  total_people: number;
  total_items: number;
  total_amount: number;

  generated_by?: string;
  generated_at?: string;
  approved_by?: string;
  approved_at?: string;

  version: number;

  created_at: string;
  updated_at: string;
}
```

## 11.3. DailyAllowance

```ts
interface DailyAllowance {
  id: string;
  organization_id: string;
  allowance_week_id: string;

  person_id: string;
  employment_contract_id?: string;

  allowance_date: string;
  allowance_type: "meal";

  project_id: string;
  worksite_id?: string;
  allocation_id?: string;
  policy_id: string;

  amount: number;
  currency: "BRL";

  status:
    | "candidate"
    | "planned"
    | "under_review"
    | "blocked"
    | "approved"
    | "included_in_batch"
    | "processing"
    | "paid"
    | "confirmed"
    | "divergent"
    | "compensation_pending"
    | "reversed";

  eligibility_reason?: string;
  blocking_reason?: string;

  planned_evidence: Record<string, unknown>;
  reconciliation_evidence?: Record<string, unknown>;

  attendance_punch_id?: string;
  location_evidence_id?: string;
  time_entry_id?: string;

  rule_version: string;
  payment_batch_id?: string;
  idempotency_key: string;

  created_at: string;
  updated_at: string;
}
```

## 11.4. AllowancePaymentBatch

```ts
interface AllowancePaymentBatch {
  id: string;
  organization_id: string;
  allowance_week_id: string;

  batch_code: string;
  payment_date: string;

  item_count: number;
  total_amount: number;

  status:
    | "draft"
    | "pending_approval"
    | "approved"
    | "processing"
    | "partially_paid"
    | "paid"
    | "failed"
    | "cancelled";

  payment_method:
    | "pix_batch"
    | "bank_file"
    | "bank_api"
    | "benefit_card"
    | "manual_export";

  requested_by: string;
  approved_by?: string;
  provider_reference?: string;

  created_at: string;
  processed_at?: string;
}
```

## 11.5. AllowancePayment

```ts
interface AllowancePayment {
  id: string;
  organization_id: string;

  allowance_id: string;
  payment_batch_id: string;

  person_id: string;
  amount: number;

  status:
    | "pending"
    | "processing"
    | "paid"
    | "failed"
    | "reversed";

  provider_reference?: string;
  failure_code?: string;
  failure_message?: string;

  requested_at: string;
  paid_at?: string;
}
```

## 11.6. AllowanceAdjustment

```ts
interface AllowanceAdjustment {
  id: string;
  organization_id: string;

  person_id: string;
  allowance_id?: string;
  source_week_id?: string;
  target_week_id?: string;

  type:
    | "supplement"
    | "compensation"
    | "manual_correction"
    | "approved_exception"
    | "write_off";

  amount: number;
  reason: string;

  status:
    | "draft"
    | "pending_approval"
    | "approved"
    | "applied"
    | "cancelled";

  requested_by: string;
  approved_by?: string;

  created_at: string;
  applied_at?: string;
}
```

---

# 12. Proteção contra duplicidade

Criar restrição única no banco:

```text
organization_id
+ person_id
+ allowance_date
+ allowance_type
+ policy_id
```

Chave de idempotência:

```text
allowance:{organization_id}:{person_id}:{date}:{allowance_type}:{policy_id}
```

Para lotes:

```text
allowance-batch:{organization_id}:{week_start}:{week_end}:{version}
```

O processo pode ser executado novamente sem duplicar diária ou pagamento.

---

# 13. Workflow semanal

```text
DRAFT
→ GENERATED
→ MANAGER_REVIEW
→ HR_VALIDATION
→ FINANCE_APPROVED
→ SCHEDULED
→ PROCESSING
→ PAID
→ RECONCILIATION
→ CLOSED
```

## DRAFT

Semana ainda não calculada.

## GENERATED

Prévia gerada automaticamente.

## MANAGER_REVIEW

Gestores revisam somente exceções.

## HR_VALIDATION

Vínculo, férias, afastamentos e desligamentos são cruzados.

## FINANCE_APPROVED

Financeiro aprova valor, quantidade e lote.

## SCHEDULED

Lote pronto para pagamento.

## PROCESSING

Em processamento bancário.

## PAID

Pagamentos enviados.

## RECONCILIATION

Execução real é comparada com o planejado.

## CLOSED

Semana auditada e encerrada.

---

# 14. Mudanças após aprovação

Não apagar ou sobrescrever silenciosamente o plano aprovado.

Gerar eventos de ajuste:

- colaborador adicionado;
- colaborador removido;
- obra alterada;
- dia cancelado;
- valor alterado;
- pagamento complementar;
- compensação;
- justificativa;
- reabertura.

Cada alteração deve registrar:

- valor anterior;
- valor novo;
- solicitante;
- aprovador;
- motivo;
- data e hora;
- impacto financeiro;
- versão do plano.

---

# 15. Integrações

## Pessoas

Fornece vínculo, situação, gestor, unidade, tipo de contratação e dados de pagamento.

## Capacidade e Alocação

Fornece projeto, obra, período, percentual, função e centro de custo.

## Jornada

Fornece entrada, intervalo, saída, faltas, atrasos, escala e jornada executada.

## Geofences

Fornece obra, área autorizada, raio, polígono, tolerância e validação espacial.

## Projetos

Fornece status, contrato, obra, responsável, centro de custo e orçamento.

## Financeiro

Recebe lote, obrigação, projeto, centro de custo, pagamento, comprovante e conciliação.

## Custo de mão de obra

```text
Custo de mão de obra
+ diárias de alimentação
+ hospedagem
+ transporte
+ custos de campo
= custo total de pessoas do projeto
```

---

# 16. Segurança e segregação de funções

| Perfil | Responsabilidade |
|---|---|
| Operações | Define alocação, obra e escala |
| Gestor da obra | Revisa exceções |
| RH | Valida vínculo, férias e afastamentos |
| Financeiro | Aprova e executa lote |
| Diretoria | Aprova valores acima de limite |
| Auditoria | Consulta evidências e histórico |
| Administrador | Configura o sistema, sem aprovar pagamento |

Regras:

- quem altera conta bancária não aprova o pagamento correspondente;
- quem gera o lote não deve ser o único aprovador;
- alterações bancárias recentes devem gerar bloqueio ou revisão;
- dados bancários devem ser protegidos;
- webhooks devem ser assinados;
- todo pagamento deve possuir idempotência;
- acessos sensíveis devem ser auditados.

---

# 17. UI/UX recomendada

## 17.1. Direção visual

A nova aba deve seguir a linguagem atual do Insight Apex:

- cabeçalho executivo;
- cards compactos;
- tabela densa;
- filtros persistentes;
- status por cor;
- drawer lateral;
- timeline de evidências;
- empty states úteis;
- comparação com semana anterior;
- destaque de exceções;
- aprovação em massa com segurança.

## 17.2. Filtros

- semana;
- empresa;
- projeto;
- obra;
- gestor;
- centro de custo;
- status;
- vínculo;
- tipo de contratação;
- política;
- valor;
- divergência;
- pago/não pago;
- ajuste pendente.

## 17.3. Ações em massa

- aprovar elegíveis;
- bloquear selecionados;
- enviar para gestor;
- gerar lote;
- exportar;
- recalcular;
- marcar exceção;
- criar ajuste;
- fechar semana.

---

# 18. Casos especiais

O módulo deve tratar:

- colaborador transferido de obra;
- desmobilização no meio da semana;
- mobilização após segunda-feira;
- férias lançadas retroativamente;
- afastamento;
- feriado;
- domingo;
- jornada noturna;
- terceiro;
- PJ;
- temporário;
- obra sem internet;
- GPS indisponível;
- ponto offline;
- trabalho externo;
- mudança de política;
- projeto encerrado;
- conta bancária inválida;
- pagamento falho;
- duplicidade;
- alteração retroativa;
- mais de uma diária no mesmo dia;
- segunda diária por jornada extensa;
- complemento;
- compensação futura;
- valor não recuperável.

---

# 19. Alertas inteligentes

```text
Colaborador recebeu diária, mas não possui jornada válida.
Colaborador foi pago após desmobilização.
Pessoa recebeu diária durante férias.
Obra possui 32 alocados, mas 41 diárias.
Projeto encerrado recebeu diárias.
Colaborador recebeu diária em projeto diferente da geolocalização.
Pagamento duplicado bloqueado.
Conta bancária alterada antes do lote.
Diárias subiram 27% sem aumento de pessoas ou horas.
```

O sistema deve chamar esses casos de:

```text
Inconsistência de diária — requer análise
```

Não acusar automaticamente fraude.

---

# 20. Modo simulação

Antes de executar pagamentos reais, rodar em paralelo por duas ou três semanas.

```text
Sistema gera quem deveria receber
→ não envia pagamento
→ compara com a planilha manual
→ registra divergências
→ regras são calibradas
```

Indicadores:

- incluídos pelo sistema e não pelo manual;
- incluídos pelo manual e não pelo sistema;
- falsos bloqueios;
- falsos elegíveis;
- valor divergente;
- motivo recorrente;
- diferença por obra;
- diferença por gestor.

---

# 21. Fases de implantação

## Fase 1 — Planejamento semanal

- aba Diárias;
- política;
- semana;
- geração automática;
- registros por dia;
- tabela;
- filtros;
- exceções;
- duplicidade;
- auditoria.

## Fase 2 — Revisão e aprovação

- revisão por gestor;
- validação RH;
- aprovação financeira;
- versionamento;
- ajustes;
- histórico.

## Fase 3 — Lote financeiro

- geração de lote;
- exportação;
- pagamento em lote;
- retorno;
- falhas;
- comprovantes.

## Fase 4 — Conciliação

- jornada;
- geofence;
- apontamento;
- divergência;
- compensação;
- fechamento semanal.

## Fase 5 — Inteligência

- alertas;
- comparação histórica;
- anomalias;
- previsão;
- custo por projeto;
- painel executivo.

---

# 22. Critérios de aceite

## Planejamento

- semana é gerada automaticamente;
- cada diária possui data individual;
- pessoas sem elegibilidade são bloqueadas;
- motivo do bloqueio é salvo;
- duplicidade é impossível no banco;
- total semanal é reproduzível.

## Aprovação

- gestor revisa somente exceções;
- RH valida vínculo e ausências;
- Financeiro aprova o lote;
- alteração após aprovação gera nova versão;
- histórico é preservado.

## Pagamento

- um lote semanal pode conter múltiplos pagamentos;
- idempotência evita duplicidade;
- falhas são individualizadas;
- retorno bancário é conciliado;
- comprovante é armazenado.

## Conciliação

- jornada é comparada com a diária;
- obra real é comparada com obra prevista;
- divergências geram ajuste;
- semana pode ser fechada;
- reabertura exige permissão.

## Segurança

- dados bancários são protegidos;
- alterações são auditadas;
- segregação de funções é respeitada;
- RLS isola tenants;
- perfis veem somente o necessário.

---

# 23. Decisões arquiteturais

## ADR-001 — Registros diários, lote semanal

**Decisão:** criar uma diária por pessoa e data, agrupada em lote semanal.

**Motivo:** permite precisão diária sem exigir transferências manuais diárias.

## ADR-002 — Revisão por exceção

**Decisão:** registros limpos avançam automaticamente.

**Motivo:** reduz trabalho operacional.

## ADR-003 — Planejamento antecipado, conciliação posterior

**Decisão:** pagar a semana antecipadamente e validar a execução depois.

**Motivo:** mantém a rotina atual e reduz erro.

## ADR-004 — Ajustes imutáveis

**Decisão:** mudanças geram ajustes e novas versões.

**Motivo:** auditoria e controle financeiro.

## ADR-005 — Políticas configuráveis

**Decisão:** regras não ficam hardcoded.

**Motivo:** contratos e obras possuem regras diferentes.

## ADR-006 — Sem acusação automática

**Decisão:** usar alertas de inconsistência.

**Motivo:** evitar falso positivo e risco trabalhista.

---

# 24. Perguntas que o plano técnico deve responder

1. Onde estão pessoas, vínculos e gestores?
2. Como obras e projetos são representados?
3. Existe entidade de mobilização e desmobilização?
4. Existe escala?
5. Como férias e afastamentos são armazenados?
6. Existe jornada oficial?
7. Existe geofence ativa?
8. Existe apontamento por projeto?
9. Como o financeiro registra pagamentos?
10. Já existe lote ou obrigação financeira?
11. Quais políticas RLS existem?
12. Como funciona auditoria?
13. Existe mecanismo genérico de aprovação?
14. Como dados bancários são armazenados?
15. Existe integração bancária?
16. Como tratar terceiros?
17. Como tratar quem trabalha em várias obras?
18. Qual o dia limite de geração?
19. Qual o valor por contrato?
20. Como compensações são autorizadas?
21. Quem pode reabrir semana?
22. Como custo de diária chega ao projeto?
23. Como o sistema lida com feriados?
24. Quais regras mudam por empresa?
25. Qual deve ser o período de retenção?

---

# 25. Prompt para Claude Opus

```text
Você é um arquiteto sênior de software enterprise trabalhando no Insight Apex.

Leia integralmente este documento sobre o módulo de Diárias de Campo.

Objetivo de negócio:
Automatizar a geração semanal de diárias de alimentação para colaboradores em campo, mantendo um único lote de pagamento na sexta-feira para a semana seguinte, mas criando internamente uma diária por pessoa e por dia, com validação por vínculo, alocação, obra, escala, mobilização, férias, afastamentos e política aplicável.

Regra central:
Não devemos fazer transferências manuais diárias. O sistema deve gerar registros diários, agrupar em um único lote semanal, pagar antecipadamente e depois conciliar com jornada, geolocalização, geofence e apontamentos reais.

Antes de implementar qualquer alteração:

1. Inspecione o repositório completo.
2. Localize os módulos existentes de:
   - Pessoas & Custos
   - Pessoas
   - Organograma
   - Capacidade e Alocação
   - Jornada
   - Aprovações de Horas
   - Geofences
   - Ponto Oficial
   - Projetos
   - Contratos
   - Financeiro
   - Folha
   - Auditoria
   - Aprovações
   - RBAC
   - RLS
3. Mapeie as tabelas, migrations, tipos, serviços, hooks, componentes e rotas relacionados.
4. Identifique o que já existe e pode ser reutilizado.
5. Não crie domínios duplicados.
6. Não implemente ainda.
7. Entregue primeiro apenas um plano técnico aderente ao código real.
8. Preserve o padrão live-first.
9. Não introduza mocks em fluxos de produção.
10. Não altere arquivos fora do escopo sem justificar.
11. Planeje migrations reversíveis.
12. Preserve compatibilidade com dados existentes.
13. Considere multiempresa, multitenancy, RLS, auditoria e segregação de funções.
14. Considere segurança de dados bancários e idempotência.
15. Considere que alterações após aprovação devem gerar versões e ajustes, nunca sobrescrever silenciosamente.
16. Considere o uso criterioso das bibliotecas de animação já preferidas no projeto, apenas quando agregarem valor à UX:
    - Motion
    - anime.js
    - GSAP
    - react-spring
17. Não usar todas simultaneamente no mesmo fluxo.
18. Priorize tabela densa, filtros, drawers, estados claros e aprovação por exceção.
19. Identifique decisões que dependem de RH, Financeiro, Jurídico ou Operações.
20. Aguarde aprovação antes de começar a implementação.

Entregáveis obrigatórios:

A. Inventário do estado atual
- arquivos
- rotas
- componentes
- hooks
- serviços
- migrations
- tabelas
- tipos
- RLS
- auditoria
- aprovações
- integrações
- módulos reutilizáveis

B. Gap analysis
Para cada requisito:
- existente
- parcialmente existente
- ausente
- precisa refatoração
- risco
- dependência

C. Arquitetura alvo
- bounded contexts
- entidades
- estados
- comandos
- queries
- eventos
- permissões
- integrações
- fluxo semanal
- reconciliação

D. Plano de banco de dados
- novas tabelas
- alterações
- constraints
- índices
- RLS
- funções
- views
- triggers apenas se realmente necessários
- backfill
- rollback
- idempotência
- versionamento

E. Plano de frontend
- rota da aba Diárias
- estrutura da página
- cards
- tabela semanal
- filtros
- drawer de evidências
- estados
- empty states
- erros
- responsividade
- acessibilidade

F. Plano de regras de negócio
- elegibilidade
- bloqueios
- revisão
- lote
- duplicidade
- pagamento
- conciliação
- ajuste
- fechamento
- reabertura

G. Plano de segurança
- RBAC
- ABAC
- RLS
- dados bancários
- segregação de funções
- logs
- auditoria
- retenção
- proteção contra replay
- assinatura de webhooks
- idempotência

H. Plano de testes
- unitários
- integração
- RLS
- E2E
- concorrência
- idempotência
- duplicidade
- aprovação
- reconciliação
- regressão

I. Roadmap
Divida em fases pequenas, reversíveis e testáveis.

Para cada fase, informar:
- objetivo
- dependências
- arquivos afetados
- migrations
- implementação
- testes
- validação
- riscos
- critérios de pronto

J. Questões em aberto
Liste tudo que precisa de validação de produto, RH, Financeiro, Jurídico e Operações.

Importante:
O plano deve considerar a seguinte decisão arquitetural:

“Uma diária individual por colaborador e por data, agrupada em um lote semanal único.”

Não proponha pagamento manual diário como fluxo principal.

Entregue primeiro o plano técnico completo. Não implemente nada até nova autorização.
```

---

# 26. Resultado esperado

O processo deve sair de:

```text
Responsável abre planilha
→ tenta lembrar quem estará na obra
→ multiplica dias
→ copia dados bancários
→ envia pagamentos
→ corrige erros depois
```

Para:

```text
Sistema gera a próxima semana
→ cruza vínculo, alocação, obra e escala
→ bloqueia ausências conhecidas
→ gestores revisam exceções
→ Financeiro aprova um lote
→ pagamento ocorre na sexta
→ execução real é conciliada
→ diferenças viram ajuste
→ custo chega ao projeto
```

O módulo deve se tornar uma camada enterprise de:

- elegibilidade;
- planejamento;
- pagamento;
- conciliação;
- auditoria;
- prevenção de erro;
- apropriação de custo;
- inteligência operacional.
