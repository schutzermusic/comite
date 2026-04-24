# TASK-015 · Migrar `risk-list` e `contract-list` para HudTable

**Fase:** F4 — Migração do legado
**PR:** PR-15
**Dependências:** TASK-012 (risk-list já feito nessa task — verificar)
**Pode rodar em paralelo com:** TASK-013, TASK-014
**Owner-profile:** Frontend Engineer
**Estimativa:** 2–3h

---

## Contexto

`risk-list.tsx` e `contract-list.tsx` usam `@/components/ui/table` (Shadcn Table cru). Esta tarefa migra ambos para `HudTable`, eliminando as últimas referências a `ui/table` em componentes de feature.

> **Nota:** Se TASK-012 já migrou `risk-list.tsx`, verificar se a migração está completa. Caso esteja, focar apenas em `contract-list.tsx`.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/components/risks/risk-list.tsx` (se não migrado em TASK-012) |
| **Modificar** | `src/components/contracts/contract-list.tsx` |

---

## Migração de `contract-list.tsx`

### Antes (estrutura típica)

```tsx
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

// ...
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Contrato</TableHead>
      <TableHead>Valor</TableHead>
      // ...
    </TableRow>
  </TableHeader>
  <TableBody>
    {contracts.map((c) => (
      <TableRow key={c.id} onClick={() => onSelect?.(c)}>
        <TableCell>{c.numero}</TableCell>
        // ...
      </TableRow>
    ))}
  </TableBody>
</Table>
```

### Depois

```tsx
import { HudTable, type HudTableColumn } from "@/components/hud/HudTable";
import { HudStatusPill } from "@/components/hud/HudStatusPill";
import type { Contract } from "@/lib/types";

const columns: HudTableColumn<Contract>[] = [
  {
    key: 'numero',
    header: 'Número',
    width: 140,
    render: (c) => (
      <span className="font-mono text-ig-body-sm text-ig-fg-strong">{c.numero}</span>
    ),
  },
  {
    key: 'titulo',
    header: 'Contrato',
    render: (c) => (
      <span className="text-ig-body-sm text-ig-fg-strong">{c.titulo}</span>
    ),
  },
  {
    key: 'fornecedor',
    header: 'Fornecedor',
    render: (c) => (
      <span className="text-ig-body-sm text-ig-fg-muted">{c.fornecedor}</span>
    ),
  },
  {
    key: 'valor',
    header: 'Valor',
    width: 140,
    render: (c) => (
      <span className="text-ig-body-sm text-ig-fg ig-tabular">
        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c.valor)}
      </span>
    ),
  },
  {
    key: 'vencimento',
    header: 'Vencimento',
    width: 120,
    render: (c) => (
      <span className="text-ig-body-sm text-ig-fg-muted">
        {new Date(c.dataVencimento).toLocaleDateString('pt-BR')}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 110,
    render: (c) => (
      <HudStatusPill variant={c.status === 'ativo' ? 'success' : c.status === 'vencido' ? 'critical' : 'default'}>
        {c.status}
      </HudStatusPill>
    ),
  },
];

export function ContractList({
  contracts,
  onRowClick,
}: {
  contracts: Contract[];
  onRowClick?: (c: Contract) => void;
}) {
  return (
    <HudTable
      columns={columns}
      data={contracts}
      onRowClick={onRowClick}
      emptyMessage="Nenhum contrato encontrado."
    />
  );
}
```

---

## Verificação

```bash
grep -r "from \"@/components/ui/table\"" src/components/
```

Deve retornar **0 matches** em arquivos de features (pode existir em `src/components/ui/table.tsx` em si).

---

## Acceptance criteria

- [ ] `grep -r "from \"@/components/ui/table\"" src/components/risks/ src/components/contracts/` → 0.
- [ ] `ContractList` renderiza com `HudTable`.
- [ ] `onRowClick` funciona (abre drawer de detalhes se existente).
- [ ] Colunas formatam valor monetário com `Intl.NumberFormat`.
- [ ] `npm run build` passa.
