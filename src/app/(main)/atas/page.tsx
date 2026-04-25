import { FileText } from "lucide-react";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPageLayout } from "@/components/hud/HudPageLayout";
import { HudPanel } from "@/components/hud/HudPanel";

export default function AtasPage() {
  return (
    <HudPageLayout>
      <HudHeader
        title="Atas de Reunião"
        subtitle="Repositório de atas de reuniões e votações"
        icon={<FileText size={18} />}
        iconTint="#14B8A6"
      />

      <HudPanel elevation={2}>
        <div className="flex min-h-64 items-center justify-center">
          <div className="max-w-md text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-ig-fg-subtle" />
            <p className="text-sm text-ig-fg-muted">O conteúdo de visualização de atas será implementado aqui.</p>
          </div>
        </div>
      </HudPanel>
    </HudPageLayout>
  );
}
