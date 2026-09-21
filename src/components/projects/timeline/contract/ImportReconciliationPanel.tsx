'use client';

/**
 * O RESULTADO CONTRATUAL da importação de cronograma.
 *
 * ─── Por que este bloco existe ────────────────────────────────────────────
 *
 * A importação já dizia "57 atividades processadas". Isso responde sobre o
 * arquivo. A pergunta que vem logo depois é sobre o CONTRATO: dos seis eventos
 * de medição deste projeto, quantos passaram a ter lugar no cronograma?
 *
 * Sem esta resposta na hora, ela só aparecia quando alguém abria Contratos —
 * e um marco de R$ 803.233,98 sem etapa ficava semanas sem dono.
 *
 * ─── O que ele nunca faz ──────────────────────────────────────────────────
 *
 * Não celebra. "4 sincronizados · 1 sugerido · 1 sem correspondência" não é
 * um placar: sugerido é trabalho pendente e sem correspondência é um alerta.
 * O botão de ação principal leva à revisão, não ao fechamento.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Landmark, MinusCircle } from 'lucide-react';
import type { ProposalRunResult } from '@/lib/projects/contract-events';

interface Props {
  readonly report: ProposalRunResult | null;
  readonly onReview?: () => void;
}

function Line({ icon: Icon, color, value, label, hint }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string; value: number; label: string; hint?: string;
}) {
  if (value === 0) return null;
  return (
    <li className="flex items-center gap-2 text-[12px]" title={hint}>
      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      <strong className="tabular-nums text-ig-fg-strong">{value}</strong>
      <span className="text-ig-fg-muted">{label}</span>
    </li>
  );
}

export function ImportReconciliationPanel({ report, onReview }: Props) {
  /*
    `null` e zero contam histórias diferentes, e a tela conta as duas.

    `null` = a reconciliação falhou (e o cronograma foi gravado assim mesmo).
    Fingir "0 eventos" aqui afirmaria que o projeto não tem contrato ligado.
  */
  if (report === null) {
    return (
      <div className="w-full rounded-lg border border-dashed border-ig-border px-3 py-2 text-left">
        <p className="flex items-center gap-1.5 text-[12px] text-ig-warning">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          A análise dos eventos contratuais não pôde ser concluída.
        </p>
        <p className="mt-0.5 text-[11px] text-ig-fg-subtle">
          O cronograma foi importado normalmente. A análise pode ser refeita a partir
          do contrato, sem nova importação.
        </p>
      </div>
    );
  }

  if (report.contractEvents === 0) {
    return (
      <p className="text-[11px] text-ig-fg-subtle">
        Nenhum contrato com marco de medição está ligado a este projeto — não há evento
        contratual a reconciliar.
      </p>
    );
  }

  const pending = report.suggested + report.ambiguous + report.unmatched;

  return (
    <div
      className="w-full rounded-lg border px-3 py-2 text-left"
      style={{
        borderColor: 'color-mix(in oklab, var(--ig-contract) 35%, transparent)',
        background: 'var(--ig-contract-weak)',
      }}
    >
      <p className="flex items-center gap-1.5">
        <Landmark className="h-3.5 w-3.5" style={{ color: 'var(--ig-contract)' }} aria-hidden />
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: 'var(--ig-contract)' }}
        >
          Eventos contratuais
        </span>
        <span className="text-[11px] text-ig-fg-muted">
          {report.contractEvents} {report.contractEvents === 1 ? 'evento de medição' : 'eventos de medição'}
        </span>
      </p>

      <ul className="mt-1.5 space-y-0.5">
        <Line
          icon={CheckCircle2} color="var(--ig-contract)"
          value={report.synchronized} label="sincronizados"
          hint="Ponte já aceita: a data nova do cronograma já alimenta a previsão, sem pedir nada a ninguém."
        />
        <Line
          icon={HelpCircle} color="var(--ig-warning)"
          value={report.suggested} label={report.suggested === 1 ? 'vínculo sugerido' : 'vínculos sugeridos'}
          hint="Proposta do sistema. Não alimenta previsão nenhuma antes de um aceite humano."
        />
        <Line
          icon={AlertTriangle} color="var(--ig-warning)"
          value={report.ambiguous} label={report.ambiguous === 1 ? 'ambíguo' : 'ambíguos'}
          hint="Mais de uma etapa explica o marco igualmente bem — exige escolha humana."
        />
        <Line
          icon={MinusCircle} color="var(--ig-fg-disabled)"
          value={report.unmatched} label="sem correspondência"
          hint="Nenhuma etapa deste cronograma sustenta o marco."
        />
      </ul>

      {pending > 0 && onReview && (
        <button type="button" className="portfolio-action mt-2" onClick={onReview}>
          Revisar eventos ({pending})
        </button>
      )}
    </div>
  );
}
