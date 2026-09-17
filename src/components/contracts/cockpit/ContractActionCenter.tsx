'use client';

/**
 * CENTRAL DE AÇÃO — o que exige uma pessoa neste contrato, agora.
 *
 * ─── O que ela substitui ───────────────────────────────────────────────────
 *
 * Uma tabela administrativa de quatro colunas com rótulo de severidade,
 * título, idade e botão — todas as linhas com o mesmo peso, o rótulo repetindo
 * a mesma palavra três vezes seguidas, e a coluna de ação com um botão
 * desenhado em cada linha, competindo com o conteúdo.
 *
 * ─── A hierarquia é a do BACKEND ───────────────────────────────────────────
 *
 * `AttentionSeverity` já distingue quatro estados, e a distinção entre os dois
 * do meio é a que importa:
 *
 *   critical → há controle, e ele aponta ruptura
 *   warning  → há controle, e ele aponta problema (decisão parada)
 *   setup    → o controle NÃO EXISTE ainda (falta configurar)
 *   info     → observação
 *
 * Nada aqui inventa prioridade: a ordem é `severity` + `rank`, os dois campos
 * que `attentionItems` já produz. Misturar `warning` com `setup` — que era o
 * efeito de tratar todas as linhas igual — faz um contrato recém-cadastrado
 * parecer um contrato em dificuldade.
 *
 * ─── O resumo semântico ────────────────────────────────────────────────────
 *
 * "3 pendências · 1 decisão · 2 configuração" sai da contagem por severidade
 * dos itens recebidos. Nenhum número é escrito à mão e nenhuma categoria
 * aparece com zero.
 *
 * ─── A ponte com a Inteligência Contratual ────────────────────────────────
 *
 * O item "N interpretações contratuais requerem sua atenção" chega daqui com a
 * MESMA contagem da aba, porque `attentionItems` passou a derivá-la de
 * `contract_operational_interpretations` via `buildContractIntelligence` — a
 * mesma função que a aba usa. Ele também herda o mesmo âmbar e o mesmo ícone,
 * para que as duas superfícies se leiam como uma só.
 */

import { cn } from '@/lib/utils';
import {
  AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, Info, Settings2,
} from 'lucide-react';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';
import {
  ATTENTION_SEVERITY_ORDER, summarizeActions,
  type AttentionActionKey, type AttentionItem, type AttentionSeverity,
} from '@/lib/contracts/trust/attention';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

/**
 * O rótulo de cada estado, curto o bastante para caber na coluna da esquerda.
 *
 * `warning` é "Decisão" e não "Atenção": a seção inteira já se chama "Requer
 * ação", e repetir "atenção" dentro dela não acrescenta nada. O que distingue
 * este estado dos outros é que existe uma decisão parada.
 */
const SEVERITY: Record<AttentionSeverity, { label: string; icon: React.ReactNode }> = {
  critical: { label: 'Crítico', icon: <AlertOctagon className="h-3.5 w-3.5" aria-hidden /> },
  warning: { label: 'Decisão', icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> },
  setup: { label: 'Configuração', icon: <Settings2 className="h-3.5 w-3.5" aria-hidden /> },
  info: { label: 'Monitorar', icon: <Info className="h-3.5 w-3.5" aria-hidden /> },
};

export interface ContractActionCenterProps {
  readonly items: readonly AttentionItem[];
  readonly onAction?: (key: AttentionActionKey) => void;
  /** Fato do horizonte, para o estado vazio não dizer só "nenhum registro". */
  readonly emptyHint?: string | null;
  /**
   * `band` remove a folha própria: a central passa a ser a terceira dobra da
   * plataforma de comando, separada por fio e não por moldura.
   *
   * Empilhadas, a identidade, a faixa operacional e a central eram três
   * cartões brancos do mesmo peso — três vezes a mesma moldura para três
   * dobras de uma pergunta só ("como está este contrato, e o que falta").
   */
  readonly variant?: 'standalone' | 'band';
  readonly className?: string;
}

export function ContractActionCenter({
  items, onAction, emptyHint, variant = 'standalone', className,
}: ContractActionCenterProps) {
  const ordered = [...items].sort(
    (a, b) => ATTENTION_SEVERITY_ORDER[a.severity] - ATTENTION_SEVERITY_ORDER[b.severity] || a.rank - b.rank,
  );
  const breakdown = summarizeActions(ordered);

  return (
    <section
      className={cn(
        'px-5 py-4 md:px-7',
        variant === 'standalone' ? 'ig-deck' : 'border-t border-ig-border-subtle',
        className,
      )}
      data-testid="contract-attention"
      aria-label="Requer ação"
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-ig-h3 text-ig-fg-strong">Requer ação</h2>
        {ordered.length > 0 && (
          <>
            <span className="ig-ci-count px-2 py-0.5 text-ig-label font-semibold">
              {ordered.length}
            </span>
            <span className="text-ig-caption text-ig-fg-muted">
              {ordered.length === 1 ? 'pendência operacional' : 'pendências operacionais'}
              {breakdown && <span className="text-ig-fg-subtle"> · {breakdown}</span>}
            </span>
          </>
        )}
        <span className="ig-ci-zone-rule min-w-6 flex-1" aria-hidden />
      </div>

      {ordered.length === 0 ? (
        <div className="flex items-start gap-2.5 py-1">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ig-success" aria-hidden />
          <div>
            <p className="text-ig-body-sm font-medium text-ig-fg-strong">
              Nada exige ação agora
            </p>
            <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
              {emptyHint ?? 'Todas as dimensões apuradas deste contrato estão regulares.'}
            </p>
          </div>
        </div>
      ) : (
        <div>
          {ordered.map((item) => (
            <ActionRow key={item.id} item={item} onAction={onAction} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Uma pendência, em uma altura de linha.
 *
 * Quatro faixas no desktop — estado, assunto, dimensão, ação — e duas alturas
 * no telefone. O CTA é fantasma até o hover: sete botões desenhados ao mesmo
 * tempo transformam a coluna de ações no elemento mais pesado da seção, que é
 * o oposto do que ela precisa comunicar.
 */
function ActionRow({
  item, onAction,
}: {
  item: AttentionItem;
  onAction?: (key: AttentionActionKey) => void;
}) {
  const severity = SEVERITY[item.severity];
  /*
    A dimensão do item: exposição quando o dado a sustenta, idade quando não.
    Nunca as duas, e nunca um traço — um "—" aqui sugeriria que alguém tentou
    medir a exposição desta pendência e não encontrou.
  */
  const dimension = item.exposure && hasOfficialValue(item.exposure)
    ? BRL.format(item.exposure.value)
    : item.age;

  return (
    <article
      className="ig-act-row grid gap-x-4 gap-y-1 py-3 pl-4 md:grid-cols-[118px_minmax(0,1fr)_auto_auto] md:items-center"
      /* É daqui que saem o trilho e a cor do rótulo — ver `.ig-act-row[data-severity]`. */
      data-severity={item.severity}
    >
      <span className="ig-act-rail" aria-hidden />

      <span className={cn('ig-act-tag flex items-center gap-1.5 text-ig-label font-semibold')}>
        {severity.icon}
        {severity.label}
      </span>

      <div className="min-w-0">
        <h3 className="truncate text-ig-body-sm font-medium text-ig-fg-strong" title={item.title}>
          {item.title}
        </h3>
        <p className="truncate text-ig-caption text-ig-fg-muted" title={item.reason}>
          {item.reason}
        </p>
      </div>

      <span className="ig-tabular whitespace-nowrap text-ig-caption text-ig-fg-muted md:text-right">
        {dimension}
      </span>

      {onAction && (
        <button
          type="button"
          onClick={() => onAction(item.actionKey)}
          className="ig-act-cta inline-flex h-7 items-center gap-1.5 px-2.5 text-ig-label font-semibold md:justify-self-end"
        >
          {item.actionLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </article>
  );
}
