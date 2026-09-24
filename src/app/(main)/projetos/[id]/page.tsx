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
  Ruler,
  UserCog,
  Activity,
  ShieldAlert,
  LayoutDashboard,
  History,
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
import { ProjectCommercialSourceChain } from '@/components/projects/ProjectCommercialSourceChain';
import { ProjectMeasurementsTab } from '@/components/projects/measurements/ProjectMeasurementsTab';
import { ProjectRisksTab } from '@/components/projects/ProjectRisksTab';
import { ProjectDocumentsView } from '@/components/projects/ProjectDocumentsView';
import { TeamAllocationView } from '@/components/projects/team-allocation-view';
import { ProjectTimesheetView } from '@/components/projects/project-timesheet-view';
import { FinanceView } from '@/components/projects/FinanceView';
import { ProjectOverviewTab } from '@/components/operations/projects/ProjectOverviewTab';
import { ProjectActivityTimeline } from '@/components/operations/projects/ProjectActivityTimeline';
import { ProjectRequirementsPanel } from '@/components/operations/planning/ProjectRequirementsPanel';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { projectSerial } from '@/lib/utils/serial';
import { formatMoney } from '@/lib/utils/project-utils';
import { getClientLogoUrl } from '@/lib/utils/client-logos';
import { clientLogoSlotSize } from '@/lib/utils/client-logo-frame';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openProjectOverviewReport } from '@/lib/reports/modules/project-overview-report';
import {
  formatProjectStatus, isProjectStatus, type ProjectStatus,
} from '@/lib/projects/status';
import { getProjectContractProjection } from '@/lib/projects/contract/project-contract-service';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { canViewProjectFinancials } from '@/lib/auth/project-financials';
import { MILESTONE_PARAM } from '@/lib/projects/cross-module-links';
import type { ProjectContractFinancial } from '@/lib/projects/contract/project-contract-types';

export default function DetalheProjetoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const tProjects = useTranslations('projects');
  const { id } = use(params);
  const searchParams = useSearchParams();
  const initialTab = (() => {
    const t = searchParams?.get('tab');
    /*
      `timeline` continua sendo o CRONOGRAMA (links antigos e de outros módulos
      apontam para ele); a timeline cronológica de eventos é `activity`. Sem
      `?tab=`, o projeto abre na Visão Geral.
    */
    return t && ['overview', 'timeline', 'contract', 'measurements', 'finance', 'activity', 'risks', 'documents', 'team', 'timesheet'].includes(t) ? t : 'overview';
  })();
  /*
    ─── O MARCO EM FOCO, atravessando as abas ─────────────────────────────

    `?milestone=` carrega a identidade canônica (`contract_milestones.id`) —
    a mesma que Contratos, o cronograma, a medição e o documento usam. É o
    que faz "Ver medição" chegar no marco certo em vez de no topo da lista.

    Ele NÃO seleciona aba sozinho: quem manda na aba é `?tab=`. Dois
    parâmetros disputando a mesma decisão é como um link acabaria abrindo
    uma aba e destacando o marco em outra.
  */
  const focusMilestoneId = searchParams?.get(MILESTONE_PARAM) ?? null;
  /*
    ─── A DECISÃO FINANCEIRA DO PROJETO, uma vez ──────────────────────────

    Espelho de `current_user_can_view_project_financials()` (migration 183) —
    a mesma que mascara os valores do evento de medição na visão do
    cronograma. Aqui ela decide o DESENHO: se os KPIs de receita são pintados
    e se a aba Financeiro existe.

    Enquanto as permissões carregam, `hasPermission` responde falso para tudo.
    Tratar isso como "não autorizado" faria a aba Financeiro PISCAR para fora
    da tela de quem tem acesso; então o portão só fecha depois da resposta.
  */
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  /* Para DESENHAR: permissivo enquanto carrega, para a aba não piscar. */
  const canViewFinancials = permissionsLoading || canViewProjectFinancials(hasPermission);
  /* Para BUSCAR: só depois que a resposta chegou. Não se pede dado
     financeiro "por enquanto" e se descarta depois — ele já viajou. */
  const financialsAllowed = !permissionsLoading && canViewProjectFinancials(hasPermission);

  const [projeto, setProjeto] = useState<Awaited<ReturnType<typeof getProjectByIdAsync>>>(undefined);
  const [projetoV2, setProjetoV2] = useState<ProjectV2 | undefined>(undefined);
  const [contractFinancial, setContractFinancial] = useState<ProjectContractFinancial | null>(null);
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

  /*
    A PROJEÇÃO CONTRATUAL carrega separada, e só com acesso financeiro.

    Separada do projeto para que a resposta das permissões não faça o projeto
    inteiro ser buscado duas vezes; e condicionada porque buscar-e-esconder
    deixaria o valor no estado do React e no payload da resposta — fora da
    vista, dentro do inspetor.
  */
  const reloadContractProjection = useCallback(async () => {
    if (!financialsAllowed) {
      setContractFinancial(null);
      return;
    }
    try {
      const projection = await getProjectContractProjection(id);
      setContractFinancial(projection.financial);
    } catch {
      setContractFinancial(null);
    }
  }, [id, financialsAllowed]);

  useEffect(() => {
    void reloadContractProjection();
  }, [reloadContractProjection]);

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

  /*
    Esta é a tela em que o dossiê do contrato ATERRISSA. Um projeto sem ciclo
    configurado chega aqui pelo link do contrato, e `status` pode não existir.
  */
  const NEUTRAL_STATUS_CLASS = 'bg-ig-panel text-ig-fg-muted border-ig-border';

  const getStatusColor = (status: unknown) => {
    const colors: Record<ProjectStatus, string> = {
      planejamento: 'bg-ig-accent-weak text-ig-accent border-ig-border-focus',
      em_andamento: 'bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] text-ig-success border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)]',
      pausado: 'bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] text-ig-warning border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)]',
      concluido: 'bg-ig-panel text-ig-fg-muted border-ig-border',
      cancelado: 'bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] text-ig-danger border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)]'
    };
    // Ausente e desconhecido são NEUTROS. Cair em `planejamento`, como antes,
    // pintaria de fase um projeto que não declarou nenhuma.
    return isProjectStatus(status) ? colors[status] : NEUTRAL_STATUS_CLASS;
  };

  const getStatusLabel = (status: unknown) => {
    if (!isProjectStatus(status)) return formatProjectStatus(status);
    const labels: Record<ProjectStatus, string> = {
      planejamento: tProjects('planning'),
      em_andamento: tProjects('inProgress'),
      pausado: tProjects('paused'),
      concluido: tProjects('completed'),
      cancelado: tProjects('cancelled'),
    };
    return labels[status];
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

  /*
    KPIs de receita: preferir a projeção governada do contrato quando a cópia
    em `project_v2.revenue` está zerada. Não gravamos o valor no JSONB — só
    lemos a visão. Faturado permanece o que Finanças registrou (ou zero).
  */
  const copiedContractCents = projetoV2?.revenue?.totalContracted?.amountCents ?? 0;
  const governedContractValue = contractFinancial?.contractValue ?? null;
  const displayContractTotal =
    copiedContractCents > 0
      ? formatMoney(projetoV2!.revenue!.totalContracted, true)
      : governedContractValue != null
        ? new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: contractFinancial?.currency || 'BRL',
          }).format(governedContractValue)
        : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
            projeto.valor_total || 0,
          );
  const displayBilled = projetoV2?.revenue
    ? formatMoney(projetoV2.revenue.billed, true)
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
        projeto.valor_executado || 0,
      );
  const billedAmount = (projetoV2?.revenue?.billed?.amountCents ?? 0) / 100;
  const toBillAmount =
    copiedContractCents > 0
      ? (projetoV2?.revenue?.toBill?.amountCents ?? 0) / 100
      : governedContractValue != null
        ? Math.max(governedContractValue - billedAmount, 0)
        : Math.max((projeto.valor_total || 0) - (projeto.valor_executado || 0), 0);
  const displayToBill =
    copiedContractCents > 0 && projetoV2?.revenue
      ? formatMoney(projetoV2.revenue.toBill, true)
      : new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: contractFinancial?.currency || 'BRL',
        }).format(toBillAmount);
  const contractSourceLabel = contractFinancial
    ? `Fonte: Contrato ${contractFinancial.contractNumber}`
    : projetoV2?.revenue?.updatedAt
      ? `Fonte: Contrato · ${new Date(projetoV2.revenue.updatedAt).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        })}`
      : 'Fonte: Contrato · —';

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
                  status: projeto.status ?? null,
                  statusLabel: getStatusLabel(projeto.status),
                  responsible: projeto.responsavel?.nome || projeto.responsavel?.full_name,
                  description: projeto.descricao,
                  startDate: projeto.data_inicio,
                  endDate: projeto.data_fim,
                  progressPercent: projeto.progresso_percentual ?? 0,
                  healthScore: projetoV2?.health_score,
                  healthReasons: projetoV2?.health_reasons,
                  revenue: (() => {
                    if (copiedContractCents > 0 && projetoV2?.revenue) {
                      return {
                        totalContracted: projetoV2.revenue.totalContracted,
                        billed: projetoV2.revenue.billed,
                        toBill: projetoV2.revenue.toBill,
                      };
                    }
                    if (governedContractValue != null) {
                      const currency = contractFinancial?.currency || 'BRL';
                      const toCents = (v: number) => Math.round(v * 100);
                      return {
                        totalContracted: { amountCents: toCents(governedContractValue), currency },
                        billed: { amountCents: toCents(billedAmount), currency },
                        toBill: { amountCents: toCents(toBillAmount), currency },
                      };
                    }
                    return undefined;
                  })(),
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

                {/*
                  ── KPIs de receita ──

                  Ausentes, e não zerados, para quem não tem leitura
                  financeira do projeto: um "R$ 0,00" no lugar de
                  "R$ 8.032.339,76" seria uma afirmação falsa sobre o
                  contrato, não uma omissão.
                */}
                {canViewFinancials && (
                <div className="mt-6 border-t border-ig-border-subtle pt-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 p-4">
                      <DollarSign className="mb-2 h-4 w-4 text-ig-accent" />
                      <p className="text-ig-caption font-medium text-ig-fg-muted">Contrato Total (Receita)</p>
                      <p className="mt-1 text-ig-kpi-md font-semibold text-ig-fg-strong tabular-nums">
                        {displayContractTotal}
                      </p>
                      <p className="mt-1 text-[10px] text-ig-fg-muted">{contractSourceLabel}</p>
                    </div>
                    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/70 p-4">
                      <TrendingUp className="mb-2 h-4 w-4 text-ig-success" />
                      <p className="text-ig-caption font-medium text-ig-fg-muted">Faturado (Receita)</p>
                      <p className="mt-1 text-ig-kpi-md font-semibold text-ig-success tabular-nums">
                        {displayBilled}
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
                        {displayToBill}
                      </p>
                    </div>
                  </div>
                </div>
                )}
              </div>
            </HudPanel>
        </div>

        {/* Tabs: barra solta — painéis de conteúdo flutuam direto na página */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div id="project-tabs">
            <TabsList
              className={cn(
                'grid w-full grid-cols-3 rounded-xl backdrop-blur-sm hud-tabs-container',
                canViewFinancials ? 'lg:grid-cols-10' : 'lg:grid-cols-9',
              )}
            >
              <TabsTrigger value="overview" className="hud-tab-trigger">
                <LayoutDashboard className="w-4 h-4 mr-2" />
                Visão Geral
              </TabsTrigger>
              <TabsTrigger value="timeline" className="hud-tab-trigger">
                <GanttChart className="w-4 h-4 mr-2" />
                Cronograma / Planejamento
              </TabsTrigger>
              {canViewFinancials && (
                <TabsTrigger value="finance" className="hud-tab-trigger">
                  <DollarSign className="w-4 h-4 mr-2" />
                  Financeiro
                </TabsTrigger>
              )}
              <TabsTrigger value="contract" className="hud-tab-trigger">
                <FileText className="w-4 h-4 mr-2" />
                Contexto Contratual
              </TabsTrigger>
              <TabsTrigger value="measurements" className="hud-tab-trigger">
                <Ruler className="w-4 h-4 mr-2" />
                Medições &amp; Evidências
              </TabsTrigger>
              <TabsTrigger value="activity" className="hud-tab-trigger">
                <History className="w-4 h-4 mr-2" />
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
              <TabsContent value="overview" className="mt-0">
                <ProjectOverviewTab projectId={id} onOpenTab={setActiveTab} />
              </TabsContent>

              <TabsContent value="activity" className="mt-0">
                <ProjectActivityTimeline projectId={id} />
              </TabsContent>

              <TabsContent value="timeline" className="mt-0">
                <TimelineTab
                  projectId={id}
                  projectName={projeto.nome}
                  projectManagerUserId={projeto.responsavel?.id ?? null}
                />
                {/* Requisitos pendem das atividades do cronograma: o plano de
                    execução é o cronograma canônico, não uma segunda tabela. */}
                <ProjectRequirementsPanel projectId={id} />
              </TabsContent>

              <TabsContent value="contract" className="mt-0 space-y-4">
                {/*
                  A ORIGEM COMERCIAL vem antes do contrato, e não depois.

                  A aba contratual pressupõe que existe contrato. Quando o
                  projeto executa trabalho autorizado por proposta aceita ou
                  por pedido de compra, ela fica vazia — e vazio aqui se lê
                  como "falta cadastrar", que é o oposto da verdade. A cadeia
                  acima diz o que autoriza este projeto, exista ou não
                  instrumento, e a projeção contratual segue logo abaixo para
                  quem tem contrato.
                */}
                <ProjectCommercialSourceChain projectId={id} />
                <ProjectContractTab projectId={id} focusMilestoneId={focusMilestoneId} />
              </TabsContent>

              {/*
                Medições é aba de PROJETOS, e não de Contratos, porque a
                instância de medição é operacional: quem a prepara, submete e
                vê aceitar é a operação. Contratos mostra a regra e a prontidão
                em contexto, sem virar um segundo editor da mesma coisa.

                A fila dela nasce da ponte ACEITA ao cronograma — não da
                existência de linha em `project_measurements`. Era essa
                confusão que fazia a aba dizer "nenhuma medição" sobre um
                projeto com cinco mapeamentos aceitos.
              */}
              <TabsContent value="measurements" className="mt-0">
                <ProjectMeasurementsTab projectId={id} focusMilestoneId={focusMilestoneId} />
              </TabsContent>

              <TabsContent value="risks" className="mt-0">
                <ProjectRisksTab projectId={id} />
              </TabsContent>

              <TabsContent value="documents" className="mt-0">
                <ProjectDocumentsView projectId={id} focusMilestoneId={focusMilestoneId} />
              </TabsContent>

              <TabsContent value="team" className="mt-0">
                <TeamAllocationView projectId={id} />
              </TabsContent>

              <TabsContent value="timesheet" className="mt-0">
                <ProjectTimesheetView projectId={id} />
              </TabsContent>

              {/*
                A aba não é só escondida: o conteúdo não é montado, então
                `FinanceView` não roda e nenhuma consulta de razão, custo ou
                curva S sai do navegador.
              */}
              <TabsContent value="finance" className="mt-0">
                {!canViewFinancials ? (
                  <div className="py-12 text-center">
                    <DollarSign className="mx-auto mb-3 h-12 w-12 hud-text-muted" />
                    <p className="hud-text-muted">
                      Informações financeiras deste projeto são restritas.
                    </p>
                    <p className="mt-1 text-xs hud-text-muted">
                      Solicite permissão de leitura financeira de projetos para acessar
                      esta aba.
                    </p>
                  </div>
                ) : projetoV2 ? (
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
