# Insight Apex — Arquitetura Enterprise de Alocação, Apontamento, Jornada e Custo Real por Projeto

> Documento de referência para planejamento técnico no Claude Code.  
> Objetivo: transformar o módulo de projetos do Insight Apex em uma camada enterprise de gestão de capacidade, alocação, apontamento operacional, custo real de mão de obra, auditoria e inteligência organizacional.

---

## 1. Contexto do produto

O Insight Apex é uma plataforma corporativa de governança, projetos, contratos, financeiro, pessoas e custos.

A nova capacidade deverá conectar:

```text
Organograma
→ vínculo do colaborador
→ capacidade disponível
→ alocação planejada
→ jornada
→ apontamento por projeto
→ aprovação
→ custo-hora
→ custo real do projeto
→ conciliação com a folha
→ alertas e inteligência operacional
```

A solução deve permitir responder, com rastreabilidade:

1. Em quais projetos cada colaborador está alocado.
2. Qual percentual da capacidade está comprometido.
3. Quanto ainda está disponível para novas demandas.
4. Quem está sobrecarregado.
5. Qual é o custo-hora estimado e real de cada colaborador.
6. Quanto da folha está sendo apropriado em cada projeto.
7. Qual a diferença entre custo planejado, realizado estimado e realizado fechado.
8. Quem recebe folha sem alocação, atividade ou centro de custo compatível.
9. Quais pessoas podem ser alocadas em uma nova demanda.
10. Quais registros apresentam inconsistências de identidade, localização, jornada ou atividade.

---

# 2. Princípios arquiteturais

## 2.1. Alocação é uma relação temporal

Alocação não deve ser um atributo direto do colaborador nem do projeto.

Evitar modelos como:

```ts
person.project_id
person.allocation_percentage
```

A alocação deve ser uma entidade com:

- colaborador;
- projeto;
- função no projeto;
- período de vigência;
- percentual;
- horas planejadas;
- tipo de alocação;
- status;
- origem;
- aprovação;
- centro de custo;
- histórico.

## 2.2. Planejamento, execução e contabilidade são camadas distintas

O sistema deve separar:

```text
Alocação planejada
≠ Jornada registrada
≠ Apontamento por projeto
≠ Folha processada
≠ Custo contábil conciliado
```

Essas camadas se relacionam, mas não devem ser confundidas.

## 2.3. Eventos críticos são imutáveis

Marcações de ponto, início e fim de atividade, aprovações, correções, alterações de alocação e reconciliações financeiras devem gerar eventos auditáveis.

Não apagar ou sobrescrever silenciosamente.

Correções devem criar novos registros vinculados ao original.

## 2.4. A mesma base deve suportar múltiplas perspectivas

A solução deve alimentar:

- visão do projeto;
- visão corporativa;
- visão do colaborador;
- visão do gestor;
- visão de RH;
- visão financeira;
- visão da diretoria;
- visão de auditoria.

## 2.5. Segurança e privacidade por padrão

- custo salarial detalhado é sensível;
- biometria é dado sensível;
- localização deve ser coletada apenas quando necessária;
- o sistema deve usar princípio do menor privilégio;
- dados devem ser protegidos por tenant, empresa, projeto, papel e contexto.

---

# 3. Escopo funcional

## 3.1. Dentro de Projetos

Adicionar ou evoluir as áreas:

```text
Projetos
└── Projeto selecionado
    ├── Visão Geral
    ├── Financeiro
    ├── Contrato
    ├── Timeline
    ├── Riscos
    ├── Documentos
    ├── Equipe
    └── Apontamentos
```

### Equipe

Responsável por:

- alocação planejada;
- capacidade;
- disponibilidade;
- sobrecarga;
- custo planejado;
- matriz temporal;
- histórico;
- aprovações.

### Apontamentos

Responsável por:

- horas executadas;
- atividades;
- apontamentos aprovados;
- localização;
- divergências;
- custo realizado;
- reconciliação com jornada;
- conciliação com folha.

## 3.2. Dentro de Pessoas & Custos

```text
Pessoas & Custos
├── Organograma
├── Folha
├── Capacidade e Alocação
├── Jornada
├── Apontamentos
├── Aprovações
└── Inconsistências
```

### Capacidade e Alocação

Visão corporativa de todos os colaboradores e projetos.

### Jornada

Controle de entrada, intervalo, retorno e saída.

### Apontamentos

Distribuição do tempo produtivo por projeto, atividade, pacote de trabalho e contrato.

### Aprovações

Fila orientada a exceções.

### Inconsistências

Alertas de vínculo, alocação, atividade, jornada, localização, identidade e custo.

---

# 4. Diferença entre jornada e apontamento

## 4.1. Jornada

Registra o cumprimento do horário de trabalho.

Exemplo:

```text
07:52 — Entrada
12:03 — Início do intervalo
13:01 — Fim do intervalo
17:48 — Saída
```

## 4.2. Apontamento por projeto

Registra onde o tempo produtivo foi aplicado.

Exemplo:

```text
08:00–10:30 — Projeto CEMIG — Planejamento
10:30–12:00 — Projeto ENEL — Engenharia
13:00–17:30 — Projeto CEMIG — Execução
```

## 4.3. Conciliação

```text
Horas da jornada:             8h00
Horas apontadas em projetos:  7h30
Tempo não classificado:       0h30
```

O sistema deve identificar:

- horas de jornada sem projeto;
- horas de projeto fora da jornada;
- sobreposição de atividades;
- horas acima da capacidade;
- projeto sem alocação ativa;
- atividade após encerramento do projeto.

---

# 5. Modelo de domínio

## 5.1. Entidades principais

| Entidade | Responsabilidade |
|---|---|
| `Person` | Identidade organizacional |
| `EmploymentContract` | Vínculo, jornada, cargo, área e vigência |
| `OrganizationPosition` | Posição no organograma |
| `Project` | Projeto corporativo |
| `ProjectRole` | Função desempenhada no projeto |
| `ProjectAllocation` | Alocação planejada e aprovada |
| `CapacityPeriod` | Capacidade disponível no período |
| `LeavePeriod` | Férias, afastamentos e indisponibilidades |
| `AttendancePunch` | Evento de jornada |
| `ProjectWorkSession` | Sessão de trabalho em projeto |
| `TimeEntry` | Apontamento consolidado |
| `EmployeeCostSnapshot` | Custo do colaborador por competência |
| `ProjectLaborCostPeriod` | Custo consolidado por projeto |
| `AllocationChangeRequest` | Solicitação de alteração |
| `ApprovalDecision` | Decisão de aprovação |
| `LocationEvidence` | Evidência geográfica |
| `AuthenticationEvidence` | Evidência de autenticação |
| `RegisteredDevice` | Dispositivo vinculado |
| `IntegrityAlert` | Alerta de inconsistência |
| `AuditEvent` | Trilha de auditoria append-only |

---

# 6. Estruturas de dados sugeridas

## 6.1. ProjectAllocation

```ts
interface ProjectAllocation {
  id: string;
  organization_id: string;
  company_id?: string;

  person_id: string;
  employment_contract_id?: string;
  project_id: string;
  project_role_id?: string;

  allocation_type:
    | "billable"
    | "non_billable"
    | "overhead"
    | "bench"
    | "training"
    | "leave";

  start_date: string;
  end_date?: string;

  planned_percentage: number;
  planned_hours_week?: number;
  planned_hours_month?: number;

  status:
    | "draft"
    | "pending_approval"
    | "approved"
    | "active"
    | "ended"
    | "cancelled";

  cost_center_id?: string;
  contract_id?: string;
  work_package_id?: string;

  source:
    | "manual"
    | "project_plan"
    | "timesheet"
    | "payroll"
    | "integration";

  requested_by?: string;
  approved_by?: string;
  approved_at?: string;

  justification?: string;

  created_at: string;
  updated_at: string;
}
```

## 6.2. CapacityPeriod

```ts
interface CapacityPeriod {
  id: string;
  organization_id: string;
  person_id: string;
  employment_contract_id?: string;

  period_start: string;
  period_end: string;

  contractual_hours: number;
  leave_hours: number;
  holiday_hours: number;
  unavailable_hours: number;
  productive_capacity_hours: number;

  source: "contract" | "calendar" | "leave" | "manual";
}
```

## 6.3. AttendancePunch

```ts
interface AttendancePunch {
  id: string;
  organization_id: string;
  company_id?: string;
  person_id: string;
  employment_contract_id: string;

  type:
    | "clock_in"
    | "break_start"
    | "break_end"
    | "clock_out";

  occurred_at: string;
  received_at: string;

  timezone: string;

  location_evidence_id?: string;
  authentication_evidence_id?: string;
  device_id?: string;

  capture_mode: "online" | "offline";

  status:
    | "accepted"
    | "under_review"
    | "corrected"
    | "cancelled";

  original_punch_id?: string;
  correction_reason?: string;
  corrected_by?: string;

  sequential_number?: number;
  integrity_hash?: string;

  created_at: string;
}
```

## 6.4. ProjectWorkSession

```ts
interface ProjectWorkSession {
  id: string;
  organization_id: string;
  company_id?: string;

  person_id: string;
  project_id: string;
  allocation_id?: string;

  activity_id?: string;
  work_package_id?: string;
  cost_center_id?: string;
  contract_id?: string;

  started_at: string;
  ended_at?: string;
  duration_minutes?: number;

  description?: string;

  source:
    | "mobile_timer"
    | "manual_entry"
    | "import"
    | "manager_adjustment";

  status:
    | "running"
    | "draft"
    | "submitted"
    | "approved"
    | "rejected"
    | "locked";

  submitted_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;

  location_evidence_start_id?: string;
  location_evidence_end_id?: string;

  hourly_cost_snapshot_id?: string;
  hourly_cost_snapshot?: number;
  calculated_cost?: number;

  created_at: string;
  updated_at: string;
}
```

## 6.5. TimeEntry

```ts
interface TimeEntry {
  id: string;
  organization_id: string;
  person_id: string;
  project_id: string;

  work_date: string;
  minutes: number;

  activity_id?: string;
  work_package_id?: string;
  allocation_id?: string;

  source_session_id?: string;

  status:
    | "draft"
    | "submitted"
    | "approved"
    | "rejected"
    | "locked";

  estimated_hourly_cost?: number;
  estimated_cost?: number;

  actual_hourly_cost?: number;
  actual_cost?: number;

  reconciliation_status:
    | "not_required"
    | "pending"
    | "reconciled"
    | "divergent";
}
```

## 6.6. LocationEvidence

```ts
interface LocationEvidence {
  id: string;
  organization_id: string;
  person_id: string;

  latitude: number;
  longitude: number;
  accuracy_meters: number;

  captured_at_device: string;
  received_at_server: string;

  geofence_id?: string;
  distance_from_geofence_meters?: number;

  source: "gps" | "network" | "unknown";
  offline_capture: boolean;

  device_id?: string;

  integrity_status:
    | "trusted"
    | "limited"
    | "suspicious"
    | "unverified";

  metadata?: Record<string, unknown>;
}
```

## 6.7. AuthenticationEvidence

```ts
interface AuthenticationEvidence {
  id: string;
  organization_id: string;
  person_id: string;
  device_id?: string;

  method:
    | "device_biometric"
    | "device_credential"
    | "facial_verification"
    | "manager_override";

  result: "success" | "failure";

  assurance_level:
    | "basic"
    | "standard"
    | "enhanced";

  verified_at: string;
  provider_reference?: string;

  metadata?: Record<string, unknown>;
}
```

## 6.8. RegisteredDevice

```ts
interface RegisteredDevice {
  id: string;
  organization_id: string;
  person_id: string;

  platform: "ios" | "android" | "web";
  device_public_id: string;
  device_name?: string;

  enrolled_at: string;
  last_seen_at?: string;

  status:
    | "pending"
    | "trusted"
    | "blocked"
    | "revoked";

  integrity_level:
    | "unknown"
    | "basic"
    | "trusted"
    | "compromised";
}
```

## 6.9. EmployeeCostSnapshot

```ts
interface EmployeeCostSnapshot {
  id: string;
  organization_id: string;
  person_id: string;
  employment_contract_id?: string;

  competence_month: string;

  salary: number;
  payroll_taxes: number;
  benefits: number;
  provisions: number;
  overtime: number;
  bonuses: number;
  additional_costs: number;

  loaded_monthly_cost: number;
  productive_capacity_hours: number;
  loaded_hourly_cost: number;

  source_payroll_batch_id?: string;

  status:
    | "estimated"
    | "processed"
    | "reconciled";

  created_at: string;
}
```

## 6.10. ProjectLaborCostPeriod

```ts
interface ProjectLaborCostPeriod {
  id: string;
  organization_id: string;
  project_id: string;
  person_id?: string;

  competence_month: string;

  planned_hours: number;
  approved_hours: number;

  planned_cost: number;
  estimated_actual_cost: number;
  reconciled_actual_cost: number;

  variance_amount: number;
  variance_percentage?: number;

  status:
    | "open"
    | "estimated"
    | "payroll_processed"
    | "reconciled"
    | "locked";
}
```

## 6.11. IntegrityAlert

```ts
interface IntegrityAlert {
  id: string;
  organization_id: string;

  person_id?: string;
  project_id?: string;
  time_entry_id?: string;
  attendance_punch_id?: string;

  type:
    | "no_active_allocation"
    | "over_capacity"
    | "time_overlap"
    | "outside_geofence"
    | "location_unavailable"
    | "untrusted_device"
    | "journey_without_project"
    | "project_time_outside_journey"
    | "payroll_without_activity"
    | "inactive_person_with_activity"
    | "closed_project_with_time"
    | "duplicate_identity"
    | "cost_without_cost_center";

  severity:
    | "info"
    | "low"
    | "medium"
    | "high"
    | "critical";

  status:
    | "open"
    | "under_review"
    | "resolved"
    | "dismissed";

  evidence: Record<string, unknown>;

  detected_at: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution_notes?: string;
}
```

---

# 7. Cálculo de capacidade

## 7.1. Capacidade contratual

```text
Capacidade contratual do período
= horas previstas no contrato
- feriados
- férias
- afastamentos
- indisponibilidades aprovadas
```

## 7.2. FTE

```text
FTE alocado
= soma dos percentuais ativos ÷ 100
```

Exemplo:

```text
Pessoa A = 100%
Pessoa B = 50%
Pessoa C = 25%

FTE total = 1,75
```

## 7.3. Comprometimento total

```text
Comprometimento total
= soma das alocações ativas em todos os projetos
+ overhead
+ treinamento
+ atividades internas
```

## 7.4. Disponibilidade

```text
Disponibilidade
= 100% - comprometimento total
```

Exemplo:

```text
Projeto CEMIG: 70%
Projeto ENEL: 30%
Atividade interna: 20%

Comprometimento total: 120%
Disponibilidade: -20%
Status: sobrecarga
```

---

# 8. Cálculo de custo

## 8.1. Custo carregado mensal

Não utilizar apenas salário dividido por 220 horas.

```text
Custo carregado mensal
= salário
+ encargos
+ benefícios
+ provisões
+ horas extras
+ bônus
+ adicionais
+ outros custos atribuíveis
```

## 8.2. Custo-hora carregado

```text
Custo-hora carregado
= custo carregado mensal
÷ capacidade produtiva do período
```

## 8.3. Custo planejado por projeto

```text
Custo planejado
= custo carregado mensal
× percentual de alocação aprovado
```

## 8.4. Custo realizado estimado

```text
Custo realizado estimado
= horas aprovadas
× custo-hora estimado da competência
```

## 8.5. Custo realizado fechado

```text
Custo realizado fechado
= horas aprovadas
× custo-hora real após processamento da folha
```

## 8.6. Reconciliação

Exemplo:

```text
Custo estimado: R$ 9.324,00
Custo real:     R$ 9.660,42
Ajuste:         R$   336,42
```

A reconciliação deve gerar lançamento auditável e não alterar silenciosamente o histórico.

---

# 9. UI/UX — Equipe dentro do projeto

## 9.1. Problema da tela atual

A tela baseada em cards verticais:

- tem baixa densidade;
- não escala para dezenas ou centenas de pessoas;
- não diferencia percentual no projeto e percentual total;
- não exibe período de vigência;
- não mostra custo planejado, realizado e reconciliado;
- não mostra alocações simultâneas;
- não mostra disponibilidade futura.

## 9.2. Cabeçalho executivo

Indicadores recomendados:

- custo mensal planejado;
- custo realizado estimado;
- custo realizado reconciliado;
- variação;
- FTE alocado;
- pessoas alocadas;
- pessoas sobrecarregadas;
- pessoas sem atividade;
- capacidade disponível;
- horas pendentes de aprovação;
- inconsistências abertas.

## 9.3. Tabela principal

Colunas recomendadas:

| Coluna | Descrição |
|---|---|
| Colaborador | Nome, foto/iniciais, vínculo |
| Função no projeto | Papel operacional |
| Neste projeto | Percentual no projeto atual |
| Total empresa | Soma em todos os projetos |
| Disponível | Capacidade restante |
| Período | Início e fim da alocação |
| Horas planejadas | Horas previstas |
| Horas realizadas | Horas apontadas |
| Custo/hora | Conforme permissão |
| Custo planejado | Apropriação planejada |
| Custo realizado | Estimado ou reconciliado |
| Status | Disponível, completo, sobrecarga, inconsistência |
| Ações | Editar, visualizar, solicitar alteração |

Exemplo:

| Colaborador | Neste projeto | Total empresa | Disponível | Período | Custo/hora | Custo mensal | Status |
|---|---:|---:|---:|---|---:|---:|---|
| Alice Chen | 80% | 80% | 20% | 01/07–31/12 | R$ 148 | R$ 18.900 | Disponível |
| Bob Torres | 60% | 100% | 0% | 01/06–30/09 | R$ 176 | R$ 21.120 | Completo |
| Carlos Santos | 70% | 120% | -20% | 15/06–31/08 | R$ 74 | R$ 8.288 | Sobrecarga |

## 9.4. Drawer lateral do colaborador

Exibir:

### Identidade organizacional

- cargo;
- área;
- gestor;
- vínculo;
- localidade;
- jornada;
- competências.

### Distribuição atual

```text
Projeto Modernização UHE      70%
Contrato ENEL                 30%
Atividades administrativas   20%
Total                        120%
```

### Linha do tempo

```text
Julho       120%
Agosto      110%
Setembro     80%
Outubro      40%
```

### Custos

- custo carregado mensal;
- custo-hora;
- custo planejado no projeto;
- custo realizado;
- custo reconciliado;
- variação.

### Evidências

- últimos apontamentos;
- última localização validada;
- dispositivo vinculado;
- divergências;
- aprovações pendentes.

## 9.5. Subabas

```text
Equipe
├── Visão geral
├── Matriz de alocação
├── Custos
└── Histórico e aprovações
```

---

# 10. UI/UX — Capacidade e Alocação corporativa

## 10.1. Matriz organizacional

Linhas: colaboradores.  
Colunas: projetos, semanas ou meses.

Exemplo:

| Colaborador | UHE X | ENEL | CEMIG | Interno | Livre |
|---|---:|---:|---:|---:|---:|
| Alice Chen | 80% | 0% | 0% | 0% | 20% |
| Bob Torres | 60% | 40% | 0% | 0% | 0% |
| Carlos Santos | 70% | 30% | 20% | 0% | -20% |
| Marina Silva | 0% | 0% | 0% | 20% | 80% |

## 10.2. Filtros

- empresa;
- unidade;
- diretoria;
- área;
- gestor;
- cargo;
- competência;
- localidade;
- vínculo;
- projeto;
- contrato;
- competência técnica;
- certificação;
- disponibilidade mínima;
- custo-hora;
- período;
- status;
- centro de custo.

## 10.3. Modos de visualização

- por pessoa;
- por projeto;
- por equipe;
- por função;
- por localidade;
- por competência;
- por centro de custo;
- por disponibilidade futura.

---

# 11. UI/UX — Apontamento dentro do projeto

## 11.1. Indicadores

- pessoas trabalhando hoje;
- horas realizadas no mês;
- horas aprovadas;
- horas pendentes;
- custo realizado estimado;
- custo reconciliado;
- folha planejada;
- variação;
- registros com inconsistência;
- horas sem classificação.

## 11.2. Tabela operacional

| Colaborador | Alocação | Horas planejadas | Horas realizadas | Custo/hora | Custo realizado | Último registro | Localização | Status |
|---|---:|---:|---:|---:|---:|---|---|---|
| Carlos Santos | 70% | 123h | 126h | R$ 74 | R$ 9.324 | Hoje, 07:52 | Dentro da área | Normal |
| Alice Chen | 80% | 141h | 132h | R$ 148 | R$ 19.536 | Hoje, 08:03 | Remoto autorizado | Normal |
| Bob Torres | 60% | 106h | 139h | R$ 176 | R$ 24.464 | Ontem, 17:48 | Fora da área | Revisão |

## 11.3. Comparação de capacidade

```text
Planejado no projeto:       60%
Realizado equivalente:      79%
Outros projetos:            40%
Comprometimento total:     119%
```

---

# 12. Aplicativo do colaborador

## 12.1. Objetivo

Aplicativo mobile simples, rápido e confiável para:

- autenticação;
- entrada;
- intervalo;
- retorno;
- saída;
- início de atividade;
- troca de projeto;
- encerramento de atividade;
- operação offline;
- comprovantes;
- histórico;
- correção solicitada.

## 12.2. Tela inicial

```text
Olá, Carlos

Terça-feira, 15 de julho
Jornada iniciada às 07:52

Projeto atual
Modernização UHE X

Atividade
Instalação elétrica

Tempo nesta atividade
02:34:18

[Encerrar atividade]
[Trocar de projeto]
[Iniciar intervalo]
```

## 12.3. Timeline do dia

```text
07:52  Entrada
08:00  Projeto UHE X
10:34  Projeto ENEL
12:03  Intervalo
13:01  Projeto UHE X
17:48  Saída
```

## 12.4. Estados visuais importantes

- sincronizado;
- aguardando internet;
- localização indisponível;
- registro pendente;
- jornada incompleta;
- atividade em andamento;
- apontamento sem projeto;
- divergência detectada;
- dispositivo não autorizado.

---

# 13. Biometria e identidade

## 13.1. Primeira fase recomendada

Utilizar biometria nativa do aparelho:

- iOS: Face ID ou Touch ID;
- Android: biometria suportada pelo sistema;
- o aplicativo recebe apenas sucesso ou falha;
- não armazenar template facial próprio.

Fluxo:

```text
Colaborador
→ dispositivo cadastrado
→ sessão autenticada
→ biometria local
→ evento registrado
```

## 13.2. Reconhecimento facial próprio

Somente em fase posterior, com:

- prova de vida;
- avaliação jurídica;
- relatório de impacto;
- política de retenção;
- criptografia;
- controle de acesso;
- alternativa não biométrica;
- revisão de falso positivo e falso negativo;
- fornecedor especializado.

## 13.3. Regras de uso

- autenticação biométrica na entrada;
- autenticação biométrica na saída;
- autenticação em correções sensíveis;
- troca de projeto sem nova autenticação quando a sessão estiver válida;
- bloqueio ou revisão em dispositivo revogado;
- trilha de tentativas e falhas.

---

# 14. Geolocalização

## 14.1. Princípio

Não implementar rastreamento contínuo por padrão.

Capturar localização apenas em eventos definidos:

- entrada;
- saída;
- início de atividade externa;
- confirmação em local crítico;
- registro solicitado por política;
- ajuste sensível.

## 14.2. Geofence

Cada projeto ou unidade pode possuir:

- ponto central;
- raio;
- múltiplos polígonos;
- áreas autorizadas;
- áreas restritas;
- tolerância por precisão.

## 14.3. Evidências exibidas

```text
Dentro da área autorizada
Distância do local: 42 metros
Precisão do GPS: 18 metros
Registrado às 07:52
```

## 14.4. Operação offline

Registrar localmente:

- horário do dispositivo;
- localização;
- precisão;
- dispositivo;
- evento;
- sequência;
- hash;
- status de sincronização.

Ao sincronizar:

- gravar horário de recebimento;
- validar sequência;
- validar integridade;
- detectar alteração de horário;
- gerar alerta se necessário.

---

# 15. Aprovação orientada a exceções

## 15.1. Objetivo

Evitar que o gestor aprove manualmente todos os registros normais.

Exemplo:

```text
142 apontamentos recebidos

128 aprováveis automaticamente
8 com horas acima do planejado
3 fora da área autorizada
2 sem alocação no projeto
1 com sobreposição de horários
```

## 15.2. Regras de aprovação automática

Aprovar automaticamente quando:

- existe alocação ativa;
- projeto está ativo;
- não há sobreposição;
- horário está dentro da jornada ou tolerância;
- localização atende à política;
- dispositivo está vinculado;
- horas não excedem limites;
- não houve edição manual;
- atividade é válida;
- centro de custo está definido.

## 15.3. Casos que exigem revisão

- sobrecarga;
- horas extras;
- apontamento sem jornada;
- jornada sem projeto;
- localização fora da área;
- baixa precisão;
- dispositivo não confiável;
- projeto encerrado;
- vínculo inativo;
- alteração retroativa;
- correção manual;
- custo sem snapshot;
- duplicidade.

---

# 16. Workflow de alocação

```text
Solicitação
→ validação de capacidade
→ simulação de impacto financeiro
→ análise de conflitos
→ aprovação do gestor funcional
→ aprovação do projeto
→ ativação na vigência
→ recálculo de capacidade
→ recálculo de custos
→ evento de auditoria
```

## 16.1. Sobrecarga

Quando ultrapassar 100%:

1. bloquear por padrão;
2. permitir exceção com justificativa;
3. exigir aprovador autorizado;
4. definir prazo de normalização;
5. gerar alerta;
6. manter histórico.

---

# 17. Simulador de nova demanda

## 17.1. Entrada

```text
Demanda: Engenheiro elétrico
Período: agosto a novembro
Necessidade: 50%
Limite de custo: R$ 15.000/mês
Local: Minas Gerais
Competências: NR-10, SEP, manutenção de subestação
```

## 17.2. Saída

| Colaborador | Disponível | Custo estimado | Compatibilidade | Conflitos |
|---|---:|---:|---:|---|
| Marina | 80% | R$ 11.200 | 92% | Nenhum |
| Carlos | -20% | R$ 8.300 | 96% | Sobrealocado |
| Roberto | 50% em setembro | R$ 13.900 | 84% | Disponível posteriormente |

## 17.3. Critérios

- disponibilidade;
- função;
- competência;
- certificações;
- localização;
- custo;
- período;
- experiência;
- conflito de projetos;
- férias;
- jornada;
- restrições contratuais.

---

# 18. Detecção de inconsistências

O sistema não deve acusar automaticamente fraude ou “funcionário fantasma”.

Utilizar nomenclatura:

> Inconsistência de vínculo, alocação ou atividade — requer análise.

## 18.1. Exemplos

| Situação | Alerta |
|---|---|
| Recebe folha sem alocação | Sem alocação ativa |
| Possui alocação sem atividade | Sem atividade comprovada |
| Registra jornada sem projeto | Tempo não classificado |
| Aponta projeto sem alocação | Alocação inconsistente |
| Dispositivo usado por múltiplas pessoas | Risco de identidade |
| Locais incompatíveis em curto intervalo | Risco de integridade |
| Ativo na folha após desligamento | Divergência cadastral |
| Projeto encerrado recebe horas | Apropriação indevida |
| Custo sem centro de custo | Custo não classificado |
| Mais de 100% por período | Sobrecarga |
| Horários sobrepostos | Sobreposição |
| Correções recorrentes | Padrão de ajuste anormal |

## 18.2. Evidência

```text
Risco alto

• Folha processada nos últimos 3 meses
• Nenhuma alocação ativa
• Nenhum apontamento desde 12/04
• Sem gestor definido
• Sem centro de custo associado
```

---

# 19. Controle de acesso

## 19.1. Perfis

| Perfil | Acesso |
|---|---|
| Colaborador | Própria jornada e apontamentos |
| Líder de equipe | Capacidade e apontamentos da equipe |
| Gerente de projeto | Alocação, horas e custo carregado do projeto |
| Gestor funcional | Alocações e disponibilidade da área |
| RH | Vínculo, jornada, remuneração e benefícios |
| Financeiro | Custo, folha, conciliação e centros de custo |
| Diretoria | Consolidado, exceções e indicadores |
| Auditoria | Evidências, histórico e trilha imutável |
| Admin | Configuração técnica, sem acesso automático a salário |

## 19.2. Regras

- RBAC para papel;
- ABAC para empresa, área, projeto, vínculo e confidencialidade;
- RLS no banco;
- mascaramento de custo individual;
- custo-hora agregado para gerente;
- salário detalhado apenas para perfis autorizados;
- logs de acesso a dados sensíveis.

---

# 20. Arquitetura técnica

## 20.1. Stack base

Considerar o stack existente:

- Next.js;
- TypeScript;
- Supabase;
- PostgreSQL;
- Vercel;
- autenticação existente;
- RLS;
- integrações já presentes no Insight Apex.

## 20.2. Componentes

```text
┌────────────────────────────────────────┐
│ Portal Web Next.js                     │
│ Projetos, RH, Financeiro, Aprovações   │
└───────────────────┬────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────┐
│ Serviços de domínio                    │
│ Alocação, jornada, apontamento, custo  │
└───────────────────┬────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌──────────────────┐   ┌─────────────────┐
│ PostgreSQL       │   │ Audit/Event Log │
│ Supabase + RLS   │   │ Append-only     │
│ PostGIS          │   │ Outbox          │
└──────────────────┘   └─────────────────┘
        ▲
        │ sincronização segura
        ▼
┌────────────────────────────────────────┐
│ Aplicativo mobile                      │
│ Biometria, GPS, offline, dispositivo   │
└────────────────────────────────────────┘
```

## 20.3. Aplicativo mobile

Recomendação:

- React Native;
- armazenamento local criptografado;
- fila offline;
- biometria nativa;
- localização;
- vinculação de dispositivo;
- sincronização idempotente;
- atualizações seguras;
- captura mínima de dados.

## 20.4. PostGIS

Usar para:

- geofences;
- polígonos;
- distância;
- validação espacial;
- consulta de área autorizada.

## 20.5. Outbox pattern

Eventos relevantes:

- allocation.requested;
- allocation.approved;
- allocation.activated;
- attendance.punched;
- work_session.started;
- work_session.ended;
- time_entry.submitted;
- time_entry.approved;
- payroll.processed;
- labor_cost.reconciled;
- integrity_alert.created;
- device.revoked.

## 20.6. Idempotência

Todo evento mobile deve conter:

- `client_event_id`;
- `device_id`;
- sequência local;
- horário local;
- horário de recebimento;
- chave de idempotência;
- hash de integridade.

---

# 21. Integração com folha

## 21.1. Origem

A folha deve gerar ou alimentar `EmployeeCostSnapshot`.

## 21.2. Estados

```text
estimated
→ processed
→ reconciled
```

## 21.3. Fluxo

```text
Folha processada
→ custo real por colaborador
→ custo-hora real
→ distribuição pelas horas aprovadas
→ custo real por projeto
→ variação
→ reconciliação
→ bloqueio da competência
```

## 21.4. Competência fechada

Após fechamento:

- impedir alterações diretas;
- permitir reabertura autorizada;
- registrar justificativa;
- recalcular com versão;
- preservar valores anteriores;
- gerar evento de ajuste.

---

# 22. Compliance e privacidade

## 22.1. LGPD

- biometria é dado pessoal sensível;
- localização pode ser dado pessoal;
- aplicar minimização;
- definir finalidade;
- controlar retenção;
- restringir acesso;
- documentar tratamento;
- oferecer alternativa quando aplicável;
- registrar base legal e política interna.

## 22.2. Controle de ponto

Caso o Insight Apex seja usado como sistema oficial de jornada:

- avaliar requisitos de REP-P;
- comprovantes;
- arquivos fiscais;
- assinatura;
- integridade;
- responsabilidade técnica;
- documentação legal;
- operação offline conforme requisitos.

Estratégia recomendada inicialmente:

```text
Insight Apex
→ apontamento por projeto
→ integração com solução de ponto aderente
→ importação da jornada oficial
→ conciliação
```

Estratégia futura:

```text
Insight Apex
→ REP-P próprio
→ requisitos legais e técnicos completos
```

---

# 23. Observabilidade e auditoria

## 23.1. Logs

- comandos;
- eventos;
- erros;
- sincronização;
- tentativas biométricas;
- falhas de localização;
- alterações de alocação;
- aprovações;
- reconciliações;
- acesso a dados sensíveis.

## 23.2. Métricas

- eventos por minuto;
- falhas de sincronização;
- tempo médio de aprovação;
- horas sem projeto;
- sobrecarga;
- disponibilidade;
- divergência custo planejado x real;
- registros offline;
- alertas por severidade;
- taxa de autoaprovação;
- retrabalho.

## 23.3. Auditoria

Todo evento deve registrar:

- ator;
- origem;
- tenant;
- empresa;
- dispositivo;
- data;
- valor anterior;
- valor novo;
- justificativa;
- aprovador;
- correlação;
- IP quando aplicável;
- hash.

---

# 24. Requisitos não funcionais

## 24.1. Segurança

- RLS;
- criptografia em trânsito e repouso;
- segredo fora do frontend;
- assinatura de eventos;
- rate limiting;
- revogação de dispositivo;
- sessão curta para ações sensíveis;
- detecção de replay;
- proteção contra alteração de horário;
- segregação de funções.

## 24.2. Disponibilidade

- funcionamento offline no mobile;
- sincronização resiliente;
- reprocessamento;
- idempotência;
- tolerância a duplicidade;
- fila de falhas;
- observabilidade.

## 24.3. Escalabilidade

Planejar para:

- milhares de colaboradores;
- centenas de projetos;
- múltiplas empresas;
- múltiplos tenants;
- milhões de eventos;
- consultas por competência;
- relatórios agregados;
- retenção histórica.

## 24.4. Performance

- paginação;
- virtualização de tabelas;
- agregações pré-calculadas;
- materialized views quando necessário;
- índices por tenant, pessoa, projeto e período;
- particionamento futuro de eventos;
- cache de indicadores.

---

# 25. Estratégia de implementação

> **STATUS DE ENTREGA (15/07/2026)** — implementado no repositório web
> (migrations 038–051 aplicadas, typecheck/build verdes):
>
> | Fase | Status |
> |---|---|
> | 1 — Fundação de alocação | ✅ ENTREGUE (people, project_allocations, aba Equipe) |
> | 2 — Capacidade corporativa | ✅ ENTREGUE (leave_periods, matriz /capacidade) |
> | 3 — Apontamento operacional | ✅ ENTREGUE (sessions, time_entries, aprovação por exceção) |
> | 4 — Mobile | ✅ Backend (devices, geofences, evidências, /api/mobile/*) + gestão web de geofences com globo · App RN: scaffold em `mobile/` (build/teste na máquina do time) |
> | 5 — Jornada | ✅ ENTREGUE (attendance_punches imutável, HE/noturno/banco derivados, conciliação D4) |
> | 6 — Custos | ✅ ENTREGUE (snapshots, custo-hora, project_labor_cost, margem D1) |
> | 7 — Governança | ✅ ENTREGUE (audit append-only enforced, governance_exceptions, SoD — D3) |
> | 8 — Inteligência | ✅ ENTREGUE (simulador §17, forecast, IA via /api/ai/workforce-insights — D2) |
> | 9 — Compliance REP-P | ✅ Módulo implementado (NSR + hash encadeado por trigger, imutabilidade fiscal, AFD, espelho, comprovante, trilha de exportações — /workforce-cost/ponto-oficial) · ⚠️ uso fiscal requer homologação: layout AFD vs Anexo oficial, assinatura ICP-Brasil e atestado técnico |

## Fase 0 — Descoberta e mapeamento

- mapear tabelas existentes;
- mapear tipos TypeScript;
- mapear serviços;
- mapear RLS;
- mapear folha;
- mapear projetos;
- mapear pessoas;
- mapear organograma;
- mapear auditoria;
- identificar mocks e dados live;
- registrar lacunas.

## Fase 1 — Fundação de alocação

- criar `ProjectAllocation`;
- período de vigência;
- percentual;
- horas;
- tipo;
- status;
- aprovação;
- auditoria;
- tabela enterprise;
- drawer;
- soma entre projetos;
- disponibilidade.

## Fase 2 — Capacidade corporativa

- `CapacityPeriod`;
- jornada contratual;
- férias;
- afastamentos;
- feriados;
- matriz temporal;
- visão global;
- filtros;
- FTE;
- sobrecarga.

## Fase 3 — Apontamento operacional

- `ProjectWorkSession`;
- `TimeEntry`;
- cronômetro;
- troca de projeto;
- envio;
- aprovação;
- reconciliação básica;
- alertas.

## Fase 4 — Mobile

- autenticação;
- biometria;
- dispositivo;
- GPS;
- geofence;
- offline;
- sincronização;
- histórico;
- comprovantes.

## Fase 5 — Jornada

- `AttendancePunch`;
- entrada;
- intervalo;
- retorno;
- saída;
- conciliação com apontamentos;
- integração com sistema oficial de ponto.

## Fase 6 — Custos

- `EmployeeCostSnapshot` (custo por competência, origem folha);
- custo carregado mensal (salário + encargos + benefícios rateados do batch);
- custo-hora carregado (÷ capacidade produtiva);
- custo planejado por projeto (% × custo carregado);
- custo realizado estimado (horas aprovadas × custo-hora estimado);
- custo realizado fechado (× custo-hora real pós-folha);
- `ProjectLaborCostPeriod` (consolidado projeto/pessoa/competência);
- reconciliação auditável estimado × real;
- **margem por projeto** (D1): receita do contrato − custo MO − outros;
- popular `time_entries.hourly_cost_cents`/`cost_cents` na aprovação;
- mascaramento por `people.cost_view`;
- competência bloqueada (reabertura autorizada, versão preservada).

## Fase 7 — Governança

- aprovações;
- exceções;
- justificativas;
- reabertura;
- segregação de funções;
- acesso sensível;
- auditoria expandida.

## Fase 8 — Inteligência

- inconsistências;
- ociosidade;
- sobrecarga;
- ausência de atividade;
- recomendação de alocação;
- simulador;
- forecast;
- risco de custo.

## Fase 9 — Compliance REP-P (condicional)

Somente se o Insight Apex se tornar o **sistema oficial de ponto**. Depende de
validação jurídica (ver §22). Enquanto não, a estratégia é integrar a um ponto
aderente e importar a jornada oficial.

- geração de AFD/AFDT/ACJEF;
- aderência à Portaria 671 (REP-P);
- comprovante de registro ao trabalhador;
- assinatura/integridade dos arquivos fiscais;
- espelho de ponto;
- operação offline conforme requisitos legais;
- ISO 27001 e política de retenção LGPD.

---

# 25B. Benchmark competitivo e diferenciais (Pontotel e correlatos)

Referência de mercado analisada: **Pontotel** (REP-P enterprise) — registro por
app/web/facial/QR/PIN com prova de vida, geolocalização e offline; jornada com
banco de horas, HE e adicional noturno; férias; fechamento colaborativo; custo
por colaborador/área/projeto; gestão de tarefas; dashboards; exports
AFD/AFDT/ACJEF; Portaria 671, ISO 27001, LGPD; integração de folha (Pessoas+/Sankhya).

Diagnóstico: produtos como o Pontotel são **silos de RH/ponto**. O Insight Apex
não deve clonar um relógio de ponto; deve **absorver o ponto como uma entrada**
dentro de um cockpit integrado de governança, custo, projeto e decisão. Essa
integração vertical é o diferencial estruturante — nenhum concorrente de ponto
tem o contrato, o risco, a deliberação, o DRE e a IA do outro lado.

## 25B.1. Os 5 diferenciais (escopo formal das fases 4–9)

**D1 — Margem de projeto em tempo real.**
Custo de mão de obra (Fase 6) × Receita do contrato (módulo Contratos/Financeiro
já existentes) × outros custos (ledger) ⇒ **margem por projeto**. Ligar
`time_entries` → `EmployeeCostSnapshot` → visão financeira do projeto. Entra na
**Fase 6** (cálculo/serviço) e evolui na **Fase 8** (forecast de margem).
Nenhum produto de ponto entrega margem porque não tem o contrato.

**D2 — Camada de IA (stack Genkit/Anthropic já presente).**
- classificação assistida de inconsistências com evidência (§18), sem acusar fraude;
- simulador de nova demanda com ranking por disponibilidade, competência, custo e conflito (§17);
- forecast de capacidade e de estouro de custo por projeto;
- preenchimento inteligente de apontamento (sugestão de projeto/atividade por padrão do colaborador).
Entra na **Fase 8**; itens de baixo acoplamento podem adiantar em paralelo.

**D3 — Governança de verdade, não só RH.**
Sobrecarga >100%, reabertura de competência fechada e horas em projeto encerrado
viram **deliberações/aprovações** no módulo de governança já existente. Auditoria
**append-only real** (hoje `audit_logs` é best-effort) com trigger de banco.
Entra na **Fase 7**.

**D4 — Conciliação tríplice auditável.**
Jornada (Fase 5) × Apontamento (Fase 3, feito) × Folha (Fase 6). Conciliar as três
e apontar a diferença por projeto, com trilha imutável. Diferente do Pontotel que
concilia apenas ponto × folha. Entra nas **Fases 5 e 6**.

**D5 — Geofence por canteiro + evidência contextual.**
A cerca é por **obra/UHE/subestação** (o projeto tem localização), não genérica por
empresa. Evidência ligada à alocação ("dentro da área da UHE X · 42m · GPS 18m").
Entra na **Fase 4** (mobile) com PostGIS (§14).

## 25B.2. Reforços por fase existente

| Fase | Reforço competitivo incorporado |
|---|---|
| Fase 4 — Mobile | prova de vida + device binding + **geofence por projeto** (D5); offline idempotente |
| Fase 5 — Jornada | motor de regras CLT (banco de horas, HE, adicional noturno); conciliação jornada×apontamento (D4) |
| Fase 6 — Custos | custo carregado/hora, planejado×realizado×reconciliado; **margem por projeto** (D1); conciliação com folha (D4) |
| Fase 7 — Governança | exceções viram deliberação; **auditoria append-only enforced** (D3); segregação de funções |
| Fase 8 — Inteligência | **IA aplicada** (D2): inconsistências, simulador, forecast de capacidade e de margem/custo |
| Fase 9 — Compliance | equivalência ao REP-P do Pontotel (AFD/AFDT/ACJEF, Portaria 671) — condicional a decisão de produto/jurídico |

---

# 26. Critérios de aceite

## 26.1. Alocação

- uma pessoa pode estar em vários projetos;
- toda alocação possui vigência;
- soma corporativa é calculada;
- sobrecarga é detectada;
- alterações possuem histórico;
- custo planejado é calculado.

## 26.2. Apontamento

- colaborador inicia e encerra atividade;
- pode trocar de projeto;
- sistema impede sobreposição indevida;
- gestor aprova por exceção;
- horas são consolidadas;
- custo estimado é calculado.

## 26.3. Mobile

- biometria funciona;
- dispositivo é vinculado;
- localização é capturada;
- operação offline funciona;
- duplicidade é evitada;
- sincronização é auditável.

## 26.4. Custos

- custo mensal carregado existe;
- custo-hora é reproduzível;
- custo planejado é separado do realizado;
- fechamento da folha gera reconciliação;
- histórico não é sobrescrito.

## 26.5. Segurança

- salário detalhado é restrito;
- gerente vê apenas custo permitido;
- RLS impede vazamento entre tenants;
- acessos sensíveis são auditados;
- dispositivo pode ser revogado.

---

# 27. Decisões arquiteturais recomendadas

## ADR-001 — Alocação como entidade temporal

**Decisão:** criar `ProjectAllocation` independente.  
**Motivo:** múltiplos projetos, vigência, histórico, custo e aprovação.

## ADR-002 — Separar jornada e apontamento

**Decisão:** usar domínios diferentes e conciliáveis.  
**Motivo:** jornada trabalhista e apropriação de projeto possuem finalidades distintas.

## ADR-003 — Biometria nativa na primeira fase

**Decisão:** usar biometria do dispositivo.  
**Motivo:** menor risco, menor complexidade e melhor privacidade.

## ADR-004 — Aplicativo mobile dedicado

**Decisão:** priorizar React Native para operação de campo.  
**Motivo:** biometria, GPS, offline e dispositivo confiável.

## ADR-005 — Eventos imutáveis

**Decisão:** correções criam novos eventos.  
**Motivo:** auditoria e integridade.

## ADR-006 — Custo por snapshot de competência

**Decisão:** congelar custo-hora por competência.  
**Motivo:** histórico reproduzível e reconciliação.

## ADR-007 — Aprovação por exceção

**Decisão:** autoaprovar registros normais configuráveis.  
**Motivo:** reduzir carga operacional.

## ADR-008 — Sem acusação automática de fraude

**Decisão:** classificar como inconsistência para análise.  
**Motivo:** reduzir falso positivo e risco trabalhista.

---

# 28. Questões em aberto

O plano técnico deve validar:

1. Já existe entidade de pessoa única ou há duplicação entre usuários, colaboradores e membros?
2. Qual tabela representa vínculo empregatício?
3. Onde salário, encargos, benefícios e folha são armazenados?
4. A folha atual possui competência e status de fechamento?
5. Já existe `PayrollAllocation` reutilizável?
6. Existe trilha de auditoria central?
7. Existe modelo de aprovação genérico?
8. Existe calendário de férias e afastamentos?
9. Existe estrutura de work package ou atividade de projeto?
10. Existe centro de custo por projeto?
11. O sistema é multiempresa e multitenant?
12. Como as permissões são modeladas hoje?
13. Quais políticas de RLS já existem?
14. O portal mobile será aplicativo ou PWA?
15. O ponto será oficial ou apenas operacional?
16. Há fornecedor de ponto a integrar?
17. Qual política de geofence será usada?
18. Qual retenção de localização será adotada?
19. O gerente pode ver custo individual ou apenas custo carregado?
20. Quem aprova sobrecarga?
21. Quem reabre competência fechada?
22. Como tratar terceiros, PJ e temporários?
23. Como tratar equipes de campo sem sinal?
24. Como tratar múltiplos fusos?
25. Como tratar atividade noturna que atravessa o dia?

---

# 29. Instruções para o Claude Code

## 29.1. Objetivo

Usar este documento como especificação inicial para produzir um plano técnico aderente ao repositório real do Insight Apex.

## 29.2. Regras de trabalho

1. Não implementar imediatamente.
2. Primeiro inspecionar o repositório.
3. Identificar arquitetura existente.
4. Mapear entidades já disponíveis.
5. Evitar criar domínios duplicados.
6. Reutilizar infraestrutura existente de auditoria, aprovação, RBAC, RLS e financeiro.
7. Manter comportamento live-first.
8. Não introduzir mocks em fluxos de produção.
9. Não alterar módulos não relacionados sem justificativa.
10. Planejar migrações reversíveis.
11. Preservar compatibilidade com dados existentes.
12. Documentar decisões.
13. Separar MVP, evolução e longo prazo.
14. Identificar riscos de segurança e LGPD.
15. Propor testes e critérios de aceite.

## 29.3. Entregáveis esperados do plano

O Claude deve entregar:

### A. Inventário do estado atual

- arquivos;
- rotas;
- componentes;
- hooks;
- serviços;
- tabelas;
- migrations;
- tipos;
- RLS;
- funções;
- integrações;
- auditoria;
- aprovações;
- folha;
- projetos;
- pessoas.

### B. Gap analysis

Para cada requisito:

- existente;
- parcialmente existente;
- ausente;
- precisa refatoração;
- risco;
- dependência.

### C. Arquitetura proposta

- módulos;
- boundaries;
- entidades;
- comandos;
- queries;
- eventos;
- permissões;
- estados;
- fluxos.

### D. Plano de banco

- novas tabelas;
- alterações;
- índices;
- constraints;
- políticas RLS;
- views;
- funções;
- migrations;
- backfill;
- rollback.

### E. Plano de frontend

- rotas;
- páginas;
- componentes;
- tabelas;
- drawers;
- filtros;
- estados;
- loading;
- empty states;
- erros;
- acessibilidade;
- responsividade.

### F. Plano mobile

- arquitetura;
- autenticação;
- biometria;
- GPS;
- armazenamento local;
- fila offline;
- sincronização;
- revogação;
- integridade.

### G. Plano de custos

- origem do custo;
- snapshot;
- cálculo;
- conciliação;
- fechamento;
- reabertura;
- auditoria.

### H. Plano de segurança

- RBAC;
- ABAC;
- RLS;
- dados sensíveis;
- logs;
- criptografia;
- retenção;
- segregação.

### I. Plano de testes

- unitários;
- integração;
- RLS;
- E2E;
- offline;
- idempotência;
- concorrência;
- reconciliação;
- regressão.

### J. Roadmap executável

Cada fase deve incluir:

- objetivo;
- dependências;
- arquivos afetados;
- migrations;
- implementação;
- testes;
- validação;
- riscos;
- critérios de pronto.

---

# 30. Prompt sugerido para usar no Claude Code

```text
Leia integralmente o arquivo de arquitetura do módulo de Alocação, Apontamento, Jornada e Custo Real por Projeto.

Antes de implementar qualquer alteração:

1. Inspecione o repositório completo e identifique como pessoas, organograma, projetos, contratos, folha, custos, auditoria, aprovações, RBAC e RLS estão modelados.
2. Localize tudo que pode ser reutilizado.
3. Identifique inconsistências entre o documento e a implementação atual.
4. Produza um gap analysis detalhado.
5. Proponha a arquitetura alvo aderente ao código existente, evitando duplicação de domínio.
6. Divida o trabalho em fases pequenas, testáveis e reversíveis.
7. Liste migrations, tabelas, tipos, serviços, hooks, componentes e rotas envolvidos.
8. Para cada fase, defina critérios de aceite, testes e riscos.
9. Priorize primeiro a fundação de alocação e capacidade.
10. Não implemente o módulo completo de uma só vez.
11. Não altere arquivos fora do escopo sem explicar a necessidade.
12. Preserve o padrão live-first do sistema.
13. Considere segurança, LGPD, auditoria e segregação de acesso desde o início.
14. Aponte explicitamente qualquer decisão que dependa de validação de produto, jurídico, RH ou financeiro.

Entregue primeiro apenas o plano técnico. Aguarde aprovação antes de iniciar a implementação.
```

---

# 31. Resultado esperado

Ao final da implementação, o Insight Apex deverá operar como uma camada integrada de gestão de pessoas e projetos:

```text
Pessoa
→ vínculo
→ capacidade
→ alocação
→ jornada
→ atividade
→ aprovação
→ custo
→ folha
→ projeto
→ margem
→ risco
→ decisão
```

O módulo não deve ser apenas uma tela de presença ou lista de equipe.

Ele deve se tornar um sistema enterprise para:

- planejar capacidade;
- controlar execução;
- apropriar custo;
- reconciliar folha;
- detectar inconsistências;
- melhorar alocação;
- apoiar decisões operacionais e financeiras.
