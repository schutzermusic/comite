# Insight Apex — Operations & Supply Chain
## UI/UX and Information Architecture

---

# 1. Product UX principle

Apex should feel like an intelligent operations command system, not a legacy ERP navigation tree.

The interface should prioritize:

1. what changed;
2. what needs attention;
3. what decision is required;
4. what action Apex can safely take;
5. why that action is recommended.

Navigation remains available, but autonomous operation should reduce navigation frequency over time.

---

# 2. Main sidebar

```text
Operações
  Visão Geral
  Ordens de Serviço
  Projetos
  Mapa de Operações
  Planejamento
  Medições & Evidências

Supply Chain
  Visão Geral
  Planejamento de Materiais
  Estoque
  Compras
  Fornecedores
  Recebimentos & Logística
```

Avoid third-level sidebar nesting when tabs, filters or workspaces are better.

---

# 3. Global header concepts

Retain/plan room for:

- global search / command bar;
- Decisions queue;
- Notifications;
- organization/context switch where appropriate;
- profile.

Future command examples:

- “Quais projetos têm risco de material?”
- “Prepare as compras necessárias para os próximos 14 dias.”
- “Mostre OS com divergência bloqueante.”
- “Simule transferência para evitar atraso em Tucuruí.”

Do not make Apex Intelligence a standalone AI sidebar module.

---

# 4. Operations Overview UX

### Header

- domain title;
- active date/context filters;
- optional command/action entry.

### Compact KPI strip

5–6 high-value metrics max.

### Primary attention section

`O que precisa de decisão`

Rows/cards should state:

- object;
- issue;
- impact;
- due time;
- responsible owner;
- clear action.

### Execution horizon

7 / 14 / 30 days.

### Risk matrix

Project vs blocker type:

- schedule;
- supply;
- team;
- customer dependency;
- measurement;
- contract.

---

# 5. Service Order UX

## List

Columns/signals:

- OS;
- customer;
- source proposal/package;
- project;
- owner;
- status;
- divergence count/severity;
- next action.

Primary actions:

- `Importar OS`
- `Gerar a partir de proposta`

## Workspace

Suggested tabs:

- Resumo
- Escopo
- Atividades
- Materiais & Recursos
- Divergências
- Documentos
- Projeto
- Atividade/Histórico

Header should show:

- OS number;
- customer/work;
- upstream proposal context;
- governing PT/PC revisions;
- authorization state;
- OS state;
- linked project;
- next action.

Do not dump extracted text. Structure it into sections and retain raw source/provenance as secondary detail.

---

# 6. Project UX

## Project header

Must communicate:

- project/customer;
- current phase;
- overall health;
- contractual/governing context;
- next milestone;
- owner;
- critical alert count.

## Tabs

```text
Visão Geral
Cronograma / Planejamento
Financeiro
Contexto Contratual
Medições & Evidências
Timeline
Riscos
Documentos
Equipe
Apontamento
Materiais & Supply
```

Use permission-aware tab visibility for sensitive Finance.

### Visão Geral layout

Recommended hierarchy:

1. next operational milestone;
2. critical blockers;
3. execution progress;
4. supply readiness;
5. measurement status;
6. team readiness;
7. financial exposure if authorized.

Avoid equal-weight card grids.

---

# 7. Operations Map UX

Map should be useful, not decorative.

Desktop layout:

```text
[Map................................] [Side panel]
[Map................................] [Filters   ]
[Map................................] [Selected  ]
```

Pins/layers:

- project sites;
- warehouses;
- field teams where authorized;
- vehicles where authorized;
- alerts.

Selected project side panel:

- status;
- next activity;
- team;
- supply issue;
- measurement issue;
- route to workspace.

Mobile:

- full-height map with bottom sheet;
- filter chips;
- selected-object sheet.

---

# 8. Planning UX

Primary views:

- Gantt / timeline;
- table;
- readiness;
- requirements;
- constraints.

Gantt must remain operational, not presentation-only.

Activity row can expose:

- duration;
- progress;
- dependencies;
- responsible owner;
- measurement linkage;
- material/resource readiness;
- risk.

Example compact readiness indicators:

```text
Equipe      ✓
Material    ⚠ 2 shortages
Documento   ✓
Cliente     ⚠ dependency overdue
Medição     upcoming
```

---

# 9. Supply Chain Overview UX

Control-tower structure:

### KPI strip

- uncovered demand;
- critical shortages;
- open PO value;
- late inbound;
- receiving discrepancies;
- projects exposed.

### Primary blocks

- Supply risks by project;
- Critical shortages;
- Purchase decisions pending;
- Late deliveries;
- Transfer opportunities;
- Receiving issues.

Apex recommendation cards must contain evidence/rationale and direct governed actions. Avoid generic “AI insight” styling.

---

# 10. Material Planning UX

This is a core differentiator.

Portfolio matrix:

```text
Project / Need date / Required / Covered / Shortage / Risk
```

Requirement drawer/workspace:

### Demand
- project;
- activity;
- material;
- quantity;
- need date;
- criticality.

### Coverage
- reserved inventory;
- inbound purchase;
- transfer;
- remaining shortage.

### Alternatives
- other warehouse stock;
- alternate supplier;
- revised delivery plan.

### Actions
- reserve;
- simulate transfer;
- prepare purchase request;
- assign exception owner.

---

# 11. Inventory UX

Use tabs within one Supply Chain screen:

```text
Posição | Reservas | Movimentações | Transferências | Inventário
```

### Position

Group by item and location.

Important quantities visually distinct:

- on hand;
- reserved;
- available;
- inbound;
- project allocated.

### Movement timeline

Every movement should show source/reason/project/user/reference.

---

# 12. Procurement UX

Use one primary screen with workflow tabs:

```text
Solicitações | Cotações | Aprovações | Pedidos
```

### Solicitações

Prioritize:

- project/requirement;
- need date;
- estimated cost;
- urgency;
- status.

### Cotações

Comparison must be table/decision oriented, not document oriented.

### Aprovações

Show:

- requested decision;
- value;
- project impact;
- chosen supplier;
- alternatives;
- policy/alçada;
- deviations.

### Pedidos

Operational order tracking:

- supplier;
- issue date;
- expected date;
- value;
- project;
- receipt status;
- delay risk.

---

# 13. Supplier UX

Supplier 360:

- identity;
- categories;
- contacts;
- compliance/homologation;
- open quotes;
- open orders;
- delivery performance;
- quality/issues;
- historical spend;
- documents.

Avoid separate duplicate supplier identity if Party already exists.

---

# 14. Receiving & Logistics UX

Primary queues:

- expected today;
- upcoming;
- in transit;
- late;
- partial;
- discrepancy;
- complete.

Receiving flow must be usable on mobile/tablet.

Field receiving UI:

- scan/search PO;
- item quantities;
- damaged/rejected;
- photo/evidence;
- destination;
- submit.

Do not silently mark PO complete unless quantities/status support it.

---

# 15. Visual design rules

- light and dark mode;
- premium enterprise;
- restrained futuristic cues;
- strong typographic hierarchy;
- refined surfaces;
- fewer hard card borders;
- no excessive cyan/neon glow;
- charts must communicate operational decisions;
- dense tables on desktop;
- card transforms on mobile;
- consistent status language;
- no generic AI sparkle patterns.

---

# 16. Empty states

Empty state should explain the workflow and offer the correct next action.

Example Material Planning empty state:

> Nenhuma demanda de material confirmada. As necessidades aparecerão aqui quando o Planejamento do Projeto confirmar materiais e datas de necessidade.

Action:

`Abrir Planejamento`

Do not create fake sample data in production screens.

