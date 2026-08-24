'use client';

/**
 * Card de contrato — painel de instrumentos, não retângulo de SaaS (MD §15).
 *
 * Largura alvo 350–420px, densidade média-alta, com quatro camadas de leitura:
 *
 *   IDENTIDADE   contraparte, código, status, risco, origem
 *   PROJETO      relação de primeira classe, com estado quando ausente
 *   EXPOSIÇÃO    valor, execução, faturado/backlog
 *   SINAIS       módulos conectados + o que exige atenção
 *
 * A hierarquia é deliberada: o olho encontra a contraparte, depois o dinheiro,
 * depois o problema. Nada é do mesmo tamanho que tudo (MD §8).
 */

import { motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import {
  ArrowRight, Workflow, AlertTriangle, Link2, Receipt,
  ClipboardCheck, Archive, ShieldCheck, X,
} from 'lucide-react';
import { hasOfficialValue, isError, ratioTrusted, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { obligationBreakdown, missingDocuments, renewalState, contractHealth, RENEWAL_LABEL } from '@/lib/contracts/trust/signals';
import { attentionItems } from '@/lib/contracts/trust/attention';
import { DataClassBadge } from './PortfolioScope';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', negotiation: 'Em negociação', legal_review: 'Revisão jurídica',
  commercial_review: 'Revisão comercial', signed: 'Assinado', active: 'Ativo',
  expiring_soon: 'Expirando', expired: 'Expirado', closed: 'Encerrado',
  cancelled: 'Cancelado', archived: 'Arquivado',
};
const RISK_LABEL = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;

const text = (t: Official<string>, fallback: string) => (hasOfficialValue(t) ? t.value : fallback);

export interface ContractInstrumentCardProps {
  contract: TrustedContract;
  active?: boolean;
  onSelect: () => void;
  onOpen?: () => void;
  onDelete?: () => void;
  className?: string;
  now?: Date;
}

export function ContractInstrumentCard({
  contract: c, active = false, onSelect, onOpen, onDelete, className, now = new Date(),
}: ContractInstrumentCardProps) {
  const reduced = useReducedMotion();

  const execution = ratioTrusted(c.billedValue, c.totalValue, 'faturado sobre total', ['contracts', 'contract_billing_events']);
  const pct = hasOfficialValue(execution) ? Math.round(execution.value * 100) : null;
  const obligations = obligationBreakdown(c);
  const docs = missingDocuments(c);
  const renewal = renewalState(c);
  const health = contractHealth(c);
  const attention = attentionItems(c, now);
  const critical = attention.filter((a) => a.severity === 'critical').length;

  const counterparty = text(c.counterparty, 'Contraparte não informada');
  const linked = hasOfficialValue(c.project);

  return (
    <motion.article
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduced ? undefined : { y: -2 }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-[20px] border',
        'bg-[linear-gradient(165deg,color-mix(in_oklab,var(--ig-bg-panel)_92%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_45%,transparent))]',
        'px-5 py-4 transition-[border-color,box-shadow] duration-200',
        active
          ? 'border-ig-accent/55 shadow-[0_12px_36px_-16px_color-mix(in_oklab,var(--ig-accent)_55%,transparent),var(--ig-shadow-e2)]'
          : 'border-ig-border-subtle hover:border-ig-border-focus hover:shadow-[var(--ig-shadow-e2)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
        className,
      )}
    >
      {/* Rail de severidade: vermelho quando há crítico, accent quando selecionado. */}
      <span
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-[3px] transition-opacity',
          critical > 0 ? 'bg-ig-danger opacity-100'
            : active ? 'bg-ig-accent opacity-100'
              : 'bg-ig-accent opacity-0 group-hover:opacity-60',
        )}
        aria-hidden
      />

      {/* ── Identidade ───────────────────────────────────────────────────── */}
      <header className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="ig-tabular truncate font-mono text-ig-caption font-semibold text-ig-fg-muted">
            {c.code}
          </span>
          <DataClassBadge dataClass={c.dataClass} />
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Excluir contrato"
              className="ml-auto shrink-0 rounded p-1 text-ig-fg-subtle opacity-0 transition-opacity hover:text-ig-danger group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-danger)_45%,transparent)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>

        <h3 className="mt-1.5 truncate text-[19px] font-semibold leading-tight text-ig-fg-strong">
          {counterparty}
        </h3>
        <p className="mt-0.5 truncate text-ig-caption text-ig-fg-muted">{c.title}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Chip label={STATUS_LABEL[c.status] ?? c.status} tone={c.status === 'active' || c.status === 'signed' ? 'success' : 'accent'} />
          <Chip label={`Risco ${RISK_LABEL[c.riskLevel]}`} tone={c.riskLevel === 'high' ? 'danger' : c.riskLevel === 'medium' ? 'warning' : 'success'} />
          {hasOfficialValue(renewal) && (renewal.value === 'expired' || renewal.value === 'critical') && (
            <Chip label={RENEWAL_LABEL[renewal.value]} tone="danger" />
          )}
        </div>
      </header>

      {/* ── Projeto: relação de primeira classe ──────────────────────────── */}
      <div
        className={cn(
          'mt-3.5 flex items-center gap-2 rounded-[11px] border px-3 py-2',
          linked
            ? 'border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_50%,transparent)]'
            : 'border-dashed border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)]',
        )}
      >
        {linked ? (
          <>
            <Workflow className="h-3.5 w-3.5 shrink-0 text-ig-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ig-body-sm font-medium text-ig-fg-strong">
              {c.project.value.codigo}
            </span>
            <span className="shrink-0 text-ig-caption text-ig-fg-subtle">vinculado</span>
          </>
        ) : (
          <>
            <Link2 className="h-3.5 w-3.5 shrink-0 text-ig-warning" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ig-body-sm text-ig-warning">
              {isError(c.project) ? 'Vínculo indisponível' : 'Sem projeto vinculado'}
            </span>
          </>
        )}
      </div>

      {/* ── Exposição ────────────────────────────────────────────────────── */}
      <div className="mt-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-ig-label uppercase tracking-[0.13em] text-ig-fg-muted">Valor contratado</p>
            <p className="ig-tabular mt-0.5 truncate text-[26px] font-semibold leading-none text-ig-fg-strong">
              {hasOfficialValue(c.totalValue) ? BRL.format(c.totalValue.value) : (
                <span className="text-[15px] font-medium text-ig-fg-subtle">Não apurado</span>
              )}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-ig-label uppercase tracking-[0.13em] text-ig-fg-muted">Execução</p>
            <p className="ig-tabular mt-0.5 text-[18px] font-semibold leading-none text-ig-fg-strong">
              {pct === null ? <span className="text-[13px] font-medium text-ig-fg-subtle">—</span> : `${pct}%`}
            </p>
          </div>
        </div>

        {/* Sem apuração: trilho tracejado, nunca uma barra que pareça medição. */}
        <div className="mt-2">
          {pct === null ? (
            <div className="h-1.5 w-full rounded-full border border-dashed border-ig-border-strong" role="img" aria-label="Execução não apurada" />
          ) : (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ig-border-subtle">
              <div className="h-full rounded-full bg-ig-success transition-[width] duration-500" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>

        <div className="mt-1.5 flex justify-between gap-3 text-ig-caption text-ig-fg-muted">
          <span className="truncate">
            Faturado {hasOfficialValue(c.billedValue) ? BRL.format(c.billedValue.value) : '—'}
          </span>
          <span className="shrink-0">
            Backlog {hasOfficialValue(c.remainingValue) ? BRL.format(c.remainingValue.value) : '—'}
          </span>
        </div>
      </div>

      {/* ── Módulos conectados + saúde ───────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t border-ig-border-subtle pt-3">
        <ModuleTick
          icon={<ClipboardCheck className="h-3.5 w-3.5" aria-hidden />}
          value={hasOfficialValue(obligations) ? obligations.value.total : null}
          alert={hasOfficialValue(obligations) && obligations.value.overdue > 0}
          title="Obrigações mapeadas"
        />
        <ModuleTick
          icon={<Receipt className="h-3.5 w-3.5" aria-hidden />}
          value={hasOfficialValue(c.billingEvents) ? c.billingEvents.value.length : null}
          title="Eventos de faturamento"
        />
        <ModuleTick
          icon={<Archive className="h-3.5 w-3.5" aria-hidden />}
          value={hasOfficialValue(c.documents) ? c.documents.value.length : null}
          alert={hasOfficialValue(docs) && docs.value.length > 0}
          title="Documentos registrados"
        />
        <ModuleTick
          icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
          value={hasOfficialValue(c.approvals) ? c.approvals.value.length : null}
          title="Etapas de aprovação"
        />
        <span className="ml-auto shrink-0 text-ig-caption text-ig-fg-subtle" title="Dimensões de saúde apuradas">
          saúde <span className="ig-tabular font-semibold text-ig-fg-muted">{health.coverage.assessed}/{health.coverage.total}</span>
        </span>
      </div>

      {/* ── Atenção + abrir dossiê ───────────────────────────────────────── */}
      <div className="mt-3 flex items-center gap-3">
        {attention.length > 0 ? (
          <span
            className={cn(
              'flex min-w-0 items-center gap-1.5 truncate text-ig-caption font-medium',
              critical > 0 ? 'text-ig-danger' : 'text-ig-warning',
            )}
            title={attention[0].title}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{attention[0].title}</span>
          </span>
        ) : (
          <span className="text-ig-caption text-ig-fg-subtle">Nada exige atenção</span>
        )}

        {onOpen && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="ml-auto inline-flex shrink-0 items-center gap-1 text-ig-caption font-semibold text-ig-accent transition-transform hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)] rounded"
          >
            Dossiê
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </motion.article>
  );
}

function Chip({ label, tone }: { label: string; tone: 'accent' | 'success' | 'warning' | 'danger' }) {
  const TONE = {
    accent: { rail: 'bg-ig-accent', text: 'text-ig-accent' },
    success: { rail: 'bg-ig-success', text: 'text-ig-success' },
    warning: { rail: 'bg-ig-warning', text: 'text-ig-warning' },
    danger: { rail: 'bg-ig-danger', text: 'text-ig-danger' },
  }[tone];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border border-ig-border-subtle py-0.5 pl-1 pr-2">
      <span className={cn('h-3 w-[2px] rounded-full', TONE.rail)} aria-hidden />
      <span className={cn('text-ig-caption font-semibold', TONE.text)}>{label}</span>
    </span>
  );
}

/** Contador de módulo. `null` vira travessão — ausência não é zero. */
function ModuleTick({
  icon, value, alert = false, title,
}: {
  icon: React.ReactNode; value: number | null; alert?: boolean; title: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'flex shrink-0 items-center gap-1 text-ig-caption',
        alert ? 'font-semibold text-ig-warning' : 'text-ig-fg-muted',
      )}
    >
      <span className={alert ? 'text-ig-warning' : 'text-ig-fg-subtle'}>{icon}</span>
      <span className="ig-tabular">{value === null ? '—' : value}</span>
    </span>
  );
}
