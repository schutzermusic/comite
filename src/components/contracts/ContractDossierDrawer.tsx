'use client';

/**
 * Contract Dossier — painel lateral operacional.
 *
 * ─── O que este painel responde, nesta ordem ──────────────────────────────
 *
 *   1. Está tudo bem com este contrato?   → cartão de resumo + ação recomendada
 *   2. O que eu faço agora?               → acordeões por domínio, FECHADOS
 *   3. Preciso de tudo?                   → "Abrir dossiê completo"
 *
 * A versão anterior respondia as três ao mesmo tempo: nove seções abertas e um
 * muro de vinte botões no rodapé, ~2.400px de rolagem. Tudo continua aqui —
 * nenhuma operação foi removida —, mas agora agrupado por domínio e revelado
 * sob demanda, com no máximo um grupo aberto por vez. O painel não cresce
 * conforme o usuário explora: ele TROCA de conteúdo.
 *
 * Consome o mesmo `TrustedContract` das outras superfícies do módulo, então o
 * contrato não pode dizer uma coisa aqui e outra na listagem ou no dossiê.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { HudDrawer, HudButton, HudStatusPill } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import {
  formatCurrencyCompact,
  type ContractGovernanceRecord,
} from '@/components/contracts/contract-governance-data';
import {
  getContractById,
  createTaskFromObligation,
  updateContractDocumentStatus,
  listContractRelatedTasks,
  type ContractDetail,
  type ContractRelatedTask,
} from '@/lib/contracts/contract-service';
import { useContractItemModals } from '@/components/contracts/useContractItemModals';
import { trustedContractFromDetail } from '@/lib/contracts/trust/read-model';
import {
  ContractIdentity, ProjectRelation, FinancialPulse, RequiresAttention,
  ConnectedOperations, ContractHealthDrivers, RecommendedActionPanel, RecentActivity,
  DrawerAccordion, ActionGrid, ActionRow, SummaryTile,
  type ConnectedOperationKey,
} from '@/components/contracts/cockpit';
import { attentionItems, recommendedAction, type AttentionActionKey } from '@/lib/contracts/trust/attention';
import { listContractAuditEvents, type ContractAuditEventRow } from '@/lib/contracts/contract-service';
import { useContractInstrumentationModals } from './useContractInstrumentationModals';
import { ClientLogoUploadSlot } from '@/components/portfolio/ClientLogoUploadSlot';
import {
  approvalRoute, approvalStepOutcome, missingDocuments as trustedMissingDocs,
  obligationBreakdown, contractHealth,
} from '@/lib/contracts/trust/signals';
import { hasOfficialValue, isError } from '@/lib/contracts/trust/trusted';
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileDiff,
  FileSearch,
  FileText,
  GanttChartSquare,
  Link2,
  Receipt,
  Ruler,
  Scale,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wallet,
  Workflow,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

const statusLabels: Record<string, string> = {
  negotiation: 'Negociação',
  legal_review: 'Revisão jurídica',
  commercial_review: 'Revisão comercial',
  signed: 'Assinado',
  active: 'Ativo',
  expiring_soon: 'Expirando',
  expired: 'Expirado',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};

/** Os grupos do painel. Apenas um fica aberto por vez. */
type SectionKey = 'attention' | 'operational' | 'financial' | 'governance' | 'documents' | 'connections';

export interface ContractDossierDrawerProps {
  record: ContractGovernanceRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onView: (record: ContractGovernanceRecord) => void;
  onLinkProject: (record: ContractGovernanceRecord) => void;
  onCreateTask: (record: ContractGovernanceRecord) => void;
  onCreateRisk: (record: ContractGovernanceRecord) => void;
  onLinkExistingRisk: (record: ContractGovernanceRecord) => void;
  onAttachDocument: (record: ContractGovernanceRecord) => void;
  onSendToLegal: (record: ContractGovernanceRecord) => void;
  onReviewApproval: (record: ContractGovernanceRecord) => void;
  onCreateObligation: () => void;
  onCreateBilling: () => void;
  /** Registrar aditivo. Ausente quando o usuário não pode editar. */
  onAddAmendment?: () => void;
  onViewDocuments: (record: ContractGovernanceRecord) => void;
  onExportPdf: (record: ContractGovernanceRecord) => void;
  onOpenFinance: (record: ContractGovernanceRecord) => void;
  onOpenBilling: (record: ContractGovernanceRecord) => void;
  /** Excluir o contrato — só é chamado quando `permissions.delete` é true. */
  onDelete?: (record: ContractGovernanceRecord) => void;
  /** UI-level RBAC gating; Supabase RLS enforces server-side. */
  permissions: { edit: boolean; approve: boolean; uploadDoc: boolean; delete?: boolean };
  /** Called after an in-drawer item mutation so the page governance/KPIs refresh. */
  onDataChanged?: () => Promise<void> | void;
  /** Upload/remoção da logo do cliente (gravada no projeto vinculado). */
  onLogoUpload?: (
    record: ContractGovernanceRecord,
    file: File | null,
  ) => Promise<string | null> | string | null;
}

export function ContractDossierDrawer({
  record,
  isOpen,
  onClose,
  onView,
  onLinkProject,
  onCreateTask,
  onCreateRisk,
  onLinkExistingRisk,
  onAttachDocument,
  onSendToLegal,
  onReviewApproval,
  onCreateObligation,
  onCreateBilling,
  onAddAmendment,
  onViewDocuments,
  onExportPdf,
  onOpenFinance,
  onOpenBilling,
  onDelete,
  permissions,
  onDataChanged,
  onLogoUpload,
}: ContractDossierDrawerProps) {
  const { notify } = useHudToast();
  const contractId = record?.contract.id ?? null;
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** Tarefas da Agenda; `error` distingue "nenhuma" de "não consegui ler". */
  const [tasks, setTasks] = useState<{ rows: ContractRelatedTask[]; error: string | null }>({ rows: [], error: null });
  /** Histórico real de `audit_logs`, para a seção de atividade recente. */
  const [audit, setAudit] = useState<{ rows: ContractAuditEventRow[]; error: string | null }>({ rows: [], error: null });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadedLogoUrl, setUploadedLogoUrl] = useState<string | null>(null);
  /**
   * `null` = tudo fechado, que é o estado de ABERTURA do painel.
   *
   * Um acordeão aberto fecha o anterior: é o que garante que a altura do painel
   * seja função do grupo mais alto, e não da soma de tudo que foi explorado.
   */
  const [openSection, setOpenSection] = useState<SectionKey | null>(null);

  // All state writes happen inside this callback (not lexically in the effect),
  // so the effect body stays free of synchronous setState.
  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const [nextDetail, tasksResult, auditResult] = await Promise.all([
        getContractById(id),
        listContractRelatedTasks(id).catch(() => ({ rows: [] as ContractRelatedTask[], error: 'Falha ao ler as tarefas vinculadas.' })),
        listContractAuditEvents(id).catch(() => ({ rows: [] as ContractAuditEventRow[], error: 'Falha ao ler o histórico.' })),
      ]);
      setDetail(nextDetail);
      setTasks(tasksResult);
      setAudit(auditResult);
    } catch {
      setDetail(null);
      setTasks({ rows: [], error: null });
      setAudit({ rows: [], error: null });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !contractId) return;
    void loadDetail(contractId);
  }, [isOpen, contractId, loadDetail]);

  useEffect(() => {
    setUploadedLogoUrl(null);
    // Trocar de contrato reabre o painel na visão, nunca no grupo que o
    // contrato ANTERIOR deixou aberto.
    setOpenSection(null);
  }, [contractId]);

  const refreshAfterMutation = useCallback(async () => {
    if (contractId) await loadDetail(contractId);
    if (onDataChanged) await onDataChanged();
  }, [contractId, loadDetail, onDataChanged]);

  const handleLogoSelect = useCallback(
    (file: File | null) => {
      if (!record || !onLogoUpload) return;
      const preview = file ? URL.createObjectURL(file) : null;
      setUploadedLogoUrl(preview);
      Promise.resolve(onLogoUpload(record, file))
        .then((url) => setUploadedLogoUrl(url))
        .finally(() => {
          if (preview) URL.revokeObjectURL(preview);
        });
    },
    [record, onLogoUpload],
  );

  const itemModals = useContractItemModals({ onSuccess: refreshAfterMutation });

  /**
   * P2B — registro de marco e cláusula direto do cockpit.
   *
   * Os dois formulários são estruturados (evidência, origem documental, efeito
   * contratual), mas a AÇÃO de registrar pertence ao cockpit: é aqui que o
   * usuário descobre que a medição está vazia, e mandá-lo ao dossiê completo só
   * para clicar num botão quebraria o fluxo.
   */
  const instrumentation = useContractInstrumentationModals({
    contractId: contractId ?? '',
    documents: detail?.documents ?? [],
    clauses: detail?.clauses ?? [],
    onRefresh: refreshAfterMutation,
  });

  const runItemAction = useCallback(
    async (key: string, action: () => Promise<unknown>, successMsg: string) => {
      setBusyId(key);
      try {
        await action();
        await refreshAfterMutation();
        notify(successMsg, { variant: 'success' });
      } catch (err) {
        notify('Não foi possível concluir', {
          description: err instanceof Error ? err.message : 'Erro inesperado.',
          variant: 'error',
        });
      } finally {
        setBusyId(null);
      }
    },
    [notify, refreshAfterMutation],
  );

  if (!record) return null;

  /**
   * Contrato CONFIÁVEL do painel.
   *
   * Deriva do `detail` que o drawer já carregava, passando pelo MESMO
   * `buildTrustedContract` da listagem e da página de detalhe — as três
   * superfícies não podem discordar sobre o mesmo contrato.
   *
   * Enquanto `detail` não chega, `trusted` é nulo e os indicadores exibem "—",
   * que é a verdade naquele instante.
   */
  const trusted = detail ? trustedContractFromDetail(detail, record.project ? [record.project] : []) : null;
  const projectLogo =
    trusted && hasOfficialValue(trusted.project)
      ? trusted.project.value.clientLogoUrl
      : record.project?.clientLogoUrl;
  const displayLogoUrl = uploadedLogoUrl ?? projectLogo ?? null;
  const logoAlt =
    trusted && hasOfficialValue(trusted.counterparty)
      ? trusted.counterparty.value
      : record.companyName;

  const legalOutcome = trusted ? approvalStepOutcome(trusted, 'juridico') : null;
  const legalApproved = Boolean(legalOutcome && hasOfficialValue(legalOutcome) && legalOutcome.value === 'approved');
  const statusLabel = statusLabels[record.contract.status] ?? record.contract.status;
  const obligationStats = trusted ? obligationBreakdown(trusted) : null;
  const overdueObligations = obligationStats && hasOfficialValue(obligationStats) ? obligationStats.value.overdue : null;
  const docsMissing = trusted ? trustedMissingDocs(trusted) : null;
  const missingDocCount = docsMissing && hasOfficialValue(docsMissing) ? docsMissing.value.length : null;
  const trustedRoute = trusted ? approvalRoute(trusted) : null;
  const health = trusted ? contractHealth(trusted) : null;
  const linkedProject = trusted && hasOfficialValue(trusted.project) ? trusted.project.value : null;
  /**
   * Falha de LEITURA não é ausência de vínculo.
   *
   * O tile do resumo só pode dizer "não vinculado" quando a consulta voltou e
   * não havia vínculo. Se ela falhou, o painel diz que não sabe — e o cartão
   * abaixo explica por quê.
   */
  const projectUnreadable = Boolean(trusted && isError(trusted.project));
  const projectUnresolved = Boolean(trusted && !linkedProject);

  /**
   * Itens de atenção e ação recomendada — determinísticos, do modelo confiável.
   * Sem `trusted` não há sinal: preferimos silêncio a um alerta sobre dado que
   * ainda não foi lido.
   */
  const attention = trusted ? attentionItems(trusted) : [];
  const recommendation = trusted ? recommendedAction(trusted) : null;
  const criticalAttention = attention.some((item) => item.severity === 'critical');

  /** Empty state com inteligência: aponta o próximo marco real (MD §40). */
  const attentionEmptyHint = (() => {
    if (!trusted || !hasOfficialValue(trusted.billingEvents)) return null;
    const next = trusted.billingEvents.value
      .filter((e) => !e.paid_at && e.due_date)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))[0];
    if (!next?.due_date) return null;
    return `Próximo marco financeiro: ${next.title} em ${new Date(next.due_date).toLocaleDateString('pt-BR')}.`;
  })();

  /** Uma ação de atenção despacha para a operação já existente do drawer. */
  const runAttentionAction = (key: AttentionActionKey) => {
    switch (key) {
      case 'linkProject': onLinkProject(record); break;
      case 'reviewApproval': onReviewApproval(record); break;
      case 'createObligation': onCreateObligation(); break;
      case 'createBilling': onCreateBilling(); break;
      case 'attachDocument': onAttachDocument(record); break;
      case 'openDocuments': onViewDocuments(record); break;
      case 'openBilling': onOpenBilling(record); break;
      case 'openObligations': onView(record); break;
      // A revisão de proposta exige a comparação lado a lado, que só cabe no
      // dossiê completo.
      case 'reviewClauseProposals': onView(record); break;
    }
  };

  /** Connected Operations leva ao módulo dono do domínio. */
  const navigateToOperation = (key: ConnectedOperationKey) => {
    switch (key) {
      case 'project':
        if (linkedProject) {
          window.location.assign(`/projetos/${linkedProject.id}`);
        } else if (permissions.edit) {
          onLinkProject(record);
        }
        break;
      case 'billing': onOpenBilling(record); break;
      case 'documents': onViewDocuments(record); break;
      case 'obligations': onView(record); break;
      case 'risks': onView(record); break;
      case 'approvals':
        if (permissions.approve) onReviewApproval(record);
        else onView(record);
        break;
      // Os três abaixo entregam o assunto ao módulo DONO, sem cópia local.
      case 'tasks': window.location.assign('/reunioes'); break;
      // Medição e cláusulas moram no dossiê completo, onde há espaço para o
      // formulário estruturado que os dois exigem.
      case 'measurement': onView(record); break;
      case 'clauses': onView(record); break;
      case 'audit': onView(record); break;
      case 'finance': onOpenFinance(record); break;
    }
  };

  const toggle = (key: SectionKey) => setOpenSection((current) => (current === key ? null : key));

  // ── Contagens dos grupos ────────────────────────────────────────────────
  const obligationCount = detail ? detail.obligations.length : null;
  const billingCount = detail ? detail.billingEvents.length : null;
  const documentCount = detail ? detail.documents.length : null;
  const approvalCount = detail ? detail.approvals.length : null;
  const taskCount = tasks.error ? null : tasks.rows.length;
  const pendingBilling = detail
    ? detail.billingEvents.filter((be) => !isRealized(be.paid_at, be.status)).length
    : null;

  /**
   * Resumo factual do grupo fechado.
   *
   * O cabeçalho passou a ter dois papéis distintos: a linha de apoio diz O QUE
   * HÁ (contagens), e o chip à direita diz O QUE PENDE. Antes os dois
   * disputavam o mesmo lugar — um número sem assunto ao lado de um rótulo
   * colorido sem anatomia.
   */
  const summarize = (...parts: (string | null)[]) =>
    parts.filter(Boolean).join(' · ') || 'Carregando…';
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const countLabel = (n: number | null, one: string, many: string) =>
    n === null ? null : plural(n, one, many);

  /*
    O rodapé perdeu as três linhas de navegação e o muro de doze botões: elas
    viraram, respectivamente, o grupo "Conexões" e as ações dentro de cada
    acordeão. Sobra a hierarquia real — um destino primário e uma saída.
  */
  const footer = (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <HudButton variant="primary" size="sm" leftIcon={<FileSearch className="h-4 w-4" />} onClick={() => onView(record)}>
        Abrir dossiê completo
      </HudButton>
      <HudButton
        variant="glass"
        size="sm"
        leftIcon={<FileText className="h-4 w-4" />}
        title="Exportar o dossiê em PDF"
        onClick={() => onExportPdf(record)}
      >
        PDF
      </HudButton>
    </div>
  );

  return (
    <>
    <HudDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={record.contract.name}
      density="compact"
      width="500px"
      footer={footer}
      subtitle={
        trusted ? (
          /* Código + estado + risco + vigência numa faixa só: o cabeçalho
             identifica, não descreve. */
          <ContractIdentity contract={trusted} compact />
        ) : (
          <div className="flex items-center gap-1.5" aria-busy="true">
            <span className="h-4 w-20 rounded bg-ig-border-subtle/60" />
            <span className="h-4 w-16 rounded bg-ig-border-subtle/45" />
          </div>
        )
      }
      headerLeading={
        onLogoUpload || displayLogoUrl ? (
          <ClientLogoUploadSlot
            logoUrl={displayLogoUrl}
            alt={logoAlt || 'Logo do cliente'}
            disabled={!onLogoUpload || !permissions.edit}
            onSelect={handleLogoSelect}
          />
        ) : undefined
      }
      headerActions={
        permissions.delete && onDelete ? (
          <button
            type="button"
            title="Excluir contrato"
            aria-label="Excluir contrato"
            onClick={() => onDelete(record)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-ig-border bg-ig-panel text-ig-fg-muted transition-colors hover:border-[color-mix(in_oklab,var(--ig-danger)_45%,transparent)] hover:bg-red-500/15 hover:text-ig-danger"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : undefined
      }
    >
      <div className="space-y-2.5">
        {/* ── 1 · Resumo — o único bloco sempre visível ─────────────────────
            Tipo, projeto, valor e execução. Nada além disto compete pelo
            primeiro olhar. Contraparte permanece nos formulários e na ficha. */}
        {trusted ? (
          <section className="ig-lp overflow-hidden" aria-label="Resumo do contrato">
            <div className="grid grid-cols-2 gap-x-1 px-1.5 py-2">
              <SummaryTile
                label="Tipo"
                value={hasOfficialValue(trusted.contractType) ? trusted.contractType.value : 'Não informado'}
              />
              {linkedProject ? (
                <SummaryTile
                  label="Projeto vinculado"
                  value={linkedProject.codigo}
                  sub={linkedProject.nome}
                  href={`/projetos/${linkedProject.id}`}
                />
              ) : projectUnreadable ? (
                <SummaryTile
                  label="Projeto vinculado"
                  value="Não apurado"
                  sub="Falha ao ler o vínculo"
                  tone="warning"
                />
              ) : (
                <SummaryTile
                  label="Projeto vinculado"
                  value="Não vinculado"
                  sub={permissions.edit ? 'Vincular agora' : 'Fora da visão de portfólio'}
                  tone="warning"
                  onClick={permissions.edit ? () => onLinkProject(record) : undefined}
                />
              )}
            </div>

            {/* Valor, faturado, backlog e execução — a régua financeira do
                painel, no degrau recuado da linguagem `.ig-lp`. */}
            <div className="ig-lp-rule ig-lp-rule--tail px-3 py-2.5">
              <FinancialPulse contract={trusted} compact />
            </div>
          </section>
        ) : (
          <div className="ig-lp space-y-2 p-3" aria-busy="true">
            <div className="h-3 w-28 rounded bg-ig-border-subtle/60" />
            <div className="h-5 w-48 rounded bg-ig-border-subtle/50" />
            <div className="h-3 w-36 rounded bg-ig-border-subtle/40" />
          </div>
        )}

        {/* ── 2 · Vínculo ausente: estado operacional, não campo vazio ──────
            Só aparece quando FALTA. No caminho feliz o tile acima já disse o
            que havia a dizer, e o cartão inteiro seria repetição. */}
        {projectUnresolved && (
          <ProjectRelation
            project={trusted!.project}
            compact
            onLink={permissions.edit ? () => onLinkProject(record) : undefined}
          />
        )}

        {/* ── 3 · Comece por aqui — uma decisão, não uma lista ──────────── */}
        {trusted && recommendation && (
          <RecommendedActionPanel
            action={recommendation}
            attentionCount={attention.length}
            onRun={() => runAttentionAction(recommendation.key)}
          />
        )}

        {/* ── 4 · Grupos ────────────────────────────────────────────────────
            Fechados por padrão, um aberto por vez. O cabeçalho de cada um
            carrega a contagem e o sinal — quem só quer saber "quantas
            obrigações, alguma atrasada?" lê sem abrir nada. */}

        {trusted && attention.length > 0 && (
          <DrawerAccordion
            id="ig-cd-attention"
            title="Requer atenção"
            icon={<AlertTriangle className="h-4 w-4" />}
            hint={criticalAttention ? 'Há item crítico neste contrato' : 'Pendências monitoradas'}
            flag={criticalAttention ? 'crítico' : 'atenção'}
            flagValue={attention.length}
            tone={criticalAttention ? 'danger' : 'warning'}
            open={openSection === 'attention'}
            onToggle={() => toggle('attention')}
          >
            <RequiresAttention
              items={attention}
              max={4}
              compact
              onAction={runAttentionAction}
              emptyHint={attentionEmptyHint}
            />
          </DrawerAccordion>
        )}

        {/* ── Operacional · obrigações, marcos e tarefas ──────────────────── */}
        <DrawerAccordion
          id="ig-cd-operational"
          title="Operacional"
          icon={<Workflow className="h-4 w-4" />}
          hint={summarize(
            countLabel(obligationCount, 'obrigação', 'obrigações'),
            countLabel(taskCount, 'tarefa', 'tarefas'),
          )}
          count={obligationCount}
          tone={overdueObligations ? 'danger' : 'neutral'}
          flag={overdueObligations ? 'em atraso' : undefined}
          flagValue={overdueObligations ?? undefined}
          open={openSection === 'operational'}
          onToggle={() => toggle('operational')}
        >
          {permissions.edit && (
            <ActionGrid>
              <ActionRow icon={<ClipboardCheck />} label="Criar obrigação" tone="accent" onClick={onCreateObligation} />
              <ActionRow icon={<Ruler />} label="Registrar marco" onClick={() => instrumentation.openMilestone()} />
              <ActionRow icon={<CalendarClock />} label="Criar tarefa" onClick={() => onCreateTask(record)} />
              <ActionRow icon={<Link2 />} label="Vincular projeto" onClick={() => onLinkProject(record)} />
            </ActionGrid>
          )}

          {/* F. Obrigações */}
          <Group title="F · Obrigações" count={obligationCount}>
            {detail && detail.obligations.length > 0 ? (
              <ItemList>
                {detail.obligations.slice(0, 6).map((ob) => {
                  const overdue = ob.status === 'overdue';
                  const done = ob.status === 'done';
                  return (
                    <ItemRow
                      key={ob.id}
                      title={ob.title}
                      meta={ob.due_date ? format(new Date(ob.due_date), 'dd/MM/yyyy', { locale: pt }) : 'sem prazo'}
                      pill={
                        <HudStatusPill variant={overdue ? 'critical' : done ? 'active' : ob.status === 'due_soon' ? 'warning' : 'neutral'} size="sm">
                          {done ? 'Concluída' : overdue ? 'Atrasada' : ob.status === 'due_soon' ? 'Próxima' : 'Aberta'}
                        </HudStatusPill>
                      }
                      actions={
                        <>
                          {permissions.edit && !done && (
                            <IconAction
                              title="Concluir obrigação"
                              tone="success"
                              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                              onClick={() => itemModals.openCompleteObligation(ob)}
                            />
                          )}
                          {permissions.edit && (
                            <IconAction
                              title="Criar tarefa na agenda"
                              icon={<CalendarClock className="h-3.5 w-3.5" />}
                              disabled={busyId === `obltask-${ob.id}`}
                              onClick={() =>
                                runItemAction(
                                  `obltask-${ob.id}`,
                                  () => createTaskFromObligation(ob.contract_id, ob.title, `${ob.due_date ?? format(new Date(), 'yyyy-MM-dd')}T23:59:59`, ob.owner_user_id),
                                  'Tarefa criada na agenda',
                                )
                              }
                            />
                          )}
                        </>
                      }
                    />
                  );
                })}
              </ItemList>
            ) : (
              <EmptyState loading={detailLoading} label="Nenhuma obrigação cadastrada" />
            )}
          </Group>

          {/* I. Tarefas na agenda (leitura) */}
          <Group title="I · Tarefas na agenda" count={taskCount}>
            {tasks.error ? (
              <p className="rounded-lg border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger">
                Não foi possível ler as tarefas vinculadas. A ausência de itens aqui não significa que não existam.
              </p>
            ) : tasks.rows.length > 0 ? (
              <ItemList>
                {tasks.rows.slice(0, 5).map((task) => (
                  <ItemRow
                    key={task.id}
                    title={task.title}
                    meta={task.due_at ? format(new Date(task.due_at), 'dd/MM/yyyy', { locale: pt }) : 'sem prazo'}
                    pill={
                      <HudStatusPill variant={task.status === 'done' ? 'active' : task.status === 'blocked' ? 'critical' : 'neutral'} size="sm">
                        {task.status}
                      </HudStatusPill>
                    }
                  />
                ))}
              </ItemList>
            ) : (
              <EmptyState loading={detailLoading} label="Nenhuma tarefa vinculada na agenda" />
            )}
          </Group>
        </DrawerAccordion>

        {/* ── Financeiro · faturamento e aditivos ─────────────────────────── */}
        <DrawerAccordion
          id="ig-cd-financial"
          title="Financeiro"
          icon={<Wallet className="h-4 w-4" />}
          hint={summarize(countLabel(billingCount, 'evento', 'eventos de faturamento'))}
          count={billingCount}
          tone={pendingBilling ? 'warning' : 'neutral'}
          flag={pendingBilling ? 'a faturar' : undefined}
          flagValue={pendingBilling ?? undefined}
          open={openSection === 'financial'}
          onToggle={() => toggle('financial')}
        >
          <ActionGrid>
            {permissions.edit && (
              <ActionRow icon={<Receipt />} label="Criar faturamento" tone="accent" onClick={onCreateBilling} />
            )}
            {permissions.edit && onAddAmendment && (
              <ActionRow icon={<FileDiff />} label="Adicionar aditivo" onClick={onAddAmendment} />
            )}
            <ActionRow icon={<Wallet />} label="Abrir Financeiro" onClick={() => onOpenFinance(record)} />
            <ActionRow icon={<Receipt />} label="Abrir Faturamento" onClick={() => onOpenBilling(record)} />
          </ActionGrid>

          {/* G. Faturamento */}
          <Group title="G · Faturamento" count={billingCount}>
            {detail && detail.billingEvents.length > 0 ? (
              <ItemList>
                {detail.billingEvents.slice(0, 6).map((be) => {
                  const realized = isRealized(be.paid_at, be.status);
                  return (
                    <ItemRow
                      key={be.id}
                      title={be.title}
                      meta={`${formatCurrencyCompact(Number(be.amount) || 0)} · ${be.due_date ? format(new Date(be.due_date), 'dd/MM/yyyy', { locale: pt }) : 'sem data'}`}
                      pill={
                        <HudStatusPill variant={realized ? 'active' : 'warning'} size="sm">
                          {realized ? 'Faturado' : 'Pendente'}
                        </HudStatusPill>
                      }
                      actions={
                        permissions.edit && !realized ? (
                          <IconAction
                            title="Marcar como faturado"
                            tone="success"
                            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                            onClick={() => itemModals.openRealizeBilling(be)}
                          />
                        ) : null
                      }
                    />
                  );
                })}
              </ItemList>
            ) : (
              <EmptyState loading={detailLoading} label="Nenhum evento de faturamento vinculado" />
            )}
          </Group>
        </DrawerAccordion>

        {/* ── Governança · aprovações, cláusulas, risco e cobertura ───────── */}
        <DrawerAccordion
          id="ig-cd-governance"
          title="Governança"
          icon={<ShieldCheck className="h-4 w-4" />}
          hint={summarize(
            countLabel(approvalCount, 'etapa de alçada', 'etapas de alçada'),
            trusted && legalApproved ? 'jurídico aprovado' : null,
          )}
          count={approvalCount}
          tone={trusted && !legalApproved ? 'warning' : 'neutral'}
          flag={trusted && !legalApproved ? 'jurídico' : undefined}
          open={openSection === 'governance'}
          onToggle={() => toggle('governance')}
        >
          <ActionGrid>
            {permissions.approve && (
              <ActionRow icon={<GanttChartSquare />} label="Aprovar / rejeitar" tone="accent" onClick={() => onReviewApproval(record)} />
            )}
            {permissions.edit && !legalApproved && (
              <ActionRow icon={<Scale />} label="Revisão jurídica" onClick={() => onSendToLegal(record)} />
            )}
            {permissions.edit && (
              <ActionRow icon={<Scale />} label="Registrar cláusula" onClick={() => instrumentation.openClause()} />
            )}
            {permissions.edit && (
              <ActionRow icon={<ShieldAlert />} label="Criar risco" onClick={() => onCreateRisk(record)} />
            )}
            {permissions.edit && (
              <ActionRow icon={<ShieldCheck />} label="Vincular risco" onClick={() => onLinkExistingRisk(record)} />
            )}
          </ActionGrid>

          {/* Cobertura por dimensão — sem score. */}
          {health && <ContractHealthDrivers health={health} compact />}

          {/* Detalhes do contrato, em nível 2 de revelação. */}
          {trusted && (
            <details className="group rounded-[12px] border border-ig-border-subtle px-3 py-2.5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-ig-caption font-semibold text-ig-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]">
                Detalhes do contrato
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Detail label="Código" value={trusted.code} />
                <Detail label="Status" value={statusLabel} />
                <Detail label="Tipo" value={hasOfficialValue(trusted.contractType) ? trusted.contractType.value : 'Não informado'} />
                <Detail label="Contraparte" value={hasOfficialValue(trusted.counterparty) ? trusted.counterparty.value : 'Não informada'} />
                <Detail label="Início" value={hasOfficialValue(trusted.startDate) ? trusted.startDate.value.toLocaleDateString('pt-BR') : 'Não informado'} />
                <Detail label="Término" value={hasOfficialValue(trusted.endDate) ? trusted.endDate.value.toLocaleDateString('pt-BR') : 'Não informado'} />
                <Detail label="Rota de aprovação" value={trustedRoute && hasOfficialValue(trustedRoute) ? trustedRoute.value : 'Nenhuma etapa'} wide />
              </dl>
            </details>
          )}
        </DrawerAccordion>

        {/* ── Documentos ──────────────────────────────────────────────────── */}
        <DrawerAccordion
          id="ig-cd-documents"
          title="Documentos"
          icon={<Archive className="h-4 w-4" />}
          hint={summarize(countLabel(documentCount, 'documento', 'documentos'))}
          count={documentCount}
          tone={missingDocCount ? 'warning' : 'neutral'}
          flag={missingDocCount ? 'pendentes' : undefined}
          flagValue={missingDocCount ?? undefined}
          open={openSection === 'documents'}
          onToggle={() => toggle('documents')}
        >
          <ActionGrid>
            {permissions.uploadDoc && (
              <ActionRow icon={<FileText />} label="Anexar documento" tone="accent" onClick={() => onAttachDocument(record)} />
            )}
            <ActionRow icon={<Archive />} label="Abrir Documentos" onClick={() => onViewDocuments(record)} />
          </ActionGrid>

          {/* H. Documentos */}
          <Group title="H · Documentos" count={documentCount}>
            {detail && detail.documents.length > 0 ? (
              <ItemList>
                {detail.documents.slice(0, 8).map((doc) => (
                  <ItemRow
                    key={doc.id}
                    title={doc.title}
                    meta={DOC_STATUS_LABELS[doc.status] ?? doc.status}
                    pill={
                      <HudStatusPill variant={DOC_STATUS_VARIANT[doc.status] ?? 'neutral'} size="sm">
                        {DOC_STATUS_LABELS[doc.status] ?? doc.status}
                      </HudStatusPill>
                    }
                    actions={
                      <>
                        {permissions.uploadDoc && doc.status !== 'pending_approval' && doc.status !== 'approved' && doc.status !== 'rejected' && (
                          <IconAction
                            title="Enviar para aprovação"
                            icon={<ClipboardCheck className="h-3.5 w-3.5" />}
                            disabled={busyId === `docp-${doc.id}`}
                            onClick={() => runItemAction(`docp-${doc.id}`, () => updateContractDocumentStatus(doc.id, 'pending_approval'), 'Documento enviado para aprovação')}
                          />
                        )}
                        {permissions.uploadDoc && doc.status !== 'approved' && (
                          <IconAction
                            title="Aprovar documento"
                            tone="success"
                            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                            disabled={busyId === `doca-${doc.id}`}
                            onClick={() => runItemAction(`doca-${doc.id}`, () => updateContractDocumentStatus(doc.id, 'approved'), 'Documento aprovado')}
                          />
                        )}
                        {permissions.uploadDoc && doc.status !== 'rejected' && (
                          <IconAction
                            title="Rejeitar documento"
                            tone="danger"
                            icon={<AlertTriangle className="h-3.5 w-3.5" />}
                            onClick={() => itemModals.openRejectDoc(doc)}
                          />
                        )}
                      </>
                    }
                  />
                ))}
              </ItemList>
            ) : (
              <EmptyState loading={detailLoading} label="Nenhum documento anexado" />
            )}
          </Group>
        </DrawerAccordion>

        {/* ── Conexões e atividade ────────────────────────────────────────── */}
        {trusted && (
          <DrawerAccordion
            id="ig-cd-connections"
            title="Conexões e atividade"
            icon={<Share2 className="h-4 w-4" />}
            hint={summarize(
              'Módulos relacionados',
              audit.error ? 'histórico indisponível' : countLabel(audit.rows.length, 'evento', 'eventos'),
            )}
            count={audit.error ? null : audit.rows.length}
            open={openSection === 'connections'}
            onToggle={() => toggle('connections')}
          >
            <ConnectedOperations
              contract={trusted}
              context={{
                tasks: { count: taskCount, errored: Boolean(tasks.error) },
                auditEvents: { count: audit.error ? null : audit.rows.length, errored: Boolean(audit.error) },
              }}
              onNavigate={navigateToOperation}
            />

            <Group title="Atividade recente">
              <RecentActivity
                events={audit.rows}
                error={audit.error}
                max={4}
                onViewAll={() => onView(record)}
              />
            </Group>
          </DrawerAccordion>
        )}
      </div>
    </HudDrawer>
    {itemModals.modals}
    {instrumentation.modals}
    </>
  );
}

const PAID_TOKENS = ['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado'];
/** Mesma regra do Financial Pulse: um evento faturado não pode divergir entre as duas leituras. */
function isRealized(paidAt: string | null | undefined, status: string | null | undefined) {
  return Boolean(paidAt) || PAID_TOKENS.includes((status ?? '').toLowerCase());
}

/** Subtítulo de bloco dentro de um acordeão — um degrau abaixo do grupo. */
function Group({ title, count, children }: { title: string; count?: number | null; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-ig-caption font-semibold uppercase tracking-wide text-ig-fg-subtle">{title}</h4>
        {count !== undefined && count !== null && count > 0 && (
          <span className="ig-tabular text-ig-caption text-ig-fg-subtle">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Lista de itens: divisórias de 1px em vez de uma borda por linha. */
function ItemList({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[12px] border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_35%,transparent)] [&>*+*]:border-t [&>*+*]:border-ig-border-subtle">
      {children}
    </div>
  );
}

/**
 * Linha de item compacta.
 *
 * A moldura por item virou divisória: doze linhas emolduradas eram doze
 * objetos disputando a mesma atenção, e ~30px de borda e respiro por linha.
 */
function ItemRow({
  title, meta, pill, actions,
}: {
  title: string;
  meta?: React.ReactNode;
  pill?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 transition-colors hover:bg-[color-mix(in_oklab,var(--ig-accent)_5%,transparent)]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{title}</p>
        {meta && <p className="truncate text-ig-caption text-ig-fg-muted">{meta}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {pill}
        {actions}
      </div>
    </div>
  );
}

/** Par rótulo/valor da lista de detalhes, em progressive disclosure. */
function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-ig-caption text-ig-fg-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-ig-body-sm font-medium text-ig-fg-strong">{value}</dd>
    </div>
  );
}

const DOC_STATUS_LABELS: Record<string, string> = {
  uploaded: 'Enviado',
  missing: 'Faltante',
  expired: 'Vencido',
  expiring_soon: 'A vencer',
  pending_approval: 'Em aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

const DOC_STATUS_VARIANT: Record<string, 'active' | 'warning' | 'critical' | 'neutral'> = {
  uploaded: 'active',
  missing: 'warning',
  expired: 'critical',
  expiring_soon: 'warning',
  pending_approval: 'warning',
  approved: 'active',
  rejected: 'critical',
};

function IconAction({
  title,
  icon,
  disabled,
  onClick,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  tone?: 'default' | 'danger' | 'success';
}) {
  const toneClass =
    tone === 'danger'
      ? 'hover:border-[color-mix(in_oklab,var(--ig-danger)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)] hover:text-ig-danger'
      : tone === 'success'
        ? 'hover:border-[color-mix(in_oklab,var(--ig-success)_40%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-success)_14%,transparent)] hover:text-ig-success'
        : 'hover:border-ig-border-focus hover:bg-ig-panel-hover hover:text-ig-fg-strong';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:h-7 sm:w-7 ${toneClass}`}
    >
      {icon}
    </button>
  );
}

function EmptyState({ loading, label }: { loading: boolean; label: string }) {
  return (
    <p className="rounded-[12px] border border-dashed border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_25%,transparent)] px-3 py-2.5 text-center text-ig-caption text-ig-fg-muted">
      {loading ? 'Carregando…' : label}
    </p>
  );
}
