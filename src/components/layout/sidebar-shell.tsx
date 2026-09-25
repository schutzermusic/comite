"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  SIDEBAR_PREFERENCE_COOKIE,
  SIDEBAR_PREFERENCE_MAX_AGE,
  initialSidebarOpen,
  parseSidebarPreference,
} from "./sidebar-preference";

const SIDEBAR_WIDTH_ICON = "4.5rem";

const writePreference = (value: boolean) => {
  if (typeof document === "undefined") return;
  document.cookie = `${SIDEBAR_PREFERENCE_COOKIE}=${value}; path=/; max-age=${SIDEBAR_PREFERENCE_MAX_AGE}; samesite=lax`;
};

/** Onde a preferência morava antes do cookie. Lida uma vez, para migrar. */
const readLegacyPreference = (): boolean | null => {
  try {
    return parseSidebarPreference(window.localStorage.getItem(SIDEBAR_PREFERENCE_COOKIE));
  } catch {
    return null;
  }
};

/**
 * `preference` vem do cookie lido pelo layout do servidor. O estado inicial é
 * o MESMO no HTML e no render de hidratação — e não muda depois de montar: a
 * `AppSidebar` hidrata dentro de um limite de Suspense, e uma troca de estado
 * antes disso faria ela hidratar contra um HTML que não bate.
 */
export function SidebarShell({
  children,
  preference = null,
}: {
  children: React.ReactNode;
  preference?: boolean | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState<boolean>(() => initialSidebarOpen(preference, pathname));

  // Migração única: a preferência antiga (localStorage) vira cookie e vale a
  // partir da próxima carga — aplicá-la agora reabriria o descompasso.
  React.useEffect(() => {
    if (preference !== null) return;
    const legacy = readLegacyPreference();
    if (legacy !== null) writePreference(legacy);
  }, [preference]);

  const handleOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    writePreference(next);
  }, []);

  return (
    <SidebarProvider
      open={open}
      onOpenChange={handleOpenChange}
      style={{ "--sidebar-width-icon": SIDEBAR_WIDTH_ICON } as React.CSSProperties}
    >
      {children}
    </SidebarProvider>
  );
}
