import type { ReactNode } from "react";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function ConfiguracoesLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <SettingsNav />
      <div className="relative flex-1 px-5 py-6 md:max-w-3xl md:px-8 md:py-8">
        {children}
        <SettingsFooter />
      </div>
    </div>
  );
}
