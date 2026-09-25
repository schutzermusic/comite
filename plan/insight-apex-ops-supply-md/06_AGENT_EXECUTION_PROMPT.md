# Insight Apex — Agent Execution Prompt
## Operations + Supply Chain Foundation

You are working on Insight Apex, an enterprise autonomous operations platform.

Read all architecture MDs in this package before changing code.

## Mission

Implement the Operations + Supply Chain architecture incrementally, preserving the current Commercial, Projects, Contracts, Measurements, Finance, People/Attendance, Fleet, Documents, RBAC/RLS and AI gateway architecture.

Target navigation:

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

Project workspace must retain/implement:

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

## Mandatory behavior before implementation

1. Inspect current branch/HEAD and working tree.
2. Do not reset/clean/overwrite unrelated changes.
3. Audit existing schema, migrations, services, routes, read models and permissions.
4. Identify canonical entities that already exist.
5. Do not create parallel Project, Contract, Measurement, Document, Attendance, Finance or Party truth.
6. Check migration-number conflicts, including active worktrees. Commercial currently reaches 217 and Fiscal was previously planned for 220–229.
7. Return a concise discovery/boundary report before major structural changes.

## Product architecture

Apex is not a legacy ERP with an AI button.

Build:

- Oracle-like transactional rigor;
- Palantir-like connected operational context;
- Apex Intelligence for observation, planning, recommendation and governed action.

Core path:

```text
PT+PC authorization
→ Internal OS
→ Project
→ Execution Planning
→ Requirements
→ Supply Planning
→ Reserve / Transfer / Buy
→ Procurement / Logistics / Receiving
→ Execution
→ Measurement
→ Billing / Finance
```

## First implementation priority

Start with **Operations + Internal Service Orders**, but design the model so Planning and Supply Chain can connect without refactoring the OS later.

Internal OS must support:

1. `Importar OS`
   - PDF upload
   - canonical document storage
   - extraction with provenance
   - structured review
   - compare OS × governing PT × governing PC
   - divergence severity

2. `Gerar a partir de proposta`
   - use proposal context
   - preserve governing PT/PC revisions
   - populate scope/activities/deliverables/requirements
   - preserve authorization evidence

3. governed issuance
   - blocking divergence prevents normal issue
   - material changes after issuance require revision/history

4. project handoff
   - create/link project idempotently
   - no duplicate project

## Planning foundation

Use:

```text
Project
→ Execution Plan
→ Activity / Work Package
→ Requirement
```

Requirement types must accommodate material, equipment, vehicle, workforce, external service, document and customer dependency.

A material requirement must be able to feed Supply Planning later.

## Supply Chain foundation

Model around demand, not manual purchase entry:

```text
Requirement
→ Supply Requirement
→ Coverage
→ Reserve / Transfer / Buy
```

Inventory must distinguish on-hand, reserved and available.

Reservations must be atomic and cannot double-allocate stock.

Procurement must preserve requirement/project provenance through requisition → sourcing → PO → receipt.

Supplier identity must reuse canonical Parties/roles.

Partial receiving must be first-class.

## AI constraints

AI may extract, compare, classify, recommend and prepare governed drafts.

AI must not silently create:

- customer acceptance;
- approval;
- OS issuance;
- physical receipt;
- stock consumption;
- financial/fiscal truth.

## UX

Modern premium enterprise, not generic AI UI.

- strong hierarchy;
- dense but readable;
- exception-first;
- progressive disclosure;
- no excessive glow;
- no fake dashboard metrics;
- structured extracted data, raw text secondary;
- light/dark;
- mobile where field use matters.

## Verification

For every phase run:

- typecheck;
- lint;
- unit tests;
- DB proofs;
- security audit;
- affected integration tests;
- targeted Playwright;
- read-only real-data compatibility checks where relevant.

Do not write real hosted business data unless explicitly authorized.

## Final report format

Return:

1. Architecture / discovery findings
2. Files changed
3. Migrations
4. Canonical entities reused
5. New entities and why they are necessary
6. Invariants
7. RBAC/RLS/security
8. UI changes
9. Tests with counts
10. Real-data impact
11. Remaining debt
12. Exact next step
13. FINAL VERDICT: READY / NOT READY

Do not claim READY if a critical browser→DB, authorization, concurrency or tenant-isolation path was not actually proven.

