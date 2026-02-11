'use client';

import React, { useState, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  RefreshCw,
  Brain,
  TrendingUp,
  AlertTriangle,
  Users,
  Target,
  BarChart3,
  Activity,
  Zap
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { HUDProgressBar } from "@/components/ui/hud-progress-bar";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import { useToast } from "@/hooks/use-toast";
import { projects, mockAnalytics } from "@/lib/mock-data";
import { ProjetoAnalytics } from "@/lib/types";

import ProjectRiskAssessment from "@/components/analytics/ProjectRiskAssessment";
import ResourceAllocation from "@/components/analytics/ResourceAllocation";
import ROIForecasting from "@/components/analytics/ROIForecasting";

export default function ProjetoAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { toast } = useToast();
  const { id: projetoId } = use(params);

  const [isGenerating, setIsGenerating] = useState(false);
  const [analytics, setAnalytics] = useState<ProjetoAnalytics | null>(null);

  const projeto = projects.find(p => p.id === projetoId);

  React.useEffect(() => {
    // Simulate fetching analytics data
    if (projetoId === mockAnalytics.projeto_id) {
      setAnalytics(mockAnalytics);
    }
  }, [projetoId]);

  const generateAnalyticsMutation = () => {
    setIsGenerating(true);
    toast({
        title: 'Gerando Análise...',
        description: 'A IA está processando os dados do projeto. Isso pode levar alguns segundos.',
    });
    setTimeout(() => {
      setAnalytics(mockAnalytics);
      setIsGenerating(false);
      toast({
        title: 'Análise gerada com sucesso!',
      });
    }, 2500);
  };

  if (!projeto) {
    return (
      <OrionGreenBackground className="orion-page">
        <div className="orion-page-content flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00FFB4]"></div>
        </div>
      </OrionGreenBackground>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-[#00FFB4]';
    if (score >= 60) return 'text-[#FFB04D]';
    return 'text-[#FF5860]';
  };

  const getScoreVariant = (score: number): 'completed' | 'active' | 'at_risk' | 'critical' => {
    if (score >= 80) return 'completed';
    if (score >= 60) return 'active';
    if (score >= 40) return 'at_risk';
    return 'critical';
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        {/* Header */}
        <header className="mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => router.push(`/projetos/${projetoId}`)}
                className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Análise Avançada do Projeto</h1>
                <p className="text-sm text-[rgba(255,255,255,0.65)]">{projeto.nome}</p>
              </div>
            </div>
            <PrimaryCTA
              onClick={generateAnalyticsMutation}
              disabled={isGenerating}
              className="px-5"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Analisando...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  {analytics ? 'Regerar Análise' : 'Gerar Análise com IA'}
                </>
              )}
            </PrimaryCTA>
          </div>
        </header>

      {analytics ? (
        <>
          {/* Health Score Overview */}
          <div className="grid md:grid-cols-3 gap-6 mb-6">
            <HUDCard glow glowColor="cyan" className="md:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Target className="w-8 h-8 text-[#00C8FF]" />
                  <div>
                    <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Saúde Geral do Projeto</p>
                    <p className="text-3xl font-semibold text-white">{analytics.score_saude_projeto || 0}/100</p>
                  </div>
                </div>
                <StatusPill variant={getScoreVariant(analytics.score_saude_projeto || 0)} className="text-lg px-4 py-2">
                  {analytics.score_saude_projeto >= 80 ? 'Excelente' : 
                   analytics.score_saude_projeto >= 60 ? 'Bom' : 
                   analytics.score_saude_projeto >= 40 ? 'Atenção' : 'Crítico'}
                </StatusPill>
              </div>
              <HUDProgressBar 
                value={analytics.score_saude_projeto || 0}
                variant={getScoreVariant(analytics.score_saude_projeto || 0)}
              />
              {analytics.ia_insights && (
                <div className="mt-6 p-4 bg-[rgba(0,200,255,0.12)] border border-[rgba(0,200,255,0.25)] rounded-lg">
                  <div className="flex items-start gap-2 mb-2">
                    <Zap className="w-4 h-4 text-[#00C8FF] mt-0.5" />
                    <p className="text-sm font-semibold text-white">Insights da IA</p>
                  </div>
                  <p className="text-sm text-[rgba(255,255,255,0.85)] whitespace-pre-wrap leading-relaxed">{analytics.ia_insights}</p>
                </div>
              )}
            </HUDCard>

            {/* Quick Stats */}
            <div className="space-y-4">
              {analytics.avaliacao_risco && (
                <HUDCard glow glowColor={analytics.avaliacao_risco.nivel_risco === 'critico' ? 'red' : 
                                        analytics.avaliacao_risco.nivel_risco === 'alto' ? 'amber' : 'green'}>
                  <div className="flex items-center justify-between mb-2">
                    <AlertTriangle className={`w-6 h-6 ${
                      analytics.avaliacao_risco.nivel_risco === 'critico' ? 'text-[#FF5860]' :
                      analytics.avaliacao_risco.nivel_risco === 'alto' ? 'text-[#FFB04D]' :
                      'text-[#00FFB4]'
                    }`} />
                  </div>
                  <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Nível de Risco</p>
                  <p className="text-2xl font-semibold text-white capitalize">{analytics.avaliacao_risco.nivel_risco}</p>
                  <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">Score: {analytics.avaliacao_risco.score_risco}/100</p>
                </HUDCard>
              )}

              {analytics.previsao_roi && (
                <HUDCard glow glowColor="green">
                  <div className="flex items-center justify-between mb-2">
                    <TrendingUp className="w-6 h-6 text-[#00FFB4]" />
                  </div>
                  <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">ROI Estimado</p>
                  <p className="text-2xl font-semibold text-white">
                    {analytics.previsao_roi.roi_estimado_percentual?.toFixed(1) || 0}%
                  </p>
                  <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">Cenário Realista</p>
                </HUDCard>
              )}
            </div>
          </div>

          <Tabs defaultValue="risk" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4 lg:w-[800px] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]">
              <TabsTrigger 
                value="risk" 
                className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]"
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                Análise de Risco
              </TabsTrigger>
              <TabsTrigger 
                value="roi" 
                className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]"
              >
                <TrendingUp className="w-4 h-4 mr-2" />
                Previsão ROI
              </TabsTrigger>
              <TabsTrigger 
                value="resources" 
                className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]"
              >
                <Users className="w-4 h-4 mr-2" />
                Alocação de Recursos
              </TabsTrigger>
              <TabsTrigger 
                value="recommendations" 
                className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]"
              >
                <Target className="w-4 h-4 mr-2" />
                Recomendações
              </TabsTrigger>
            </TabsList>

            <TabsContent value="risk">
              <ProjectRiskAssessment analytics={analytics} />
            </TabsContent>

            <TabsContent value="roi">
              <ROIForecasting analytics={analytics} />
            </TabsContent>

            <TabsContent value="resources">
              <ResourceAllocation project={projeto} />
            </TabsContent>

            <TabsContent value="recommendations" className="mt-0">
              <HUDCard>
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-white orion-text-heading">Recomendações Estratégicas</h2>
                  <p className="text-sm text-[rgba(255,255,255,0.65)] mt-1">Ações sugeridas pela IA para otimizar o projeto</p>
                </div>
                {analytics.recomendacoes && analytics.recomendacoes.length > 0 ? (
                  <div className="space-y-4">
                    {analytics.recomendacoes.map((rec, idx) => {
                      const priorityColors = {
                        urgente: {
                          border: 'border-[rgba(255,88,96,0.25)]',
                          bg: 'bg-[rgba(255,88,96,0.08)]',
                          text: 'text-[#FF5860]',
                          badge: 'critical' as const
                        },
                        alta: {
                          border: 'border-[rgba(255,176,77,0.25)]',
                          bg: 'bg-[rgba(255,176,77,0.08)]',
                          text: 'text-[#FFB04D]',
                          badge: 'at_risk' as const
                        },
                        media: {
                          border: 'border-[rgba(0,200,255,0.25)]',
                          bg: 'bg-[rgba(0,200,255,0.08)]',
                          text: 'text-[#00C8FF]',
                          badge: 'active' as const
                        },
                        baixa: {
                          border: 'border-[rgba(0,255,180,0.25)]',
                          bg: 'bg-[rgba(0,255,180,0.08)]',
                          text: 'text-[#00FFB4]',
                          badge: 'completed' as const
                        }
                      };
                      const colors = priorityColors[rec.prioridade] || priorityColors.media;

                      return (
                        <div 
                          key={idx} 
                          className={`p-5 rounded-xl border-l-4 ${colors.border} ${colors.bg} transition-all hover:bg-opacity-20`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <StatusPill variant={colors.badge}>
                              {rec.prioridade.charAt(0).toUpperCase() + rec.prioridade.slice(1)}
                            </StatusPill>
                            <Badge 
                              variant="outline" 
                              className="bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]"
                            >
                              {rec.tipo.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </Badge>
                          </div>
                          <p className="font-semibold text-white mb-3 text-lg">{rec.descricao}</p>
                          {rec.impacto_esperado && (
                            <div className="mt-4 p-3 bg-[rgba(255,255,255,0.05)] rounded-lg border border-[rgba(255,255,255,0.08)]">
                              <p className="text-xs font-semibold text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Impacto Esperado</p>
                              <p className="text-sm text-[rgba(255,255,255,0.85)]">{rec.impacto_esperado}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Target className="w-12 h-12 mx-auto mb-3 text-[rgba(255,255,255,0.20)]" />
                    <p className="text-[rgba(255,255,255,0.65)]">Nenhuma recomendação disponível</p>
                    <p className="text-sm text-[rgba(255,255,255,0.50)] mt-1">A IA ainda não gerou recomendações para este projeto</p>
                  </div>
                )}
              </HUDCard>
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <HUDCard className="text-center">
          <div className="py-12">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[rgba(0,255,180,0.12)] flex items-center justify-center">
              <Brain className="w-10 h-10 text-[#00FFB4]" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">
              Análise não disponível
            </h3>
            <p className="text-[rgba(255,255,255,0.65)] mb-8 max-w-md mx-auto">
              Gere uma análise detalhada usando inteligência artificial para obter insights sobre riscos, ROI e alocação de recursos
            </p>
            <PrimaryCTA
              onClick={generateAnalyticsMutation}
              disabled={isGenerating}
              className="px-6"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Gerar Primeira Análise
                </>
              )}
            </PrimaryCTA>
          </div>
        </HUDCard>
      )}
      </div>
    </OrionGreenBackground>
  );
}
