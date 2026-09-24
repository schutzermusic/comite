'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Brain, Loader2, MapPinned, ShieldAlert } from 'lucide-react';
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
import { ProjectGlance, type ProjectOverviewPayload } from '@/components/operations/projects/ProjectGlance';
import { ProjectRequirementsPanel } from '@/components/operations/planning/ProjectRequirementsPanel';
import { ProjectSupplyTab } from '@/components/supply/ProjectSupplyTab';
import {
  AxPage, CommandHeader, EmptyState, Skeleton, Tabs, dateTime, href, useResource, useUrlParam, type Tone,
} from '@/components/ax';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { formatMoney } from '@/lib/utils/project-utils';
import { getClientLogoUrl } from '@/lib/utils/client-logos';
import { clientLogoSlotSize } from '@/lib/utils/client-logo-frame';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openProjectOverviewReport } from '@/lib/reports/modules/project-overview-report';
import {
  formatProjectStatus, isProjectStatus, type ProjectStatus,
} from '@/lib/projects/status';
import { getProjectContractProjection } from '@/lib/projects/contract/project-contract-service';
import { usePermissions } from '@/hooks/use-permissions';
import { canViewProjectFinancials } from '@/lib/auth/project-financials';
import { MILESTONE_PARAM } from '@/lib/projects/cross-module-links';
import type { ProjectContractFinancial } from '@/lib/projects/contract/project-contract-types';

type TabId = 'overview' | 'timeline' | 'supply' | 'measurements' | 'timesheet' | 'team' | 'risks' | 'documents' | 'contract' | 'finance' | 'activity';
const TABS: TabId[] = ['overview', 'timeline', 'supply', 'measurements', 'timesheet', 'team', 'risks', 'documents', 'contract', 'finance', 'activity'];

export default function DetalheProjetoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const tProjects = useTranslations('projects');
  const { id } = use(params);
  const searchParams = useSearchParams();
  /*
    A aba vive na URL (`?tab=`): link, voltar e recarregar caem no mesmo lugar.
    `timeline` continua sendo o CRONOGRAMA (links antigos e de outros módulos
    apontam para ele); o histórico cronológico de eventos é `activity`. Sem
    `?tab=`, o projeto abre na Visão Geral.
  */
  const [tabParam, setTabParam] = useUrlParam<TabId>('tab', 'overview');
  const activeTab: TabId = TABS.includes(tabParam) ? tabParam : 'overview';
  const setActiveTab = (t: string) => setTabParam((TABS.includes(t as TabId) ? t : 'overview') as TabId);
  const overview = useResource<ProjectOverviewPayload>(`/api/operations/projects/${encodeURIComponent(id)}/overview`);
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
    return <AxPage testId="project-workspace"><Skeleton /></AxPage>;
  }

  if (!projeto) {
    return (
      <AxPage testId="project-workspace">
        <EmptyState title="Projeto não encontrado" action={<Link className="ax-btn primary sm" href="/projetos">Voltar para o portfólio</Link>}>
          O projeto não existe nesta organização ou você não tem acesso a ele.
        </EmptyState>
      </AxPage>
    );
  }

  /*
    Esta é a tela em que o dossiê do contrato ATERRISSA. Um projeto sem ciclo
    configurado chega aqui pelo link do contrato, e `status` pode não existir.
  */
  const STATUS_TONE: Record<ProjectStatus, Tone> = {
    planejamento: 'accent', em_andamento: 'success', pausado: 'warning', concluido: 'neutral', cancelado: 'danger',
  };
  // Ausente e desconhecido são NEUTROS: pintar de fase um projeto que não declarou nenhuma seria afirmar o que não se sabe.
  const statusTone = (status: unknown): Tone => (isProjectStatus(status) ? STATUS_TONE[status] : 'neutral');

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

  // Last activity
  const lastActivity = projetoV2?.last_activity_at ? dateTime(projetoV2.last_activity_at) : null;
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
  // Sem contrato nem valor declarado, a célula some: "R$ 0,00" diria que o contrato vale zero.
  const hasContractValue = copiedContractCents > 0 || governedContractValue != null || (projeto.valor_total ?? 0) > 0;
  const contractSourceLabel = contractFinancial
    ? `Fonte: Contrato ${contractFinancial.contractNumber}`
    : projetoV2?.revenue?.updatedAt
      ? `Fonte: Contrato · ${new Date(projetoV2.revenue.updatedAt).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        })}`
      : 'Fonte: Contrato · —';

  const tabCount = overview.data ? {
    timeline: overview.data.schedule.critical,
    measurements: overview.data.measurements?.pending ?? 0,
    risks: overview.data.blockers.filter((b) => b.kind === 'risk').length,
  } : { timeline: 0, measurements: 0, risks: 0 };

  return (
    <AxPage testId="project-workspace">
      <CommandHeader domain="operations" area={projeto.codigo ? `Projetos · ${projeto.codigo}` : 'Projetos'} title={projeto.nome}
        context={<>
          {clientLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clientLogoUrl} alt="" className="object-contain client-logo-img" style={clientLogoSlotSize(22)} draggable={false} />
          )}
          <span><strong>{projeto.cliente || 'Cliente não informado'}</strong></span>
          {lastActivity && <span>última atividade {lastActivity}</span>}
        </>}
        actions={<>
          <Link className="ax-btn" href={href.map(projeto.id)}><MapPinned size={15} aria-hidden />Mapa</Link>
          <Link className="ax-btn"
            href={`/riscos?linkType=project&refId=${encodeURIComponent(projeto.id)}&refName=${encodeURIComponent(projeto.nome)}`}>
            <ShieldAlert size={15} aria-hidden />Criar risco</Link>
          <ExportReportButton
            size="sm"
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
          <button type="button" className="ax-btn primary" disabled={scanningAdvanced} onClick={handleAdvancedAnalysis}>
            {scanningAdvanced ? <Loader2 size={15} className="spin" aria-hidden /> : <Brain size={15} aria-hidden />}
            {scanningAdvanced ? 'Abrindo análise…' : 'Análise avançada'}</button>
        </>} />

      <ProjectGlance onOpenTab={setActiveTab} overview={overview.data}
        facts={{
          statusLabel: getStatusLabel(projeto.status), statusTone: statusTone(projeto.status),
          responsible: projeto.responsavel?.nome || projeto.responsavel?.full_name || null,
          start: projeto.data_inicio ?? null, finish: projeto.data_fim ?? null,
          /* Ausente, e não zerada, sem leitura financeira: "R$ 0,00" seria uma afirmação falsa sobre o contrato. */
          revenue: canViewFinancials && hasContractValue
            ? { contract: displayContractTotal, billed: displayBilled, toBill: displayToBill, source: contractSourceLabel } : null,
        }} />
      {projeto.descricao && <p className="ax-note" style={{ marginTop: -6 }}>{projeto.descricao}</p>}

      <Tabs<TabId> label="Áreas do projeto" value={activeTab} onChange={setActiveTab} tabs={[
        { id: 'overview', label: 'Visão geral' },
        { id: 'timeline', label: 'Cronograma e plano', count: tabCount.timeline, tone: 'danger' },
        { id: 'supply', label: 'Materiais' },
        { id: 'measurements', label: 'Medições & Evidências', count: tabCount.measurements, tone: 'warning' },
        { id: 'timesheet', label: 'Apontamentos' },
        { id: 'team', label: 'Equipe' },
        { id: 'risks', label: 'Riscos', count: tabCount.risks, tone: 'danger' },
        { id: 'documents', label: 'Documentos' },
        { id: 'contract', label: 'Contexto contratual' },
        ...(canViewFinancials ? [{ id: 'finance' as const, label: 'Financeiro' }] : []),
        { id: 'activity', label: 'Histórico' },
      ]} />

      <div role="tabpanel" aria-labelledby={`ax-tab-${activeTab}`} className="ax-projtab">
        {activeTab === 'overview' && <ProjectOverviewTab projectId={id} overview={overview} onOpenTab={setActiveTab} />}
        {activeTab === 'activity' && <ProjectActivityTimeline projectId={id} />}
        {activeTab === 'timeline' && (
          <>
            <TimelineTab projectId={id} projectName={projeto.nome} projectManagerUserId={projeto.responsavel?.id ?? null} />
            {/* As necessidades pendem das atividades do cronograma: o plano de execução é o cronograma canônico, não uma segunda tabela. */}
            <ProjectRequirementsPanel projectId={id} />
          </>
        )}
        {activeTab === 'supply' && <ProjectSupplyTab projectId={id} />}
        {activeTab === 'measurements' && <ProjectMeasurementsTab projectId={id} focusMilestoneId={focusMilestoneId} />}
        {activeTab === 'timesheet' && <ProjectTimesheetView projectId={id} />}
        {activeTab === 'team' && <TeamAllocationView projectId={id} />}
        {activeTab === 'risks' && <ProjectRisksTab projectId={id} />}
        {activeTab === 'documents' && <ProjectDocumentsView projectId={id} focusMilestoneId={focusMilestoneId} />}
        {activeTab === 'contract' && (
          /*
            A ORIGEM COMERCIAL vem antes do contrato. Quando o projeto executa trabalho autorizado por
            proposta aceita ou por pedido de compra, a aba contratual ficaria vazia — e vazio aqui se lê como
            "falta cadastrar", o oposto da verdade. A cadeia diz o que autoriza o projeto, exista ou não instrumento.
          */
          <div className="ax-stack">
            <ProjectCommercialSourceChain projectId={id} />
            <ProjectContractTab projectId={id} focusMilestoneId={focusMilestoneId} />
          </div>
        )}
        {/*
          A aba Financeiro não é só escondida: sem leitura financeira o conteúdo não é montado, então
          `FinanceView` não roda e nenhuma consulta de razão, custo ou curva S sai do navegador.
        */}
        {activeTab === 'finance' && (!canViewFinancials ? (
          <EmptyState title="Informações financeiras restritas">Solicite permissão de leitura financeira de projetos para acessar esta aba.</EmptyState>
        ) : projetoV2 ? (
          <FinanceView project={projetoV2} onProjectChange={reloadProject} />
        ) : (
          <EmptyState title="Dados financeiros detalhados indisponíveis">Projetos migrados para v2 exibem curvas S, detalhamento e previsão.</EmptyState>
        ))}
      </div>
    </AxPage>
  );
}
