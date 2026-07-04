# Fase 8 — Staging QA & Production Hardening (execution guide)

> **EXECUTADO em 03/07/2026** contra o projeto Supabase do `.env.local`
> (org INSIGHT ENERGY), via `SUPABASE_DB_URL`:
>
> - **§1 Migrations 035+036: APLICADAS e verificadas** (CHECK com `approved`,
>   14/14 colunas novas, RLS ativo, linhas preservadas, idempotência confirmada
>   com segunda execução). Script: `scripts/apply-contracts-migrations-phase8.mjs`.
> - **§2 Runbook: SEMEADO** via `scripts/qa-contracts-governance-seed.mjs`
>   (contrato `[QA]`, 3 obrigações, 3 faturamentos, 3 documentos, 3 aprovações
>   com SLA real de 28h, vínculo de projeto, tarefa de agenda, análise IA).
>   Vínculo de risco pulado: tabela `risks` vazia na org. Corrigido no §7:
>   `tasks` usa `creator_user_id` (não `created_by`).
> - **Fluxo real validado na UI** (Playwright autenticado como owner_admin):
>   aprovar documento → `approved` + `approved_at`/`approved_by` persistidos,
>   `audit_logs` `contract.document_approved` com metadata, `notifications`
>   `contract_document_approved` com `link_url=/contratos/{id}`.
> - **Governança na UI: "Ao vivo · 6/7"**; KPIs refletem dados reais
>   (Faturado R$ 282,9 mil, SLA 28h · ao vivo).
> - **Responsividade verificada por screenshot** em 1440/1366/1280/1024/834/390/360,
>   light+dark, drawer desktop+mobile: sem overflow horizontal.
>
> As seções abaixo permanecem como guia para re-execução em outros ambientes.

---

## 1. Aplicar migrations 035 + 036

Ordem: `034` → `035` → `036` (035 e 036 são aditivas e idempotentes).

```bash
# Aplica todas as migrations pendentes (recomendado)
supabase db push

# OU, no SQL editor, rode cada arquivo em ordem:
#   supabase/migrations/035_contract_documents_approved.sql
#   supabase/migrations/036_contract_persistence_fields.sql
```

### Verificação (resultado esperado)

**035 — status `approved` + colunas de aprovação de documento:**
```sql
-- Deve retornar a lista COM 'approved' presente:
select pg_get_constraintdef(oid)
from pg_constraint
where conname = 'contract_documents_status_check';
-- esperado: CHECK (... 'pending_approval', 'approved', 'rejected' ...)

-- Deve retornar 3 linhas (approved_at, approved_by, rejection_reason):
select column_name from information_schema.columns
where table_name = 'contract_documents'
  and column_name in ('approved_at','approved_by','rejection_reason');
```

**036 — campos de persistência:**
```sql
-- Obrigações: completion_note / completed_by / completed_at
-- Aprovações: started_at / completed_at / requested_changes_note
-- Faturamento: realized_amount / invoice_reference / realized_note / realized_by / realized_at
select table_name, column_name from information_schema.columns
where (table_name = 'contract_obligations' and column_name in ('completion_note','completed_by','completed_at'))
   or (table_name = 'contract_approvals' and column_name in ('started_at','completed_at','requested_changes_note'))
   or (table_name = 'contract_billing_events' and column_name in ('realized_amount','invoice_reference','realized_note','realized_by','realized_at'))
order by table_name, column_name;
-- esperado: 11 linhas.
```

**Idempotência:** rodar 035/036 uma segunda vez não deve dar erro (usa `IF NOT EXISTS`
/ `DROP CONSTRAINT IF EXISTS`). **Não destrutivo:** nenhuma coluna/linha é removida;
RLS das tabelas permanece (as policies não são tocadas).

**Types x banco:** `ContractDocumentRow`/`ContractObligationRow`/`ContractApprovalRow`/
`ContractBillingEventRow` em `src/lib/contracts/contract-service.ts` já incluem os
campos novos → typecheck limpo. Antes de aplicar as migrations, aprovar documento e
marcar faturado falham graciosamente (erro no toast, sem crash); ler continua OK.

---

## 2. Semear dados e validar (runbook)

Siga [contracts-governance-live.md](contracts-governance-live.md) §1–§7 para semear as
linhas `[QA]` (contrato, obrigações, faturamento, documentos incl. `approved`/`rejected`,
aprovações com timestamps, links de projeto/risco, tarefa de agenda, análise IA).

Depois percorra o checklist §8 do runbook. Abaixo, o mapeamento por tela desta fase:

### 3. Faturamento (aba)
- [ ] Strip: Planejado / Realizado / Saldo a faturar / Vencidos batem com os eventos.
- [ ] Linhas ao vivo com botão **Faturar**; estimadas read-only (sem botão).
- [ ] **Faturar** abre o modal (data/referência/nota) → grava `realized_at`/`realized_by`/`invoice_reference`/`realized_note`.
- [ ] Após faturar: **Valor faturado** e **Saldo a faturar** (KPIs) se movem; auditoria `contract.billing_event_realized`; notificação para o owner.
- [ ] Follow-up cria tarefa na Agenda.

### 4. Aprovações (aba)
- [ ] Card por contrato com SLA por etapa + badges (média / atraso / rejeitadas) + selo **Ao vivo/Estimado**.
- [ ] **Aprovar etapa** (direto) → `approval_timestamp`/`completed_at`; KPI **SLA médio** e a subline "ao vivo" atualizam.
- [ ] **Rejeitar / Solicitar ajustes** (modal) exige motivo; grava `rejection_reason` / `requested_changes_note`; auditoria `contract.approval.*` / `contract.changes_requested`.

### 5. Documentos
- [ ] Enviar para aprovação → `pending_approval`; **Aprovar** → `approved` + `approved_at`/`approved_by`; **Rejeitar** (modal) → `rejected` + `rejection_reason`.
- [ ] Chip de status correto; **Docs faltantes** exclui `approved`, inclui `rejected`/`missing`/`expired`.
- [ ] PDF do dossiê mostra a tabela **Documentos** com situação e motivo de rejeição.

### 6. Obrigações
- [ ] Concluir (modal, nota + follow-up opcional) → `completed_at`/`completed_by`/`completion_note`; sinal executivo e contadores atualizam.
- [ ] Criar tarefa a partir da obrigação aparece na Agenda.

### 7. RBAC/RLS (gating == policy 034)
Testar com papéis distintos e confirmar botões escondidos + mutação bloqueada por RLS:
- [ ] `contracts.view` (somente leitura): nenhuma ação de mutação visível.
- [ ] `contracts.edit`: obrigações, links, documentos e aprovações visíveis (RLS de aprovações/documentos aceita `edit`).
- [ ] `contracts.approve`: pode aprovar/rejeitar etapas.
- [ ] `contracts.documents.upload`: pode agir em documentos.
- [ ] `owner_admin`: acesso total (catch-all).
- [ ] Sem vazamento entre organizações (RLS por `organization_id`).

### 8. Auditoria — confirmar linhas em `audit_logs`
`contract.document_approved`, `document_rejected`, `billing_event_realized`,
`approval.<step>.approved|rejected`, `changes_requested`, `obligation_completed`,
`agenda_task_created`, `linked_project`, `linked_risk`. Metadata inclui
`contract_id`/entity id/new_status/reason/note/reference/actor/timestamp.

### 9. Notificações — confirmar linhas em `notifications`
Owner recebe eventos de doc/faturamento/aprovação/obrigação/tarefa/projeto/risco;
`p_link` aponta para `/contratos/{id}`; falha de notificação **não** bloqueia a mutação
(best-effort). Email: só se o fluxo existente estiver ligado (não implementado nesta fase).

### 10. PDF export
Dossiê reflete: documentos (status + motivo de rejeição), faturamento realizado + saldo,
status de aprovação, **SLA real** (ou heurístico rotulado quando sem timestamps),
obrigações ao vivo, projeto/risco vinculados. Sem shell/sidebar.

---

## 11. Bugs encontrados e corrigidos (auditoria estática, Fase 8)

1. **RLS/RBAC mismatch (documentos)** — UI liberava ações de documento por
   `contracts.documents.upload || contracts.upload_file`, mas a policy 034 exige
   `contracts.documents.upload || contracts.edit`. Um usuário só-`edit` não via os
   botões (permitido pela RLS) e um só-`upload_file` via botões que a RLS recusa.
   **Fix:** gating alinhado à policy (`documents.upload || edit`).
2. **RLS/RBAC mismatch (aprovações)** — policy aceita `approve || edit`, UI exigia só
   `approve`. **Fix:** `approve || edit`.
3. **Botão sem gate (drawer Seção D)** — "Enviar para revisão jurídica" aparecia sem
   checagem de permissão (o mesmo botão no rodapé já era gated). **Fix:** gated por
   `permissions.edit`.
4. **PDF data mismatch** — dossiê usava SLA heurístico fixo e não listava status de
   documentos. **Fix:** SLA real via `computeApprovalSla` (rotulado ao vivo/estimado)
   + tabela de Documentos (status + motivo de rejeição) a partir de `liveDocuments`.

## 12. Bugs remanescentes / riscos de produção
- **Migrations 035/036 precisam ser aplicadas** — bloqueante para approved-doc, SLA por
  etapa ao vivo e provisão realizada. Verificar com as queries da §1.
- **Auto-notificação:** o ator pode receber notificação da própria ação (ruído leve) —
  não bloqueante; considerar pular quando `recipient == actor`.
- **`tasks` (agenda):** o insert do runbook §7 assume colunas `related_contract_id`,
  `due_at`, etc. (migration 031). Ajustar nomes se o schema divergir.
- **Email não ligado** aos eventos de contrato (templates prontos em
  `notification-templates.ts`).
- Validação funcional real depende de rodar este guia em staging.
