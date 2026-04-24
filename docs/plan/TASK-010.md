# TASK-010 · Reconstruir módulo /configuracoes

**Fase:** F3 — Módulos vitrine
**PR:** PR-10
**Dependências:** TASK-006, TASK-007, TASK-009
**Owner-profile:** Full-stack Engineer
**Estimativa:** 8–10h

---

## Contexto

`/configuracoes` é o módulo visualmente mais divergente do sistema: usa `@/components/ui/card`, gradientes laranja/roxo/verde aleatórios e um layout monolítico de 400+ linhas. Esta tarefa reconstrói o módulo como um sistema de sub-rotas com navegação lateral, layout padronizado `HudPanel` e `SettingRow` reutilizável.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Substituir** | `src/app/(main)/configuracoes/page.tsx` → redirect para `/configuracoes/conta` |
| **Criar** | `src/app/(main)/configuracoes/layout.tsx` |
| **Criar** | `src/components/settings/SettingsNav.tsx` |
| **Criar** | `src/components/settings/SettingRow.tsx` |
| **Criar** | `src/components/settings/SettingsFooter.tsx` |
| **Criar** | `src/app/(main)/configuracoes/conta/page.tsx` |
| **Criar** | `src/app/(main)/configuracoes/empresa/page.tsx` |
| **Criar** | `src/app/(main)/configuracoes/notificacoes/page.tsx` |
| **Criar** | `src/app/(main)/configuracoes/integracoes/page.tsx` |
| **Criar** | `src/app/(main)/configuracoes/api-tokens/page.tsx` |
| **Criar** | `src/app/(main)/configuracoes/aparencia/page.tsx` |
| **Criar** | `src/app/(main)/configuracoes/seguranca/page.tsx` |
| **Criar** | `src/app/(main)/configuracoes/auditoria/page.tsx` |

---

## Layout principal

```tsx
// src/app/(main)/configuracoes/layout.tsx
import { SettingsNav } from "@/components/settings/SettingsNav";
import { SettingsFooter } from "@/components/settings/SettingsFooter";

export default function ConfiguracoesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <SettingsNav />
      <div className="flex-1 max-w-3xl px-8 py-8 relative">
        {children}
        <SettingsFooter />
      </div>
    </div>
  );
}
```

## SettingsNav

```tsx
// src/components/settings/SettingsNav.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  User, Building2, Bell, Puzzle, KeyRound,
  Palette, Shield, ScrollText
} from "lucide-react";

const SETTINGS_LINKS = [
  { href: "/configuracoes/conta",        label: "Minha Conta",     icon: User },
  { href: "/configuracoes/empresa",      label: "Empresa",         icon: Building2 },
  { href: "/configuracoes/notificacoes", label: "Notificações",    icon: Bell },
  { href: "/configuracoes/integracoes",  label: "Integrações",     icon: Puzzle },
  { href: "/configuracoes/api-tokens",   label: "API & Tokens",    icon: KeyRound },
  { href: "/configuracoes/aparencia",    label: "Aparência",       icon: Palette },
  { href: "/configuracoes/seguranca",    label: "Segurança",       icon: Shield },
  { href: "/configuracoes/auditoria",    label: "Auditoria",       icon: ScrollText },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <aside className="w-56 flex-shrink-0 border-r border-ig-border px-3 py-8">
      <p className="text-ig-label ig-label-upper text-ig-fg-subtle px-3 mb-4">
        Configurações
      </p>
      <nav className="flex flex-col gap-0.5">
        {SETTINGS_LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-[var(--ig-radius-md)]",
                "text-ig-body-sm transition-colors",
                active
                  ? "bg-ig-accent-weak text-ig-fg-strong font-medium"
                  : "text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-fg"
              )}
            >
              <Icon size={14} className={active ? "text-ig-accent" : ""} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

## SettingRow

```tsx
// src/components/settings/SettingRow.tsx
import { cn } from "@/lib/utils";

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn(
      "flex items-start justify-between gap-8 py-4 border-b border-ig-border-subtle",
      className
    )}>
      <div className="flex-1 min-w-0">
        <p className="text-ig-body-sm text-ig-fg-strong font-medium">{label}</p>
        {description && (
          <p className="text-ig-caption text-ig-fg-muted mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center">{children}</div>
    </div>
  );
}
```

## SettingsFooter (dirty state)

```tsx
// src/components/settings/SettingsFooter.tsx
"use client";
import { HudButton } from "@/components/hud/HudButton";
import { AnimatePresence, motion } from "framer-motion";

interface SettingsFooterProps {
  dirty?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
}

export function SettingsFooter({ dirty, onSave, onDiscard }: SettingsFooterProps) {
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          className="
            sticky bottom-0 mt-8 py-4 border-t border-ig-border
            flex items-center justify-end gap-3
            bg-ig-base/90 backdrop-blur-sm
          "
        >
          <HudButton variant="ghost" onClick={onDiscard}>
            Descartar
          </HudButton>
          <HudButton variant="primary" onClick={onSave}>
            Salvar alterações
          </HudButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

## Exemplo de sub-rota

```tsx
// src/app/(main)/configuracoes/notificacoes/page.tsx
"use client";
import { useState } from "react";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudHeader } from "@/components/hud/HudHeader";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { Bell } from "lucide-react";
import { Switch } from "@/components/ui/switch"; // primitivo ok

const DEFAULTS = {
  emailResumo: true,
  emailAlertas: true,
  pushPautas: false,
  pushRiscos: true,
  pushReunioesProximas: true,
  digestSemanal: false,
};

export default function NotificacoesPage() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof typeof DEFAULTS>(k: K, v: boolean) => {
    setSettings((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  return (
    <>
      <HudHeader
        title="Notificações"
        subtitle="Controle como e quando você recebe alertas."
        icon={<Bell size={18} />}
        iconTint="#3B82F6"
      />
      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="E-mail">
          <SettingRow label="Resumo diário" description="Receba um resumo das atividades a cada manhã.">
            <Switch checked={settings.emailResumo} onCheckedChange={(v) => set("emailResumo", v)} />
          </SettingRow>
          <SettingRow label="Alertas críticos" description="Notificações imediatas para riscos e vencimentos.">
            <Switch checked={settings.emailAlertas} onCheckedChange={(v) => set("emailAlertas", v)} />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={2} title="Push">
          <SettingRow label="Novas pautas" description="Quando uma deliberação for criada para você.">
            <Switch checked={settings.pushPautas} onCheckedChange={(v) => set("pushPautas", v)} />
          </SettingRow>
          <SettingRow label="Riscos elevados">
            <Switch checked={settings.pushRiscos} onCheckedChange={(v) => set("pushRiscos", v)} />
          </SettingRow>
          <SettingRow label="Reuniões próximas" description="30 minutos antes do início.">
            <Switch checked={settings.pushReunioesProximas} onCheckedChange={(v) => set("pushReunioesProximas", v)} />
          </SettingRow>
        </HudPanel>
      </div>
      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={() => { setSettings(DEFAULTS); setDirty(false); }} />
    </>
  );
}
```

---

## Regras para todas as sub-rotas

- **Zero** `@/components/ui/card`.
- **Zero** cores `#FF7A3D`, `orange-*`, `purple-*`, `lime-*`, `pink-*`.
- Todos os painéis: `<HudPanel elevation={2}>`.
- Inputs: `HudInput`. Selects: `HudSelect`. Switches: `Switch` (Radix, aceito como primitivo).
- Botões: `HudButton`.

---

## Acceptance criteria

- [ ] 8 sub-rotas existem e são acessíveis via `SettingsNav`.
- [ ] `SettingsFooter` aparece quando há `dirty=true` e some ao salvar/descartar.
- [ ] `grep -rE "#FF7A3D|border-orange|text-purple-|from-orange" src/app/(main)/configuracoes/` → 0.
- [ ] `grep -r "from \"@/components/ui/card\"" src/app/(main)/configuracoes/` → 0.
- [ ] Dark e light testados em screenshots (WCAG AA).
- [ ] `npm run build` passa.
