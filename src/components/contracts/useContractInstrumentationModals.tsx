'use client';

/**
 * Modais de instrumentação operacional (P2B) — marcos de medição, cláusulas e
 * penalidades.
 *
 * Os três domínios existem em `contract_milestones`, `contract_clauses` e
 * `contract_penalties` desde a migration 006 e, até aqui, eram lidos em três
 * pontos do produto e escritos em nenhum. Estes são os caminhos de escrita.
 *
 * Nada aqui EXTRAI cláusula: o registro é manual e estruturado. `ai_flagged`
 * nasce `false` e `review_status` nasce `draft` no serviço — registrar não é
 * validar, e o dia em que houver extração automática o campo já separa o que a
 * máquina propôs do que uma pessoa afirmou.
 *
 * RBAC é do chamador (só passa os openers quando permitido); a RLS de 006
 * reforça `contracts.edit` no servidor.
 */

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { HudModal, HudButton, HudInput, HudSelect } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import {
  createContractMilestone,
  updateContractMilestone,
  createBillingEventFromMilestone,
  createContractClause,
  createContractPenalty,
  reviewContractClause,
  supersedeContractClause,
  MILESTONE_STATUS_LABEL,
  type ContractMilestoneRow,
  type ContractMilestoneStatus,
  type ContractClauseRow,
  type ClauseReviewStatus,
  type ContractDocumentRow,
  listOrganizationMembers,
  type OrganizationMember,
} from '@/lib/contracts/contract-service';

type Kind = 'milestone' | 'clause' | 'penalty' | 'review' | 'supersede';

const MILESTONE_STATUS_OPTIONS = (Object.keys(MILESTONE_STATUS_LABEL) as ContractMilestoneStatus[])
  .map((value) => ({ value, label: MILESTONE_STATUS_LABEL[value] }));

const CLAUSE_TYPES = [
  { value: 'renovacao', label: 'Renovação e denúncia' },
  { value: 'pagamento', label: 'Condições de pagamento' },
  { value: 'sla', label: 'SLA e nível de serviço' },
  { value: 'penalidade', label: 'Penalidade e multa' },
  { value: 'reajuste', label: 'Reajuste' },
  { value: 'garantia', label: 'Garantia' },
  { value: 'rescisao', label: 'Rescisão' },
  { value: 'confidencialidade', label: 'Confidencialidade' },
  { value: 'outra', label: 'Outra' },
];

const RISK_LEVELS = [
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
];

const REVIEW_OPTIONS = [
  { value: 'in_review', label: 'Marcar em revisão' },
  { value: 'validated', label: 'Validar cláusula' },
  { value: 'rejected', label: 'Rejeitar cláusula' },
];

const textareaClass =
  'w-full rounded-lg border hud-input-bg hud-text p-3 text-sm leading-relaxed focus:border-ig-border-focus focus:outline-none';

export interface ContractInstrumentationModals {
  openMilestone: (milestone?: ContractMilestoneRow) => void;
  openClause: () => void;
  openPenalty: (clause?: ContractClauseRow) => void;
  openReview: (clause: ContractClauseRow) => void;
  /** Corrige uma proposta: cria a versão vigente e marca a original substituída. */
  openSupersede: (clause: ContractClauseRow) => void;
  modals: React.ReactNode;
}

export function useContractInstrumentationModals({
  contractId,
  documents = [],
  clauses = [],
  onRefresh,
}: {
  contractId: string;
  /** Documentos do contrato, do módulo dono — para referenciar evidência. */
  documents?: readonly ContractDocumentRow[];
  /** Cláusulas já registradas, para vincular a penalidade à sua origem. */
  clauses?: readonly ContractClauseRow[];
  onRefresh: () => Promise<void> | void;
}): ContractInstrumentationModals {
  const { notify } = useHudToast();
  const [kind, setKind] = useState<Kind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<ContractMilestoneRow | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ContractClauseRow | null>(null);
  const [supersedeTarget, setSupersedeTarget] = useState<ContractClauseRow | null>(null);

  // Campos compartilhados
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [amount, setAmount] = useState('');

  // Marco
  const [milestoneType, setMilestoneType] = useState('');
  const [status, setStatus] = useState<ContractMilestoneStatus>('pending');
  const [measuredAmount, setMeasuredAmount] = useState('');
  const [evidence, setEvidence] = useState('');
  const [evidenceDocId, setEvidenceDocId] = useState('');
  const [generateBilling, setGenerateBilling] = useState(false);

  // Cláusula
  const [clauseType, setClauseType] = useState('renovacao');
  const [riskLevel, setRiskLevel] = useState('medium');
  const [content, setContent] = useState('');
  const [sourceDocId, setSourceDocId] = useState('');
  const [sourcePage, setSourcePage] = useState('');
  const [percentage, setPercentage] = useState('');
  const [termDays, setTermDays] = useState('');

  // Penalidade
  const [clauseId, setClauseId] = useState('');
  const [trigger, setTrigger] = useState('');

  /**
   * Membros da organização, do módulo dono — só para o seletor de responsável.
   *
   * Carregado sob demanda: o hook é montado no drawer, que existe em toda
   * renderização da listagem, e buscar `profiles` a cada carregamento de página
   * seria uma consulta para um seletor que talvez ninguém abra.
   */
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  useEffect(() => {
    if (kind !== 'milestone' || members !== null) return;
    let active = true;
    listOrganizationMembers()
      .then((rows) => { if (active) setMembers(rows); })
      .catch(() => { if (active) setMembers([]); });
    return () => { active = false; };
  }, [kind, members]);
  const [ownerUserId, setOwnerUserId] = useState('');

  // Revisão
  const [reviewStatus, setReviewStatus] = useState<ClauseReviewStatus>('validated');
  const [reviewNote, setReviewNote] = useState('');

  const num = (v: string): number | null => {
    const parsed = Number(v.replace(',', '.'));
    return v.trim() && Number.isFinite(parsed) ? parsed : null;
  };

  const resetCommon = () => {
    setTitle(''); setDescription(''); setAmount('');
    setDueDate(format(new Date(), 'yyyy-MM-dd'));
  };

  const openMilestone = (milestone?: ContractMilestoneRow) => {
    resetCommon();
    setEditing(milestone ?? null);
    if (milestone) {
      setTitle(milestone.title);
      setDescription(milestone.description ?? '');
      setDueDate(milestone.due_date ?? format(new Date(), 'yyyy-MM-dd'));
      setAmount(milestone.billing_amount != null ? String(milestone.billing_amount) : '');
      setMilestoneType(milestone.milestone_type ?? '');
      setStatus(milestone.status);
      setMeasuredAmount(milestone.measured_amount != null ? String(milestone.measured_amount) : '');
      setEvidence(milestone.evidence ?? '');
      setEvidenceDocId(milestone.evidence_document_id ?? '');
      setOwnerUserId(milestone.owner_user_id ?? '');
    } else {
      setMilestoneType(''); setStatus('pending'); setMeasuredAmount('');
      setEvidence(''); setEvidenceDocId(''); setOwnerUserId('');
    }
    setGenerateBilling(false);
    setKind('milestone');
  };

  const openClause = () => {
    resetCommon();
    setClauseType('renovacao'); setRiskLevel('medium'); setContent('');
    setSourceDocId(''); setSourcePage(''); setPercentage(''); setTermDays('');
    setKind('clause');
  };

  const openPenalty = (clause?: ContractClauseRow) => {
    resetCommon();
    setClauseId(clause?.id ?? ''); setTrigger(''); setPercentage('');
    if (clause) setTitle(`Penalidade — ${clause.title}`);
    setKind('penalty');
  };

  /**
   * Corrigir uma proposta ABRE O FORMULÁRIO PREENCHIDO com o que a máquina
   * leu, para que a pessoa edite em cima — e não do zero. A original é
   * preservada como `superseded` no submit.
   */
  const openSupersede = (clause: ContractClauseRow) => {
    resetCommon();
    setSupersedeTarget(clause);
    setTitle(clause.title);
    setClauseType(clause.clause_type ?? 'renovacao');
    setRiskLevel(clause.risk_level);
    setContent(clause.content ?? '');
    setSourceDocId(clause.source_document_id ?? '');
    setSourcePage(clause.source_page != null ? String(clause.source_page) : '');
    setAmount(clause.amount != null ? String(clause.amount) : '');
    setPercentage(clause.percentage != null ? String(clause.percentage) : '');
    setTermDays(clause.term_days != null ? String(clause.term_days) : '');
    setKind('supersede');
  };

  const openReview = (clause: ContractClauseRow) => {
    setReviewTarget(clause);
    setReviewStatus('validated');
    setReviewNote('');
    setKind('review');
  };

  const close = () => { if (!submitting) setKind(null); };

  async function run(task: () => Promise<void>, successMessage: string) {
    setSubmitting(true);
    try {
      await task();
      await onRefresh();
      notify(successMessage, { variant: 'success' });
      setKind(null);
    } catch (err) {
      notify('Não foi possível salvar', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const submitMilestone = () => {
    if (!title.trim()) return;
    run(async () => {
      const saved = editing
        ? await updateContractMilestone(editing.id, {
            title, description, milestoneType, dueDate: dueDate || null,
            billingAmount: num(amount), status,
            measuredAmount: num(measuredAmount),
            ownerUserId: ownerUserId || null,
            evidence, evidenceDocumentId: evidenceDocId || null,
          })
        : await createContractMilestone({
            contractId, title, description, milestoneType,
            dueDate: dueDate || null, billingAmount: num(amount),
            ownerUserId: ownerUserId || null,
            evidence, evidenceDocumentId: evidenceDocId || null,
          });

      // A ponte marco → faturamento é EXPLÍCITA: medir não fatura.
      if (generateBilling) await createBillingEventFromMilestone(saved);
    }, editing ? 'Marco atualizado' : 'Marco registrado');
  };

  const submitClause = () => {
    if (!title.trim()) return;
    run(() => createContractClause({
      contractId, title, clauseType, content,
      riskLevel: riskLevel as 'low' | 'medium' | 'high',
      sourceDocumentId: sourceDocId || null,
      sourcePage: sourcePage.trim() ? Number(sourcePage) : null,
      amount: num(amount), percentage: num(percentage),
      termDays: termDays.trim() ? Number(termDays) : null,
    }).then(() => undefined), 'Cláusula registrada');
  };

  const submitSupersede = () => {
    if (!supersedeTarget || !title.trim()) return;
    run(() => supersedeContractClause(supersedeTarget.id, {
      contractId, title, clauseType, content,
      riskLevel: riskLevel as 'low' | 'medium' | 'high',
      // A evidência da proposta original ACOMPANHA a versão corrigida: o
      // trecho lido continua sendo o lastro documental da cláusula.
      sourceDocumentId: sourceDocId || null,
      sourcePage: sourcePage.trim() ? Number(sourcePage) : null,
      sourceExcerpt: supersedeTarget.source_excerpt,
      amount: num(amount), percentage: num(percentage),
      termDays: termDays.trim() ? Number(termDays) : null,
    }).then(() => undefined), 'Proposta corrigida e substituída');
  };

  const submitPenalty = () => {
    if (!title.trim()) return;
    run(() => createContractPenalty({
      contractId, title, description,
      penaltyType: 'contratual',
      amount: num(amount), percentage: num(percentage),
      triggerCondition: trigger, deadlineDate: dueDate || null,
      clauseId: clauseId || null,
    }).then(() => undefined), 'Penalidade registrada');
  };

  const submitReview = () => {
    if (!reviewTarget) return;
    if (reviewStatus === 'rejected' && !reviewNote.trim()) return;
    run(() => reviewContractClause(reviewTarget.id, reviewStatus, reviewNote).then(() => undefined),
      reviewStatus === 'validated' ? 'Cláusula validada' : 'Revisão registrada');
  };

  const TITLES: Record<Kind, { title: string; cta: string }> = {
    milestone: { title: editing ? 'Editar marco de medição' : 'Novo marco de medição', cta: editing ? 'Salvar marco' : 'Registrar marco' },
    clause: { title: 'Registrar cláusula', cta: 'Registrar cláusula' },
    supersede: { title: 'Corrigir proposta', cta: 'Substituir proposta' },
    penalty: { title: 'Registrar penalidade', cta: 'Registrar penalidade' },
    review: { title: 'Revisar cláusula', cta: reviewStatus === 'rejected' ? 'Rejeitar' : 'Registrar revisão' },
  };

  const SUBMIT: Record<Kind, () => void> = {
    milestone: submitMilestone, clause: submitClause, penalty: submitPenalty,
    review: submitReview, supersede: submitSupersede,
  };

  const docOptions = [
    { value: '', label: 'Sem documento vinculado' },
    ...documents.map((d) => ({ value: d.id, label: d.title })),
  ];

  const modals = (
    <HudModal
      isOpen={kind !== null}
      onClose={close}
      size="md"
      title={kind ? TITLES[kind].title : ''}
      footer={
        <>
          <HudButton variant="ghost" size="sm" onClick={close} disabled={submitting}>Cancelar</HudButton>
          <HudButton variant="primary" size="sm" isLoading={submitting} onClick={() => kind && SUBMIT[kind]()}>
            {kind ? TITLES[kind].cta : ''}
          </HudButton>
        </>
      }
    >
      {kind === 'milestone' && (
        <div className="space-y-4">
          <HudInput label="Título do marco" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Medição física fase 1" />
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Tipo" value={milestoneType} onChange={(e) => setMilestoneType(e.target.value)} placeholder="Ex: Medição" />
            <HudInput label="Prazo" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Valor previsto (R$)" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            {editing && (
              <HudInput label="Valor medido (R$)" type="number" inputMode="decimal" value={measuredAmount} onChange={(e) => setMeasuredAmount(e.target.value)} placeholder="deixe vazio se não medido" />
            )}
          </div>
          {editing && (
            <HudSelect
              label="Situação"
              value={status}
              onChange={(v) => setStatus(v as ContractMilestoneStatus)}
              options={MILESTONE_STATUS_OPTIONS}
            />
          )}
          {/* Responsável: `user_id` de `profiles`, sem cópia de cadastro aqui. */}
          <HudSelect
            label="Responsável"
            value={ownerUserId}
            onChange={setOwnerUserId}
            options={[
              { value: '', label: members === null ? 'Carregando…' : members.length === 0 ? 'Nenhum membro disponível' : 'Não atribuído' },
              ...(members ?? []).map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
          <HudInput label="Evidência esperada" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Ex: Boletim de medição assinado" />
          {/* O documento vive em `contract_documents` — aqui só se referencia. */}
          <HudSelect label="Documento de evidência" value={evidenceDocId} onChange={setEvidenceDocId} options={docOptions} />
          <div className="flex flex-col gap-1.5">
            <label className="text-ig-label font-medium uppercase tracking-wider hud-label">Descrição</label>
            <textarea className={textareaClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-ig-caption text-ig-fg-muted">
            <input type="checkbox" checked={generateBilling} onChange={(e) => setGenerateBilling(e.target.checked)} className="mt-0.5" />
            <span>
              Gerar evento de faturamento a partir deste marco.
              <span className="block text-ig-fg-subtle">
                O evento nasce pendente e vinculado ao marco; faturar continua sendo um passo à parte.
              </span>
            </span>
          </label>
        </div>
      )}

      {kind === 'supersede' && supersedeTarget && (
        <div className="space-y-4">
          {/* O trecho lido fica à vista durante a correção: é contra ele que a
              pessoa está decidindo. */}
          <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
            <p className="text-ig-label font-semibold uppercase tracking-wider text-ig-fg-subtle">
              Trecho do contrato{supersedeTarget.source_page ? ` · p. ${supersedeTarget.source_page}` : ''}
            </p>
            <p className="mt-1 border-l-2 border-ig-accent/50 pl-2.5 text-ig-caption italic text-ig-fg-strong">
              {supersedeTarget.source_excerpt ?? 'sem trecho registrado'}
            </p>
          </div>
          <HudInput label="Título da cláusula" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label="Categoria" value={clauseType} onChange={setClauseType} options={CLAUSE_TYPES} />
            <HudSelect label="Nível de risco" value={riskLevel} onChange={setRiskLevel} options={RISK_LEVELS} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <HudInput label="Valor (R$)" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="—" />
            <HudInput label="Percentual (%)" type="number" inputMode="decimal" value={percentage} onChange={(e) => setPercentage(e.target.value)} placeholder="—" />
            <HudInput label="Prazo (dias)" type="number" value={termDays} onChange={(e) => setTermDays(e.target.value)} placeholder="—" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-ig-label font-medium uppercase tracking-wider hud-label">Texto da cláusula</label>
            <textarea className={textareaClass} rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <p className="text-ig-caption text-ig-fg-muted">
            A proposta original é preservada como <span className="font-semibold text-ig-fg-strong">Substituída</span>,
            apontando para esta versão — a trilha de o que a máquina leu e o que a pessoa concluiu não se perde.
          </p>
        </div>
      )}

      {kind === 'clause' && (
        <div className="space-y-4">
          <HudInput label="Título da cláusula" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Multa por atraso de entrega" />
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label="Categoria" value={clauseType} onChange={setClauseType} options={CLAUSE_TYPES} />
            <HudSelect label="Nível de risco" value={riskLevel} onChange={setRiskLevel} options={RISK_LEVELS} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <HudInput label="Valor (R$)" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="—" />
            <HudInput label="Percentual (%)" type="number" inputMode="decimal" value={percentage} onChange={(e) => setPercentage(e.target.value)} placeholder="—" />
            <HudInput label="Prazo (dias)" type="number" value={termDays} onChange={(e) => setTermDays(e.target.value)} placeholder="—" />
          </div>
          {/* Proveniência documental: de onde a cláusula foi transcrita. */}
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <HudSelect label="Documento de origem" value={sourceDocId} onChange={setSourceDocId} options={docOptions} />
            <HudInput label="Página" type="number" value={sourcePage} onChange={(e) => setSourcePage(e.target.value)} placeholder="—" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-ig-label font-medium uppercase tracking-wider hud-label">Texto da cláusula</label>
            <textarea className={textareaClass} rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Transcreva a cláusula como consta no contrato" />
          </div>
          <p className="text-ig-caption text-ig-fg-muted">
            O registro nasce como <span className="font-semibold text-ig-fg-strong">Registrada</span>, não validada —
            e marcado como transcrição manual, nunca como extração automática.
          </p>
        </div>
      )}

      {kind === 'penalty' && (
        <div className="space-y-4">
          <HudInput label="Título da penalidade" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Multa de 2% por atraso" />
          <HudSelect
            label="Cláusula de origem"
            value={clauseId}
            onChange={setClauseId}
            options={[
              { value: '', label: 'Sem cláusula vinculada' },
              ...clauses.map((c) => ({ value: c.id, label: c.title })),
            ]}
          />
          <div className="grid grid-cols-3 gap-3">
            <HudInput label="Valor (R$)" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="—" />
            <HudInput label="Percentual (%)" type="number" inputMode="decimal" value={percentage} onChange={(e) => setPercentage(e.target.value)} placeholder="—" />
            <HudInput label="Prazo limite" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <HudInput label="Condição de gatilho" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="Ex: Atraso superior a 5 dias na entrega" />
          <div className="flex flex-col gap-1.5">
            <label className="text-ig-label font-medium uppercase tracking-wider hud-label">Descrição</label>
            <textarea className={textareaClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      )}

      {kind === 'review' && reviewTarget && (
        <div className="space-y-4">
          <p className="text-sm text-ig-fg-muted">
            Cláusula <span className="font-semibold text-ig-fg-strong">{reviewTarget.title}</span>.
          </p>
          <HudSelect
            label="Decisão"
            value={reviewStatus}
            onChange={(v) => setReviewStatus(v as ClauseReviewStatus)}
            options={REVIEW_OPTIONS}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-ig-label font-medium uppercase tracking-wider hud-label">
              {reviewStatus === 'rejected' ? 'Motivo da rejeição (obrigatório)' : 'Observação'}
            </label>
            <textarea className={textareaClass} rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
          </div>
          <p className="text-ig-caption text-ig-fg-muted">A decisão carimba quem revisou e quando, e fica em auditoria.</p>
        </div>
      )}
    </HudModal>
  );

  return { openMilestone, openClause, openPenalty, openReview, openSupersede, modals };
}
