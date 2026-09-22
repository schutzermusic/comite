'use client';

/**
 * "NF A EMITIR" — o trabalho do Financeiro, com a autorização ao lado.
 *
 * ─── Por que este painel mora no Fiscal ────────────────────────────────────
 *
 * Porque é aqui que a nota é criada, por quem pode criá-la. Contratos não
 * escreve `fiscal_documents` — nem aqui nem em lugar nenhum —, e um botão
 * "emitir" em Contratos seria a fronteira da §29 caindo por conveniência de
 * navegação.
 *
 * ─── O recorte é LIBERAÇÃO, não elegibilidade ─────────────────────────────
 *
 * Só entra o que uma pessoa liberou (`RELEASED`) e que ainda não tem documento
 * fiscal. Elegibilidade é direito apurado; liberação é decisão. Listar o
 * elegível aqui colocaria o Financeiro emitindo nota sobre um direito que
 * ninguém autorizou.
 *
 * ─── Ausência não é zero ───────────────────────────────────────────────────
 *
 * Valor sem procedência sai como "não apurado"; prazo sem título sai como "sem
 * título financeiro". Nenhuma das duas vira R$ 0,00 nem uma data inventada.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, FileWarning, Loader2, Receipt } from 'lucide-react';
import { HudBadge, HudEmptyState, HudPanel } from '@/components/hud';
import { contractHref } from '@/lib/projects/cross-module-links';
import {
  listInvoicesToIssue, type ContractToCashRow,
} from '@/lib/contracts/billing/contract-to-cash-service';

const fmtDate = (iso: string | null) =>
  (iso ? iso.slice(0, 10).split('-').reverse().join('/') : null);

const fmtMoney = (v: number | null, currency: string | null) =>
  (v == null ? null : new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: currency || 'BRL',
  }).format(v));

export function InvoicesToIssuePanel() {
  const [rows, setRows] = useState<readonly ContractToCashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void listInvoicesToIssue()
      .then((r) => { if (alive) { setRows(r); setError(null); } })
      // Fila indisponível não é fila vazia: dizer "nada a emitir" quando a
      // consulta falhou afirmaria ausência que ninguém verificou.
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <HudPanel>
        <div className="flex items-center gap-2 p-6 text-sm text-ig-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando autorizações de faturamento…
        </div>
      </HudPanel>
    );
  }

  if (error) {
    return <HudPanel><div className="p-6 text-sm text-ig-danger">{error}</div></HudPanel>;
  }

  if (rows.length === 0) {
    return (
      <HudPanel>
        <HudEmptyState
          icon="custom"
          customIcon={<Receipt className="h-12 w-12" />}
          title="Nenhuma NF a emitir"
          description={
            'Esta fila mostra faturamentos LIBERADOS por decisão humana e ainda sem documento '
            + 'fiscal. Ela vazia significa que nada foi liberado sem nota — não que não haja '
            + 'direito contratual previsto, que continua em Contratos → Faturamentos.'
          }
        />
      </HudPanel>
    );
  }

  return (
    <HudPanel>
      <div className="flex flex-wrap items-center gap-2 border-b border-ig-border-subtle/60 px-3 py-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
          NF a emitir
        </h3>
        <HudBadge variant="warning" size="sm">{rows.length} autorização(ões)</HudBadge>
      </div>

      <ul className="divide-y divide-ig-border-subtle/30">
        {rows.map((r) => {
          const amount = fmtMoney(r.eligibleAmount, r.currency);
          const due = fmtDate(r.dueDate);
          return (
            <li key={r.billingEventId} className="space-y-1 px-3 py-2.5 text-[13px]">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate font-medium text-ig-fg">{r.title}</p>
                <span className={amount ? 'shrink-0 tabular-nums text-ig-fg' : 'shrink-0 italic text-ig-fg-disabled'}>
                  {/* Valor sem procedência é "não apurado", nunca zero. */}
                  {amount ?? 'valor não apurado'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ig-fg-muted">
                <span>liberado em {fmtDate(r.releasedAt) ?? '—'}</span>
                {/*
                  A REFERÊNCIA DO ACEITE. Sem medição de origem a linha é
                  legada, e a tela diz isso em vez de omitir a lacuna.
                */}
                {r.sourceMeasurementId
                  ? <span>· origem: medição aceita</span>
                  : <span className="text-ig-warning">· sem medição de origem (linha legada)</span>}
                <span>· {r.amountSource ?? 'procedência do valor desconhecida'}</span>
                {due
                  ? <span>· vencimento {due}</span>
                  : <span>· sem título financeiro ainda</span>}
              </div>

              {/*
                Os BLOQUEIOS fiscais, nomeados. `BLOCKED_BY_CONFIGURATION` é
                desfecho legítimo — estabelecimento, catálogo e perfil de parte
                são cadastro do Fiscal, e dizer o código é o que permite ir
                resolvê-lo em vez de tentar emitir de novo.
              */}
              {r.fiscalBlockers.length > 0 && (
                <ul className="space-y-0.5">
                  {r.fiscalBlockers.map((b) => (
                    <li key={b.code} className="inline-flex items-center gap-1 text-[11px] text-ig-warning">
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {b.code}{b.detail ? ` — ${b.detail}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {r.fiscalRequestState && r.fiscalBlockers.length === 0 && (
                <p className="inline-flex items-center gap-1 text-[11px] text-ig-fg-subtle">
                  <FileWarning className="h-3 w-3" aria-hidden />
                  pedido ao Fiscal: {r.fiscalRequestState}
                </p>
              )}

              <Link
                href={contractHref(r.contractId)}
                className="inline-flex items-center gap-1 text-[11px] text-ig-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden /> Ver autorização no contrato
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-ig-border-subtle/60 px-3 py-2 text-[10px] text-ig-fg-subtle">
        Emitir, transmitir e acompanhar a nota continuam sendo atos do Fiscal. Contratos e Projetos
        não criam documento fiscal, recebível nem pagamento.
      </p>
    </HudPanel>
  );
}
