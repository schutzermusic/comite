"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { SidebarProvider } from "@/components/ui/sidebar";

const SIDEBAR_PREFERENCE_KEY = "ig-sidebar-open";
const SIDEBAR_WIDTH_ICON = "4.5rem";

const readPreference = (): boolean | null => {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* localStorage unavailable */
  }
  return null;
};

const writePreference = (value: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(value));
  } catch {
    /* localStorage unavailable */
  }
};

const isDashboardRoute = (pathname: string | null) => {
  if (!pathname) return false;
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
};

export function SidebarShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const initialPathnameRef = React.useRef(pathname);

  const [open, setOpen] = React.useState<boolean>(true);

  React.useEffect(() => {
    const stored = readPreference();
    if (stored !== null) {
      setOpen(stored);
      return;
    }
    setOpen(!isDashboardRoute(initialPathnameRef.current));
  }, []);

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
