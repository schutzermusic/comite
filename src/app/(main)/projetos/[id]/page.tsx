'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  Building2,
  FileText,
  Brain,
  GanttChart,
  UserCog,
  Activity,
  Heart,
} from 'lucide-react';
import { HUDCard } from '@/components/ui/hud-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import { votes, meetings, users as mockUsers } from '@/lib/mock-data';
import { getProjectById, getProjectV2ById } from '@/lib/services/projects';
import { TimelineGanttView } from '@/components/projects/timeline-gantt-view';
import { TeamAllocationView } from '@/components/projects/team-allocation-view';
import { ActionCenter } from '@/components/projects/ActionCenter';
import { RiskCardV2 } from '@/components/projects/RiskCardV2';
import { ContractBillingEventogramCard } from '@/components/projects/ContractBillingEventogramCard';
import { FinanceView } from '@/components/projects/FinanceView';
import { ProjectTask, ProjectAllocation } from '@/lib/types';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { getRiskLevelFromScore, getRiskLevelLabel } from '@/lib/utils/project-utils';
import { getHealthScoreColor, getHealthScoreLabel, formatMoney } from '@/lib/utils/project-utils';
import { mockAllocationsV2 } from '@/data/mock-projects-v2';
import Link from 'next/link';
import { format, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function DetalheProjetoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const [projeto, setProjeto] = useState<ReturnType<typeof getProjectById>>(undefined);
  const [projetoV2, setProjetoV2] = useState<ProjectV2 | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    try {
      const loadedProjeto = getProjectById(id);
      setProjeto(loadedProjeto);
      // Try to load v2 enriched data
      const v2 = getProjectV2ById(id);
      setProjetoV2(v2);
    } catch (error) {
      console.error('Erro ao carregar projeto:', error);
      setProjeto(undefined);
    } finally {
      setLoading(false);
    }
  }, [id]);

  if (loading) {
    return (
      <OrionGreenBackground className="orion-page">
        <div className="orion-page-content flex items-center justify-center min-h-screen">
          <div className="text-center">
            <Briefcase className="w-16 h-16 text-[rgba(255,255,255,0.40)] mx-auto mb-4 animate-pulse" />
            <p className="text-sm text-[rgba(255,255,255,0.65)]">Carregando projeto...</p>
          </div>
        </div>
      </OrionGreenBackground>
    );
  }

  if (!projeto) {
    return (
      <OrionGreenBackground className="orion-page">
        <div className="orion-page-content flex items-center justify-center min-h-screen">
          <div className="text-center">
            <Briefcase className="w-16 h-16 text-[rgba(255,255,255,0.40)] mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white">Projeto não encontrado</h2>
            <Button onClick={() => router.push('/projetos')} className="mt-4 bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0]">
              Voltar para o Portfólio
            </Button>
          </div>
        </div>
      </OrionGreenBackground>
    );
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      planejamento: 'bg-blue-100 text-blue-700 border-blue-300',
      em_andamento: 'bg-green-100 text-green-700 border-green-300',
      pausado: 'bg-amber-100 text-amber-700 border-amber-300',
      concluido: 'bg-slate-100 text-slate-700 border-slate-300',
      cancelado: 'bg-red-100 text-red-700 border-red-300'
    };
    return colors[status] || colors.planejamento;
  };

  const getImpactoColor = (impacto: string) => {
    const colors: Record<string, string> = {
      baixo: 'text-green-600',
      medio: 'text-amber-600',
      alto: 'text-orange-600',
      critico: 'text-red-600'
    };
    return colors[impacto] || colors.medio;
  };

  const comiteNome = projeto.comiteResponsavel || projeto.comite_nome || '';
  const pautasRelacionadas = comiteNome ? votes.filter(v => v.comite === comiteNome) : [];
  const reunioesRelacionadas = comiteNome ? meetings.filter(m => m.comite === comiteNome) : [];

  // Use v2 tasks if available, otherwise fallback to mock
  const tasks: ProjectTask[] = projetoV2?.tasks?.length
    ? projetoV2.tasks.map(t => ({
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      description: t.description,
      startDate: new Date(t.startDate),
      endDate: new Date(t.endDate),
      status: t.status,
      responsibleId: t.responsibleId,
      responsibleName: t.responsibleName,
      milestone: t.milestone,
      dependencies: t.dependencies,
      progress: t.progress,
    }))
    : [
      {
        id: '1',
        projectId: id,
        name: 'Planejamento Inicial',
        description: 'Definição de escopo e requisitos',
        startDate: new Date(),
        endDate: addDays(new Date(), 14),
        status: 'completed' as const,
        responsibleId: projeto.responsavel?.id || '',
        responsibleName: projeto.responsavel?.nome || 'Não definido',
        milestone: true,
        progress: 100,
      },
      {
        id: '2',
        projectId: id,
        name: 'Desenvolvimento MVP',
        description: 'Primeira versão funcional',
        startDate: addDays(new Date(), 15),
        endDate: addDays(new Date(), 45),
        status: 'in_progress' as const,
        responsibleId: projeto.responsavel?.id || '',
        responsibleName: projeto.responsavel?.nome || 'Não definido',
        progress: 60,
      },
      {
        id: '3',
        projectId: id,
        name: 'Testes e QA',
        description: 'Validação de qualidade',
        startDate: addDays(new Date(), 46),
        endDate: addDays(new Date(), 60),
        status: 'not_started' as const,
        dependencies: ['2'],
      },
    ];

  // Use V2 allocations if available
  const v2Allocs = mockAllocationsV2[id];
  const allocations: ProjectAllocation[] = v2Allocs
    ? v2Allocs.map(a => ({
      id: a.id,
      projectId: a.projectId,
      memberId: a.memberId,
      memberName: a.memberName,
      role: a.role,
      allocationPercent: a.allocationPercent,
      hoursPerWeek: a.hoursPerWeek,
      critical: a.critical,
    }))
    : [
      { id: '1', projectId: id, memberId: projeto.responsavel?.id || '', memberName: projeto.responsavel?.nome || 'Não definido', role: 'Gerente de Projeto', allocationPercent: 80, hoursPerWeek: 32 },
      { id: '2', projectId: id, memberId: '2', memberName: 'Ana Silva', role: 'Desenvolvedora Full Stack', allocationPercent: 120, hoursPerWeek: 48, critical: true },
      { id: '3', projectId: id, memberId: '3', memberName: 'Carlos Santos', role: 'UX Designer', allocationPercent: 60, hoursPerWeek: 24 },
    ];

  const healthScore = projetoV2?.health_score ?? 100;
  const healthColor = getHealthScoreColor(healthScore);
  const healthLabel = getHealthScoreLabel(healthScore);


  // Last activity
  const lastActivity = projetoV2?.last_activity_at
    ? format(new Date(projetoV2.last_activity_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })
    : null;

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-7xl mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => router.push('/projetos')}
                className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">{projeto.nome}</h1>
                  {/* Health Score Badge */}
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={{
                      background: `${healthColor}15`,
                      color: healthColor,
                      border: `1px solid ${healthColor}30`,
                    }}
                  >
                    <Heart className="w-3.5 h-3.5" />
                    {healthScore} — {healthLabel}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm text-[rgba(255,255,255,0.65)]">Código: {projeto.codigo}</p>
                  {lastActivity && (
                    <span className="text-xs text-[rgba(255,255,255,0.40)] flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      Última atividade: {lastActivity}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <Link href={`/projetos/${projeto.id}/analytics`}>
              <Button className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]">
                <Brain className="w-4 h-4 mr-2" />
                Análise Avançada
              </Button>
            </Link>
          </div>
        </header>

        {/* ── Action Center (top alerts block) ────────────────── */}
        {projetoV2 && (
          <ActionCenter
            project={projetoV2}
            maxAlerts={3}
            onTabChange={setActiveTab}
          />
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <HUDCard>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white orion-text-heading">Resumo do Projeto</h2>
              </div>
              <div>
                <p className="text-[rgba(255,255,255,0.65)] mb-6">{projeto.descricao || 'Sem descrição'}</p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.50)] mb-1">Status</p>
                    <Badge className={getStatusColor(projeto.status)}>{projeto.status}</Badge>
                  </div>
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.50)] mb-1">Cliente</p>
                    <p className="font-medium text-white">{projeto.cliente || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.50)] mb-1">Responsável</p>
                    <p className="font-medium text-white">{projeto.responsavel?.nome || projeto.responsavel?.full_name || 'Não definido'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.50)] mb-1">Início</p>
                    <p className="font-medium text-white">
                      {projeto.data_inicio ? format(new Date(projeto.data_inicio), 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* ── Revenue-focused financial KPIs ── */}
                <div className="mt-6 pt-6 border-t border-[rgba(255,255,255,0.08)]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                    <div>
                      <DollarSign className="w-8 h-8 mx-auto text-[#00C8FF] mb-2" />
                      <p className="text-sm text-[rgba(255,255,255,0.50)]">Contrato Total (Receita)</p>
                      <p className="text-xl font-bold text-white tabular-nums">
                        {projetoV2?.revenue
                          ? formatMoney(projetoV2.revenue.totalContracted, true)
                          : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(projeto.valor_total || 0)
                        }
                      </p>
                      <p className="text-[10px] text-[rgba(255,255,255,0.30)] mt-1">
                        Fonte: Contrato · {projetoV2?.revenue?.updatedAt
                          ? new Date(projetoV2.revenue.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <TrendingUp className="w-8 h-8 mx-auto text-[#00FFB4] mb-2" />
                      <p className="text-sm text-[rgba(255,255,255,0.50)]">Faturado (Receita)</p>
                      <p className="text-xl font-bold text-white tabular-nums">
                        {projetoV2?.revenue
                          ? formatMoney(projetoV2.revenue.billed, true)
                          : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(projeto.valor_executado || 0)
                        }
                      </p>
                      <p className="text-[10px] text-[rgba(255,255,255,0.30)] mt-1">
                        Fonte: Financeiro · {projetoV2?.revenue?.updatedAt
                          ? new Date(projetoV2.revenue.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <ArrowUpRight className="w-8 h-8 mx-auto text-[#FFB84D] mb-2" />
                      <p className="text-sm text-[rgba(255,255,255,0.50)]">A Faturar (Receita)</p>
                      <p className="text-xl font-bold text-white tabular-nums">
                        {projetoV2?.revenue
                          ? formatMoney(projetoV2.revenue.toBill, true)
                          : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((projeto.valor_total || 0) - (projeto.valor_executado || 0))
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </HUDCard>

            {/* ── Billing Eventogram Card ── */}
            {projetoV2 && (
              <ContractBillingEventogramCard
                project={projetoV2}
                onTabChange={setActiveTab}
              />
            )}
          </div>

          <div className="space-y-6">
            {projeto.comite_id && (
              <HUDCard>
                <div className="mb-6">
                  <h2 className="text-lg font-semibold text-white orion-text-heading">Supervisão do Comitê</h2>
                </div>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Building2 className="w-6 h-6 text-[#00FFB4]" />
                    <p className="font-semibold text-lg text-white">{projeto.comite_nome}</p>
                  </div>
                  <Badge variant="outline" className="bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]">{projeto.comite_status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Ativo'}</Badge>
                  <p className="text-sm text-[rgba(255,255,255,0.65)]">Este projeto está sob a supervisão do {projeto.comite_nome || 'Comitê'}.</p>
                </div>
              </HUDCard>
            )}

            {/* Risk Card v2 — P/I/Score explicit */}
            {projetoV2 && (
              <RiskCardV2
                project={projetoV2}
              />
            )}

            <HUDCard>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white orion-text-heading">Atividades Recentes</h2>
              </div>
              <div>
                <ul className="space-y-3">
                  {pautasRelacionadas.slice(0, 2).map(pauta => (
                    <li key={pauta.id} className="flex items-start gap-3">
                      <div className="p-2 bg-[rgba(0,255,180,0.12)] rounded-full"><FileText className="w-4 h-4 text-[#00FFB4]" /></div>
                      <div>
                        <p className="text-sm font-medium text-white">Nova pauta de votação</p>
                        <p className="text-xs text-[rgba(255,255,255,0.50)] line-clamp-1">{pauta.titulo}</p>
                      </div>
                    </li>
                  ))}
                  {reunioesRelacionadas.slice(0, 1).map(reuniao => (
                    <li key={reuniao.id} className="flex items-start gap-3">
                      <div className="p-2 bg-[rgba(0,200,255,0.12)] rounded-full"><Calendar className="w-4 h-4 text-[#00C8FF]" /></div>
                      <div>
                        <p className="text-sm font-medium text-white">Reunião Agendada</p>
                        <p className="text-xs text-[rgba(255,255,255,0.50)] line-clamp-1">{reuniao.titulo}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </HUDCard>
          </div>
        </div>

        {/* Tabs: Overview, Timeline, Team, Financeiro */}
        <HUDCard>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="mb-6" id="project-tabs">
              <TabsList className="grid w-full grid-cols-4 lg:w-[800px] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)]">
                <TabsTrigger value="overview" className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]">Visão Geral</TabsTrigger>
                <TabsTrigger value="timeline" className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]">
                  <GanttChart className="w-4 h-4 mr-2" />
                  Timeline
                </TabsTrigger>
                <TabsTrigger value="team" className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]">
                  <UserCog className="w-4 h-4 mr-2" />
                  Equipe
                </TabsTrigger>
                <TabsTrigger value="finance" className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)]">
                  <DollarSign className="w-4 h-4 mr-2" />
                  Financeiro
                </TabsTrigger>
              </TabsList>
            </div>

            <div>
              <TabsContent value="overview" className="mt-0">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Informações do Projeto</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-[rgba(255,255,255,0.50)]">Código Interno</p>
                      <p className="font-medium text-white">{projeto.codigoInterno || projeto.codigo || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[rgba(255,255,255,0.50)]">Tipo</p>
                      <p className="font-medium text-white">{projeto.tipo || 'Não especificado'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[rgba(255,255,255,0.50)]">ROI Estimado</p>
                      <p className="font-medium text-white">{projeto.roi_estimado ? `${projeto.roi_estimado}%` : 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-[rgba(255,255,255,0.50)]">Risco Geral</p>
                      {(() => {
                        const openRisks = projetoV2?.risks?.filter(r => r.status !== 'resolved') || [];
                        const topScore = openRisks.length > 0
                          ? Math.max(...openRisks.map(r => r.probability * r.impact))
                          : 0;
                        const level = topScore > 0 ? getRiskLevelFromScore(topScore) : null;
                        const label = level ? getRiskLevelLabel(level) : (projeto.risco_geral || 'Baixo');
                        return (
                          <Badge className={level === 'critical' || level === 'high' ? 'bg-red-100 text-red-700' : level === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}>
                            {label}
                          </Badge>
                        );
                      })()}
                    </div>
                  </div>

                  {/* V2 extra fields */}
                  {projetoV2 && (
                    <>
                      <Separator className="border-[rgba(255,255,255,0.08)]" />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {projetoV2.uf && (
                          <div>
                            <p className="text-sm text-[rgba(255,255,255,0.50)]">UF</p>
                            <p className="font-medium text-white">{projetoV2.uf}</p>
                          </div>
                        )}
                        {projetoV2.location?.city && (
                          <div>
                            <p className="text-sm text-[rgba(255,255,255,0.50)]">Cidade</p>
                            <p className="font-medium text-white">{projetoV2.location.city}</p>
                          </div>
                        )}
                        {projetoV2.contract_id && (
                          <div>
                            <p className="text-sm text-[rgba(255,255,255,0.50)]">Contrato</p>
                            <p className="font-medium text-[#00C8FF] text-sm">{projetoV2.contract_id}</p>
                          </div>
                        )}
                        {projetoV2.templateType && (
                          <div>
                            <p className="text-sm text-[rgba(255,255,255,0.50)]">Template</p>
                            <Badge variant="outline" className="text-xs border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.65)]">
                              {projetoV2.templateType}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="timeline" className="mt-0">
                <TimelineGanttView
                  projectId={id}
                  tasks={tasks}
                  onAddTask={(task) => {
                    console.log('Add task:', task);
                  }}
                  onTaskClick={(task) => console.log('Task clicked:', task)}
                />
              </TabsContent>

              <TabsContent value="team" className="mt-0">
                <TeamAllocationView
                  projectId={id}
                  allocations={allocations}
                  onEditAllocation={(allocation) => {
                    console.log('Edit allocation:', allocation);
                  }}
                  onAddMember={(allocation) => {
                    console.log('Add member:', allocation);
                  }}
                />
              </TabsContent>

              <TabsContent value="finance" className="mt-0">
                {projetoV2 ? (
                  <FinanceView project={projetoV2} />
                ) : (
                  <div className="text-center py-12">
                    <DollarSign className="w-12 h-12 text-[rgba(255,255,255,0.20)] mx-auto mb-3" />
                    <p className="text-[rgba(255,255,255,0.50)]">Dados financeiros detalhados não disponíveis para este projeto</p>
                    <p className="text-xs text-[rgba(255,255,255,0.30)] mt-1">Projetos migrados para v2 exibem Curvas S, detalhamento e previsão</p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </HUDCard>
      </div>
    </OrionGreenBackground>
  );
}
