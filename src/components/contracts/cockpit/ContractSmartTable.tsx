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
import {
  ArrowUpDown, ArrowUp, ArrowDown, Search, Workflow, AlertTriangle, Settings2, X,
} from 'lucide-react';
import { hasOfficialValue, isError, ratioTrusted, type Official } from '@/lib/contracts/trust/trusted';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { obligationBreakdown, missingDocuments, contractHealth } from '@/lib/contracts/trust/signals';
import { attentionItems } from '@/lib/contracts/trust/attention';
import { DataClassBadge } from './PortfolioScope';

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
  | 'value' | 'billing' | 'obligations' | 'documents' | 'approvals' | 'health';

const COLUMNS: { key: SmartColumnKey; label: string; align?: 'right'; width?: string; optional?: boolean }[] = [
  { key: 'contract', label: 'Contrato', width: '200px' },
  { key: 'counterparty', label: 'Contraparte', width: 'minmax(160px,1fr)' },
  { key: 'project', label: 'Projeto', width: '150px' },
  { key: 'status', label: 'Status', width: '116px' },
  { key: 'risk', label: 'Risco', width: '86px', optional: true },
  { key: 'value', label: 'Valor', align: 'right', width: '104px' },
  { key: 'billing', label: 'Faturamento', align: 'right', width: '124px' },
  { key: 'obligations', label: 'Obrigações', align: 'right', width: '110px' },
  { key: 'documents', label: 'Documentos', align: 'right', width: '112px', optional: true },
  { key: 'approvals', label: 'Aprovações', align: 'right', width: '110px', optional: true },
  { key: 'health', label: 'Cobertura', align: 'right', width: '92px' },
];

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
  contracts: readonly TrustedContract[];
  selectedId?: string | null;
  onSelect: (contract: TrustedContract) => void;
  now?: Date;
  className?: string;
}

export function ContractSmartTable({
  contracts, selectedId, onSelect, now = new Date(), className,
}: ContractSmartTableProps) {
  const [sortKey, setSortKey] = useState<SmartColumnKey>('value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<SmartColumnKey>>(new Set());
  const [showConfig, setShowConfig] = useState(false);

  const rows = useMemo(() => contracts.map((c) => toRow(c, now)), [contracts, now]);

  const visible = COLUMNS.filter((col) => !hidden.has(col.key));
  const grid = visible.map((c) => c.width ?? '1fr').join(' ');

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
    <div className={cn('overflow-hidden rounded-[18px] border border-ig-border-subtle', className)}>
      {/* Barra de controle */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ig-border-subtle px-4 py-2.5">
        <label className="relative flex min-w-[220px] flex-1 items-center">
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
        </label>

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
      <div className="overflow-x-auto">
      <div className="min-w-[1180px]">
      {/* Cabeçalho */}
      <div
        className="sticky top-0 z-10 grid gap-3 border-b border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-panel)_96%,transparent)] px-4 py-2"
        style={{ gridTemplateColumns: grid }}
        role="row"
      >
        {visible.map((col) => {
          const activeSort = sortKey === col.key;
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
                  'inline-flex items-center gap-1 text-ig-label uppercase tracking-[0.1em] transition-colors',
                  activeSort ? 'text-ig-accent' : 'text-ig-fg-muted hover:text-ig-fg-strong',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)] rounded',
                )}
              >
                {col.label}
                {activeSort
                  ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)
                  : <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />}
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
                    'group relative grid w-full items-center gap-3 border-b border-ig-border-subtle/60 px-4 py-2.5 text-left transition-colors last:border-0',
                    selected
                      ? 'bg-[color-mix(in_oklab,var(--ig-accent)_9%,transparent)]'
                      : 'hover:bg-[color-mix(in_oklab,var(--ig-accent)_5%,transparent)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                  )}
                  style={{ gridTemplateColumns: grid }}
                >
                  <span
                    className={cn(
                      'pointer-events-none absolute inset-y-0 left-0 w-[2px] transition-opacity',
                      r.criticalCount > 0 ? 'bg-ig-danger opacity-100'
                        : selected ? 'bg-ig-accent opacity-100' : 'opacity-0',
                    )}
                    aria-hidden
                  />

                  {visible.map((col) => (
                    <Cell key={col.key} col={col.key} align={col.align} row={r} />
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
  );
}

function Cell({ col, align, row: r }: { col: SmartColumnKey; align?: 'right'; row: Row }) {
  const base = cn('min-w-0 truncate text-ig-body-sm', align === 'right' && 'text-right');
  const dash = <span className="text-ig-fg-subtle">—</span>;

  switch (col) {
    case 'contract':
      return (
        <span className={cn(base, 'flex items-center gap-1.5')}>
          {r.criticalCount > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-ig-danger" aria-hidden />}
          <span className="ig-tabular truncate font-mono text-ig-caption font-semibold text-ig-fg-strong">{r.code}</span>
          <DataClassBadge dataClass={r.contract.dataClass} />
        </span>
      );
    case 'counterparty':
      return <span className={cn(base, 'font-medium text-ig-fg-strong')}>{r.counterparty}</span>;
    case 'project':
      return r.projectErrored ? (
        <span className={cn(base, 'text-ig-danger')}>indisponível</span>
      ) : r.project ? (
        <span className={cn(base, 'flex items-center gap-1.5 text-ig-fg-muted')}>
          <Workflow className="h-3 w-3 shrink-0 text-ig-accent" aria-hidden />
          <span className="truncate">{r.project}</span>
        </span>
      ) : (
        <span className={cn(base, 'text-ig-warning')}>sem vínculo</span>
      );
    case 'status':
      return <span className={cn(base, 'text-ig-fg-muted')}>{STATUS_LABEL[r.status] ?? r.status}</span>;
    case 'risk':
      return (
        <span className={cn(base, r.risk === 'high' ? 'text-ig-danger' : r.risk === 'medium' ? 'text-ig-warning' : 'text-ig-success')}>
          {RISK_LABEL[r.risk]}
        </span>
      );
    case 'value':
      return <span className={cn(base, 'ig-tabular font-semibold text-ig-fg-strong')}>{r.value === null ? dash : BRL.format(r.value)}</span>;
    case 'billing':
      return (
        <span className={cn(base, 'ig-tabular')}>
          {r.billed === null ? dash : (
            <>
              <span className="font-semibold text-ig-fg-strong">{BRL.format(r.billed)}</span>
              {r.execPct !== null && <span className="ml-1 text-ig-caption text-ig-fg-subtle">{r.execPct}%</span>}
            </>
          )}
        </span>
      );
    case 'obligations':
      return (
        <span className={cn(base, 'ig-tabular')}>
          {r.obligationsTotal === null ? dash : r.obligationsOverdue > 0 ? (
            <span className="font-semibold text-ig-danger">{r.obligationsOverdue} atrasada(s)</span>
          ) : (
            <span className="text-ig-fg-muted">{r.obligationsTotal}</span>
          )}
        </span>
      );
    case 'documents':
      return (
        <span className={cn(base, 'ig-tabular')}>
          {r.documentsTotal === null ? dash : r.documentsPending > 0 ? (
            <span className="font-semibold text-ig-warning">{r.documentsPending} pend.</span>
          ) : (
            <span className="text-ig-fg-muted">{r.documentsTotal}</span>
          )}
        </span>
      );
    case 'approvals':
      return (
        <span className={cn(base, 'ig-tabular')}>
          {r.approvalsTotal === null ? dash : r.approvalsPending > 0 ? (
            <span className="font-semibold text-ig-warning">{r.approvalsPending} aberta(s)</span>
          ) : (
            <span className="text-ig-fg-muted">{r.approvalsTotal}</span>
          )}
        </span>
      );
    case 'health':
      return (
        <span className={cn(base, 'ig-tabular text-ig-fg-muted')}>
          {r.healthAssessed}/{r.healthTotal}
        </span>
      );
  }
}
