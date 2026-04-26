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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  HudPageLayout,
  HudHeader,
  HudPanel,
  HudButton,
} from '@/components/hud';
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
import { projectSerial } from '@/lib/utils/serial';
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
      <HudPageLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-center">
            <Briefcase className="w-16 h-16 hud-text-muted mx-auto mb-4 animate-pulse" />
            <p className="text-sm hud-text-tertiary">Carregando projeto...</p>
          </div>
        </div>
      </HudPageLayout>
    );
  }

  if (!projeto) {
    return (
      <HudPageLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="text-center">
            <Briefcase className="w-16 h-16 hud-text-muted mx-auto mb-4" />
            <h2 className="text-xl font-semibold orion-text-heading mb-4">Projeto não encontrado</h2>
            <HudButton variant="primary" onClick={() => router.push('/projetos')}>
              Voltar para o Portfólio
            </HudButton>
          </div>
        </div>
      </HudPageLayout>
    );
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      planejamento: 'bg-ig-accent-weak text-ig-accent border-ig-border-focus',
      em_andamento: 'bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] text-ig-success border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)]',
      pausado: 'bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] text-ig-warning border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)]',
      concluido: 'bg-ig-panel text-ig-fg-muted border-ig-border',
      cancelado: 'bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] text-ig-danger border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)]'
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
    <HudPageLayout maxWidth="100%">
      <div className="max-w-7xl mx-auto space-y-6">
        <HudHeader
          title={projeto.nome}
          subtitle={`Código: ${projeto.codigo} ${lastActivity ? ` · Última atividade: ${lastActivity}` : ''}`}
          icon={<Briefcase className="w-5 h-5" />}
          iconTint="#10B981"
          breadcrumbs={[
            { label: 'Projetos', href: '/projetos' },
            { label: projeto.codigo },
          ]}
          actions={
            <div className="flex items-center gap-3">
              <HudButton
                variant="ghost"
                size="md"
                leftIcon={<ArrowLeft className="w-4 h-4" />}
                onClick={() => router.push('/projetos')}
              >
                Voltar
              </HudButton>
              {healthScore != null && (
                <div
                  className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={{
                    background: `${healthColor}15`,
                    color: healthColor,
                    border: `1px solid ${healthColor}30`,
                  }}
                >
                  <Heart className="w-3.5 h-3.5" />
                  {healthScore} — {healthLabel}
                </div>
              )}
              <Link href={`/projetos/${projeto.id}/analytics`}>
                <HudButton variant="primary" leftIcon={<Brain className="w-4 h-4" />}>
                  Análise Avançada
                </HudButton>
              </Link>
            </div>
          }
        />

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
            <HudPanel
              title="Resumo do Projeto"
              accentColor="emerald"
              serial={projectSerial(projeto.id)}
              watermark="PROJECT · BRIEF"
            >
              <div>
                <p className="mb-6 text-ig-body-sm font-medium text-ig-fg-muted">{projeto.descricao || 'Sem descrição'}</p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <p className="mb-1 text-ig-caption font-medium text-ig-fg-muted">Status</p>
                    <Badge className={getStatusColor(projeto.status)}>{projeto.status}</Badge>
                  </div>
                  <div>
                    <p className="mb-1 text-ig-caption font-medium text-ig-fg-muted">Cliente</p>
                    <p className="text-ig-body-sm font-medium text-ig-fg-strong">{projeto.cliente || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-ig-caption font-medium text-ig-fg-muted">Responsável</p>
                    <p className="text-ig-body-sm font-medium text-ig-fg-strong">{projeto.responsavel?.nome || projeto.responsavel?.full_name || 'Não definido'}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-ig-caption font-medium text-ig-fg-muted">Início</p>
                    <p className="text-ig-body-sm font-medium text-ig-fg-strong">
                      {projeto.data_inicio ? format(new Date(projeto.data_inicio), 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* ── Revenue-focused financial KPIs ── */}
                <div className="mt-6 border-t border-ig-border-subtle pt-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 p-4">
                      <DollarSign className="mb-2 h-4 w-4 text-ig-accent" />
                      <p className="text-ig-caption font-medium text-ig-fg-muted">Contrato Total (Receita)</p>
                      <p className="mt-1 text-ig-kpi-md font-semibold text-ig-fg-strong tabular-nums">
                        {projetoV2?.revenue
                          ? formatMoney(projetoV2.revenue.totalContracted, true)
                          : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(projeto.valor_total || 0)
                        }
                      </p>
                      <p className="mt-1 text-[10px] text-ig-fg-muted">
                        Fonte: Contrato · {projetoV2?.revenue?.updatedAt
                          ? new Date(projetoV2.revenue.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 p-4">
                      <TrendingUp className="mb-2 h-4 w-4 text-ig-success" />
                      <p className="text-ig-caption font-medium text-ig-fg-muted">Faturado (Receita)</p>
                      <p className="mt-1 text-ig-kpi-md font-semibold text-ig-success tabular-nums">
                        {projetoV2?.revenue
                          ? formatMoney(projetoV2.revenue.billed, true)
                          : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(projeto.valor_executado || 0)
                        }
                      </p>
                      <p className="mt-1 text-[10px] text-ig-fg-muted">
                        Fonte: Financeiro · {projetoV2?.revenue?.updatedAt
                          ? new Date(projetoV2.revenue.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 p-4">
                      <ArrowUpRight className="mb-2 h-4 w-4 text-ig-warning" />
                      <p className="text-ig-caption font-medium text-ig-fg-muted">A Faturar (Receita)</p>
                      <p className="mt-1 text-ig-kpi-md font-semibold text-ig-warning tabular-nums">
                        {projetoV2?.revenue
                          ? formatMoney(projetoV2.revenue.toBill, true)
                          : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((projeto.valor_total || 0) - (projeto.valor_executado || 0))
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </HudPanel>

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
              <HudPanel title="Supervisão do Comitê" accentColor="cyan">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Building2 className="w-6 h-6 hud-accent-success" />
                    <p className="text-ig-h3 font-semibold text-ig-fg-strong">{projeto.comite_nome}</p>
                  </div>
                  <Badge variant="outline" className="hud-panel-badge">{projeto.comite_status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Ativo'}</Badge>
                  <p className="text-sm hud-text-tertiary">Este projeto está sob a supervisão do {projeto.comite_nome || 'Comitê'}.</p>
                </div>
              </HudPanel>
            )}

            {/* Risk Card v2 — P/I/Score explicit */}
            {projetoV2 && (
              <RiskCardV2
                project={projetoV2}
              />
            )}

            <HudPanel title="Atividades Recentes">
              <div>
                <ul className="space-y-3">
                  {pautasRelacionadas.slice(0, 2).map(pauta => (
                    <li key={pauta.id} className="flex items-start gap-3">
                      <div className="p-2 hud-panel-icon rounded-full bg-[rgba(101,163,13,0.08)] text-[#65A30D] dark:bg-[rgba(0,255,180,0.12)] dark:text-[#00FFB4]"><FileText className="w-4 h-4" /></div>
                      <div>
                        <p className="text-sm font-medium orion-text-primary">Nova pauta de votação</p>
                        <p className="text-xs hud-text-muted line-clamp-1">{pauta.titulo}</p>
                      </div>
                    </li>
                  ))}
                  {reunioesRelacionadas.slice(0, 1).map(reuniao => (
                    <li key={reuniao.id} className="flex items-start gap-3">
                      <div className="p-2 hud-panel-icon rounded-full bg-[rgba(6,182,212,0.08)] text-[#06B6D4] dark:bg-[rgba(0,200,255,0.12)] dark:text-[#00C8FF]"><Calendar className="w-4 h-4" /></div>
                      <div>
                        <p className="text-sm font-medium orion-text-primary">Reunião Agendada</p>
                        <p className="text-xs hud-text-muted line-clamp-1">{reuniao.titulo}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </HudPanel>
          </div>
        </div>

        {/* Tabs: Overview, Timeline, Team, Financeiro */}
        <HudPanel noPadding>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="p-6 border-b hud-panel-divider" id="project-tabs">
              <TabsList className="grid w-full grid-cols-4 lg:w-[800px] hud-tabs-container">
                <TabsTrigger value="overview" className="hud-tab-trigger">Visão Geral</TabsTrigger>
                <TabsTrigger value="timeline" className="hud-tab-trigger">
                  <GanttChart className="w-4 h-4 mr-2" />
                  Timeline
                </TabsTrigger>
                <TabsTrigger value="team" className="hud-tab-trigger">
                  <UserCog className="w-4 h-4 mr-2" />
                  Equipe
                </TabsTrigger>
                <TabsTrigger value="finance" className="hud-tab-trigger">
                  <DollarSign className="w-4 h-4 mr-2" />
                  Financeiro
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="p-6 pt-2">
              <TabsContent value="overview" className="mt-0">
                <div className="space-y-4">
                  <h3 className="mb-4 text-ig-h3 font-semibold text-ig-fg-strong">Informações do Projeto</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-ig-caption font-medium text-ig-fg-muted">Código Interno</p>
                      <p className="text-ig-body-sm font-medium text-ig-fg-strong">{projeto.codigoInterno || projeto.codigo || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-ig-caption font-medium text-ig-fg-muted">Tipo</p>
                      <p className="text-ig-body-sm font-medium text-ig-fg-strong">{projeto.tipo || 'Não especificado'}</p>
                    </div>
                    <div>
                      <p className="text-ig-caption font-medium text-ig-fg-muted">ROI Estimado</p>
                      <p className="text-ig-body-sm font-medium text-ig-fg-strong">{projeto.roi_estimado ? `${projeto.roi_estimado}%` : 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-ig-caption font-medium text-ig-fg-muted">Risco Geral</p>
                      {(() => {
                        const openRisks = projetoV2?.risks?.filter(r => r.status !== 'resolved') || [];
                        const topScore = openRisks.length > 0
                          ? Math.max(...openRisks.map(r => r.probability * r.impact))
                          : 0;
                        const level = topScore > 0 ? getRiskLevelFromScore(topScore) : null;
                        const label = level ? getRiskLevelLabel(level) : (projeto.risco_geral || 'Baixo');
                        return (
                          <Badge className={level === 'critical' || level === 'high' ? 'bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] text-ig-danger border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)]' : level === 'medium' ? 'bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] text-ig-warning border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)]' : 'bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] text-ig-success border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)]'}>
                            {label}
                          </Badge>
                        );
                      })()}
                    </div>
                  </div>

                  {/* V2 extra fields */}
                  {projetoV2 && (
                    <>
                      <Separator className="bg-ig-border-subtle" />
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {projetoV2.uf && (
                          <div>
                            <p className="text-ig-caption font-medium text-ig-fg-muted">UF</p>
                            <p className="text-ig-body-sm font-medium text-ig-fg-strong">{projetoV2.uf}</p>
                          </div>
                        )}
                        {projetoV2.location?.city && (
                          <div>
                            <p className="text-ig-caption font-medium text-ig-fg-muted">Cidade</p>
                            <p className="text-ig-body-sm font-medium text-ig-fg-strong">{projetoV2.location.city}</p>
                          </div>
                        )}
                        {projetoV2.contract_id && (
                          <div>
                            <p className="text-ig-caption font-medium text-ig-fg-muted">Contrato</p>
                            <p className="text-ig-body-sm font-medium text-ig-accent">{projetoV2.contract_id}</p>
                          </div>
                        )}
                        {projetoV2.templateType && (
                          <div>
                            <p className="text-ig-caption font-medium text-ig-fg-muted">Template</p>
                            <Badge variant="outline" className="border-ig-border text-ig-caption text-ig-fg-muted">
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
                    <DollarSign className="w-12 h-12 hud-text-muted mx-auto mb-3" />
                    <p className="hud-text-muted">Dados financeiros detalhados não disponíveis para este projeto</p>
                    <p className="text-xs hud-text-muted mt-1">Projetos migrados para v2 exibem Curvas S, detalhamento e previsão</p>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}
