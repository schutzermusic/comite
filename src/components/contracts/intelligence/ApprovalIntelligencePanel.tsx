'use client';

/**
 * Approval Intelligence — onde a alçada está, há quanto tempo, e com quem.
 *
 * Três fatos governam o desenho:
 *
 *  · a etapa CORRENTE é a resposta principal — o contrato está parado nela;
 *  · o gargalo é observação, não previsão: a etapa aberta há mais tempo;
 *  · contrato SEM rota não é contrato aprovado. Ele aparece numa lista à
 *    parte, porque é lacuna de controle de alçada e some se for tratado como
 *    "nada pendente".
 */

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { ShieldCheck, AlertTriangle, Timer, GitBranch, UserX } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import { TrustedValue } from '../cockpit/TrustedValue';
import type {
  ApprovalIntelligence, ApprovalStepState, PortfolioApprovals,
} from '@/lib/contracts/trust/approval-intelligence';

const STATUS_TONE: Record<ApprovalStepState['status'], { label: string; text: string; rail: string }> = {
  approved: { label: 'Aprovada', text: 'text-ig-success', rail: 'bg-ig-success' },
  rejected: { label: 'Rejeitada', text: 'text-ig-danger', rail: 'bg-ig-danger' },
  under_review: { label: 'Em análise', text: 'text-ig-warning', rail: 'bg-ig-warning' },
  pending: { label: 'Aguardando', text: 'text-ig-fg-muted', rail: 'bg-ig-border-strong' },
};

const hours = (h: number | null): string =>
  h === null ? '—' : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;

// ═══════════════════════════════════════════════════════════════════════════
// Um contrato
// ═══════════════════════════════════════════════════════════════════════════

export function ApprovalJourney({
  intelligence, className,
}: { intelligence: ApprovalIntelligence; className?: string }) {
  if (intelligence.unavailable) {
    return (
      <div className={cn(
        'rounded-[14px] border border-dashed border-ig-border-strong px-4 py-3.5',
        className,
      )}>
        <p className="text-ig-body-sm font-semibold text-ig-fg-strong">
          {intelligence.unavailable === 'error' ? 'Rota de aprovação indisponível' : 'Sem rota de alçada'}
        </p>
        <p className="mt-1 text-ig-caption text-ig-fg-muted">
          {intelligence.unavailable === 'error'
            ? 'A leitura das etapas falhou. A ausência de etapas nesta tela não significa que não existam.'
            : 'Nenhuma etapa de aprovação registrada: não há como afirmar que este contrato passou por alçada.'}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* A resposta principal primeiro: onde está parado. */}
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric
          label="Etapa corrente"
          value={intelligence.currentStage?.label ?? 'Rota concluída'}
          tone={intelligence.currentStage ? 'text-ig-warning' : 'text-ig-success'}
        />
        <div className="rounded-[14px] border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
          <p className="truncate text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-muted">
            SLA médio por etapa
          </p>
          <TrustedValue
            value={intelligence.avgHoursPerStep}
            format={(h) => hours(h)}
            size="md"
            missingLabel="Nenhuma etapa concluída"
            showProvenance
          />
        </div>
        <Metric
          label="Gargalo"
          value={intelligence.bottleneck
            ? `${intelligence.bottleneck.label} · ${hours(intelligence.bottleneck.elapsedHours)}`
            : 'Nenhuma etapa aberta'}
          tone={intelligence.bottleneck ? 'text-ig-warning' : 'text-ig-fg-muted'}
          icon={<GitBranch className="h-3 w-3" aria-hidden />}
        />
      </div>

      {/* A jornada */}
      <ol className="space-y-1.5">
        {intelligence.steps.map((step) => {
          const tone = STATUS_TONE[step.status];
          const isCurrent = intelligence.currentStage?.step === step.step;
          return (
            <li
              key={step.step}
              className={cn(
                'relative grid gap-3 overflow-hidden rounded-lg border bg-ig-panel/45 p-3 md:grid-cols-[1fr_120px_130px_120px] md:items-center',
                isCurrent ? 'border-ig-accent/45' : 'border-ig-border-subtle',
              )}
            >
              <span className={cn('absolute inset-y-0 left-0 w-[2px]', tone.rail)} aria-hidden />
              <div className="min-w-0 pl-1.5">
                <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">
                  {step.label}
                  {isCurrent && <span className="ml-2 text-ig-label font-semibold uppercase text-ig-accent">agora</span>}
                </p>
                <p className={cn('truncate text-ig-caption', tone.text)}>{tone.label}</p>
              </div>

              {/* Responsável: a ausência é o problema, e por isso é marcada. */}
              <div className="min-w-0">
                {step.reviewerUserId ? (
                  <p className="truncate text-ig-caption text-ig-fg-muted">Aprovador designado</p>
                ) : (
                  <p className="flex items-center gap-1 truncate text-ig-caption text-ig-warning">
                    <UserX className="h-3 w-3 shrink-0" aria-hidden /> Sem aprovador
                  </p>
                )}
              </div>

              <div className="min-w-0">
                <p className="truncate text-ig-caption text-ig-fg-muted">
                  {step.deadline ? format(step.deadline, 'dd/MM/yyyy', { locale: pt }) : 'Sem prazo'}
                </p>
                {step.overdueDays !== null && (
                  <p className="truncate text-ig-label font-semibold text-ig-danger">
                    {step.overdueDays} dia(s) além do prazo
                  </p>
                )}
              </div>

              <span className="flex items-center gap-1 text-ig-caption text-ig-fg-muted">
                <Timer className="h-3 w-3 shrink-0" aria-hidden />
                {step.elapsedHours === null ? 'não apurado' : hours(step.elapsedHours)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Metric({ label, value, tone, icon }: { label: string; value: string; tone: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-[14px] border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
      <p className="flex items-center gap-1 truncate text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-muted">
        {icon}{label}
      </p>
      <p className={cn('mt-0.5 truncate text-ig-body-sm font-semibold', tone)}>{value}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Carteira
// ═══════════════════════════════════════════════════════════════════════════

export interface ApprovalIntelligencePanelProps {
  approvals: PortfolioApprovals;
  canApprove?: boolean;
  onReview?: (contractId: string) => void;
  className?: string;
}

export function ApprovalIntelligencePanel({
  approvals, canApprove = false, onReview, className,
}: ApprovalIntelligencePanelProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Contratos em alçada" value={String(approvals.rows.length)} tone="text-ig-fg-strong" />
        <Metric
          label="Etapas além do prazo"
          value={String(approvals.overdueCount)}
          tone={approvals.overdueCount > 0 ? 'text-ig-danger' : 'text-ig-fg-strong'}
        />
        <Metric
          label="Etapas rejeitadas"
          value={String(approvals.rejectedCount)}
          tone={approvals.rejectedCount > 0 ? 'text-ig-danger' : 'text-ig-fg-strong'}
        />
        <div className="rounded-[14px] border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5">
          <p className="truncate text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-muted">SLA da carteira</p>
          <TrustedValue
            value={approvals.avgHours}
            format={(h) => hours(h)}
            size="md"
            missingLabel="Sem etapa concluída"
            showProvenance
          />
        </div>
      </div>

      {approvals.erroredContracts.length > 0 && (
        <p className="flex items-start gap-2 rounded-[12px] border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Aprovações indisponíveis em {approvals.erroredContracts.length} contrato(s): {approvals.erroredContracts.join(', ')}.</span>
        </p>
      )}

      <HudPanel
        title="Rotas de aprovação"
        subtitle="Etapa corrente, aprovador, prazo e tempo decorrido"
        icon={<ShieldCheck className="h-4 w-4" />}
        interactive={false}
      >
        {approvals.rows.length === 0 ? (
          <p className="py-6 text-center text-ig-caption text-ig-fg-muted">
            Nenhum contrato com rota de alçada registrada no recorte.
          </p>
        ) : (
          <div className="space-y-4">
            {approvals.rows.slice(0, 12).map((row) => (
              <div key={row.contractId} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{row.title}</p>
                    <p className="truncate text-ig-caption text-ig-fg-muted">{row.code}</p>
                  </div>
                  {canApprove && onReview && (
                    <button
                      type="button"
                      onClick={() => onReview(row.contractId)}
                      className="shrink-0 rounded-md border border-ig-border-subtle px-2.5 py-1 text-ig-label font-semibold text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:text-ig-fg-strong"
                    >
                      Revisar
                    </button>
                  )}
                </div>
                <ApprovalJourney intelligence={row.intelligence} />
              </div>
            ))}
          </div>
        )}
      </HudPanel>

      {/*
        Contratos sem rota ficam depois da lista, e não misturados nela: eles
        não estão "aguardando aprovação", estão sem controle de alçada.
      */}
      {approvals.withoutRoute.length > 0 && (
        <div className="rounded-[14px] border border-dashed border-ig-border-strong px-4 py-3.5">
          <p className="text-ig-body-sm font-semibold text-ig-fg-strong">
            {approvals.withoutRoute.length} contrato(s) sem rota de alçada
          </p>
          <p className="mt-1 text-ig-caption text-ig-fg-muted">
            {approvals.withoutRoute.map((c) => c.code).join(', ')} — nenhuma etapa registrada. Não estão
            aguardando decisão: não há decisão configurada.
          </p>
        </div>
      )}
    </div>
  );
}
