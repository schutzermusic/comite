# TASK-014 · Migrar admin tranche 2 (comites / membros / roles)

**Fase:** F4 — Migração do legado
**PR:** PR-14
**Dependências:** TASK-006
**Pode rodar em paralelo com:** TASK-013, TASK-015
**Owner-profile:** Frontend Engineer
**Estimativa:** 4–5h

---

## Contexto

Continuação da migração de módulos admin. Três módulos restantes: Comitês, Membros, Permissões/Roles. Mesmas regras de TASK-013.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/app/(main)/comites/page.tsx` |
| **Modificar** | `src/app/(main)/membros/page.tsx` |
| **Modificar** | `src/app/(main)/roles/page.tsx` |

---

## Regras de migração

Idênticas a TASK-013. Consultar a tabela de substituições de imports e JSX na TASK-013.

### HudHeader por módulo

| Módulo | title | icon | iconTint |
|---|---|---|---|
| Comitês | "Comitês" | `<Users2 size={18} />` | `#F5A524` |
| Membros | "Membros" | `<UserCheck size={18} />` | `#10B981` |
| Permissões | "Permissões & Roles" | `<Lock size={18} />` | `#EF4B55` |

---

## Observação — Membros

`membros/page.tsx` já pode estar parcialmente migrado para HUD. Neste caso:
1. Verificar se há resíduos de `ui/card`, `ui/table`, `ui/button` ou `HUDCard`.
2. Aplicar apenas as substituições necessárias.
3. Garantir que `HudHeader` com `iconTint="#10B981"` está presente.

---

## Verificação

```bash
grep -E "ui/card|HUDCard|OrionGreenBackground|ui/button|ui/input|ui/table|ui/badge" \
  src/app/(main)/comites/page.tsx \
  src/app/(main)/membros/page.tsx \
  src/app/(main)/roles/page.tsx
```

Deve retornar **0 matches**.

---

## Acceptance criteria

- [ ] 3 arquivos migrados sem imports legados.
- [ ] `HudHeader` com `iconTint` correto em cada módulo.
- [ ] `HudPageLayout` envolvendo cada página.
- [ ] Screenshots dark + light de cada rota.
- [ ] `npm run build` passa.
