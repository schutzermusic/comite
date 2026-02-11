"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HUDCard } from "@/components/ui/hud-card";
import { hudInputBase } from "@/components/ui/hud-input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { GenerateMeetingMinutesOutput } from "@/ai/flows/automated-minute-generation";
import { Loader2, FileText, ListChecks, Sparkles, CheckCircle2, Brain } from "lucide-react";
import { Meeting, AgendaItem } from "@/lib/types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";

interface AiMinutesGeneratorProps {
  meeting: Meeting;
  agendaItems: AgendaItem[];
}

export function AiMinutesGenerator({ meeting, agendaItems }: AiMinutesGeneratorProps) {
  const [transcription, setTranscription] = useState("");
  const [result, setResult] = useState<GenerateMeetingMinutesOutput | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGenerate = async () => {
    if (!transcription.trim()) {
      toast({
        title: "Transcrição vazia",
        description: "Por favor, insira o texto da transcrição da reunião.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      // Mocking the AI call
      setTimeout(() => {
        const mockOutput: GenerateMeetingMinutesOutput = {
            resumoExecutivo: "A reunião focou na revisão do orçamento do Projeto X e na avaliação de novos fornecedores. A principal decisão foi aprovar um novo CAPEX para o projeto, com a ação de renegociar contratos de matéria-prima. O cronograma foi ajustado para refletir as novas milestones.",
            ataEstruturada: `**Ata da Reunião: ${meeting.titulo}**\n\n**Data:** ${new Date().toLocaleDateString('pt-BR')}\n**Participantes:** ${users.slice(0,3).map(u => u.nome).join(', ')}\n\n**1. Revisão do Orçamento do Projeto X**\n- Discussão sobre o desvio orçamentário.\n- Decisão: Aprovado novo CAPEX.\n\n**2. Apresentação de Novos Fornecedores**\n- Avaliação de propostas para expansão da planta.\n- Decisão: Selecionar os 3 melhores fornecedores para uma rodada final de negociação.\n\n**3. Discussão sobre Cronograma**\n- Definição de novas milestones.\n- Decisão: O cronograma foi ajustado e será comunicado a todos os stakeholders.`,
            planoAcao: [
                { tarefa: "Renegociar contrato com fornecedor de painéis solares.", responsavel: "Alice Johnson", prazo: "30/09/2024" },
                { tarefa: "Agendar rodada final com os 3 fornecedores selecionados.", responsavel: "Robert Brown", prazo: "15/09/2024" },
                { tarefa: "Comunicar novo cronograma aos stakeholders.", responsavel: "Carlos Davis", prazo: "10/09/2024" }
            ]
        };
        setResult(mockOutput);
        toast({
          title: "Ata gerada com sucesso!",
          description: "O resumo, a ata e o plano de ação foram criados.",
        });
        setIsLoading(false);
      }, 2000);
      
    } catch (error) {
      console.error("Error generating minutes:", error);
      toast({
        title: "Erro ao gerar ata",
        description: "Ocorreu um problema ao se comunicar com a IA. Tente novamente.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  return (
    <HUDCard className="relative overflow-hidden border-[rgba(0,200,255,0.20)]">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_20%,rgba(0,200,255,0.20),transparent_60%)]" />
      <div className="flex flex-col gap-6 relative z-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-[rgba(0,200,255,0.15)] border border-[rgba(0,200,255,0.35)] shadow-[0_0_18px_rgba(0,200,255,0.25)]">
              <Sparkles className="w-5 h-5 text-[#00C8FF]" />
            </div>
            <div>
              <p className="text-sm text-[rgba(255,255,255,0.65)] uppercase tracking-[0.18em]">Ata com IA</p>
              <h3 className="text-lg font-semibold text-white">Assistente Inteligente</h3>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[rgba(0,200,255,0.18)] border border-[rgba(0,200,255,0.45)] text-[10px] font-semibold uppercase tracking-wide text-[#00C8FF] shadow-[0_0_14px_rgba(0,200,255,0.25)]">
            <Brain className="w-3.5 h-3.5" />
            <span>AI</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="transcricao" className="text-[rgba(255,255,255,0.85)]">Transcrição ou Resumo da Reunião</Label>
          <Textarea
            id="transcricao"
            placeholder="Cole aqui a transcrição da reunião, notas principais ou um resumo das discussões..."
            rows={8}
            value={transcription}
            onChange={(e) => setTranscription(e.target.value)}
            className={cn(
              hudInputBase,
              "min-h-[180px] bg-[rgba(255,255,255,0.06)] border-[rgba(0,200,255,0.30)] focus:ring-[rgba(0,255,180,0.35)]"
            )}
          />
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <PrimaryCTA
            onClick={handleGenerate}
            disabled={!transcription || isLoading}
            className="flex-col h-full py-4"
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 mb-1 animate-spin" />
            ) : (
              <FileText className="w-6 h-6 mb-1" />
            )}
            <span className="font-semibold">Gerar Ata e Ações</span>
            <span className="text-[11px] opacity-80 -mt-1">IA Orion</span>
          </PrimaryCTA>

          <SecondaryButton
            onClick={handleGenerate}
            disabled={!transcription || isLoading}
            className="flex-col h-full py-4 text-[rgba(255,255,255,0.9)] border-[rgba(0,255,180,0.35)]"
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 mb-1 animate-spin text-[#00FFB4]" />
            ) : (
              <ListChecks className="w-6 h-6 mb-1 text-[#00FFB4]" />
            )}
            <span className="font-semibold">Sugerir Ações</span>
            <span className="text-[11px] opacity-80 -mt-1">Insights</span>
          </SecondaryButton>

          <SecondaryButton
            onClick={handleGenerate}
            disabled={!transcription || isLoading}
            className="flex-col h-full py-4 text-[rgba(255,255,255,0.9)] border-[rgba(0,200,255,0.45)]"
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 mb-1 animate-spin text-[#00C8FF]" />
            ) : (
                <Sparkles className="w-6 h-6 mb-1 text-[#00C8FF]" />
            )}
            <span className="font-semibold">Resumo Executivo</span>
            <span className="text-[11px] opacity-80 -mt-1">Instantâneo</span>
          </SecondaryButton>
        </div>

        {result && (
        <Accordion type="single" collapsible className="w-full">
          {result.ataEstruturada && (
            <AccordionItem value="ata" className="border border-[rgba(0,200,255,0.25)] rounded-xl px-4 mb-3 bg-[rgba(255,255,255,0.02)]">
              <AccordionTrigger className="hover:no-underline text-white">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-[#00FFB4]" />
                  <span className="font-semibold">Ata Gerada pela IA</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-4">
                  <div className="p-4 rounded-lg border border-[rgba(0,255,180,0.25)] bg-[rgba(255,255,255,0.03)]">
                    <pre className="whitespace-pre-wrap text-[rgba(255,255,255,0.85)] font-sans text-sm">
                      {result.ataEstruturada}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {result.resumoExecutivo && (
            <AccordionItem value="resumo" className="border border-[rgba(0,200,255,0.25)] rounded-xl px-4 mb-3 bg-[rgba(255,255,255,0.02)]">
              <AccordionTrigger className="hover:no-underline text-white">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-[#00C8FF]" />
                  <span className="font-semibold">Resumo Executivo</span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-4">
                  <div className="p-4 rounded-lg border border-[rgba(0,200,255,0.30)] bg-[rgba(0,200,255,0.05)]">
                    <p className="text-[rgba(255,255,255,0.85)] text-sm leading-relaxed">
                      {result.resumoExecutivo}
                    </p>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )}

          {result.planoAcao && result.planoAcao.length > 0 && (
            <AccordionItem value="acoes" className="border border-[rgba(0,255,180,0.25)] rounded-xl px-4 mb-3 bg-[rgba(255,255,255,0.02)]">
              <AccordionTrigger className="hover:no-underline text-white">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-5 h-5 text-[#00FFB4]" />
                  <span className="font-semibold">Ações Sugeridas</span>
                  <Badge className="bg-[rgba(0,255,180,0.16)] text-[#00FFB4] border border-[rgba(0,255,180,0.35)]">
                    {result.planoAcao.length}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="pt-4 space-y-3">
                  {result.planoAcao.map((acao, index) => (
                    <div 
                      key={index} 
                      className="p-4 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(0,255,180,0.25)] transition-all"
                    >
                      <div className="flex items-start justify-between mb-2 gap-3">
                        <h4 className="font-semibold text-white flex-1">
                          {index + 1}. {acao.tarefa}
                        </h4>
                        <Badge className="bg-[rgba(0,200,255,0.16)] text-[#00C8FF] border border-[rgba(0,200,255,0.35)]">
                          {acao.prazo}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-[rgba(255,255,255,0.75)] mt-3">
                        {acao.responsavel && (
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-white/90">Responsável:</span>
                            <span>{acao.responsavel}</span>
                          </div>
                        )}
                        {acao.prazo && (
                          <div className="flex items-center gap-1">
                            <span className="font-medium text-white/90">Prazo:</span>
                            <span>{acao.prazo}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
        )}
      </div>
    </HUDCard>
  );
}

// Mock data to avoid breaking the component
const users = [
    { nome: "Alice" },
    { nome: "Bob" },
    { nome: "Charlie" },
]
