# TASK-017 · Watermark + serial numbers

**Fase:** F5 — Identidade + Polish
**PR:** PR-17
**Dependências:** TASK-005
**Pode rodar em paralelo com:** TASK-016, TASK-018, TASK-019
**Owner-profile:** Full-stack Engineer
**Estimativa:** 3–4h

---

## Contexto

Produtos executivos premium usam identificadores serializados em documentos e painéis de controle. Esta tarefa adiciona seriais visíveis nos módulos de deliberações, contratos, projetos e riscos, além de watermarks nos painéis herói do Dashboard, Financeiro e Riscos.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Criar** | `src/lib/utils/serial.ts` |
| **Modificar** | `src/app/(main)/pautas/page.tsx` (ou componente de detalhes) |
| **Modificar** | `src/components/contracts/contract-list.tsx` ou drawer |
| **Modificar** | `src/app/(main)/projetos/[id]/page.tsx` ou drawer |
| **Modificar** | `src/app/(main)/riscos/page.tsx` |
| **Modificar** | Dashboard (Left/Right Stack panels) |
| **Modificar** | `src/app/(main)/financeiro/page.tsx` |

---

## Utilitário `src/lib/utils/serial.ts`

```ts
/**
 * Gera um serial number de 4 dígitos baseado no ID do item.
 * Formato: PREFIX-YEAR-XXXX
 * Exemplo: DEL-2026-0147
 */
export function generateSerial(
  prefix: string,
  id: string,
  year?: number
): string {
  const y = year ?? new Date().getFullYear();
  const num = id.replace(/\D/g, '').padStart(4, '0').slice(-4);
  return `${prefix}-${y}-${num}`;
}

// Funções de conveniência
export const deliberationSerial  = (id: string) => generateSerial('DEL', id);
export const contractSerial      = (id: string) => generateSerial('CTR', id);
export const projectSerial       = (id: string) => generateSerial('PRJ', id);
export const riskSerial          = (id: string) => generateSerial('RSK', id);
```

---

## Aplicação em módulos

### Deliberações

No inspector/detalhe de cada deliberação:
```tsx
import { deliberationSerial } from "@/lib/utils/serial";

<HudPanel
  elevation={3}
  title={deliberation.titulo}
  serial={deliberationSerial(deliberation.id)}
>
  {/* ... */}
</HudPanel>
```

### Contratos (drawer ou lista)

```tsx
import { contractSerial } from "@/lib/utils/serial";

<HudPanel
  elevation={3}
  title={contract.titulo}
  serial={contractSerial(contract.id)}
  watermark="CONTRATO · ATIVO"
>
  {/* ... */}
</HudPanel>
```

### Projetos (página de detalhe `[id]`)

```tsx
import { projectSerial } from "@/lib/utils/serial";

<HudHeader
  title={project.nome}
  serial={projectSerial(project.id)}
/>
```

### Riscos (painel da lista)

```tsx
<HudPanel
  elevation={2}
  title="Lista de Riscos"
  watermark="RISK · MATRIX · V2.6"
>
```

---

## Watermarks em painéis herói

### Dashboard — Left Stack (painel principal)

```tsx
<HudPanel
  elevation={3}
  halo
  watermark="CONTROL ROOM · V2.6"
  serial="HUD-2026"
>
```

### Dashboard — Right Stack (painel de overview)

```tsx
<HudPanel
  elevation={2}
  watermark="EXECUTIVE · VIEW"
>
```

### Financeiro — overview (painel KPI principal)

```tsx
<HudPanel
  elevation={2}
  title="Visão Financeira"
  watermark="FIN · OVERVIEW · V2.6"
>
```

---

## Acceptance criteria

- [ ] `src/lib/utils/serial.ts` existe e `generateSerial('DEL', '001')` retorna `'DEL-2026-0001'`.
- [ ] Pelo menos 5 módulos exibem serial no rodapé de `HudPanel` (em `font-mono tracking-[0.2em]`).
- [ ] 3 painéis herói exibem watermark no canto inferior direito.
- [ ] Watermark e serial são visíveis mas não competem com o conteúdo (cor `text-ig-fg-subtle`).
- [ ] `npm run build` passa.
