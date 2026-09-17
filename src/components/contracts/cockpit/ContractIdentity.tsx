'use client';

/**
 * Identidade do contrato — o cabeçalho contextual do cockpit.
 *
 * Responde "que contrato é este?" numa leitura: contraparte em destaque, código
 * e tipo como metadado, status e risco como sinais. É a única superfície do
 * cockpit onde tudo é apurado por construção — vem das colunas de `contracts`.
 */

import { cn } from '@/lib/utils';
import { HudSignal, type HudSignalTone } from '@/components/hud';
import { hasOfficialValue, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { renewalState, type RenewalState } from '@/lib/contracts/trust/signals';

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

/**
 * Rótulo de vigência PARA CHIP.
 *
 * `RENEWAL_LABEL` diz "Atenção (≤90d)" — e "Atenção" é o TOM, que o trilho do
 * chip já comunica sem gastar sete caracteres. Aqui o chip diz o assunto e o
 * prazo; a urgência é cor e posição, não adjetivo.
 */
const RENEWAL_CHIP: Record<RenewalState, string> = {
  expired: 'Vigência vencida',
  critical: 'Vigência ≤30d',
  attention: 'Vigência ≤90d',
  planned: 'Vigência ≤180d',
  stable: 'Vigência estável',
};

const RENEWAL_TONE: Record<RenewalState, HudSignalTone> = {
  expired: 'danger',
  critical: 'danger',
  attention: 'warning',
  planned: 'neutral',
  stable: 'neutral',
};

const text = (t: Official<string>, fallback: string) =>
  hasOfficialValue(t) ? t.value : fallback;

export interface ContractIdentityProps {
  contract: TrustedContract;
  className?: string;
  /**
   * Faixa de uma linha para o CABEÇALHO do drawer: código e sinais, sem o
   * título nem a contraparte — ambos já são impressos pelo cabeçalho (o nome
   * do contrato) e pelo cartão de resumo (a contraparte). Repeti-los era boa
   * parte do peso vertical que o painel lateral carregava.
   */
  compact?: boolean;
}

export function ContractIdentity({ contract, className, compact = false }: ContractIdentityProps) {
  const renewal = renewalState(contract);
  const statusLabel = STATUS_LABEL[contract.status] ?? contract.status;

  /*
    Os três sinais do contrato são Signal Chips do sistema (`HudSignal`) — a
    mesma peça que o resto do produto usa para status. A cápsula local que
    vivia aqui reimplementava a anatomia com outra altura, outro raio e outro
    peso de fonte: parecia status sem ser status.
  */
  const renewalSignal = hasOfficialValue(renewal) ? (
    <HudSignal size="sm" label={RENEWAL_CHIP[renewal.value]} tone={RENEWAL_TONE[renewal.value]} />
  ) : (
    <HudSignal size="sm" label="Vigência não cadastrada" tone="neutral" />
  );

  const statusSignal = (
    <HudSignal
      size="sm"
      label={statusLabel}
      tone={contract.status === 'active' || contract.status === 'signed' ? 'success' : 'accent'}
    />
  );

  const riskSignal = (
    <HudSignal
      size="sm"
      label={`Risco ${RISK_LABEL[contract.riskLevel]}`}
      tone={contract.riskLevel === 'high' ? 'danger' : contract.riskLevel === 'medium' ? 'warning' : 'success'}
    />
  );

  if (compact) {
    return (
      <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
        <span className="ig-tabular font-mono text-ig-caption font-semibold tracking-wide text-ig-fg-muted">
          {contract.code}
        </span>
        {statusSignal}
        {riskSignal}
        {renewalSignal}
      </div>
    );
  }

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

      <h2 className="mt-1.5 text-ig-h1 leading-tight text-ig-fg-strong">
        {text(contract.counterparty, 'Contraparte não informada')}
      </h2>
      <p className="mt-0.5 truncate text-ig-body-sm text-ig-fg-muted">{contract.title}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {statusSignal}
        {riskSignal}
        {renewalSignal}
      </div>
    </header>
  );
}
