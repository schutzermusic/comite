# TASK-007 · Sidebar v2 — zero ternários, hierarquia, admin colapsável

**Fase:** F2 — Shell
**PR:** PR-07
**Dependências:** TASK-006
**Pode rodar em paralelo com:** TASK-008, TASK-009
**Owner-profile:** Frontend Engineer
**Estimativa:** 5–7h

---

## Contexto

`app-sidebar.tsx` tem 20+ ternários `isLight ? … : …`, texto de itens em 10–11px uppercase e o grupo "Administração" sempre expandido. Esta tarefa reescreve o componente usando apenas tokens `--ig-*` (zero ternários), eleva o tamanho de fonte, e adiciona collapse persistente para o grupo de admin.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Reescrever** | `src/components/layout/app-sidebar.tsx` |
| **Modificar** | `src/app/globals.css` (regras `.hud-sidebar`) |

---

## Regras CSS do sidebar (substituir em `globals.css`)

```css
.hud-sidebar {
  background: var(--ig-bg-base);
  border-right: 1px solid var(--ig-border-default);
  box-shadow: var(--ig-shadow-e3);
}
html.dark .hud-sidebar {
  background: linear-gradient(
    180deg,
    rgba(4, 18, 14, 0.92) 0%,
    rgba(3, 14, 10, 0.95) 100%
  );
  backdrop-filter: blur(48px) saturate(160%);
  -webkit-backdrop-filter: blur(48px) saturate(160%);
}
.hud-sidebar-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: var(--ig-radius-md);
  font-size: 13px;
  font-weight: 400;
  color: var(--ig-fg-muted);
  transition: color 150ms ease, background 150ms ease;
  cursor: pointer;
}
.hud-sidebar-item:hover {
  color: var(--ig-fg-strong);
  background: var(--ig-bg-panel-hover);
}
.hud-sidebar-item[data-active="true"] {
  color: var(--ig-fg-strong);
  background: var(--ig-accent-weak);
  font-weight: 500;
}
.hud-sidebar-item[data-active="true"]::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 2px;
  border-radius: 2px;
  background: var(--ig-accent);
}
.hud-sidebar-item[data-active="true"] .sidebar-icon {
  color: var(--ig-accent);
}
.hud-sidebar-section-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ig-fg-subtle);
  padding: 16px 14px 6px;
}
```

---

## Requisitos do componente

### Itens de navegação
- Texto: `font-size: 13px` (mínimo). Sub-itens: `12px`.
- **Remover** `uppercase tracking-[0.1em]` de itens de navegação.
- **Manter** `uppercase` apenas nos `section-label` (ex: `GOVERNANÇA`, `ADMINISTRAÇÃO`).
- Active bar: `::before` de 2px à esquerda em `bg-ig-accent`.
- Icon ativo: `color: var(--ig-accent)`.

### Grupo "Administração"
- Default: **colapsado** (estado inicial).
- Estado persiste em `localStorage` com a chave `"ig-sidebar-admin-open"`.
- Mostrar contador de itens quando colapsado: `Administração (7)`.
- Chevron rotaciona 180° quando aberto (transition).

### Avatar/footer
- Remover gradiente `cyan→emerald`.
- Usar: `bg-ig-accent-weak text-ig-accent`.

### Proibido
- Zero ternários `isLight ? … : …`.
- Zero `!important` novo.
- Zero cores hardcoded (usar apenas `var(--ig-*)`).

---

## Estrutura de referência

```tsx
"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
// ... imports de ícones e componentes

const ADMIN_STORAGE_KEY = "ig-sidebar-admin-open";

export function AppSidebar() {
  const pathname = usePathname();
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (stored !== null) setAdminOpen(stored === "true");
  }, []);

  const toggleAdmin = () => {
    setAdminOpen((prev) => {
      localStorage.setItem(ADMIN_STORAGE_KEY, String(!prev));
      return !prev;
    });
  };

  // ... renderização usando apenas classes CSS `hud-sidebar-*` e tokens `ig-*`
}
```

---

## Acceptance criteria

- [ ] `grep -c "isLight" src/components/layout/app-sidebar.tsx` = **0**.
- [ ] Tamanho mínimo de texto em itens de navegação = 13px.
- [ ] Grupo "Administração" colapsa e o estado persiste após reload da página.
- [ ] Active indicator (barra 2px) visível em dark e light.
- [ ] Avatar/footer sem gradiente cyan→emerald.
- [ ] `npm run build` passa.
