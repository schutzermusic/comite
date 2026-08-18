'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  FileSpreadsheet,
  Landmark,
  Radio,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Lock,
  HelpCircle,
  ArrowUpRight,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudSignal } from '@/components/hud';
import {
  OBLIGATION_STATUS_META,
  PAYROLL_STATUS_LABEL,
  type ComplianceSnapshot,
  type ObligationKind,
  type ObligationStatus,
  type WorkforceObligation,
} from '@/lib/workforce/compliance';

/**
 * CICLO OBRIGATÓRIO DA COMPETÊNCIA
 * ================================
 * Amarra a Visão Geral ao que de fato precisa acontecer todo mês: fechar a
 * folha, transmitir os eventos do eSocial e recolher as guias. É a peça que
 * transforma o cockpit analítico em cockpit operacional.
 *
 * Anatomia: anel de conformidade + estado do link eSocial + trilha das três
 * etapas (Folha → eSocial → Guias), cada obrigação com prazo legal e evidência.
 */

// ── Tokens de status ─────────────────────────────────────────────────────────

const STATUS_ICON: Record<ObligationStatus, typeof CheckCircle2> = {
  done: CheckCircle2,
  done_late: CheckCircle2,
  pending: Clock,
  due_soon: AlertTriangle,
  late: AlertCircle,
  unconfirmed: HelpCircle,
  blocked: Lock,
};

/** Cada status resolve para uma única CSS var, consumida como `--ob-tone`. */
const STATUS_TONE: Record<ObligationStatus, string> = {
  done: 'var(--ig-success)',
  done_late: 'var(--ig-warning)',
  pending: 'var(--ig-info)',
  due_soon: 'var(--ig-warning)',
  late: 'var(--ig-danger)',
  unconfirmed: 'var(--ig-warning)',
  blocked: 'var(--ig-fg-subtle)',
};

const KIND_META: Record<ObligationKind, { label: string; hint: string; icon: typeof FileSpreadsheet }> = {
  payroll: { label: 'Folha', hint: 'Fechamento e pagamento', icon: FileSpreadsheet },
  esocial: { label: 'eSocial', hint: 'Eventos periódicos', icon: Radio },
  tax_guide: { label: 'Guias & Impostos', hint: 'Recolhimento e declarações', icon: Landmark },
};

const KIND_ORDER: ObligationKind[] = ['payroll', 'esocial', 'tax_guide'];

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: v >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: v >= 1_000_000 ? 1 : 0,
  }).format(v);

const dayMonth = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

function dueText(o: WorkforceObligation): string {
  if (o.status === 'done' || o.status === 'done_late') return `venceu ${dayMonth(o.dueDate)}`;
  if (o.status === 'unconfirmed') return `venceu ${dayMonth(o.dueDate)} · sem retorno`;
  // Bloqueada: o prazo já passou, mas a etapa anterior é que trava — dizer
  // "em atraso" aqui aponta para a obrigação errada.
  if (o.status === 'blocked') return `prazo ${dayMonth(o.dueDate)}`;
  if (o.daysToDue < 0) return `${Math.abs(o.daysToDue)}d em atraso`;
  if (o.daysToDue === 0) return 'vence hoje';
  return `${o.daysToDue}d — ${dayMonth(o.dueDate)}`;
}

// ── Anel de conformidade ─────────────────────────────────────────────────────

function ComplianceRing({ score }: { score: number }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const tone =
    score >= 85 ? 'var(--ig-success)' : score >= 60 ? 'var(--ig-warning)' : 'var(--ig-danger)';

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div className="relative h-[92px] w-[92px]">
      <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90">
        <circle
          cx="46" cy="46" r={R} fill="none" strokeWidth="7"
          className="stroke-ig-border-subtle"
        />
        <circle
          cx="46" cy="46" r={R} fill="none" strokeWidth="7" strokeLinecap="round"
          stroke={tone}
          strokeDasharray={`${(score / 100) * C} ${C}`}
          style={{
            filter: `drop-shadow(0 0 6px color-mix(in oklab, ${tone} 60%, transparent))`,
            transition: 'stroke-dasharray 600ms ease-out',
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-[24px] font-extrabold leading-none tabular-nums"
          style={{ color: tone }}
        >
          {score}
        </span>
      </div>
      </div>
      <span className="text-[8.5px] font-bold uppercase tracking-[0.14em] text-ig-fg-subtle">
        conformidade
      </span>
    </div>
  );
}

// ── Cartão de obrigação ──────────────────────────────────────────────────────

function ObligationCard({ o }: { o: WorkforceObligation }) {
  const meta = OBLIGATION_STATUS_META[o.status];
  const Icon = STATUS_ICON[o.status];
  const done = o.status === 'done' || o.status === 'done_late';

  const body = (
    <div
      style={{ ['--ob-tone' as string]: STATUS_TONE[o.status] }}
      className={cn(
        'group relative isolate flex h-full flex-col gap-2 overflow-hidden rounded-xl border p-3',
        'border-[color-mix(in_oklab,var(--ob-tone)_24%,var(--ig-border-subtle))]',
        'bg-[linear-gradient(140deg,color-mix(in_oklab,var(--ob-tone)_7%,var(--ig-panel)),var(--ig-panel))]',
        'transition-[transform,border-color,box-shadow] duration-200 ease-out',
        o.href && 'hover:-translate-y-0.5 hover:shadow-[0_10px_28px_color-mix(in_oklab,var(--ob-tone)_18%,transparent)] motion-reduce:hover:translate-y-0',
      )}
    >
      {/* Trilho de tom */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px] bg-[color:var(--ob-tone)] shadow-[0_0_10px_color-mix(in_oklab,var(--ob-tone)_70%,transparent)]"
      />

      <div className="flex items-start justify-between gap-2 pl-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-ig-fg-strong">
              {o.code}
            </span>
            {o.source === 'esocial' && o.evidence && (
              <span
                title={`Apurado pelo eSocial — ${o.evidence}`}
                className="rounded-[4px] border border-ig-success/30 bg-ig-success/10 px-1 py-px text-[8px] font-bold uppercase tracking-[0.1em] text-ig-success"
              >
                apurado
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[11.5px] font-semibold leading-tight text-ig-fg-default">
            {o.label}
          </p>
        </div>
        <Icon className="h-3.5 w-3.5 shrink-0 text-[color:var(--ob-tone)]" />
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pl-1.5">
        <div className="min-w-0">
          <p
            className={cn(
              'truncate text-[10px] font-bold uppercase tracking-[0.1em]',
              done ? 'text-ig-fg-subtle' : 'text-[color:var(--ob-tone)]',
            )}
          >
            {/* Bloqueada: dizer O QUE trava, não só que está travada. */}
            {o.status === 'blocked' ? o.blockedReason ?? meta.label : meta.label}
          </p>
          <p className="mt-0.5 truncate text-[10px] tabular-nums text-ig-fg-muted">{dueText(o)}</p>
        </div>
        {o.amount !== undefined && o.amount > 0 && (
          <span className="shrink-0 text-[12px] font-bold tabular-nums text-ig-fg-strong">
            {brl(o.amount)}
          </span>
        )}
      </div>

      {o.href && (
        <ArrowUpRight className="pointer-events-none absolute right-2.5 top-2.5 h-3 w-3 text-ig-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </div>
  );

  return o.href ? (
    <Link href={o.href} title={o.description} className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ig-accent/50 rounded-xl">
      {body}
    </Link>
  ) : (
    <div title={o.description} className="h-full">{body}</div>
  );
}

// ── Painel ───────────────────────────────────────────────────────────────────

interface PayrollCompliancePanelProps {
  snapshot: ComplianceSnapshot;
  loading?: boolean;
  onSyncEsocial?: () => void;
  className?: string;
}

export function PayrollCompliancePanel({
  snapshot,
  loading = false,
  onSyncEsocial,
  className,
}: PayrollCompliancePanelProps) {
  const { esocial, counts, obligations } = snapshot;

  const grouped = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({
        kind,
        items: obligations.filter((o) => o.kind === kind),
      })).filter((g) => g.items.length > 0),
    [obligations],
  );

  const esocialTone =
    !esocial.connected ? 'neutral'
      : esocial.certificateStatus === 'expiring' ? 'warning'
        : esocial.failedEventsCount > 0 ? 'warning'
          : 'success';

  const nextDue = snapshot.nextDue;

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-2xl border border-ig-border-subtle bg-ig-panel',
        'shadow-[var(--ig-shadow-e1)]',
        className,
      )}
    >
      {/* Halo superior — assinatura visual da band executiva */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/3 h-48 w-[420px] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, color-mix(in oklab, var(--ig-accent) 28%, transparent), transparent 70%)' }}
      />

      {/* ── Cabeçalho: anel + estado da folha + link eSocial ── */}
      <div className="relative flex flex-wrap items-center gap-5 border-b border-ig-border-subtle/70 px-5 py-4">
        <ComplianceRing score={snapshot.score} />

        <div className="min-w-[200px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-ig-accent" />
            <h3 className="text-sm font-semibold tracking-tight text-ig-fg-strong">
              Ciclo Obrigatório da Competência
            </h3>
            <span className="rounded-[5px] border border-ig-border-subtle px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-ig-fg-muted">
              {snapshot.competenceLabel}
            </span>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-ig-fg-muted">
            Folha <span className="font-semibold text-ig-fg-default">{PAYROLL_STATUS_LABEL[snapshot.payrollStatus]}</span>
            {snapshot.payrollAmount !== undefined && (
              <> · base {brl(snapshot.payrollAmount)}</>
            )}
            {nextDue && (
              <> · próxima obrigação: <span className="font-semibold text-ig-fg-default">{nextDue.code}</span> ({dueText(nextDue)})</>
            )}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <HudSignal tone="success" size="sm" icon={<CheckCircle2 />} label="Concluídas" value={counts.done} />
            {counts.late > 0 && (
              <HudSignal tone="critical" size="sm" icon={<AlertCircle />} label="Em atraso" value={counts.late} />
            )}
            {counts.unconfirmed > 0 && (
              <HudSignal
                tone="warning"
                size="sm"
                icon={<HelpCircle />}
                label="Sem retorno"
                value={counts.unconfirmed}
              />
            )}
            {counts.due_soon > 0 && (
              <HudSignal tone="warning" size="sm" icon={<AlertTriangle />} label="Vencendo" value={counts.due_soon} />
            )}
            {counts.pending > 0 && (
              <HudSignal tone="info" size="sm" icon={<Clock />} label="No prazo" value={counts.pending} />
            )}
            {counts.blocked > 0 && (
              <HudSignal tone="neutral" size="sm" icon={<Lock />} label="Bloqueadas" value={counts.blocked} />
            )}
          </div>
        </div>

        {/* Link eSocial */}
        <div className="min-w-[230px] rounded-xl border border-ig-border-subtle bg-ig-bg-raised/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Radio className={cn('h-3.5 w-3.5', esocial.connected ? 'text-ig-success' : 'text-ig-fg-subtle')} />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ig-fg-muted">
                Link eSocial
              </span>
            </div>
            <HudSignal
              tone={esocialTone}
              size="sm"
              label={esocial.connected ? 'ativo' : 'off'}
              pulse={esocial.connected}
            />
          </div>

          <dl className="mt-2.5 space-y-1 text-[10.5px]">
            <div className="flex justify-between gap-2">
              <dt className="text-ig-fg-muted">Ambiente</dt>
              <dd className="font-semibold text-ig-fg-default">
                {esocial.environment === 'production' ? 'Produção' : 'Homologação'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ig-fg-muted">Última sync</dt>
              <dd className="font-semibold tabular-nums text-ig-fg-default">
                {esocial.lastSyncAt ? new Date(esocial.lastSyncAt).toLocaleDateString('pt-BR') : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ig-fg-muted">Eventos importados</dt>
              <dd className="font-semibold tabular-nums text-ig-fg-default">
                {esocial.importedEventsCount}
                {esocial.failedEventsCount > 0 && (
                  <span className="ml-1 text-ig-warning">({esocial.failedEventsCount} falhas)</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-2.5 flex items-center gap-2">
            {onSyncEsocial && (
              <button
                type="button"
                onClick={onSyncEsocial}
                disabled={loading}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border border-ig-border-subtle px-2 py-1',
                  'text-[10px] font-semibold text-ig-fg-default transition-colors',
                  'hover:border-ig-accent/40 hover:text-ig-accent disabled:opacity-50',
                )}
              >
                <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin motion-reduce:animate-none')} />
                Atualizar
              </button>
            )}
            <Link
              href="/configuracoes/integracoes"
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-ig-fg-muted transition-colors hover:text-ig-accent"
            >
              Configurar <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          {esocial.connected && !esocial.automationEnabled && (
            <p className="mt-2 flex items-start gap-1 text-[9.5px] leading-snug text-ig-fg-subtle">
              <Zap className="mt-px h-2.5 w-2.5 shrink-0 text-ig-warning" />
              Sincronização automática desligada no servidor — rodando em modo de simulação.
            </p>
          )}
          {!esocial.connected && (
            <p className="mt-2 flex items-start gap-1 text-[9.5px] leading-snug text-ig-fg-subtle">
              <Zap className="mt-px h-2.5 w-2.5 shrink-0 text-ig-warning" />
              Configure o certificado A1 para que as guias sejam apuradas automaticamente.
            </p>
          )}
        </div>
      </div>

      {/* ── Trilha das obrigações ── */}
      <div className="relative space-y-3.5 px-5 py-4">
        {grouped.map(({ kind, items }, groupIdx) => {
          const km = KIND_META[kind];
          const KindIcon = km.icon;
          return (
            <div key={kind} className="space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle bg-ig-bg-raised text-[9px] font-bold tabular-nums text-ig-fg-muted">
                  {groupIdx + 1}
                </span>
                <KindIcon className="h-3.5 w-3.5 shrink-0 text-ig-accent" />
                <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-ig-fg-muted">
                  {km.label}
                </span>
                <span className="text-[10px] text-ig-fg-subtle">{km.hint}</span>
                <div className="h-px flex-1 bg-gradient-to-r from-ig-border-subtle to-transparent" />
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {items.map((o) => (
                  <ObligationCard key={o.id} o={o} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
