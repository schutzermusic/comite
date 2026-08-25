'use client';

/**
 * Contract Dossier — premium right-side drawer.
 *
 * Mirrors the Projetos / Riscos drawer behavior (HudDrawer portal + structured
 * sections + sticky quick-action footer). Consumes the same enriched
 * ContractGovernanceRecord used across the contracts module, so no data is
 * duplicated — the contract stays the governance/legal source and the actions
 * link downstream execution modules.
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { HudDrawer, HudButton, HudStatusPill, HudProgressBar, HudBadge } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import {
  formatCurrencyCompact,
  formatCurrencyFull,
  type ContractGovernanceRecord,
  type GovernanceSectionQuality,
} from '@/components/contracts/contract-governance-data';
import {
  getContractById,
  createTaskFromObligation,
  updateContractDocumentStatus,
  listContractRelatedTasks,
  computeApprovalSla,
  type ContractDetail,
  type ContractRelatedTask,
} from '@/lib/contracts/contract-service';
import { useContractItemModals } from '@/components/contracts/useContractItemModals';
import { trustedContractFromDetail } from '@/lib/contracts/trust/read-model';
import {
  ContractIdentity, ProjectRelation, FinancialPulse, RequiresAttention,
  ConnectedOperations, ContractHealthDrivers, RecommendedActionPanel, RecentActivity,
  type ConnectedOperationKey,
} from '@/components/contracts/cockpit';
import { attentionItems, recommendedAction, type AttentionActionKey } from '@/lib/contracts/trust/attention';
import { listContractAuditEvents, type ContractAuditEventRow } from '@/lib/contracts/contract-service';
import { useContractInstrumentationModals } from './useContractInstrumentationModals';
import { ChevronDown, Ruler
} from 'lucide-react';
import { ClientLogoUploadSlot } from '@/components/portfolio/ClientLogoUploadSlot';
import {
  approvalRoute, approvalStepOutcome, missingDocuments as trustedMissingDocs,
  obligationBreakdown, contractHealth,
} from '@/lib/contracts/trust/signals';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';
import {
  AlertTriangle,
  Archive,
  BrainCircuit,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  FileText,
  GanttChartSquare,
  Loader2,
  Receipt,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Wallet,
  Workflow,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

const riskLabels = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;
function riskVariant(risk: ContractGovernanceRecord['contract']['riskClassification']) {
  return risk === 'high' ? 'critical' : risk === 'medium' ? 'warning' : 'active';
}

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

/**
 * Selo de proveniência da seção.
 *
 * "Estimado" era um eufemismo: a seção não traz uma estimativa, traz um
 * preview SINTÉTICO gerado por `hash(id + nome)`. P0.3 exige que dado de
 * demonstração seja sempre identificado como tal — e o tom `warning` impede
 * que ele passe por resultado neutro.
 */
function QualityBadge({ quality }: { quality?: GovernanceSectionQuality }) {
  if (!quality) return null;
  const live = quality === 'live';
  return (
    <HudBadge variant={live ? 'success' : 'warning'} size="sm">
      {live ? 'Ao vivo' : 'Demonstração'}
    </HudBadge>
  );
}

function Section({ title, icon, quality, children }: { title: string; icon: React.ReactNode; quality?: GovernanceSectionQuality; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 text-ig-fg-muted">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{title}</span>
        </div>
        <QualityBadge quality={quality} />
      </div>
      {children}
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] font-medium text-ig-fg-subtle">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-semibold text-ig-fg-strong">{children}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'default' | 'success' | 'warning' | 'danger' }) {
  const toneClass = tone === 'success' ? 'text-ig-success' : tone === 'warning' ? 'text-ig-warning' : tone === 'danger' ? 'text-ig-danger' : 'text-ig-fg-strong';
  return (
    <div className="min-w-0 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
      <p className="truncate text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function LinkRow({
  icon,
  label,
  value,
  href,
  badge,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
  badge?: React.ReactNode;
  muted?: boolean;
}) {
  const body = (
    <div className="flex items-center gap-2.5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2 transition-colors hover:border-ig-border-strong">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle bg-ig-panel ${muted ? 'text-ig-fg-subtle' : 'text-ig-accent'}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">{label}</p>
        <p className={`truncate text-[12px] font-semibold ${muted ? 'text-ig-fg-muted' : href ? 'text-ig-accent' : 'text-ig-fg-strong'}`}>{value}</p>
      </div>
      {badge}
    </div>
  );
  if (href) {
    return (
      <Link href={href} onClick={(event) => event.stopPropagation()}>
        {body}
      </Link>
    );
  }
  return body;
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
   * para clicar num botão quebraria o fluxo que P1A montou.
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

  const sla = detail ? computeApprovalSla(detail.approvals) : null;
  const slaHours = sla?.avgHours ?? null;
  const STEP_LABELS: Record<string, string> = { juridico: 'Jurídico', financeiro: 'Financeiro', comite: 'Comitê', diretoria: 'Diretoria' };

  /**
   * Contrato CONFIÁVEL do Quick Dossier.
   *
   * Deriva do `detail` que o drawer já carregava, passando pelo MESMO
   * `buildTrustedContract` da listagem e da página de detalhe — as três
   * superfícies não podem discordar sobre o mesmo contrato.
   *
   * Enquanto `detail` não chega, `trusted` é nulo e os indicadores exibem "—",
   * que é a verdade naquele instante. Antes o drawer pintava imediatamente
   * valores do enricher, e o usuário via números fabricados que mudavam
   * sozinhos alguns instantes depois.
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

  /**
   * Derivações que o cockpit ainda consome diretamente. As demais (execução,
   * percentuais, contagens de documento) migraram para dentro dos componentes
   * de `cockpit/`, que recebem o `TrustedContract` inteiro e resolvem o próprio
   * estado — evitando uma camada de props já achatada em `number | null`, que é
   * justamente por onde o dado perde a proveniência.
   */
  const legalOutcome = trusted ? approvalStepOutcome(trusted, 'juridico') : null;
  const legalApproved = Boolean(legalOutcome && hasOfficialValue(legalOutcome) && legalOutcome.value === 'approved');
  const statusLabel = statusLabels[record.contract.status] ?? record.contract.status;
  const obligationStats = trusted ? obligationBreakdown(trusted) : null;
  const overdueObligations = obligationStats && hasOfficialValue(obligationStats) ? obligationStats.value.overdue : null;
  const docsMissingT = trusted ? trustedMissingDocs(trusted) : null;
  const trustedRoute = trusted ? approvalRoute(trusted) : null;
  const health = trusted ? contractHealth(trusted) : null;

  /**
   * Itens de atenção e ação recomendada — determinísticos, do modelo confiável.
   * Sem `trusted` não há sinal: preferimos silêncio a um alerta sobre dado que
   * ainda não foi lido.
   */
  const attention = trusted ? attentionItems(trusted) : [];
  const recommendation = trusted ? recommendedAction(trusted) : null;

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
        if (trusted && hasOfficialValue(trusted.project)) {
          window.location.assign(`/projetos/${trusted.project.value.id}`);
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
  const dq = record.dataQuality;
  const linksQuality: GovernanceSectionQuality | undefined = dq
    ? (dq.projectLink === 'live' || dq.risks === 'live' || dq.billing === 'live' || dq.documents === 'live' ? 'live' : 'estimated')
    : undefined;

  const canGovern = permissions.edit || permissions.approve || permissions.uploadDoc;
  const footer = (
    <div className="space-y-2.5">
      {/* Navegação para módulos (leitura) */}
      <div className="grid grid-cols-3 gap-2">
        <HudButton variant="secondary" size="sm" leftIcon={<Wallet className="h-4 w-4" />} onClick={() => onOpenFinance(record)}>
          Financeiro
        </HudButton>
        <HudButton variant="secondary" size="sm" leftIcon={<Receipt className="h-4 w-4" />} onClick={() => onOpenBilling(record)}>
          Faturamento
        </HudButton>
        <HudButton variant="secondary" size="sm" leftIcon={<Archive className="h-4 w-4" />} onClick={() => onViewDocuments(record)}>
          Documentos
        </HudButton>
      </div>

      {/* Ações de governança — gated por RBAC (RLS reforça no servidor) */}
      {canGovern && (
        <div className="border-t border-ig-border-subtle pt-2.5">
          <p className="mb-1.5 text-ig-label font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">Ações</p>
          <div className="grid grid-cols-2 gap-2">
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<Workflow className="h-4 w-4" />} onClick={() => onLinkProject(record)}>
                Vincular projeto
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<ClipboardCheck className="h-4 w-4" />} onClick={onCreateObligation}>
                Criar obrigação
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<Ruler className="h-4 w-4" />} onClick={() => instrumentation.openMilestone()}>
                Registrar marco
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<Scale className="h-4 w-4" />} onClick={() => instrumentation.openClause()}>
                Registrar cláusula
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<Receipt className="h-4 w-4" />} onClick={onCreateBilling}>
                Criar faturamento
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<CalendarClock className="h-4 w-4" />} onClick={() => onCreateTask(record)}>
                Criar tarefa
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<ShieldAlert className="h-4 w-4" />} onClick={() => onCreateRisk(record)}>
                Criar risco
              </HudButton>
            )}
            {permissions.edit && (
              <HudButton variant="secondary" size="sm" leftIcon={<ShieldCheck className="h-4 w-4" />} onClick={() => onLinkExistingRisk(record)}>
                Vincular risco
              </HudButton>
            )}
            {permissions.uploadDoc && (
              <HudButton variant="secondary" size="sm" leftIcon={<FileText className="h-4 w-4" />} onClick={() => onAttachDocument(record)}>
                Anexar documento
              </HudButton>
            )}
            {permissions.approve && (
              <HudButton variant="secondary" size="sm" leftIcon={<GanttChartSquare className="h-4 w-4" />} onClick={() => onReviewApproval(record)}>
                Aprovar / rejeitar
              </HudButton>
            )}
            {permissions.edit && !legalApproved && (
              <HudButton variant="secondary" size="sm" leftIcon={<Scale className="h-4 w-4" />} onClick={() => onSendToLegal(record)}>
                Rev. jurídica
              </HudButton>
            )}
          </div>
        </div>
      )}

      {/* Primário */}
      <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-ig-border-subtle pt-2.5">
        <HudButton variant="primary" size="sm" leftIcon={<FileSearch className="h-4 w-4" />} onClick={() => onView(record)}>
          Abrir dossiê completo
        </HudButton>
        <HudButton variant="glass" size="sm" leftIcon={<FileText className="h-4 w-4" />} onClick={() => onExportPdf(record)}>
          PDF
        </HudButton>
      </div>
    </div>
  );

  return (
    <>
    <HudDrawer
      isOpen={isOpen}
      onClose={onClose}
      title={record.contract.name}
      subtitle={`${record.code} · cockpit operacional`}
      width="600px"
      footer={footer}
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
      {/*
        ─── Quick Dossier = cockpit operacional ────────────────────────────

        A ordem das seções responde, nesta sequência: que contrato é este? a
        que está ligado? quanto está exposto? o que exige atenção? o que posso
        fazer agora? — e só então o detalhe operacional.

        Não é uma miniatura do dossiê completo: aqui mora a DECISÃO; lá, o
        workspace de consulta.
      */}
      <div className="space-y-5">
        {/* ── 1 · Identidade ─────────────────────────────────────────────── */}
        {trusted ? (
          <ContractIdentity contract={trusted} />
        ) : (
          /* Enquanto as relações não chegam, a identidade não é inventada a
             partir do record sintético: mostra-se o esqueleto. */
          <div className="space-y-2" aria-busy="true">
            <div className="h-3 w-28 rounded bg-ig-border-subtle/60" />
            <div className="h-6 w-56 rounded bg-ig-border-subtle/50" />
            <div className="h-3 w-40 rounded bg-ig-border-subtle/40" />
          </div>
        )}

        {/* ── 2 · Relação com projeto (primeira classe, nunca em overflow) ── */}
        {trusted && (
          <ProjectRelation
            project={trusted.project}
            onLink={permissions.edit ? () => onLinkProject(record) : undefined}
          />
        )}

        {/* ── 3 · Financial Pulse ────────────────────────────────────────── */}
        {trusted && (
          <div className="relative overflow-hidden rounded-[18px] border border-ig-border-focus/35 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--ig-bg-panel)_94%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_50%,transparent))] px-4 py-4 shadow-[var(--ig-shadow-e2)]">
            <span className="pointer-events-none absolute inset-y-4 left-0 w-px bg-ig-accent shadow-[0_0_14px_color-mix(in_oklab,var(--ig-accent)_70%,transparent)]" aria-hidden />
            <FinancialPulse contract={trusted} />
          </div>
        )}

        {/* ── 4 · Requires Attention ─────────────────────────────────────── */}
        {trusted && (
          <section>
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <h3 className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
                Requer atenção
              </h3>
              {attention.length > 0 && (
                <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">
                  {attention.length}
                </span>
              )}
            </div>
            <RequiresAttention
              items={attention}
              max={3}
              onAction={runAttentionAction}
              emptyHint={attentionEmptyHint}
            />
          </section>
        )}

        {/* ── 5 · Ação recomendada ───────────────────────────────────────── */}
        {trusted && recommendation && (
          <RecommendedActionPanel
            action={recommendation}
            attentionCount={attention.length}
            onRun={() => runAttentionAction(recommendation.key)}
          />
        )}

        {/* ── 6 · Connected Operations ───────────────────────────────────── */}
        {trusted && (
          <section>
            <h3 className="mb-2.5 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
              Operações conectadas
            </h3>
            <ConnectedOperations
              contract={trusted}
              context={{
                tasks: { count: tasks.error ? null : tasks.rows.length, errored: Boolean(tasks.error) },
                auditEvents: { count: audit.error ? null : audit.rows.length, errored: Boolean(audit.error) },
              }}
              onNavigate={navigateToOperation}
            />
          </section>
        )}

        {/* ── 7 · Saúde por dimensão (sem score) ─────────────────────────── */}
        {trusted && health && (
          <div className="rounded-[16px] border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_45%,transparent)] px-4 py-4">
            <ContractHealthDrivers health={health} />
          </div>
        )}

        {/* ── 8 · Detalhes do contrato (progressive disclosure) ──────────── */}
        {trusted && (
          <details className="group rounded-[14px] border border-ig-border-subtle px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]">
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

        {/* ── 9 · Atividade recente (audit_logs real) ────────────────────── */}
        <section>
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <h3 className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
              Atividade recente
            </h3>
          </div>
          <RecentActivity
            events={audit.rows}
            error={audit.error}
            max={4}
            onViewAll={() => onView(record)}
          />
        </section>

        <div className="border-t border-ig-border-subtle pt-1" />


        {/* F. Obrigações */}
        <Section title="F · Obrigações" icon={<ClipboardCheck className="h-4 w-4" />}>
          {detail && detail.obligations.length > 0 ? (
            <div className="space-y-1.5">
              {detail.obligations.slice(0, 8).map((ob) => {
                const overdue = ob.status === 'overdue';
                const done = ob.status === 'done';
                return (
                  <div key={ob.id} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-ig-fg-strong">{ob.title}</p>
                      <p className="truncate text-[11px] text-ig-fg-muted">{ob.due_date ? format(new Date(ob.due_date), 'dd/MM/yyyy', { locale: pt }) : 'sem prazo'}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <HudStatusPill variant={overdue ? 'critical' : done ? 'active' : ob.status === 'due_soon' ? 'warning' : 'neutral'} size="sm">
                        {done ? 'Concluída' : overdue ? 'Atrasada' : ob.status === 'due_soon' ? 'Próxima' : 'Aberta'}
                      </HudStatusPill>
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
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState loading={detailLoading} label="Nenhuma obrigação cadastrada" />
          )}
        </Section>

        {/* G. Faturamento */}
        <Section title="G · Faturamento" icon={<Receipt className="h-4 w-4" />}>
          {detail && detail.billingEvents.length > 0 ? (
            <div className="space-y-1.5">
              {detail.billingEvents.slice(0, 8).map((be) => {
                const realized = Boolean(be.paid_at) || ['pago', 'paid', 'billed', 'realizado', 'realized'].includes((be.status ?? '').toLowerCase());
                return (
                  <div key={be.id} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold text-ig-fg-strong">{be.title}</p>
                      <p className="truncate text-[11px] text-ig-fg-muted">
                        {formatCurrencyCompact(Number(be.amount) || 0)} · {be.due_date ? format(new Date(be.due_date), 'dd/MM/yyyy', { locale: pt }) : 'sem data'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <HudStatusPill variant={realized ? 'active' : 'warning'} size="sm">{realized ? 'Faturado' : 'Pendente'}</HudStatusPill>
                      {permissions.edit && !realized && (
                        <IconAction
                          title="Marcar como faturado"
                          tone="success"
                          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                          onClick={() => itemModals.openRealizeBilling(be)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState loading={detailLoading} label="Nenhum evento de faturamento vinculado" />
          )}
        </Section>

        {/* H. Documentos */}
        <Section title="H · Documentos" icon={<Archive className="h-4 w-4" />}>
          {detail && detail.documents.length > 0 ? (
            <div className="space-y-1.5">
              {detail.documents.slice(0, 10).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-ig-fg-strong">{doc.title}</p>
                    <p className="truncate text-[11px] text-ig-fg-muted">{DOC_STATUS_LABELS[doc.status] ?? doc.status}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <HudStatusPill variant={DOC_STATUS_VARIANT[doc.status] ?? 'neutral'} size="sm">{DOC_STATUS_LABELS[doc.status] ?? doc.status}</HudStatusPill>
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
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState loading={detailLoading} label="Nenhum documento anexado" />
          )}
        </Section>

        {/* I. Tarefas na agenda (leitura) */}
        <Section title="I · Tarefas na agenda" icon={<CalendarClock className="h-4 w-4" />}>
          {tasks.error ? (
            <p className="rounded-lg border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger">
              Não foi possível ler as tarefas vinculadas. A ausência de itens aqui não significa que não existam.
            </p>
          ) : tasks.rows.length > 0 ? (
            <div className="space-y-1.5">
              {tasks.rows.slice(0, 8).map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-ig-fg-strong">{task.title}</p>
                    <p className="truncate text-[11px] text-ig-fg-muted">{task.due_at ? format(new Date(task.due_at), 'dd/MM/yyyy', { locale: pt }) : 'sem prazo'}</p>
                  </div>
                  <HudStatusPill variant={task.status === 'done' ? 'active' : task.status === 'blocked' ? 'critical' : 'neutral'} size="sm">{task.status}</HudStatusPill>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState loading={detailLoading} label="Nenhuma tarefa vinculada na agenda" />
          )}
        </Section>
      </div>
    </HudDrawer>
    {itemModals.modals}
    {instrumentation.modals}
    </>
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
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle text-ig-fg-muted transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:h-7 sm:w-7 ${toneClass}`}
    >
      {icon}
    </button>
  );
}

function EmptyState({ loading, label }: { loading: boolean; label: string }) {
  return (
    <p className="rounded-lg border border-dashed border-ig-border-subtle bg-ig-panel/30 px-3 py-2.5 text-center text-[11px] text-ig-fg-muted">
      {loading ? 'Carregando…' : label}
    </p>
  );
}
