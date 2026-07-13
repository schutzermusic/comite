'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  FileEdit,
  Link2,
  ListChecks,
  Route,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  Vote,
  Wallet,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { HudInput, hudInputBase } from '@/components/ui/hud-input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PrimaryCTA } from '@/components/ui/primary-cta';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  COMMITTEES,
  DELIBERATION_TEMPLATES,
  MAJORITY_TYPE_LABELS,
  VOTING_RULES_BY_COMMITTEE,
  boardRequired,
  buildCustomStagePlan,
  committeeSeats,
  computeCreationRoute,
  computeDependentCommittees,
  getTemplateProfile,
  isCommercialTemplate,
  quorumHeadcount,
  resolveTemplate,
  type CreationRoute,
} from '@/lib/deliberations-policy';
import { DeliberationStage, MajorityType } from '@/lib/types';
import { getProjectsAsync } from '@/lib/services/projects';
import { listContracts } from '@/lib/contracts/contract-service';
import { cn } from '@/lib/utils';

// Sentinela usada nos Selects de vínculo para revelar o campo de texto livre.
const NEW_LINK = '__new__';
type LinkOption = { id: string; label: string };

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type Priority = 'low' | 'medium' | 'high' | 'critical';

export type NewDeliberationPayload = {
  title: string;
  description: string;
  templateId: string;
  businessArea: string;
  financialImpact: number;
  riskLevel: RiskLevel;
  priority: Priority;
  strategicFlag: boolean;
  outsideBudget: boolean;
  marginPercent: number;
  aggressivePaymentTerms: boolean;
  ownerCommitteeId: string;
  ownerCommitteeName: string;
  dependentCommitteeIds: string[];
  dependentCommitteeNames: string[];
  votingCommitteeIds: string[];
  votingCommitteeNames: string[];
  quorumPercent: number;
  approvalRule: MajorityType;
  votingWindowHours: number;
  requiresMinutes: boolean;
  requiresEvidence: boolean;
  requiresExecutionFollowUp: boolean;
  deadline: string | null;
  linkedProjectLabel: string | null;
  linkedContractLabel: string | null;
  stages: DeliberationStage[];
  /** Rota de criação escolhida: rascunho, revisão ou votação direta. */
  route: CreationRoute;
};

interface NewDeliberationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateDeliberation: (payload: NewDeliberationPayload) => void;
  /**
   * Restringe o comitê responsável aos comitês do criador (ids de governança).
   * Vazio/omitido = sem restrição (todos os comitês). Os comitês votantes não
   * são restringidos (governança cruzada).
   */
  allowedCommitteeIds?: string[];
}

const BUSINESS_AREAS: Array<{ value: string; label: string }> = [
  { value: 'HR', label: 'Recursos Humanos' },
  { value: 'Finance', label: 'Financeiro' },
  { value: 'R&D', label: 'Engenharia / P&D' },
  { value: 'Sales', label: 'Comercial' },
  { value: 'Operations', label: 'Operações' },
  { value: 'Procurement', label: 'Compras / Suprimentos' },
  { value: 'Legal', label: 'Jurídico' },
  { value: 'Risk', label: 'Riscos & Compliance' },
];

const RISK_LABELS: Record<RiskLevel, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto', critical: 'Crítico' };
const PRIORITY_LABELS: Record<Priority, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', critical: 'Crítica' };

const priorityFromRisk = (risk: RiskLevel): Priority => risk;

// Metadados das rotas de criação (rótulo, ícone, CTA).
const ROUTE_META: Record<
  CreationRoute,
  { label: string; hint: string; cta: string; icon: React.ComponentType<{ className?: string }> }
> = {
  draft: {
    label: 'Salvar rascunho',
    hint: 'Guarda a decisão para completar os dados depois.',
    cta: 'Salvar rascunho',
    icon: FileEdit,
  },
  review: {
    label: 'Enviar para revisão',
    hint: 'Coleta parecer/revisão antes de abrir a votação.',
    cta: 'Enviar para revisão',
    icon: ScrollText,
  },
  voting: {
    label: 'Iniciar votação',
    hint: 'Abre a votação imediatamente — sem etapa de parecer.',
    cta: 'Iniciar votação',
    icon: Vote,
  },
};

// ---- Estilo Glass HUD reutilizável (theme-aware via tokens --ig-*) ----------
const panel = 'rounded-xl border border-ig-border-default bg-ig-panel/40';
const labelCls = 'text-ig-fg-default text-sm';
const selectTrigger = 'bg-ig-panel/60 border-ig-border-default text-ig-fg-strong';
const selectContent = 'bg-ig-overlay border-ig-border-strong text-ig-fg-strong';

function SectionTitle({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ig-accent-weak text-ig-accent">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ig-fg-strong">{title}</p>
        {hint && <p className="text-xs text-ig-fg-subtle">{hint}</p>}
      </div>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-ig-danger">
      <AlertCircle className="h-3 w-3" /> {message}
    </p>
  );
}

// Linha rótulo→valor usada nos cartões de revisão.
function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="shrink-0 text-xs uppercase tracking-wide text-ig-fg-subtle">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-ig-fg-strong">{value}</span>
    </div>
  );
}

// Cartão de resumo (Step 3) com título e ícone.
function SummaryCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(panel, 'p-4')}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-ig-accent" />
        <p className="text-xs font-semibold uppercase tracking-wide text-ig-fg-subtle">{title}</p>
      </div>
      <div className="divide-y divide-ig-border-subtle">{children}</div>
    </div>
  );
}

// Linha de toggle (Switch) reutilizável.
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-default bg-ig-panel/30 px-3 py-2.5">
      <span className="text-sm text-ig-fg-default">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function NewDeliberationModal({ open, onOpenChange, onCreateDeliberation, allowedCommitteeIds }: NewDeliberationModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Override manual da rota de criação (null = usa a recomendada).
  const [routeOverride, setRouteOverride] = useState<CreationRoute | null>(null);

  // Comitê responsável restrito aos comitês do criador, quando fornecidos.
  const restrictCommittees = !!allowedCommitteeIds && allowedCommitteeIds.length > 0;
  const committeeOptions = restrictCommittees
    ? COMMITTEES.filter((c) => allowedCommitteeIds!.includes(c.id))
    : COMMITTEES;

  const firstTemplate = DELIBERATION_TEMPLATES[0];
  const firstOwnerId = restrictCommittees
    ? (committeeOptions[0]?.id ?? firstTemplate?.ownerCommitteeId ?? 'board')
    : (firstTemplate?.ownerCommitteeId ?? 'board');
  const firstRule = VOTING_RULES_BY_COMMITTEE[firstOwnerId] ?? VOTING_RULES_BY_COMMITTEE.board;

  const [form, setForm] = useState({
    templateId: firstTemplate?.id ?? '',
    businessArea: 'HR',
    title: '',
    description: '',
    financialImpact: 0,
    marginPercent: 30,
    outsideBudget: false,
    aggressivePaymentTerms: false,
    strategicFlag: false,
    priority: 'medium' as Priority,
    riskLevel: 'medium' as RiskLevel,
    deadline: '',
    linkedProjectSel: '',
    linkedProject: '',
    linkedContractSel: '',
    linkedContract: '',
    responsibleCommitteeId: firstOwnerId,
    votingCommitteeIds: [] as string[],
    quorumPercent: firstRule.quorumPercent,
    approvalRule: firstRule.majorityType as MajorityType,
    votingWindowHours: firstRule.votingWindowHours,
    requiresMinutes: true,
    requiresEvidence: true,
    requiresExecutionFollowUp: true,
  });

  const patch = (next: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...next }));

  // Projetos e contratos já cadastrados, para vincular sem redigitar.
  const [projectOptions, setProjectOptions] = useState<LinkOption[]>([]);
  const [contractOptions, setContractOptions] = useState<LinkOption[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getProjectsAsync()
      .then((projects) => {
        if (cancelled) return;
        setProjectOptions(
          projects.map((p) => ({ id: p.id, label: p.codigo ? `${p.codigo} · ${p.nome}` : p.nome })),
        );
      })
      .catch(() => {});
    void listContracts()
      .then((contracts) => {
        if (cancelled) return;
        setContractOptions(
          contracts.map((c) => ({ id: c.id, label: c.contract_number ? `${c.contract_number} · ${c.title}` : c.title })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Garante que o comitê responsável esteja entre os permitidos — cobre a
  // chegada assíncrona de `allowedCommitteeIds` e qualquer deriva de estado.
  useEffect(() => {
    if (!open || !restrictCommittees) return;
    if (allowedCommitteeIds!.includes(form.responsibleCommitteeId)) return;
    const cid = committeeOptions[0]?.id;
    if (!cid) return;
    const rule = VOTING_RULES_BY_COMMITTEE[cid] ?? VOTING_RULES_BY_COMMITTEE.board;
    setForm((prev) => ({
      ...prev,
      responsibleCommitteeId: cid,
      quorumPercent: rule.quorumPercent,
      approvalRule: rule.majorityType,
      votingWindowHours: rule.votingWindowHours,
      votingCommitteeIds: prev.votingCommitteeIds.filter((id) => id !== cid),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, restrictCommittees, allowedCommitteeIds, form.responsibleCommitteeId]);

  // Resolve o rótulo final do vínculo: item existente, texto novo ou nada.
  const resolveLinkLabel = (sel: string, custom: string, options: LinkOption[]): string | null => {
    if (sel === NEW_LINK) return custom.trim() || null;
    if (!sel) return null;
    return options.find((o) => o.id === sel)?.label ?? null;
  };

  const template = useMemo(() => resolveTemplate(form.templateId), [form.templateId]);
  const profile = useMemo(() => getTemplateProfile(form.templateId), [form.templateId]);

  const responsible = COMMITTEES.find((c) => c.id === form.responsibleCommitteeId) ?? COMMITTEES[0];
  const votingCommittees = COMMITTEES.filter((c) => form.votingCommitteeIds.includes(c.id));

  // Visibilidade dos campos financeiros/comerciais por tipo de decisão.
  const commercial = isCommercialTemplate(form.templateId);
  const showFinancialImpact = profile.showFinancialImpact;
  const showAdditionalBudget = profile.showAdditionalBudget;
  const showMargin = commercial && profile.showMargin;
  const showCommercialRisk = commercial;
  const showFinancialSection = showFinancialImpact || showAdditionalBudget || showMargin || showCommercialRisk;
  const financialSectionTitle = commercial ? 'Impacto financeiro & comercial' : 'Impacto financeiro';

  // Rótulos finais dos vínculos (item existente, texto novo ou nada).
  const linkedProjectLabel = resolveLinkLabel(form.linkedProjectSel, form.linkedProject, projectOptions);
  const linkedContractLabel = resolveLinkLabel(form.linkedContractSel, form.linkedContract, contractOptions);

  // Selecionar template → reposiciona comitê responsável, regras de voto padrão
  // e sugere comitês votantes conforme a política.
  const onTemplateChange = (templateId: string) => {
    const tpl = resolveTemplate(templateId);
    // Quando o comitê responsável é restrito ao criador, o template não o
    // reposiciona — mantém o comitê do usuário e apenas recalcula regras/deps.
    const ownerId = restrictCommittees
      ? form.responsibleCommitteeId
      : (tpl?.ownerCommitteeId ?? form.responsibleCommitteeId);
    const rule = VOTING_RULES_BY_COMMITTEE[ownerId] ?? VOTING_RULES_BY_COMMITTEE.board;
    const suggested = computeDependentCommittees({
      ownerCommitteeId: ownerId,
      riskLevel: form.riskLevel,
      financialImpact: form.financialImpact,
      outsideBudget: form.outsideBudget,
      marginPercent: form.marginPercent,
      aggressivePaymentTerms: form.aggressivePaymentTerms,
      strategicFlag: form.strategicFlag,
    });
    patch({
      templateId,
      responsibleCommitteeId: ownerId,
      quorumPercent: rule.quorumPercent,
      approvalRule: rule.majorityType,
      votingWindowHours: rule.votingWindowHours,
      votingCommitteeIds: suggested.filter((id) => id !== ownerId),
    });
  };

  const onResponsibleChange = (committeeId: string) => {
    const rule = VOTING_RULES_BY_COMMITTEE[committeeId] ?? VOTING_RULES_BY_COMMITTEE.board;
    patch({
      responsibleCommitteeId: committeeId,
      quorumPercent: rule.quorumPercent,
      approvalRule: rule.majorityType,
      votingWindowHours: rule.votingWindowHours,
      votingCommitteeIds: form.votingCommitteeIds.filter((id) => id !== committeeId),
    });
  };

  const toggleVotingCommittee = (committeeId: string) => {
    if (committeeId === form.responsibleCommitteeId) return; // dedupe: responsável já vota
    setForm((prev) => ({
      ...prev,
      votingCommitteeIds: prev.votingCommitteeIds.includes(committeeId)
        ? prev.votingCommitteeIds.filter((id) => id !== committeeId)
        : [...prev.votingCommitteeIds, committeeId],
    }));
  };

  const suggestCommittees = () => {
    const suggested = computeDependentCommittees({
      ownerCommitteeId: form.responsibleCommitteeId,
      riskLevel: form.riskLevel,
      financialImpact: form.financialImpact,
      outsideBudget: form.outsideBudget,
      marginPercent: form.marginPercent,
      aggressivePaymentTerms: form.aggressivePaymentTerms,
      strategicFlag: form.strategicFlag,
    });
    patch({ votingCommitteeIds: suggested.filter((id) => id !== form.responsibleCommitteeId) });
  };

  const routingInput = {
    ownerCommitteeId: form.responsibleCommitteeId,
    riskLevel: form.riskLevel,
    financialImpact: form.financialImpact,
    outsideBudget: form.outsideBudget,
    marginPercent: form.marginPercent,
    aggressivePaymentTerms: form.aggressivePaymentTerms,
    strategicFlag: form.strategicFlag,
  };
  const includeBoard = boardRequired(routingInput);

  const stages = useMemo(
    () =>
      buildCustomStagePlan({
        ownerCommitteeId: form.responsibleCommitteeId,
        votingCommitteeIds: form.votingCommitteeIds,
        includeBoard,
        quorumPercent: form.quorumPercent,
        majorityType: form.approvalRule,
        votingWindowHours: form.votingWindowHours,
      }),
    [form.responsibleCommitteeId, form.votingCommitteeIds, includeBoard, form.quorumPercent, form.approvalRule, form.votingWindowHours],
  );

  const votingStages = stages.filter((s) => s.stageType !== 'publish_minutes' && s.stageType !== 'execution');

  // Votantes esperados = soma dos assentos dos comitês que efetivamente votam.
  const expectedVoters = votingStages.reduce((sum, s) => sum + committeeSeats(s.committeeId), 0);

  // Comitês votantes adicionais (fora o responsável), já deduplicados.
  const additionalVotingStages = votingStages.filter((s) => s.stageType !== 'owner_review');

  // Roteamento inteligente: calcula a rota recomendada (rascunho / revisão /
  // votação direta) a partir da completude e dos gatilhos de política.
  const routeResult = useMemo(
    () =>
      computeCreationRoute({
        templateId: form.templateId,
        title: form.title,
        description: form.description,
        businessArea: form.businessArea,
        ownerCommitteeId: form.responsibleCommitteeId,
        votingCommitteeCount: votingStages.length,
        quorumPercent: form.quorumPercent,
        votingWindowHours: form.votingWindowHours,
        deadline: form.deadline || null,
        riskLevel: form.riskLevel,
        financialImpact: showFinancialImpact ? form.financialImpact : 0,
        outsideBudget: showAdditionalBudget ? form.outsideBudget : false,
        aggressivePaymentTerms: showCommercialRisk ? form.aggressivePaymentTerms : false,
        strategicFlag: form.strategicFlag,
        isCommercial: commercial,
      }),
    [
      form.templateId,
      form.title,
      form.description,
      form.businessArea,
      form.responsibleCommitteeId,
      votingStages.length,
      form.quorumPercent,
      form.votingWindowHours,
      form.deadline,
      form.riskLevel,
      form.financialImpact,
      form.outsideBudget,
      form.aggressivePaymentTerms,
      form.strategicFlag,
      showFinancialImpact,
      showAdditionalBudget,
      showCommercialRisk,
      commercial,
    ],
  );

  // Rota efetiva: override manual, se válido; senão a recomendada.
  const effectiveRoute: CreationRoute = (() => {
    const r = routeOverride ?? routeResult.recommended;
    if (r === 'voting' && !routeResult.canVote) return routeResult.canReview ? 'review' : 'draft';
    if (r === 'review' && !routeResult.canReview) return 'draft';
    return r;
  })();

  // Alertas exibidos antes de criar a decisão (Step 3).
  const warnings = [
    !linkedProjectLabel && 'Nenhum projeto vinculado à decisão.',
    !linkedContractLabel && 'Nenhum contrato vinculado à decisão.',
    (form.riskLevel === 'high' || form.riskLevel === 'critical') && 'Decisão de alto risco — reforce evidências e aprovação.',
    additionalVotingStages.length === 0 && 'Sem comitê votante adicional — apenas o responsável delibera.',
    !form.deadline && 'Prazo da decisão não definido.',
  ].filter(Boolean) as string[];

  // ---- Validação -----------------------------------------------------------
  const validateStep1 = () => {
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = 'Informe o título da decisão.';
    if (!form.templateId) next.templateId = 'Selecione o tipo de decisão.';
    if (!form.businessArea) next.businessArea = 'Selecione a área de negócio.';
    if (!form.description.trim()) next.description = 'Descreva o resumo executivo / justificativa.';
    if (!form.deadline) next.deadline = 'Defina o prazo da decisão.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const validateStep2 = () => {
    const next: Record<string, string> = {};
    if (!form.responsibleCommitteeId) next.responsibleCommitteeId = 'Selecione o comitê responsável.';
    if (votingStages.length === 0) next.voting = 'Configure ao menos um comitê votante.';
    if (!(form.quorumPercent >= 1 && form.quorumPercent <= 100)) next.quorumPercent = 'Quórum deve estar entre 1% e 100%.';
    if (!(form.votingWindowHours >= 1)) next.votingWindowHours = 'Janela de votação deve ser maior que zero.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const goNext = () => {
    if (step === 1) {
      if (validateStep1()) {
        setStep(2);
        setErrors({});
      }
    } else if (step === 2) {
      if (validateStep2()) {
        setStep(3);
        setErrors({});
      }
    }
  };

  const resetAndClose = () => {
    setStep(1);
    setErrors({});
    setRouteOverride(null);
    onOpenChange(false);
  };

  const handleCreate = () => {
    if (!validateStep1()) {
      setStep(1);
      return;
    }
    if (!validateStep2()) {
      setStep(2);
      return;
    }
    // Guardas por rota: votação direta exige tudo completo e sem gatilho de
    // revisão; envio para revisão exige os dados básicos.
    if (effectiveRoute === 'voting' && !routeResult.canVote) return;
    if (effectiveRoute === 'review' && !routeResult.canReview) return;
    const dependent = form.votingCommitteeIds.filter((id) => id !== form.responsibleCommitteeId && id !== 'board');
    onCreateDeliberation({
      title: form.title.trim(),
      description: form.description.trim(),
      templateId: form.templateId,
      businessArea: form.businessArea,
      financialImpact: showFinancialImpact ? form.financialImpact : 0,
      riskLevel: form.riskLevel,
      priority: form.priority,
      strategicFlag: form.strategicFlag,
      outsideBudget: showAdditionalBudget ? form.outsideBudget : false,
      marginPercent: showMargin ? form.marginPercent : 100,
      aggressivePaymentTerms: showCommercialRisk ? form.aggressivePaymentTerms : false,
      ownerCommitteeId: form.responsibleCommitteeId,
      ownerCommitteeName: responsible.name,
      dependentCommitteeIds: dependent,
      dependentCommitteeNames: dependent.map((id) => COMMITTEES.find((c) => c.id === id)?.name ?? id),
      votingCommitteeIds: form.votingCommitteeIds,
      votingCommitteeNames: votingCommittees.map((c) => c.name),
      quorumPercent: form.quorumPercent,
      approvalRule: form.approvalRule,
      votingWindowHours: form.votingWindowHours,
      requiresMinutes: form.requiresMinutes,
      requiresEvidence: form.requiresEvidence,
      requiresExecutionFollowUp: form.requiresExecutionFollowUp,
      deadline: form.deadline || null,
      linkedProjectLabel,
      linkedContractLabel,
      stages,
      route: effectiveRoute,
    });
    resetAndClose();
  };

  const steps = [
    { n: 1, label: 'Contexto' },
    { n: 2, label: 'Comitê & Votação' },
    { n: 3, label: 'Revisão' },
  ] as const;

  const votingCommitteesSummary =
    additionalVotingStages.length > 0
      ? additionalVotingStages.map((s) => s.committeeName).join(', ')
      : includeBoard
        ? 'Diretoria Executiva (política)'
        : 'Somente responsável';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="flush" className="max-h-[90vh] w-[calc(100vw-1.5rem)] border-ig-border-strong bg-ig-raised sm:max-w-[900px]">
        {/* Cabeçalho fixo + stepper (sempre visível) */}
        <div className="shrink-0 border-b border-ig-border-subtle px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-xl text-ig-fg-strong">Nova Deliberação</DialogTitle>
            <DialogDescription className="text-ig-fg-muted">
              Registre uma decisão de comitê com contexto, fluxo de aprovação e votação.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex items-center gap-2">
            {steps.map((s, idx) => (
              <React.Fragment key={s.n}>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                      step >= s.n ? 'bg-ig-accent text-ig-fg-strong' : 'bg-ig-panel/60 text-ig-fg-muted',
                    )}
                  >
                    {step > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
                  </span>
                  <span className={cn('hidden text-xs font-medium sm:inline', step >= s.n ? 'text-ig-fg-strong' : 'text-ig-fg-subtle')}>
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && <span className="h-px flex-1 bg-ig-border-default" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Corpo rolável */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {/* -------------------------------------------------------------- */}
          {/* STEP 1 — Contexto da decisão                                   */}
          {/* -------------------------------------------------------------- */}
          {step === 1 && (
            <div className="space-y-5">
              <SectionTitle icon={Building2} title="Contexto da decisão" hint="Defina o tipo, a área e o que está sendo decidido." />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className={labelCls}>Tipo de decisão / template</Label>
                  <Select value={form.templateId} onValueChange={onTemplateChange}>
                    <SelectTrigger className={selectTrigger}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={selectContent}>
                      {DELIBERATION_TEMPLATES.map((item) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={errors.templateId} />
                </div>

                <div className="space-y-2">
                  <Label className={labelCls}>Área de negócio</Label>
                  <Select value={form.businessArea} onValueChange={(value) => patch({ businessArea: value })}>
                    <SelectTrigger className={selectTrigger}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={selectContent}>
                      {BUSINESS_AREAS.map((area) => (
                        <SelectItem key={area.value} value={area.value}>{area.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError message={errors.businessArea} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className={labelCls}>Título</Label>
                <HudInput
                  value={form.title}
                  onChange={(event) => patch({ title: event.target.value })}
                  placeholder="Ex.: Contratação de Diretor de Operações"
                />
                <FieldError message={errors.title} />
              </div>

              <div className="space-y-2">
                <Label className={labelCls}>Resumo executivo / justificativa</Label>
                <Textarea
                  value={form.description}
                  onChange={(event) => patch({ description: event.target.value })}
                  rows={4}
                  className={cn(hudInputBase, 'min-h-[104px]')}
                  placeholder="Descreva o contexto, a decisão solicitada e o racional para o comitê."
                />
                <FieldError message={errors.description} />
              </div>

              <div className="space-y-2 sm:max-w-xs">
                <Label className={labelCls}>Prazo da decisão</Label>
                <HudInput type="date" value={form.deadline} onChange={(event) => patch({ deadline: event.target.value })} />
                <FieldError message={errors.deadline} />
              </div>

              {/* Impacto financeiro (& comercial p/ tipos comerciais) */}
              {showFinancialSection && (
                <div className={cn(panel, 'space-y-4 p-4')}>
                  <SectionTitle
                    icon={commercial ? ShieldCheck : Wallet}
                    title={financialSectionTitle}
                    hint={commercial ? 'Valores, margem e risco comercial/contratual.' : 'Valores e orçamento da decisão.'}
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {showFinancialImpact && (
                      <div className="space-y-2">
                        <Label className={labelCls}>Impacto financeiro estimado (R$) <span className="text-ig-fg-subtle">(opcional)</span></Label>
                        <HudInput
                          type="number"
                          value={String(form.financialImpact)}
                          onChange={(event) => patch({ financialImpact: Number(event.target.value || 0) })}
                        />
                      </div>
                    )}
                    {showMargin && (
                      <div className="space-y-2">
                        <Label className={labelCls}>Margem estimada (%)</Label>
                        <HudInput
                          type="number"
                          value={String(form.marginPercent)}
                          onChange={(event) => patch({ marginPercent: Number(event.target.value || 0) })}
                        />
                      </div>
                    )}
                  </div>
                  {(showAdditionalBudget || showCommercialRisk) && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {showAdditionalBudget && (
                        <ToggleRow
                          label="Requer orçamento adicional?"
                          checked={form.outsideBudget}
                          onChange={(value) => patch({ outsideBudget: value })}
                        />
                      )}
                      {showCommercialRisk && (
                        <ToggleRow
                          label="Alto risco comercial/contratual?"
                          checked={form.aggressivePaymentTerms}
                          onChange={(value) => patch({ aggressivePaymentTerms: value })}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Classificação da decisão */}
              <div className={cn(panel, 'space-y-4 p-4')}>
                <SectionTitle icon={Tag} title="Classificação da decisão" hint="Prioridade, risco e caráter estratégico." />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className={labelCls}>Prioridade</Label>
                    <Select value={form.priority} onValueChange={(value: Priority) => patch({ priority: value })}>
                      <SelectTrigger className={selectTrigger}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={selectContent}>
                        {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                          <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className={labelCls}>Nível de risco</Label>
                    <Select
                      value={form.riskLevel}
                      onValueChange={(value: RiskLevel) => patch({ riskLevel: value, priority: priorityFromRisk(value) })}
                    >
                      <SelectTrigger className={selectTrigger}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={selectContent}>
                        {(Object.keys(RISK_LABELS) as RiskLevel[]).map((r) => (
                          <SelectItem key={r} value={r}>{RISK_LABELS[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <ToggleRow
                  label="Decisão estratégica?"
                  checked={form.strategicFlag}
                  onChange={(value) => patch({ strategicFlag: value })}
                />
              </div>

              {/* Vínculos (opcional) */}
              <div className={cn(panel, 'space-y-4 p-4')}>
                <SectionTitle icon={Link2} title="Vínculos" hint="Associe a decisão a um projeto e/ou contrato (opcional)." />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className={labelCls}>Projeto vinculado</Label>
                    <Select value={form.linkedProjectSel} onValueChange={(value) => patch({ linkedProjectSel: value })}>
                      <SelectTrigger className={selectTrigger}>
                        <SelectValue placeholder="Selecione um projeto cadastrado" />
                      </SelectTrigger>
                      <SelectContent className={selectContent}>
                        {projectOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                        ))}
                        <SelectItem value={NEW_LINK}>➕ Novo projeto (digitar)</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.linkedProjectSel === NEW_LINK && (
                      <HudInput
                        value={form.linkedProject}
                        onChange={(event) => patch({ linkedProject: event.target.value })}
                        placeholder="Nome ou código do novo projeto"
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className={labelCls}>Contrato vinculado</Label>
                    <Select value={form.linkedContractSel} onValueChange={(value) => patch({ linkedContractSel: value })}>
                      <SelectTrigger className={selectTrigger}>
                        <SelectValue placeholder="Selecione um contrato cadastrado" />
                      </SelectTrigger>
                      <SelectContent className={selectContent}>
                        {contractOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                        ))}
                        <SelectItem value={NEW_LINK}>➕ Novo contrato (digitar)</SelectItem>
                      </SelectContent>
                    </Select>
                    {form.linkedContractSel === NEW_LINK && (
                      <HudInput
                        value={form.linkedContract}
                        onChange={(event) => patch({ linkedContract: event.target.value })}
                        placeholder="Nome ou nº do novo contrato"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* -------------------------------------------------------------- */}
          {/* STEP 2 — Comitê & Votação                                      */}
          {/* -------------------------------------------------------------- */}
          {step === 2 && (
            <div className="space-y-5">
              <SectionTitle icon={Users} title="Comitê & votação" hint="Defina quem delibera e as regras de votação." />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className={labelCls}>Comitê responsável</Label>
                  <Select value={form.responsibleCommitteeId} onValueChange={onResponsibleChange}>
                    <SelectTrigger className={selectTrigger}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={selectContent}>
                      {committeeOptions.map((committee) => (
                        <SelectItem key={committee.id} value={committee.id}>{committee.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {restrictCommittees && (
                    <p className="text-[10px] text-ig-fg-subtle">Limitado aos comitês em que você participa.</p>
                  )}
                  <FieldError message={errors.responsibleCommitteeId} />
                </div>
              </div>

              {/* Comitês votantes (multi-select) */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className={labelCls}>Comitês votantes <span className="text-ig-fg-subtle">({additionalVotingStages.length} selecionado{additionalVotingStages.length === 1 ? '' : 's'})</span></Label>
                  <button
                    type="button"
                    onClick={suggestCommittees}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-ig-accent/40 bg-ig-accent-weak px-2.5 py-1.5 text-xs font-medium text-ig-accent transition-colors hover:bg-ig-accent/15"
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Sugerir pela política
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {COMMITTEES.filter((c) => c.id !== form.responsibleCommitteeId).map((committee) => {
                    const active = form.votingCommitteeIds.includes(committee.id);
                    return (
                      <button
                        key={committee.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleVotingCommittee(committee.id)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          active
                            ? 'border-ig-accent bg-ig-accent-weak text-ig-accent shadow-[0_0_0_1px_var(--ig-accent)]'
                            : 'border-ig-border-strong text-ig-fg-muted hover:border-ig-fg-subtle',
                        )}
                      >
                        {active && <Check className="h-3 w-3" />}
                        {committee.name}
                        <span className="opacity-60">· {committee.seats}</span>
                      </button>
                    );
                  })}
                </div>
                <FieldError message={errors.voting} />
              </div>

              {/* Resumo consolidado da votação */}
              <div className={cn(panel, 'p-4')}>
                <div className="mb-3 flex items-center gap-2">
                  <Vote className="h-4 w-4 text-ig-accent" />
                  <p className="text-xs font-semibold uppercase tracking-wide text-ig-fg-subtle">Resumo da votação</p>
                </div>
                <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  <SummaryRow label="Responsável" value={responsible.name} />
                  <SummaryRow label="Votantes" value={votingCommitteesSummary} />
                  <SummaryRow label="Quórum" value={`${form.quorumPercent}%`} />
                  <SummaryRow label="Aprovação" value={MAJORITY_TYPE_LABELS[form.approvalRule]} />
                  <SummaryRow label="Janela" value={`${form.votingWindowHours}h`} />
                  <SummaryRow label="Votantes esperados" value={`≈ ${expectedVoters} assentos`} />
                </div>
              </div>

              {/* Regras por comitê (deduplicadas) */}
              <div className={cn(panel, 'divide-y divide-ig-border-subtle')}>
                {votingStages.map((stage) => {
                  const isOwner = stage.stageType === 'owner_review';
                  const isBoard = stage.stageType === 'final_approval';
                  const seats = committeeSeats(stage.committeeId);
                  const headcount = quorumHeadcount(stage.committeeId, stage.votingRule.quorumPercent);
                  return (
                    <div key={stage.id} className="flex flex-col gap-1 p-3.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ig-fg-strong">{stage.committeeName}</span>
                        <span className="rounded-full bg-ig-panel/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ig-fg-subtle">
                          {isOwner ? 'Responsável' : isBoard ? 'Aprovação final' : 'Votante'}
                        </span>
                      </div>
                      <p className="text-xs text-ig-fg-muted">
                        Quórum {stage.votingRule.quorumPercent}% ({headcount} de {seats}) · {MAJORITY_TYPE_LABELS[stage.votingRule.majorityType]} · Janela {stage.votingRule.votingWindowHours}h
                      </p>
                    </div>
                  );
                })}
                {includeBoard && !form.votingCommitteeIds.includes('board') && (
                  <p className="p-3 text-xs text-ig-fg-subtle">
                    A Diretoria Executiva foi adicionada como aprovação final pela política (decisão estratégica ou de alto valor).
                  </p>
                )}
              </div>

              {/* Regras de votação do comitê responsável */}
              <div className={cn(panel, 'space-y-4 p-4')}>
                <SectionTitle icon={Vote} title="Regras de votação" hint="Aplicadas ao comitê responsável." />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label className={labelCls}>Quórum exigido (%)</Label>
                    <HudInput
                      type="number"
                      value={String(form.quorumPercent)}
                      onChange={(event) => patch({ quorumPercent: Number(event.target.value || 0) })}
                    />
                    <p className="text-[10px] text-ig-fg-subtle">
                      ≈ {quorumHeadcount(form.responsibleCommitteeId, form.quorumPercent)} de {committeeSeats(form.responsibleCommitteeId)} assentos
                    </p>
                    <FieldError message={errors.quorumPercent} />
                  </div>
                  <div className="space-y-2">
                    <Label className={labelCls}>Regra de aprovação</Label>
                    <Select value={form.approvalRule} onValueChange={(value: MajorityType) => patch({ approvalRule: value })}>
                      <SelectTrigger className={selectTrigger}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={selectContent}>
                        {(Object.keys(MAJORITY_TYPE_LABELS) as MajorityType[]).map((m) => (
                          <SelectItem key={m} value={m}>{MAJORITY_TYPE_LABELS[m]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className={labelCls}>Janela de votação (h)</Label>
                    <HudInput
                      type="number"
                      value={String(form.votingWindowHours)}
                      onChange={(event) => patch({ votingWindowHours: Number(event.target.value || 0) })}
                    />
                    <FieldError message={errors.votingWindowHours} />
                  </div>
                </div>
              </div>

              {/* Requisitos de governança */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ToggleRow label="Exige ata" checked={form.requiresMinutes} onChange={(value) => patch({ requiresMinutes: value })} />
                <ToggleRow label="Exige evidências" checked={form.requiresEvidence} onChange={(value) => patch({ requiresEvidence: value })} />
                <ToggleRow label="Acompanhar execução" checked={form.requiresExecutionFollowUp} onChange={(value) => patch({ requiresExecutionFollowUp: value })} />
              </div>
            </div>
          )}

          {/* -------------------------------------------------------------- */}
          {/* STEP 3 — Revisão                                               */}
          {/* -------------------------------------------------------------- */}
          {step === 3 && (
            <div className="space-y-4">
              <SectionTitle icon={ScrollText} title="Revisão da deliberação" hint="Confirme os dados antes de criar." />

              {warnings.length > 0 && (
                <div className="rounded-xl border border-ig-warning/40 bg-ig-warning/10 p-3.5">
                  <div className="mb-2 flex items-center gap-2 text-ig-warning">
                    <AlertTriangle className="h-4 w-4" />
                    <p className="text-xs font-semibold uppercase tracking-wide">Pontos de atenção</p>
                  </div>
                  <ul className="space-y-1">
                    {warnings.map((w) => (
                      <li key={w} className="flex items-start gap-2 text-sm text-ig-fg-default">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ig-warning" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <SummaryCard icon={Building2} title="Contexto">
                  <SummaryRow label="Título" value={form.title || '—'} />
                  <SummaryRow label="Área" value={BUSINESS_AREAS.find((a) => a.value === form.businessArea)?.label ?? form.businessArea} />
                  <SummaryRow label="Tipo" value={template?.name ?? form.templateId} />
                  <SummaryRow label="Prioridade" value={PRIORITY_LABELS[form.priority]} />
                  <SummaryRow label="Risco" value={RISK_LABELS[form.riskLevel]} />
                  <SummaryRow label="Prazo" value={form.deadline || '—'} />
                  <SummaryRow label="Estratégica" value={form.strategicFlag ? 'Sim' : 'Não'} />
                </SummaryCard>

                <SummaryCard icon={Users} title="Comitê & votação">
                  <SummaryRow label="Responsável" value={responsible.name} />
                  <SummaryRow label="Votantes" value={votingCommitteesSummary} />
                  <SummaryRow label="Quórum" value={`${form.quorumPercent}% (${quorumHeadcount(form.responsibleCommitteeId, form.quorumPercent)} de ${committeeSeats(form.responsibleCommitteeId)})`} />
                  <SummaryRow label="Aprovação" value={MAJORITY_TYPE_LABELS[form.approvalRule]} />
                  <SummaryRow label="Janela" value={`${form.votingWindowHours}h`} />
                  <SummaryRow label="Votantes esperados" value={`≈ ${expectedVoters} assentos`} />
                </SummaryCard>

                <SummaryCard icon={ListChecks} title="Requisitos">
                  <SummaryRow label="Ata" value={form.requiresMinutes ? 'Sim' : 'Não'} />
                  <SummaryRow label="Evidências" value={form.requiresEvidence ? 'Sim' : 'Não'} />
                  <SummaryRow label="Acompanhar execução" value={form.requiresExecutionFollowUp ? 'Sim' : 'Não'} />
                </SummaryCard>

                <SummaryCard icon={Wallet} title="Vínculos & impacto">
                  <SummaryRow label="Projeto" value={linkedProjectLabel ?? '—'} />
                  <SummaryRow label="Contrato" value={linkedContractLabel ?? '—'} />
                  {showFinancialImpact && (
                    <SummaryRow label="Impacto financeiro" value={form.financialImpact > 0 ? `R$ ${form.financialImpact.toLocaleString('pt-BR')}` : '—'} />
                  )}
                  {showMargin && <SummaryRow label="Margem" value={`${form.marginPercent}%`} />}
                  {showAdditionalBudget && <SummaryRow label="Orçamento adicional" value={form.outsideBudget ? 'Sim' : 'Não'} />}
                  {showCommercialRisk && <SummaryRow label="Risco comercial" value={form.aggressivePaymentTerms ? 'Sim' : 'Não'} />}
                </SummaryCard>
              </div>

              {/* Rota de criação — roteamento inteligente */}
              <div className={cn(panel, 'space-y-3 p-4')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SectionTitle icon={Route} title="Rota de criação" hint="Como esta decisão entra no fluxo." />
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ig-accent/40 bg-ig-accent-weak px-2.5 py-1 text-[11px] font-semibold text-ig-accent">
                    <Sparkles className="h-3.5 w-3.5" />
                    Recomendado: {ROUTE_META[routeResult.recommended].label}
                  </span>
                </div>

                {/* Por quê */}
                {routeResult.reasons.length > 0 && (
                  <ul className="space-y-1">
                    {routeResult.reasons.map((r) => (
                      <li key={r} className="flex items-start gap-2 text-xs text-ig-fg-muted">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ig-accent" />
                        {r}
                      </li>
                    ))}
                  </ul>
                )}

                {/* Opções de rota */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {(['draft', 'review', 'voting'] as CreationRoute[]).map((r) => {
                    const meta = ROUTE_META[r];
                    const disabled = (r === 'voting' && !routeResult.canVote) || (r === 'review' && !routeResult.canReview);
                    const active = effectiveRoute === r;
                    const RouteIcon = meta.icon;
                    return (
                      <button
                        key={r}
                        type="button"
                        disabled={disabled}
                        aria-pressed={active}
                        onClick={() => setRouteOverride(r)}
                        className={cn(
                          'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                          active
                            ? 'border-ig-accent bg-ig-accent-weak shadow-[0_0_0_1px_var(--ig-accent)]'
                            : 'border-ig-border-default bg-ig-panel/30 hover:border-ig-fg-subtle',
                          disabled && 'cursor-not-allowed opacity-40 hover:border-ig-border-default',
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium text-ig-fg-strong">
                          <RouteIcon className="h-4 w-4 text-ig-accent" />
                          {meta.label}
                          {r === routeResult.recommended && (
                            <Check className="ml-auto h-3.5 w-3.5 text-ig-accent" />
                          )}
                        </span>
                        <span className="text-[11px] leading-snug text-ig-fg-subtle">{meta.hint}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Explicação de bloqueio */}
                {effectiveRoute !== 'voting' && routeResult.missingForVoting.length > 0 && (
                  <p className="flex items-start gap-1.5 text-[11px] text-ig-fg-subtle">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    Votação direta indisponível — faltam: {routeResult.missingForVoting.join(', ')}.
                  </p>
                )}
                {effectiveRoute !== 'voting' && routeResult.missingForVoting.length === 0 && routeResult.reviewTriggers.length > 0 && (
                  <p className="flex items-start gap-1.5 text-[11px] text-ig-fg-subtle">
                    <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    {routeResult.reviewTriggers[0]}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Rodapé fixo (sempre visível, desktop e mobile) */}
        <div className="shrink-0 border-t border-ig-border-subtle bg-ig-raised px-5 py-4 sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {step > 1 && (
                <SecondaryButton onClick={() => { setStep((s) => (s - 1) as 1 | 2 | 3); setErrors({}); }}>
                  Voltar
                </SecondaryButton>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={resetAndClose} className="text-ig-fg-muted">
                Cancelar
              </Button>
              {step < 3 ? (
                <PrimaryCTA onClick={goNext}>Continuar</PrimaryCTA>
              ) : (
                <PrimaryCTA onClick={handleCreate}>{ROUTE_META[effectiveRoute].cta}</PrimaryCTA>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
