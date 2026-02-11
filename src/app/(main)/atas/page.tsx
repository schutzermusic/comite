import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { HUDCard } from "@/components/ui/hud-card";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import { FileText } from "lucide-react";

export default function AtasPage() {
  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Atas</h1>
          <p className="text-sm text-[rgba(255,255,255,0.65)]">Repositório de atas de reuniões e votações</p>
        </header>
        
        <HUDCard>
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <FileText className="mx-auto h-12 w-12 text-[rgba(255,255,255,0.20)] mb-4"/>
              <p className="text-[rgba(255,255,255,0.65)]">O conteúdo de visualização de atas será implementado aqui.</p>
            </div>
          </div>
        </HUDCard>
      </div>
    </OrionGreenBackground>
  );
}
