# TASK-013 · Migrar admin tranche 1 (workflows / relatorios / historico / atas)

**Fase:** F4 — Migração do legado
**PR:** PR-13
**Dependências:** TASK-006
**Pode rodar em paralelo com:** TASK-014, TASK-015
**Owner-profile:** Frontend Engineer
**Estimativa:** 5–7h

---

## Contexto

Quatro módulos de admin ainda usam `@/components/ui/card`, `HUDCard`, `OrionGreenBackground` e botões/tabelas Shadcn crus. Esta tarefa faz a migração mecânica para o design system HUD v2.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/app/(main)/workflows/page.tsx` |
| **Modificar** | `src/app/(main)/relatorios/page.tsx` |
| **Modificar** | `src/app/(main)/historico/page.tsx` |
| **Modificar** | `src/app/(main)/atas/page.tsx` |

---

## Regras de migração (aplicar em todos os 4 arquivos)

### Substituições de imports

```ts
// REMOVER
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { HUDCard } from "@/components/ui/hud-card";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// ADICIONAR
import { HudPanel } from "@/components/hud/HudPanel";
import { HudButton } from "@/components/hud/HudButton";
import { HudInput } from "@/components/hud/HudInput";
import { HudSelect } from "@/components/hud/HudSelect";
import { HudTable } from "@/components/hud/HudTable";
import { HudBadge } from "@/components/hud/HudBadge";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPageLayout } from "@/components/hud/HudPageLayout";
```

### Substituições JSX

| Antes | Depois |
|---|---|
| `<Card>...</Card>` | `<HudPanel elevation={2}>...</HudPanel>` |
| `<CardHeader><CardTitle>X</CardTitle></CardHeader>` | Prop `title="X"` em `HudPanel` |
| `<CardContent>` | Remover; conteúdo fica diretamente em `HudPanel` |
| `<HUDCard>...</HUDCard>` | `<HudPanel elevation={2}>...</HudPanel>` |
| `<OrionGreenBackground />` | Remover (background é do `HudPageLayout`) |
| `<Button variant="default">` | `<HudButton variant="primary">` |
| `<Button variant="outline">` | `<HudButton variant="secondary">` |
| `<Button variant="ghost">` | `<HudButton variant="ghost">` |
| `<Input ...>` | `<HudInput ...>` |
| `<Badge>X</Badge>` | `<HudBadge>X</HudBadge>` |
| `<Table>...<TableHeader>...<TableBody>...` | Converter para `HudTable columns={...} data={...}` |

### Adicionar `HudHeader` no topo de cada página

| Módulo | title | icon | iconTint |
|---|---|---|---|
| Workflows | "Workflows" | `<GitBranch size={18} />` | `#A855F7` |
| Relatórios | "Relatórios" | `<BarChart3 size={18} />` | `#3B82F6` |
| Histórico | "Histórico de Atividades" | `<History size={18} />` | `#64748B` |
| Atas | "Atas de Reunião" | `<FileText size={18} />` | `#14B8A6` |

### Envolver em `HudPageLayout`

```tsx
export default function WorkflowsPage() {
  return (
    <HudPageLayout>
      <HudHeader title="Workflows" icon={<GitBranch size={18} />} iconTint="#A855F7" />
      {/* ... conteúdo da página */}
    </HudPageLayout>
  );
}
```

---

## Verificação

Após migração, rodar para cada arquivo:
```bash
grep -E "ui/card|HUDCard|OrionGreenBackground|ui/button|ui/input|ui/table|ui/badge" src/app/(main)/workflows/page.tsx
grep -E "ui/card|HUDCard|OrionGreenBackground|ui/button|ui/input|ui/table|ui/badge" src/app/(main)/relatorios/page.tsx
grep -E "ui/card|HUDCard|OrionGreenBackground|ui/button|ui/input|ui/table|ui/badge" src/app/(main)/historico/page.tsx
grep -E "ui/card|HUDCard|OrionGreenBackground|ui/button|ui/input|ui/table|ui/badge" src/app/(main)/atas/page.tsx
```

Todos devem retornar **0 matches**.

---

## Acceptance criteria

- [ ] 4 arquivos migrados, sem imports legados.
- [ ] Cada página tem `HudHeader` com `iconTint` correto.
- [ ] Cada página está envolvida em `HudPageLayout`.
- [ ] Screenshots dark + light de cada rota migrada.
- [ ] `npm run build` passa sem warnings novos.
