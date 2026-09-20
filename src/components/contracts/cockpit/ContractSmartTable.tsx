'use client';

/**
 * Smart Table de contratos (MD §16).
 *
 * Tabela de leitura densa para carteira enterprise: ordenação por qualquer
 * coluna, busca, colunas configuráveis e a linha inteira abrindo o Quick
 * Dossier.
 *
 * Não usa `HudTable`: aquele primitivo é usado em ~30 telas, não tem ordenação
 * real e anima cada linha individualmente — trocá-lo ali seria mexer em módulos
 * que não fazem parte deste trabalho. Esta tabela é local a Contratos e
 * construída sobre os mesmos tokens.
 *
 * A densidade é deliberada (MD §72): tabela é área de alta densidade, e
 * espremer aqui é o que a MD pede, ao contrário do que vale para os cards.
 */

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { HudSignal, type HudSignalTone } from '@/components/hud';
import {
  ArrowUpDown, ArrowUp, ArrowDown, ArrowRight, Search, Workflow, AlertTriangle,
  Settings2, X,
} from 'lucide-react';
import { hasOfficialValue, isError, ratioTrusted, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { obligationBreakdown, missingDocuments, contractHealth } from '@/lib/contracts/trust/signals';
import { attentionItems } from '@/lib/contracts/trust/attention';
import { DataClassBadge } from './PortfolioScope';
import { ClientLogoBanner } from '@/components/portfolio/ClientLogoBanner';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', negotiation: 'Negociação', legal_review: 'Rev. jurídica',
  commercial_review: 'Rev. comercial', signed: 'Assinado', active: 'Ativo',
  expiring_soon: 'Expirando', expired: 'Expirado', closed: 'Encerrado',
  cancelled: 'Cancelado', archived: 'Arquivado',
};
const RISK_LABEL = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;

export type SmartColumnKey =
  | 'contract' | 'counterparty' | 'project' | 'status' | 'risk'
  | 'value' | 'billing' | 'obligations' | 'documents' | 'approvals' | 'health'
  // ---- operacionalização: o que o Apex sabe e o que sobrou para você ----
  | 'attention' | 'apexState'
  // Coluna de saída: não ordena, não se esconde — é a afordância de abertura.
  | 'open';

const COLUMNS: { key: SmartColumnKey; label: string; align?: 'right'; width?: string; optional?: boolean }[] = [
  /*
    Só a contraparte absorve folga (`1fr`). Métricas e Apex alinham à ESQUERDA
    (conteúdo começa na ponta da coluna) — alinhamento à direita empurrava
    números para o final e confundia a leitura horizontal. Larguras um pouco
    folgadas para o gap entre Faturamento…Apex não colar os rótulos.
  */
  { key: 'counterparty', label: 'Contraparte', width: 'minmax(260px,1fr)' },
  { key: 'contract', label: 'Contrato', width: '168px' },
  { key: 'project', label: 'Projeto', width: '128px' },
  { key: 'status', label: 'Status', width: '108px' },
  { key: 'risk', label: 'Risco', width: '76px', optional: true },
  { key: 'value', label: 'Valor', width: '84px' },
  { key: 'billing', label: 'Faturamento', width: '130px' },
  { key: 'obligations', label: 'Obrigações', width: '122px' },
  { key: 'documents', label: 'Documentos', width: '130px', optional: true },
  { key: 'approvals', label: 'Aprovações', width: '128px', optional: true },
  { key: 'health', label: 'Cobertura', width: '118px', optional: true },
  { key: 'attention', label: 'Requer você', width: '128px' },
  { key: 'apexState', label: 'Apex', width: '156px' },
  { key: 'open', label: '', width: '44px' },
];

/** Pixels mínimos de uma trilha — `minmax(260px,1fr)` → 260; `130px` → 130. */
function trackMinPx(width: string | undefined): number {
  if (!width) return 0;
  const minmax = /^minmax\((\d+)px,/i.exec(width);
  if (minmax) return Number(minmax[1]);
  const fixed = /^(\d+)px$/i.exec(width);
  return fixed ? Number(fixed[1]) : 0;
}

/** Tons canônicos de status e risco — os mesmos do Signal Chip do sistema. */
const STATUS_TONE: Record<string, HudSignalTone> = {
  draft: 'neutral', negotiation: 'info', legal_review: 'info',
  commercial_review: 'info', signed: 'success', active: 'success',
  expiring_soon: 'warning', expired: 'danger', closed: 'neutral',
  cancelled: 'danger', archived: 'neutral',
};

const RISK_TONE: Record<'low' | 'medium' | 'high', HudSignalTone> = {
  high: 'danger', medium: 'warning', low: 'success',
};

/**
 * O que o Apex está fazendo por este contrato.
 *
 * A ordem das checagens é a ordem da urgência: um contrato bloqueado é
 * bloqueado mesmo que também tenha obrigações em dia. `sem vínculo operacional`
 * vem por último porque é uma lacuna de configuração, não um problema de
 * execução — e reportá-la primeiro esconderia o que está pegando fogo.
 */
export type ApexContractState =
  | 'blocked' | 'attention' | 'monitoring' | 'awaiting_schedule' | 'unlinked' | 'idle';

const APEX_STATE_LABEL: Record<ApexContractState, string> = {
  blocked: 'Faturamento bloqueado',
  attention: 'Requer decisão',
  monitoring: 'Monitorando',
  awaiting_schedule: 'Aguardando agenda',
  unlinked: 'Sem vínculo operacional',
  idle: 'Sem exigência ativa',
};

const APEX_STATE_TONE: Record<ApexContractState, HudSignalTone> = {
  blocked: 'danger',
  attention: 'warning',
  monitoring: 'accent',
  awaiting_schedule: 'accent',
  unlinked: 'neutral',
  idle: 'neutral',
};

/** Uma linha já resolvida — ordenação e busca operam sobre valores, não JSX. */
type Row = {
  contract: TrustedContract;
  code: string;
  counterparty: string;
  project: string | null;
  projectErrored: boolean;
  status: string;
  risk: 'low' | 'medium' | 'high';
  value: number | null;
  billed: number | null;
  execPct: number | null;
  billingEvents: number | null;
  obligationsTotal: number | null;
  obligationsOverdue: number;
  documentsTotal: number | null;
  documentsPending: number;
  approvalsTotal: number | null;
  approvalsPending: number;
  healthAssessed: number;
  healthTotal: number;
  criticalCount: number;
  /** Itens que EXIGEM uma pessoa. Nunca o tamanho do acervo. */
  attentionCount: number;
  apexState: ApexContractState;
  searchBlob: string;
};

const val = (t: Official<string>) => (hasOfficialValue(t) ? t.value : '');

function toRow(c: TrustedContract, now: Date): Row {
  const exec = ratioTrusted(c.billedValue, c.totalValue, 'exec', ['contracts', 'contract_billing_events']);
  const obl = obligationBreakdown(c);
  const docs = missingDocuments(c);
  const health = contractHealth(c);
  const attention = attentionItems(c, now);
  const counterparty = val(c.counterparty) || c.title;
  const project = hasOfficialValue(c.project) ? c.project.value.codigo : null;

  /*
    Atenção humana é EXCEÇÃO (migration 154). Contamos as interpretações que a
    política marcou, mais os itens críticos de operação. Cláusula sem
    classificação — linha anterior à 154 — NÃO entra: ausência de classificação
    não é pendência.
  */
  const interpretationsNeedingAttention = hasOfficialValue(c.clauses)
    ? c.clauses.value.filter(
        (clause) => (clause as { interpretation_state?: string | null }).interpretation_state
          === 'requires_attention').length
    : 0;
  const attentionCount = interpretationsNeedingAttention
    + attention.filter((a) => a.severity === 'critical' || a.severity === 'warning').length;

  const overdue = hasOfficialValue(obl) ? obl.value.overdue : 0;
  const activeObligations = hasOfficialValue(obl) ? obl.value.total : 0;
  const apexState: ApexContractState =
    overdue > 0 ? 'blocked'
      : attentionCount > 0 ? 'attention'
        : activeObligations > 0 ? 'monitoring'
          : !hasOfficialValue(c.project) ? 'unlinked'
            : 'idle';

  return {
    contract: c,
    code: c.code,
    counterparty,
    project,
    projectErrored: isError(c.project),
    status: c.status,
    risk: c.riskLevel,
    value: hasOfficialValue(c.totalValue) ? c.totalValue.value : null,
    billed: hasOfficialValue(c.billedValue) ? c.billedValue.value : null,
    execPct: hasOfficialValue(exec) ? Math.round(exec.value * 100) : null,
    billingEvents: hasOfficialValue(c.billingEvents) ? c.billingEvents.value.length : null,
    obligationsTotal: hasOfficialValue(obl) ? obl.value.total : null,
    obligationsOverdue: hasOfficialValue(obl) ? obl.value.overdue : 0,
    documentsTotal: hasOfficialValue(c.documents) ? c.documents.value.length : null,
    documentsPending: hasOfficialValue(docs) ? docs.value.length : 0,
    approvalsTotal: hasOfficialValue(c.approvals) ? c.approvals.value.length : null,
    approvalsPending: hasOfficialValue(c.approvals) ? c.approvals.value.filter((a) => a.status !== 'approved').length : 0,
    healthAssessed: health.coverage.assessed,
    healthTotal: health.coverage.total,
    criticalCount: attention.filter((a) => a.severity === 'critical').length,
    attentionCount,
    apexState,
    searchBlob: `${c.code} ${counterparty} ${c.title} ${project ?? ''} ${STATUS_LABEL[c.status] ?? c.status}`.toLowerCase(),
  };
}

/** `null` sempre no fim, independente da direção — ausência não disputa ranking. */
function compare(a: Row, b: Row, key: SmartColumnKey): number {
  const nums: Partial<Record<SmartColumnKey, (r: Row) => number | null>> = {
    value: (r) => r.value,
    billing: (r) => r.execPct,
    obligations: (r) => r.obligationsTotal,
    documents: (r) => r.documentsTotal,
    approvals: (r) => r.approvalsTotal,
    health: (r) => r.healthAssessed,
    attention: (r) => r.attentionCount,
  };
  const pickNum = nums[key];
  if (pickNum) {
    const av = pickNum(a); const bv = pickNum(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  }
  if (key === 'risk') {
    const rank = { low: 0, medium: 1, high: 2 };
    return rank[a.risk] - rank[b.risk];
  }
  const strs: Record<string, (r: Row) => string> = {
    contract: (r) => r.code,
    counterparty: (r) => r.counterparty,
    project: (r) => r.project ?? '￿',
    status: (r) => STATUS_LABEL[r.status] ?? r.status,
  };
  return (strs[key]?.(a) ?? '').localeCompare(strs[key]?.(b) ?? '', 'pt-BR');
}

export interface ContractSmartTableProps {
  hideSearch?: boolean;
  contracts: readonly TrustedContract[];
  selectedId?: string | null;
  onSelect: (contract: TrustedContract) => void;
  now?: Date;
  className?: string;
}

export function ContractSmartTable({
  contracts, selectedId, onSelect, now = new Date(), className, hideSearch = false,
}: ContractSmartTableProps) {
  const [sortKey, setSortKey] = useState<SmartColumnKey>('value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<SmartColumnKey>>(new Set());
  const [showConfig, setShowConfig] = useState(false);

  const rows = useMemo(() => contracts.map((c) => toRow(c, now)), [contracts, now]);

  const visible = COLUMNS.filter((col) => !hidden.has(col.key));
  const grid = visible.map((c) => c.width ?? '1fr').join(' ');
  /*
    A largura mínima TEM que caber a soma das trilhas + gaps + padding.
    Se o wrapper for mais estreito, o grid estoura para fora e o
    `overflow-auto` do pai não enxerga o overflow dos filhos — a seleção e
    as colunas finais ficam cortadas (“não vão até o final”).
  */
  const tableMinWidth = useMemo(() => {
    const cols = COLUMNS
      .filter((col) => !hidden.has(col.key))
      .reduce((sum, col) => sum + trackMinPx(col.width), 0);
    const n = COLUMNS.filter((col) => !hidden.has(col.key)).length;
    const gaps = Math.max(0, n - 1) * 16; // gap-4
    const pad = 32; // px-4
    return cols + gaps + pad;
  }, [hidden]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.searchBlob.includes(q)) : rows;
    return [...filtered].sort((a, b) => (sortDir === 'asc' ? 1 : -1) * compare(a, b, sortKey));
  }, [rows, query, sortKey, sortDir]);

  const toggleSort = (key: SmartColumnKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'contract' || key === 'counterparty' || key === 'project' ? 'asc' : 'desc'); }
  };

  return (
    <div
      data-elev="1"
      className={cn(
        /*
          A tabela é uma SUPERFÍCIE do sistema, não uma caixa com contorno.
          O material de vidro (tinta, ruído, specular, sombra de elevação) é o
          mesmo dos cards e da barra de controle — é o que faz os três modos de
          visualização lerem como a mesma coisa vista de três ângulos.
        */
        'ig-glass overflow-hidden rounded-[18px]',
        className,
      )}
    >
      <span data-ig-noise="" />
      <div data-ig-content="">
      {/* Barra de controle */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ig-border-subtle px-4 py-2.5">
        {!hideSearch && <label className="relative flex min-w-[220px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-ig-fg-subtle" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar contrato, contraparte ou projeto…"
            className={cn(
              'w-full rounded-[9px] border border-ig-border-subtle bg-transparent py-1.5 pl-8 pr-7',
              'text-ig-body-sm text-ig-fg-strong placeholder:text-ig-fg-subtle',
              'focus:border-ig-border-focus focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--ig-accent)_35%,transparent)]',
            )}
          />
          {query && (
            <button
              type="button" onClick={() => setQuery('')} aria-label="Limpar busca"
              className="absolute right-2 text-ig-fg-subtle hover:text-ig-fg-strong"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </label>}

        <span className="shrink-0 text-ig-caption text-ig-fg-muted">
          <span className="ig-tabular font-semibold text-ig-fg-strong">{shown.length}</span>
          {shown.length === rows.length ? ' contrato(s)' : ` de ${rows.length}`}
        </span>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            aria-expanded={showConfig}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[9px] border border-ig-border-subtle px-2.5 py-1.5',
              'text-ig-caption font-medium text-ig-fg-muted transition-colors',
              'hover:border-ig-border-focus hover:text-ig-fg-strong',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
            )}
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden />
            Colunas
          </button>
          {showConfig && (
            <div className="absolute right-0 top-full z-20 mt-1.5 w-[190px] rounded-[12px] border border-ig-border-focus/50 bg-ig-bg-overlay p-2 shadow-[var(--ig-shadow-e4)]">
              {COLUMNS.filter((c) => c.optional).map((col) => (
                <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-ig-body-sm text-ig-fg-muted hover:bg-[color-mix(in_oklab,var(--ig-accent)_8%,transparent)]">
                  <input
                    type="checkbox"
                    checked={!hidden.has(col.key)}
                    onChange={() => setHidden((prev) => {
                      const next = new Set(prev);
                      if (next.has(col.key)) next.delete(col.key); else next.add(col.key);
                      return next;
                    })}
                    className="accent-[var(--ig-accent)]"
                  />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/*
        A tabela rola dentro do PRÓPRIO container.
        
        Onze colunas não cabem em 1440px sem espremer valores monetários até a
        ilegibilidade. A regra do design system é clara: conteúdo largo rola em
        seu próprio `overflow-x`, e a página nunca rola horizontalmente. O
        `min-width` garante que as colunas mantenham a largura projetada em vez
        de se comprimirem umas sobre as outras.
      */}
      <div
        /*
          O cabeçalho gruda de verdade.

          `sticky top-0` já estava aqui, mas nunca funcionou: o único ancestral
          rolável era esta faixa de `overflow-x`, cujo eixo vertical não rola —
          então o cabeçalho se prendia a um scrollport que nunca se move, e ao
          descer a página os rótulos das colunas sumiam junto com ela. Dando ao
          MESMO container o eixo vertical (com teto de altura), a régua de
          colunas permanece visível enquanto se percorre a carteira, que é o
          que uma tabela densa precisa. Com poucos contratos o teto não é
          atingido e nada rola.
        */
        className="max-h-[68vh] overflow-auto overscroll-contain"
      >
      <div style={{ minWidth: tableMinWidth }}>
      {/* Cabeçalho */}
      <div
        className={cn(
          'sticky top-0 z-10 grid gap-4 px-4 py-2.5',
          /*
            Cabeçalho com CONTRASTE de material, não só de cor de texto.
            Antes ele era o mesmo painel das linhas com 96% de opacidade: ao
            rolar, os rótulos passavam por cima dos valores e a régua superior
            da tabela desaparecia. Agora é uma faixa própria — tinta de acento
            mínima, fio inferior forte e sombra de separação quando gruda.
          */
          'border-b border-ig-border-strong',
          'bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ig-bg-raised)_97%,transparent),color-mix(in_oklab,var(--ig-bg-panel)_97%,transparent))]',
          'shadow-[0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_70%,transparent),0_8px_16px_-14px_rgba(0,0,0,0.6)]',
          'backdrop-blur-[6px]',
        )}
        style={{ gridTemplateColumns: grid }}
        role="row"
      >
        {visible.map((col) => {
          const activeSort = sortKey === col.key;
          if (col.key === 'open') {
            return <div key={col.key} role="columnheader" aria-label="Abrir dossiê" className="min-w-0" />;
          }
          return (
            /*
              `aria-sort` pertence ao CABEÇALHO DE COLUNA, não ao botão: em um
              `button` o atributo é inválido e leitores de tela o ignoram, de
              modo que o usuário perderia justamente a informação de qual coluna
              ordena a tabela.
            */
            <div
              key={col.key}
              role="columnheader"
              aria-sort={activeSort ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
              className={cn('min-w-0', col.align === 'right' && 'text-right')}
            >
              <button
                type="button"
                onClick={() => toggleSort(col.key)}
                className={cn(
                  'inline-flex items-center gap-1 whitespace-nowrap rounded text-ig-label font-semibold uppercase tracking-[0.08em] transition-colors',
                  activeSort ? 'text-ig-accent' : 'text-ig-fg-muted hover:text-ig-fg-strong',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                )}
              >
                {col.label}
                {activeSort
                  ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0" aria-hidden /> : <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />)
                  : <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" aria-hidden />}
              </button>
            </div>
          );
        })}
      </div>

      {/* Linhas */}
      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-ig-body-sm text-ig-fg-muted">
          {query ? `Nenhum contrato corresponde a "${query}".` : 'Nenhum contrato neste recorte.'}
        </p>
      ) : (
        <ul>
          {shown.map((r) => {
            const selected = r.contract.id === selectedId;
            return (
              <li key={r.contract.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.contract)}
                  className={cn(
                    /*
                      A linha é um OBJETO de carteira, não uma célula de
                      planilha: altura de leitura confortável (44px de conteúdo
                      contra os 30px anteriores), fio divisor mais calado e
                      elevação sutil no hover — a mesma profundidade que o card
                      usa, em dose de tabela.
                    */
                    'group relative grid w-full items-center gap-4 px-4 py-3 text-left last:border-0',
                    'border-b border-ig-border-subtle/45',
                    'transition-[background-color,box-shadow] duration-150',
                    !selected && 'hover:bg-[color-mix(in_oklab,var(--ig-accent)_6%,transparent)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                  )}
                  style={{ gridTemplateColumns: grid }}
                >
                  {/*
                    Camada de seleção em `inset-0`: cobre a linha INTEIRA até a
                    última coluna. Pintar só o `background` do botão falhava
                    quando o grid estourava o wrapper — a tinta parava no meio.
                  */}
                  {selected && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 bg-[color-mix(in_oklab,var(--ig-accent)_11%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--ig-accent)_22%,transparent)]"
                    />
                  )}
                  <span
                    className={cn(
                      'pointer-events-none absolute inset-y-0 left-0 z-[1] w-[3px] transition-opacity',
                      r.criticalCount > 0 ? 'bg-ig-danger opacity-100'
                        : selected ? 'bg-ig-accent opacity-100'
                          : 'bg-ig-accent opacity-0 group-hover:opacity-50',
                    )}
                    aria-hidden
                  />

                  {visible.map((col) => (
                    <span key={col.key} className="relative z-[1] min-w-0">
                      <Cell col={col.key} align={col.align} row={r} />
                    </span>
                  ))}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </div>
      </div>
      </div>
    </div>
  );
}

/**
 * Indicador de sincronia com um módulo a jusante.
 *
 * Faturamento, Obrigações, Documentos e Aprovações não são números soltos:
 * cada um é o estado de um vínculo com outro módulo. O desenho é sempre o
 * mesmo — ponto tonal + contagem tabular + legenda do que está pendente —
 * para que a linha possa ser varrida na horizontal sem reler o rótulo da
 * coluna a cada célula.
 *
 * `null` (relação não lida) continua sendo traço, nunca zero: ausência de
 * leitura e ausência de pendência são coisas diferentes.
 */
function SyncCell({
  total, pending, pendingLabel, tone = 'warning',
}: {
  total: number | null;
  pending: number;
  pendingLabel: string;
  tone?: 'warning' | 'danger';
}) {
  if (total === null) {
    return <span className="flex items-center justify-start text-ig-fg-subtle" title="Vínculo não lido">—</span>;
  }
  const alert = pending > 0;
  const toneClass = !alert
    ? 'bg-ig-success/70'
    : tone === 'danger' ? 'bg-ig-danger' : 'bg-ig-warning';
  return (
    <span
      className="flex min-w-0 items-center justify-start gap-1.5"
      title={alert ? `${pending} ${pendingLabel} de ${total}` : `${total} em dia`}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', toneClass)} />
      <span className="min-w-0 text-left">
        <span
          className={cn(
            'ig-tabular block text-ig-body-sm font-semibold leading-none',
            alert ? (tone === 'danger' ? 'text-ig-danger' : 'text-ig-warning') : 'text-ig-fg-strong',
          )}
        >
          {alert ? pending : total}
        </span>
        <span className="mt-0.5 block truncate text-[10px] leading-none text-ig-fg-subtle">
          {alert ? pendingLabel : total === 0 ? 'sem registro' : 'em dia'}
        </span>
      </span>
    </span>
  );
}

function Cell({ col, align, row: r }: { col: SmartColumnKey; align?: 'right'; row: Row }) {
  const base = cn('min-w-0 truncate text-ig-body-sm', align === 'right' && 'text-right');
  const dash = <span className="text-ig-fg-subtle">—</span>;

  switch (col) {
    case 'contract':
      /*
        Identidade da linha: o código no desenho canônico (`.ig-code`), com o
        título como segunda linha calada. Antes o código dividia a célula com
        a marca de origem num fio só, e a linha não tinha nenhuma âncora de
        leitura à esquerda — o olho começava a varredura pela contraparte.
      */
      return (
        <span className={cn('flex min-w-0 items-center gap-2')}>
          {r.criticalCount > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-ig-danger" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="ig-code truncate !text-[12px] !text-ig-fg-strong">{r.code}</span>
              <DataClassBadge dataClass={r.contract.dataClass} />
            </span>
            <span className="mt-0.5 block truncate text-[11px] leading-tight text-ig-fg-subtle" title={r.contract.title}>
              {r.contract.title}
            </span>
          </span>
        </span>
      );
    case 'counterparty': {
      /*
        O projeto vinculado, já estreitado. Um booleano guardado numa variável
        não estreita o campo para o compilador — só o guard na própria
        expressão estreita —, então a leitura é materializada uma vez.
      */
      const linkedProject = hasOfficialValue(r.contract.project) ? r.contract.project.value : null;
      const logoUrl = linkedProject?.clientLogoUrl ?? undefined;
      const logoClient = linkedProject?.cliente || r.counterparty;
      return (
        <span className="flex min-w-0 items-center gap-2.5">
          <ClientLogoBanner
            client={logoClient}
            logoUrl={logoUrl}
            height={22}
            align="start"
            className="shrink-0"
          />
          <span
            className={cn(
              'min-w-0 flex-1 font-semibold text-ig-body-sm text-ig-fg-strong whitespace-normal line-clamp-2',
              align === 'right' && 'text-right',
            )}
            title={r.counterparty}
          >
            {r.counterparty}
          </span>
        </span>
      );
    }
    case 'project':
      return r.projectErrored ? (
        <span className={cn(base, 'text-ig-danger')}>indisponível</span>
      ) : r.project ? (
        /* Chip de projeto vinculado: o vínculo é um objeto, não um texto. */
        <span
          className={cn(
            'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[7px] border px-2 py-1 leading-none',
            'border-[color-mix(in_oklab,var(--ig-accent)_24%,var(--ig-border-strong))]',
            'bg-[color-mix(in_oklab,var(--ig-accent)_9%,transparent)]',
          )}
          title={`Projeto vinculado: ${r.project}`}
        >
          <Workflow className="h-3 w-3 shrink-0 text-ig-accent" aria-hidden />
          <span className="ig-code truncate !text-ig-fg-strong">{r.project}</span>
        </span>
      ) : (
        <HudSignal size="sm" tone="warning" variant="inline" label="sem vínculo" />
      );
    case 'status':
      return (
        <span className="flex min-w-0 items-center">
          <HudSignal
            size="sm"
            tone={STATUS_TONE[r.status] ?? 'neutral'}
            label={STATUS_LABEL[r.status] ?? r.status}
          />
        </span>
      );
    case 'risk':
      return (
        <span className="flex min-w-0 items-center">
          <HudSignal size="sm" tone={RISK_TONE[r.risk]} label={RISK_LABEL[r.risk]} />
        </span>
      );
    case 'value':
      return (
        <span className={cn(base, 'ig-tabular block text-[15px] font-bold leading-none text-ig-fg-strong')}>
          {r.value === null ? dash : BRL.format(r.value)}
        </span>
      );
    case 'billing':
      return (
        <span className={cn(base, 'ig-tabular block')}>
          {r.billed === null ? dash : (
            <>
              <span className="block font-semibold leading-none text-ig-fg-strong">{BRL.format(r.billed)}</span>
              <span className="mt-1 flex items-center justify-start gap-1.5">
                {r.execPct !== null && (
                  <span className="h-1 w-10 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ig-fg-subtle)_28%,transparent)]">
                    <span
                      className="block h-full rounded-full bg-ig-success"
                      style={{ width: `${Math.min(100, Math.max(0, r.execPct))}%` }}
                    />
                  </span>
                )}
                <span className="text-[10px] leading-none text-ig-fg-subtle">
                  {r.execPct !== null ? `${r.execPct}%` : 'exec. n/a'}
                </span>
              </span>
            </>
          )}
        </span>
      );
    case 'obligations':
      return (
        <SyncCell
          total={r.obligationsTotal}
          pending={r.obligationsOverdue}
          pendingLabel="atrasada(s)"
          tone="danger"
        />
      );
    case 'documents':
      return <SyncCell total={r.documentsTotal} pending={r.documentsPending} pendingLabel="pendente(s)" />;
    case 'approvals':
      return <SyncCell total={r.approvalsTotal} pending={r.approvalsPending} pendingLabel="aberta(s)" />;
    case 'health':
      return (
        <span className={cn(base, 'ig-tabular block')}>
          <span className="block font-semibold leading-none text-ig-fg-strong">
            {r.healthAssessed}/{r.healthTotal}
          </span>
          <span className="mt-0.5 block text-[10px] leading-none text-ig-fg-subtle">apurado</span>
        </span>
      );
    case 'attention':
      /*
        Zero é um bom resultado, e a tabela precisa dizer isso sem gritar: o
        traço discreto no lugar de um "0" evita treinar o olho a varrer uma
        coluna de zeros.
      */
      return (
        <span className={cn(base, 'ig-tabular block')}>
          <span
            className={cn(
              'block text-[15px] font-bold leading-none',
              r.attentionCount > 0 ? 'text-ig-warning' : 'text-ig-fg-subtle',
            )}
          >
            {r.attentionCount > 0 ? r.attentionCount : '—'}
          </span>
          {r.attentionCount > 0 && (
            <span className="mt-0.5 block text-[10px] leading-none text-ig-fg-subtle">item(ns)</span>
          )}
        </span>
      );
    case 'apexState':
      return (
        <span className={cn(base, 'flex items-center')}>
          <HudSignal size="sm" label={APEX_STATE_LABEL[r.apexState]} tone={APEX_STATE_TONE[r.apexState]} />
        </span>
      );
    case 'open':
      /*
        Não é um `button`: a linha inteira já É o botão, e aninhar um dentro do
        outro é HTML inválido — o clique do interno nem chegaria ao externo em
        alguns navegadores. Isto é a AFORDÂNCIA da ação da linha, que aparece
        no hover e no foco.
      */
      return (
        <span
          aria-hidden
          title="Abrir dossiê"
          className={cn(
            'flex items-center justify-end opacity-0 transition-opacity duration-150',
            'group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
        >
          <span
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-[8px] border px-2 leading-none',
              'border-[color-mix(in_oklab,var(--ig-accent)_28%,var(--ig-border-strong))]',
              'bg-[color-mix(in_oklab,var(--ig-accent)_12%,transparent)] text-[10px] font-semibold text-ig-accent',
            )}
          >
            <ArrowRight className="h-3 w-3" />
          </span>
        </span>
      );
  }
}
