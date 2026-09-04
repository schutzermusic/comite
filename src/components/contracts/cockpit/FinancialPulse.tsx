'use client';

/**
 * Financial Pulse — a superfície financeira do cockpit (MD §8 do adendo).
 *
 * Substitui o bloco simples de exposição por uma leitura com hierarquia: uma
 * mensagem primária ("quanto está exposto?"), execução como segunda voz, e
 * faturado/backlog/próximo marco como terceira (MD §71 — uma mensagem primária
 * por superfície).
 *
 * ─── O que NÃO existe aqui ────────────────────────────────────────────────
 *
 * Nenhuma previsão, nenhuma curva projetada, nenhum "próximo marco estimado".
 * O próximo marco é a linha real mais próxima de `contract_billing_events`; se
 * não houver evento registrado, a seção diz isso em vez de desenhar uma
 * projeção. Forecast sem base é a forma mais convincente de mentira num painel
 * financeiro.
 */

import { cn } from '@/lib/utils';
import { Receipt, TrendingUp, CalendarClock } from 'lucide-react';
import { HudProgressBar } from '@/components/hud';
import { TrustedValue, TrustedCoverage } from './TrustedValue';
import { MetricRow } from '../shell/MetricRow';
import { hasOfficialValue, isError, ratioTrusted, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import type { ContractBillingEventRow } from '@/lib/contracts/contract-service';

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});
const BRL_FULL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const PAID_TOKENS = ['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado'];
const isPaid = (e: ContractBillingEventRow) =>
  Boolean(e.paid_at) || PAID_TOKENS.includes((e.status ?? '').toLowerCase());

/** Próximo marco REAL: o evento não realizado com vencimento mais próximo. */
function nextMilestone(contract: TrustedContract, now: Date): ContractBillingEventRow | null {
  if (!hasOfficialValue(contract.billingEvents)) return null;
  const pending = contract.billingEvents.value
    .filter((e) => !isPaid(e) && e.due_date)
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const future = pending.find((e) => new Date(e.due_date as string).getTime() >= now.getTime());
  return future ?? pending[0] ?? null;
}

export interface FinancialPulseProps {
  contract: TrustedContract;
  now?: Date;
  className?: string;
  /**
   * Faixa horizontal de quatro métricas, para o topo do dossiê.
   *
   * A leitura completa (barra de execução, próximo marco, contagem de eventos)
   * continua existindo — ela vive na aba Financeiro, que é onde alguém que
   * quer detalhe financeiro vai. No topo, quatro números alinhados respondem
   * "quanto vale e como está indo" em uma linha, em vez de ~320px de altura
   * empurrando a navegação para baixo da dobra.
   */
  compact?: boolean;
}

export function FinancialPulse({ contract, now = new Date(), className, compact = false }: FinancialPulseProps) {
  const execution = ratioTrusted(
    contract.billedValue,
    contract.totalValue,
    'faturado sobre valor contratado',
    ['contracts', 'contract_billing_events'],
  );
  const pct = hasOfficialValue(execution) ? Math.round(execution.value * 100) : null;
  const milestone = nextMilestone(contract, now);
  const milestoneOverdue = milestone?.due_date
    ? new Date(milestone.due_date).getTime() < now.getTime()
    : false;

  const eventCount = hasOfficialValue(contract.billingEvents) ? contract.billingEvents.value.length : null;
  const paidCount = hasOfficialValue(contract.billingEvents)
    ? contract.billingEvents.value.filter(isPaid).length
    : null;

  if (compact) {
    return (
      <MetricRow
        label="Pulso financeiro do contrato"
        className={className}
        columns={4}
        items={[
          {
            id: 'total',
            label: 'Valor contratado',
            value: <TrustedValue value={contract.totalValue} format={(v) => BRL_COMPACT.format(v)} size="md" metallic />,
          },
          {
            id: 'billed',
            label: 'Faturado',
            value: <TrustedValue value={contract.billedValue} format={(v) => BRL_COMPACT.format(v)} size="md" />,
            sub: eventCount === null ? undefined : `${paidCount} de ${eventCount} evento(s)`,
          },
          {
            id: 'backlog',
            label: 'Backlog',
            value: <TrustedValue value={contract.remainingValue} format={(v) => BRL_COMPACT.format(v)} size="md" />,
          },
          {
            id: 'execution',
            label: 'Execução',
            value: (
              <TrustedValue
                value={execution}
                format={(v) => `${Math.round(v * 100)}%`}
                size="md"
                missingLabel="Não apurada"
              />
            ),
            /*
              Sem apuração NÃO vira 0%. A faixa compacta herda a mesma regra da
              versão completa: o trilho tracejado diz "não há medição", uma
              barra vazia diria "a medição deu quase nada".
            */
            sub:
              pct === null ? (
                <span
                  className="mt-1 block h-1 w-full rounded-full border border-dashed border-ig-border-strong"
                  role="img"
                  aria-label="Execução financeira não apurada"
                />
              ) : (
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-ig-border-subtle">
                  <span
                    className="block h-full rounded-full bg-ig-success"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </span>
              ),
          },
        ]}
      />
    );
  }

  return (
    <section className={cn('relative', className)} aria-label="Pulso financeiro do contrato">
      {/* Linha primária: exposição domina; execução responde em segunda voz. */}
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-ig-label text-ig-fg-muted">Valor contratado</p>
          <div className="mt-1">
            <TrustedValue
              value={contract.totalValue}
              format={(v) => BRL_COMPACT.format(v)}
              size="hero"
              metallic
            />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-ig-label text-ig-fg-muted">Execução</p>
          <div className="mt-1 flex items-baseline justify-end gap-1.5">
            <TrustedValue
              value={execution}
              format={(v) => `${Math.round(v * 100)}%`}
              size="lg"
              missingLabel="Não apurada"
            />
          </div>
        </div>
      </div>

      {/* Barra: sem execução apurada fica neutra — 0% seria lido como "nada executado". */}
      <div className="mt-3">
        {/*
          `showLabel={false}` é obrigatório: a barra imprime o próprio
          "0%" por padrão, e um 0% ao lado de "Não apurada" é exatamente o
          achatamento MISSING → zero que o Trust Layer existe para impedir.
          O percentual já aparece acima, via TrustedValue.
        */}
        {/*
          Sem apuração, a barra vira um trilho TRACEJADO em vez de uma barra
          vazia: uma barra vazia de borda sólida, à distância, é lida como
          "existe uma medição e ela é baixa". O tracejado diz "não há medição".
        */}
        {pct === null ? (
          <div
            className="h-2 w-full rounded-full border border-dashed border-ig-border-strong"
            role="img"
            aria-label="Execução financeira não apurada"
          />
        ) : (
          <HudProgressBar value={pct} size="md" showLabel={false} variant="success" />
        )}
        {pct === null && (
          <p className="mt-1.5 text-ig-caption text-ig-fg-subtle">
            {isError(contract.billedValue)
              ? 'A leitura do faturamento falhou — a execução não pode ser calculada.'
              : 'Sem evento de faturamento registrado, a execução não pode ser apurada.'}
          </p>
        )}
      </div>

      {/* Terceira voz: faturado e backlog lado a lado. */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <PulseCell
          icon={<Receipt className="h-3.5 w-3.5" />}
          label="Faturado"
          value={contract.billedValue}
          accent="success"
        />
        <PulseCell
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Backlog"
          value={contract.remainingValue}
          accent="warning"
        />
      </div>

      {/* Próximo marco REAL, ou a declaração de que não há. */}
      <div className="mt-3 rounded-[12px] border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_55%,transparent)] px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-ig-label text-ig-fg-muted">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          Próximo marco financeiro
        </p>
        {milestone ? (
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-ig-body-sm font-semibold text-ig-fg-strong">
              {milestone.title}
            </span>
            {/* Coluna nullable: um marco sem valor cadastrado não vale R$ 0. */}
            <span className="ig-tabular shrink-0 text-ig-body-sm font-semibold text-ig-fg-strong">
              {milestone.amount === null || milestone.amount === undefined
                ? <span className="font-medium text-ig-fg-subtle">Valor não informado</span>
                : BRL_FULL.format(Number(milestone.amount))}
            </span>
          </div>
        ) : (
          <p className="mt-1.5 text-ig-body-sm text-ig-fg-subtle">
            {eventCount === null
              ? 'Não apurado'
              : 'Nenhum evento pendente registrado.'}
          </p>
        )}
        {milestone?.due_date && (
          <p className={cn('mt-1 text-ig-caption', milestoneOverdue ? 'font-semibold text-ig-danger' : 'text-ig-fg-muted')}>
            {milestoneOverdue ? 'Vencido em ' : 'Vence em '}
            {new Date(milestone.due_date).toLocaleDateString('pt-BR')}
          </p>
        )}
        {eventCount !== null && eventCount > 0 && (
          <p className="mt-1.5 text-ig-caption text-ig-fg-subtle">
            {paidCount} de {eventCount} evento(s) realizado(s)
          </p>
        )}
      </div>
    </section>
  );
}

function PulseCell({
  icon, label, value, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: Official<number>;
  accent: 'success' | 'warning';
}) {
  const measured = hasOfficialValue(value);
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[12px] border px-3.5 py-3',
        measured
          ? 'border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_55%,transparent)]'
          : 'border-dashed border-ig-border-subtle bg-transparent',
      )}
    >
      {measured && (
        <span
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-px',
            accent === 'success'
              ? 'bg-[linear-gradient(90deg,transparent,var(--ig-success),transparent)]'
              : 'bg-[linear-gradient(90deg,transparent,var(--ig-warning),transparent)]',
          )}
          aria-hidden
        />
      )}
      <p className="flex items-center gap-1.5 text-ig-label text-ig-fg-muted">
        <span className="text-ig-fg-subtle">{icon}</span>
        {label}
      </p>
      <div className="mt-1 flex items-baseline gap-2">
        <TrustedValue value={value} format={(v) => BRL_COMPACT.format(v)} size="md" />
      </div>
      <TrustedCoverage value={value} className="mt-0.5 block" />
    </div>
  );
}
