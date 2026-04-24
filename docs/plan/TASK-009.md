# TASK-009 · `HudToaster` unificado

**Fase:** F2 — Shell
**PR:** PR-09
**Dependências:** TASK-005
**Pode rodar em paralelo com:** TASK-007, TASK-008
**Owner-profile:** Frontend Engineer
**Estimativa:** 4–5h

---

## Contexto

O projeto tem 3 sistemas de toast simultâneos: `useToast` (shadcn), `react-hot-toast` (se presente) e `QuickActionToast` personalizado. Esta tarefa cria um sistema único `HudToaster` / `useHudToast`, migra todas as chamadas e remove os sistemas legados.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Criar** | `src/components/hud/HudToaster.tsx` |
| **Criar** | `src/hooks/useHudToast.ts` |
| **Modificar** | `src/components/hud/index.ts` (exportar HudToaster e useHudToast) |
| **Modificar** | `src/app/layout.tsx` (envolver com HudToaster) |
| **Migrar** | Todas as chamadas de `useToast` → `useHudToast` |
| **Deletar** | `src/hooks/use-toast.ts` |
| **Deletar** | `src/components/ui/toaster.tsx` |
| **Deletar** | `src/components/ui/toast.tsx` |
| **Deletar/Migrar** | `src/components/dashboard/QuickActionToast.tsx` |

---

## Implementação

### `src/hooks/useHudToast.ts`

```ts
import { create } from "zustand";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration?: number;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, "id">) => void;
  remove: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { ...toast, id: crypto.randomUUID() },
      ],
    })),
  remove: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

export function useHudToast() {
  const add = useToastStore((s) => s.add);

  return {
    notify: (
      title: string,
      options?: { description?: string; variant?: ToastVariant; duration?: number }
    ) =>
      add({
        title,
        description: options?.description,
        variant: options?.variant ?? "info",
        duration: options?.duration ?? 4000,
      }),
    success: (title: string, description?: string) =>
      add({ title, description, variant: "success", duration: 4000 }),
    error: (title: string, description?: string) =>
      add({ title, description, variant: "error", duration: 6000 }),
    warning: (title: string, description?: string) =>
      add({ title, description, variant: "warning", duration: 5000 }),
  };
}

export { useToastStore };
```

> **Dependência:** adicionar `zustand` se não presente (`npm install zustand`).

### `src/components/hud/HudToaster.tsx`

```tsx
"use client";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, AlertTriangle, Info, XCircle } from "lucide-react";
import { useToastStore, type ToastVariant } from "@/hooks/useHudToast";

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-ig-success" />,
  error:   <XCircle size={16} className="text-ig-danger" />,
  warning: <AlertTriangle size={16} className="text-ig-warning" />,
  info:    <Info size={16} className="text-ig-info" />,
};

const STATE_MAP: Record<ToastVariant, string> = {
  success: "success",
  error:   "critical",
  warning: "warning",
  info:    "default",
};

export function HudToaster() {
  const { toasts, remove } = useToastStore();

  return (
    <div
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 w-80 pointer-events-none"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={remove} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: import("@/hooks/useHudToast").ToastItem;
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(
      () => onRemove(toast.id),
      toast.duration ?? 4000
    );
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onRemove]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 32, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 32, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-auto"
    >
      <div
        className="ig-glass"
        data-elev="4"
        data-state={STATE_MAP[toast.variant]}
      >
        <span data-ig-noise="" />
        <div data-ig-content="" className="flex items-start gap-3 px-4 py-3">
          <span className="flex-shrink-0 mt-0.5">{ICONS[toast.variant]}</span>
          <div className="flex-1 min-w-0">
            <p className="text-ig-body-sm text-ig-fg-strong font-medium leading-tight">
              {toast.title}
            </p>
            {toast.description && (
              <p className="text-ig-caption text-ig-fg-muted mt-0.5">
                {toast.description}
              </p>
            )}
          </div>
          <button
            onClick={() => onRemove(toast.id)}
            className="flex-shrink-0 text-ig-fg-subtle hover:text-ig-fg transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}
```

### Modificar `src/app/layout.tsx`

```tsx
// Adicionar import
import { HudToaster } from "@/components/hud/HudToaster";

// Envolver children
<body>
  {children}
  <HudToaster />
</body>
```

---

## Migração de chamadas legadas

Rodar o grep para identificar todos os arquivos a migrar:
```bash
grep -rl "useToast\|use-toast\|hot-toast\|QuickActionToast" src/
```

Para cada arquivo encontrado, substituir:
```ts
// Antes
import { useToast } from "@/hooks/use-toast";
// ...
const { toast } = useToast();
toast({ title: "Salvo!", description: "Configurações salvas." });

// Depois
import { useHudToast } from "@/hooks/useHudToast";
// ...
const { notify } = useHudToast();
notify("Salvo!", { description: "Configurações salvas.", variant: "success" });
```

---

## Acceptance criteria

- [ ] `grep -r "use-toast\|ui/toaster\|ui/toast\|QuickActionToast" src/` retorna 0 matches.
- [ ] Múltiplos `notify()` em sequência empilham toasts sem sobrepor.
- [ ] Toast `error` exibe borda vermelha (`data-state="critical"`).
- [ ] Toast desaparece automaticamente após `duration`.
- [ ] `prefers-reduced-motion: reduce` → toast entra/sai com fade simples (sem spring).
- [ ] `npm run build` passa.
