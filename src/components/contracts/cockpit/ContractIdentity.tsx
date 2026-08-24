'use client';

/**
 * Identidade do contrato — o cabeçalho contextual do cockpit.
 *
 * Responde "que contrato é este?" numa leitura: contraparte em destaque, código
 * e tipo como metadado, status e risco como sinais. É a única superfície do
 * cockpit onde tudo é apurado por construção — vem das colunas de `contracts`.
 */

import { cn } from '@/lib/utils';
import { hasOfficialValue, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { renewalState, RENEWAL_LABEL } from '@/lib/contracts/trust/signals';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  negotiation: 'Em negociação',
  legal_review: 'Revisão jurídica',
  commercial_review: 'Revisão comercial',
  signed: 'Assinado',
  active: 'Ativo',
  expiring_soon: 'Expirando',
  expired: 'Expirado',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
  archived: 'Arquivado',
};

const RISK_LABEL = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;

/** Cápsula de sinal com rail tonal — a linguagem do HudSignal, sem pill. */
function Signal({
  label, tone,
}: {
  label: string;
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const TONE: Record<typeof tone, { rail: string; text: string }> = {
    accent: { rail: 'bg-ig-accent', text: 'text-ig-accent' },
    success: { rail: 'bg-ig-success', text: 'text-ig-success' },
    warning: { rail: 'bg-ig-warning', text: 'text-ig-warning' },
    danger: { rail: 'bg-ig-danger', text: 'text-ig-danger' },
    neutral: { rail: 'bg-ig-border-strong', text: 'text-ig-fg-muted' },
  };
  const t = TONE[tone];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_60%,transparent)] py-1 pl-1 pr-2.5">
      <span className={cn('h-3.5 w-[2px] rounded-full', t.rail)} aria-hidden />
      <span className={cn('text-ig-caption font-semibold', t.text)}>{label}</span>
    </span>
  );
}

const text = (t: Official<string>, fallback: string) =>
  hasOfficialValue(t) ? t.value : fallback;

export interface ContractIdentityProps {
  contract: TrustedContract;
  className?: string;
}

export function ContractIdentity({ contract, className }: ContractIdentityProps) {
  const renewal = renewalState(contract);
  const statusLabel = STATUS_LABEL[contract.status] ?? contract.status;

  return (
    <header className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="ig-tabular font-mono text-ig-caption font-semibold tracking-wide text-ig-fg-muted">
          {contract.code}
        </span>
        <span className="text-ig-fg-subtle" aria-hidden>·</span>
        <span className="truncate text-ig-caption text-ig-fg-muted">
          {text(contract.contractType, 'Tipo não informado')}
        </span>
      </div>

      <h2 className="mt-1.5 text-[22px] font-semibold leading-tight text-ig-fg-strong">
        {text(contract.counterparty, 'Contraparte não informada')}
      </h2>
      <p className="mt-0.5 truncate text-ig-body-sm text-ig-fg-muted">{contract.title}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Signal
          label={statusLabel}
          tone={contract.status === 'active' || contract.status === 'signed' ? 'success' : 'accent'}
        />
        <Signal
          label={`Risco ${RISK_LABEL[contract.riskLevel]}`}
          tone={contract.riskLevel === 'high' ? 'danger' : contract.riskLevel === 'medium' ? 'warning' : 'success'}
        />
        {hasOfficialValue(renewal) ? (
          <Signal
            label={RENEWAL_LABEL[renewal.value]}
            tone={
              renewal.value === 'expired' || renewal.value === 'critical'
                ? 'danger'
                : renewal.value === 'attention'
                  ? 'warning'
                  : 'neutral'
            }
          />
        ) : (
          <Signal label="Vigência não cadastrada" tone="neutral" />
        )}
      </div>
    </header>
  );
}
