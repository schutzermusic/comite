'use client';

/**
 * FATURAMENTOS — a cadeia contrato-a-caixa, operável.
 *
 * ─── Uma tela, um cálculo ─────────────────────────────────────────────────
 *
 * Este componente é usado pela seção `Faturamentos` da carteira E pela aba
 * `Financeiro` do dossiê do contrato. Os dois chamam o MESMO serviço, que lê a
 * MESMA visão do banco. A §87 pede exatamente isso, e a razão é histórica:
 * quando cada tela somava por conta própria, uma delas passou a apresentar
 * previsão contratual como valor apurado.
 *
 * ─── O que esta tela recusa mostrar ───────────────────────────────────────
 *
 * "R$ 0 recebido" quando não há título em Finanças. A §62 é literal, e o
 * módulo de derivação devolve DESCONHECIDO nesse caso — aqui só se escolhe a
 * palavra. Também não há KPI de DSO, de "pronto para faturar" nem de
 * inadimplência: a §121 os proíbe enquanto não vierem só de dado real, e a
 * base de produção não tem nenhum.
 *
 * ─── O que esta tela NÃO opera ────────────────────────────────────────────
 *
 * Emissão de nota (é do Fiscal, §89), registro de recebimento e conciliação
 * (são de Finanças, §88). Contratos libera o faturamento e mostra o resto.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleSlash, FileText, HelpCircle, Loader2, Send,
} from 'lucide-react';
import { HudBadge, HudPanel } from '@/components/hud';
import { cn } from '@/lib/utils';
import {
  listContractToCash, listContractToCashForContracts, releaseBillingEvent,
  type ContractToCashRow,
} from '@/lib/contracts/billing/contract-to-cash-service';
import {
  AMOUNT_SOURCE_LABEL, ELIGIBILITY_LABEL, FINANCE_LINK_LABEL, RECEIVABLE_STATUS_LABEL,
  RELEASE_LABEL, advisoryReasons, blockerLabel, blockingReasons, canRelease, chainStage,
  displayText, eligibleAmount, openAmount, receivedAmount, reconciliationPending,
} from '@/lib/contracts/billing/contract-to-cash-display';

interface Props {
  /** Um contrato (dossiê) ou vários (carteira). */
  readonly contractId?: string;
  readonly contractIds?: readonly string[];
  /** Rótulo do contrato, quando a lista mistura vários. */
  readonly contractLabel?: (contractId: string) => string;
  readonly onNotify?: (message: string, variant: 'success' | 'error') => void;
}

export function ContractToCashPanel({ contractId, contractIds, contractLabel, onNotify }: Props) {
  const [rows, setRows] = useState<ContractToCashRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const ids = useMemo(
    () => (contractId ? [contractId] : [...(contractIds ?? [])]),
    [contractId, contractIds],
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = contractId
        ? await listContractToCash(contractId)
        : await listContractToCashForContracts(ids);
      setRows(data);
    } catch (e) {
      // A tabela pode não existir num ambiente que ainda não aplicou a fase.
      // Dizer isso é melhor que uma lista vazia, que se lê como "nada a faturar".
      setError(e instanceof Error ? e.message : 'Falha ao carregar a cadeia de faturamento.');
      setRows([]);
    }
  }, [contractId, ids]);

  useEffect(() => { void load(); }, [load]);

  const release = async (row: ContractToCashRow) => {
    setBusyId(row.billingEventId);
    try {
      const result = await releaseBillingEvent(row.billingEventId);
      onNotify?.(
        result.releaseState === 'PENDING_RELEASE'
          ? 'Liberação enviada para aprovação.'
          : 'Faturamento liberado.',
        'success',
      );
      await load();
    } catch (e) {
      onNotify?.(e instanceof Error ? e.message : 'Falha ao liberar faturamento.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (rows === null) {
    return (
      <HudPanel>
        <div className="flex items-center gap-2 p-6 text-ig-caption text-ig-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando a cadeia de faturamento…
        </div>
      </HudPanel>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <HudPanel>
          <div className="flex items-start gap-2 p-4 text-ig-caption text-ig-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </HudPanel>
      )}

      {rows.length === 0 && !error && (
        <HudPanel>
          <p className="p-6 text-center text-ig-caption text-ig-fg-muted">
            Nenhum evento de faturamento neste recorte.
          </p>
        </HudPanel>
      )}

      {rows.map((row) => (
        <BillingEventCard
          key={row.billingEventId}
          row={row}
          label={contractLabel?.(row.contractId)}
          busy={busyId === row.billingEventId}
          onRelease={() => release(row)}
        />
      ))}
    </div>
  );
}

function BillingEventCard({
  row, label, busy, onRelease,
}: {
  row: ContractToCashRow; label?: string; busy: boolean; onRelease: () => void;
}) {
  const eligible = eligibleAmount(row);
  const received = receivedAmount(row);
  const open = openAmount(row);
  const blocking = blockingReasons(row);
  const advisory = advisoryReasons(row);
  const unreconciled = reconciliationPending(row);

  return (
    <HudPanel>
      <div className="space-y-3 p-4">
        {/* ---- identidade e estágio ---- */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-ig-body font-medium text-ig-fg">{row.title}</p>
            {label && <p className="truncate text-ig-caption text-ig-fg-muted">{label}</p>}
          </div>
          <HudBadge className={cn(
            row.releaseState === 'RELEASED' && 'text-ig-success',
            row.eligibilityState === 'BLOCKED' && 'text-ig-danger',
            row.legacyRow && 'text-ig-fg-subtle',
          )}>
            {chainStage(row)}
          </HudBadge>
        </div>

        {/* ---- os valores, cada um com o seu estado ---- */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric
            label="Elegível a faturar"
            value={displayText(eligible)}
            muted={!eligible.known}
            /* A PROCEDÊNCIA anda junto do número, sempre (§108). Sem ela,
               "faturado pelo previsto" e "faturado pelo medido" voltam a ser
               indistinguíveis — que foi o defeito que a Fase 7 corrigiu. */
            hint={row.amountSource ? AMOUNT_SOURCE_LABEL[row.amountSource] : 'Sem procedência'}
          />
          <Metric
            label="Nota fiscal"
            value={row.fiscalDocumentNumber ?? (row.fiscalDocumentId ? 'Em preparo' : '—')}
            muted={!row.fiscalDocumentNumber}
            hint={row.fiscalDocumentStatus
              ? `${row.fiscalDocumentStatus}${row.fiscalEnvironment === 'homologation' ? ' · homologação' : ''}`
              : (row.fiscalRequestState ?? 'Sem pedido')}
          />
          <Metric
            label="Recebido"
            value={displayText(received)}
            muted={!received.known}
            hint={row.receivableStatus
              ? RECEIVABLE_STATUS_LABEL[row.receivableStatus]
              : FINANCE_LINK_LABEL[row.financeLinkState]}
          />
          <Metric
            label="Em aberto"
            value={displayText(open)}
            muted={!open.known}
            hint={row.dueDate ? `Vence em ${fmtDate(row.dueDate)}` : 'Sem vencimento registrado'}
          />
        </div>

        {/* ---- elegibilidade e liberação: dimensões distintas (§14, §60) ---- */}
        <div className="flex flex-wrap items-center gap-2 text-ig-caption">
          <HudBadge>{`Elegibilidade: ${row.eligibilityState ? ELIGIBILITY_LABEL[row.eligibilityState] : '—'}`}</HudBadge>
          <HudBadge>{`Liberação: ${row.releaseState ? RELEASE_LABEL[row.releaseState] : '—'}`}</HudBadge>
          {row.ledgerPostingState && row.ledgerPostingState !== 'NOT_POSTED' && (
            <HudBadge>{`Razão: ${row.ledgerPostingState === 'POSTED' ? 'lançado' : 'pendente de configuração'}`}</HudBadge>
          )}
          {/* Conciliado NÃO é o mesmo que recebido (§49). */}
          {unreconciled !== null && unreconciled > 0 && (
            <HudBadge className="text-ig-warning">
              {`${unreconciled} recebimento(s) sem conciliação bancária`}
            </HudBadge>
          )}
        </div>

        {/* ---- por que não se pode faturar ---- */}
        {blocking.length > 0 && (
          <ReasonList
            tone="danger"
            title="Impede o faturamento"
            reasons={blocking.map((b) => ({
              code: b.code,
              text: b.title ? `${blockerLabel(b.code)} — ${b.title}` : blockerLabel(b.code),
              detail: b.why ?? b.detail,
            }))}
          />
        )}
        {advisory.length > 0 && (
          <ReasonList
            tone="muted"
            title="Não impede o direito, trava o próximo passo"
            reasons={advisory.map((b) => ({
              code: b.code, text: blockerLabel(b.code), detail: b.detail,
            }))}
          />
        )}
        {row.fiscalBlockers.length > 0 && (
          <ReasonList
            tone="muted"
            title="Emissão fiscal bloqueada por configuração"
            reasons={row.fiscalBlockers.map((b) => ({
              code: b.code, text: blockerLabel(b.code), detail: b.detail,
            }))}
          />
        )}
        {row.ledgerBlockers.length > 0 && (
          <ReasonList
            tone="muted"
            title="Lançamento contábil bloqueado por configuração"
            reasons={row.ledgerBlockers.map((b) => ({
              code: b.code, text: blockerLabel(b.code), detail: b.detail,
            }))}
          />
        )}

        {/* ---- o único ato desta tela ---- */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-ig-caption text-ig-fg-subtle">
            {row.legacyRow
              ? 'Faturamento anterior à Fase 7: mantido como histórico, sem procedência de valor.'
              : row.releasedAt
                ? `Liberado em ${fmtDate(row.releasedAt)}.`
                : 'Medir e aceitar não fatura: a liberação é um ato à parte.'}
          </p>
          {canRelease(row) && (
            <button
              type="button"
              onClick={onRelease}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-ig-border px-3 py-1.5 text-ig-caption text-ig-fg hover:bg-ig-bg-elevated disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Liberar faturamento
            </button>
          )}
        </div>
      </div>
    </HudPanel>
  );
}

function Metric({ label, value, hint, muted }: {
  label: string; value: string; hint?: string; muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-ig-caption text-ig-fg-muted">{label}</p>
      <p className={cn('truncate text-ig-body font-medium',
        muted ? 'text-ig-fg-subtle italic' : 'text-ig-fg')}>{value}</p>
      {hint && <p className="truncate text-ig-caption text-ig-fg-subtle">{hint}</p>}
    </div>
  );
}

function ReasonList({ title, reasons, tone }: {
  title: string;
  reasons: readonly { code: string; text: string; detail?: string }[];
  tone: 'danger' | 'muted';
}) {
  return (
    <div className="rounded-md border border-ig-border/60 p-2.5">
      <p className={cn('mb-1 flex items-center gap-1.5 text-ig-caption font-medium',
        tone === 'danger' ? 'text-ig-danger' : 'text-ig-fg-muted')}>
        {tone === 'danger' ? <CircleSlash className="h-3.5 w-3.5" /> : <HelpCircle className="h-3.5 w-3.5" />}
        {title}
      </p>
      <ul className="space-y-0.5">
        {reasons.map((r, i) => (
          <li key={`${r.code}-${i}`} className="text-ig-caption text-ig-fg-muted">
            {r.text}
            {r.detail && <span className="text-ig-fg-subtle"> — {r.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const fmtDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
