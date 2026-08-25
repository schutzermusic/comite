'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Briefcase,
  DollarSign,
  TrendingUp,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  FileText,
  Brain,
  GanttChart,
  UserCog,
  Activity,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  HudPageLayout,
  HudHeader,
  HudPanel,
  HudButton,
} from '@/components/hud';
import { getProjectByIdAsync, getProjectV2ByIdAsync } from '@/lib/services/projects';
import { TimelineTab } from '@/components/projects/timeline/TimelineTab';
import { ProjectContractTab } from '@/components/projects/ProjectContractTab';
import { ProjectRisksTab } from '@/components/projects/ProjectRisksTab';
import { ProjectDocumentsView } from '@/components/projects/ProjectDocumentsView';
import { TeamAllocationView } from '@/components/projects/team-allocation-view';
import { ProjectTimesheetView } from '@/components/projects/project-timesheet-view';
import { FinanceView } from '@/components/projects/FinanceView';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { projectSerial } from '@/lib/utils/serial';
import { formatMoney } from '@/lib/utils/project-utils';
import { getClientLogoUrl } from '@/lib/utils/client-logos';
import { clientLogoSlotSize } from '@/lib/utils/client-logo-frame';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openProjectOverviewReport } from '@/lib/reports/modules/project-overview-report';

export default function DetalheProjetoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const tProjects = useTranslations('projects');
  const { id } = use(params);
  const searchParams = useSearchParams();
  const initialTab = (() => {
    const t = searchParams?.get('tab');
    return t && ['timeline', 'contract', 'finance', 'risks', 'documents', 'team', 'timesheet'].includes(t) ? t : 'timeline';
  })();
  const [projeto, setProjeto] = useState<Awaited<ReturnType<typeof getProjectByIdAsync>>>(undefined);
  const [projetoV2, setProjetoV2] = useState<ProjectV2 | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [scanningAdvanced, setScanningAdvanced] = useState(false);

  const handleAdvancedAnalysis = async () => {
    if (!id) return;
    if (
      !window.confirm(
        'Gerar diagnóstico avançado com IA e abrir a análise completa do projeto?',
      )
    )
      return;
    setScanningAdvanced(true);
    try {
      router.push(`/projetos/${id}/analytics?run=1`);
    } finally {
      setScanningAdvanced(false);
    }
  };

  const reloadProject = useCallback(async () => {
    try {
      const [loadedProjeto, v2] = await Promise.all([
        getProjectByIdAsync(id),
        getProjectV2ByIdAsync(id),
      ]);
      setProjeto(loadedProjeto);
      setProjetoV2(v2);
    } catch (error) {
      console.error('Erro ao carregar projeto:', error);
      setProjeto(undefined);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reloadProject();
  }, [reloadProject]);

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

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      planejamento: tProjects('planning'),
      em_andamento: tProjects('inProgress'),
      pausado: tProjects('paused'),
      concluido: tProjects('completed'),
      cancelado: tProjects('cancelled'),
    };
    return labels[status] || status.replace(/_/g, ' ');
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

  // Last activity
  const lastActivity = projetoV2?.last_activity_at
    ? format(new Date(projetoV2.last_activity_at), "dd MMM yyyy 'às' HH:mm", { locale: ptBR })
    : null;
  const clientLogoUrl = getClientLogoUrl(projeto.cliente, projeto.clientLogoUrl);

  return (
    <HudPageLayout maxWidth="full">
      <div className="w-full max-w-none space-y-6">
        <HudHeader
          title={
            <>
              <span>{projeto.nome}</span>
              {clientLogoUrl && (
                <span className="inline-flex h-12 shrink-0 items-center justify-center px-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={clientLogoUrl}
                    alt={projeto.cliente || 'Logo cliente'}
                    className="object-contain client-logo-img"
                    style={clientLogoSlotSize(40)}
                    draggable={false}
                  />
                </span>
              )}
            </>
          }
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
              <HudButton
                variant="secondary"
                size="md"
                leftIcon={<ShieldAlert className="w-4 h-4" />}
                onClick={() =>
                  router.push(
                    `/riscos?linkType=project&refId=${encodeURIComponent(projeto.id)}&refName=${encodeURIComponent(projeto.nome)}`,
                  )
                }
              >
                Criar risco
              </HudButton>
              <ExportReportButton
                size="md"
                variant="secondary"
                permission="projects.export"
                fallbackPermission="projects.view"
                build={() => openProjectOverviewReport({
                  name: projeto.nome,
                  code: projeto.codigo,
                  client: projeto.cliente,
                  status: projeto.status,
                  statusLabel: getStatusLabel(projeto.status),
                  responsible: projeto.responsavel?.nome || projeto.responsavel?.full_name,
                  description: projeto.descricao,
                  startDate: projeto.data_inicio,
                  endDate: projeto.data_fim,
                  progressPercent: projeto.progresso_percentual ?? 0,
                  healthScore: projetoV2?.health_score,
                  healthReasons: projetoV2?.health_reasons,
                  revenue: projetoV2?.revenue
                    ? { totalContracted: projetoV2.revenue.totalContracted, billed: projetoV2.revenue.billed, toBill: projetoV2.revenue.toBill }
                    : undefined,
                  finance: projetoV2?.finance
                    ? { bac: projetoV2.finance.bac, ac: projetoV2.finance.ac, eac: projetoV2.finance.eac, variancePercent: projetoV2.finance.variancePercent }
                    : undefined,
                  milestones: projetoV2?.milestones ?? [],
                  risks: projetoV2?.risks ?? [],
                  tasks: projetoV2?.tasks ?? [],
                  documents: projetoV2?.documents ?? [],
                  allocations: [],
                  source: projetoV2 ? 'Supabase' : 'demonstração',
                })}
              />
              <HudButton
                variant="primary"
                leftIcon={<Brain className="w-4 h-4" />}
                disabled={scanningAdvanced}
                onClick={handleAdvancedAnalysis}
              >
                {scanningAdvanced ? 'Abrindo análise...' : 'Análise Avançada'}
              </HudButton>
            </div>
          }
        />
        <div className="space-y-6">
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
                    <Badge className={getStatusColor(projeto.status)}>{getStatusLabel(projeto.status)}</Badge>
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
        </div>

        {/* Tabs: barra solta — painéis de conteúdo flutuam direto na página */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div id="project-tabs">
            <TabsList className="grid w-full grid-cols-3 rounded-xl backdrop-blur-sm lg:grid-cols-7 hud-tabs-container">
              <TabsTrigger value="finance" className="hud-tab-trigger">
                <DollarSign className="w-4 h-4 mr-2" />
                Financeiro
              </TabsTrigger>
              <TabsTrigger value="contract" className="hud-tab-trigger">
                <FileText className="w-4 h-4 mr-2" />
                Contrato
              </TabsTrigger>
              <TabsTrigger value="timeline" className="hud-tab-trigger">
                <GanttChart className="w-4 h-4 mr-2" />
                Timeline
              </TabsTrigger>
              <TabsTrigger value="risks" className="hud-tab-trigger">
                <ShieldAlert className="w-4 h-4 mr-2" />
                Riscos
              </TabsTrigger>
              <TabsTrigger value="documents" className="hud-tab-trigger">
                <FileText className="w-4 h-4 mr-2" />
                Documentos
              </TabsTrigger>
              <TabsTrigger value="team" className="hud-tab-trigger">
                <UserCog className="w-4 h-4 mr-2" />
                Equipe
              </TabsTrigger>
              <TabsTrigger value="timesheet" className="hud-tab-trigger">
                <Clock className="w-4 h-4 mr-2" />
                Apontamentos
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="mt-5">
              <TabsContent value="timeline" className="mt-0">
                <TimelineTab
                  projectId={id}
                  projectName={projeto.nome}
                  projectManagerUserId={projeto.responsavel?.id ?? null}
                />
              </TabsContent>

              <TabsContent value="contract" className="mt-0">
                <ProjectContractTab projectId={id} />
              </TabsContent>

              <TabsContent value="risks" className="mt-0">
                <ProjectRisksTab projectId={id} />
              </TabsContent>

              <TabsContent value="documents" className="mt-0">
                <ProjectDocumentsView projectId={id} />
              </TabsContent>

              <TabsContent value="team" className="mt-0">
                <TeamAllocationView projectId={id} />
              </TabsContent>

              <TabsContent value="timesheet" className="mt-0">
                <ProjectTimesheetView projectId={id} />
              </TabsContent>

              <TabsContent value="finance" className="mt-0">
                {projetoV2 ? (
                  <FinanceView project={projetoV2} onProjectChange={reloadProject} />
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
      </div>
    </HudPageLayout>
  );
}
