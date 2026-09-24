'use client';

import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { daysBetween, dateShort, qty } from './format';
import type { Tone } from './primitives';

/* ── Cobertura de um requisito ─────────────────────────────────────────── */
export interface CoverageParts {
  required: number; consumed?: number; reserved?: number; transit?: number; onOrder?: number; inspection?: number; shortage?: number;
}
const SEGMENTS: Array<{ key: keyof CoverageParts; cls: string; label: string }> = [
  { key: 'consumed', cls: 'consumed', label: 'Consumido' },
  { key: 'reserved', cls: 'reserved', label: 'Reservado' },
  { key: 'transit', cls: 'transit', label: 'Em transferência' },
  { key: 'inspection', cls: 'inspection', label: 'Em inspeção' },
  { key: 'onOrder', cls: 'onorder', label: 'Em pedido' },
  { key: 'shortage', cls: 'shortage', label: 'Falta' },
];

/** Requerido × o que cobre, numa barra: a falta aparece como a parte hachurada que sobra. */
export function CoverageBar({ parts, unit, showMeta = true }: { parts: CoverageParts; unit?: string | null; showMeta?: boolean }) {
  const total = Math.max(parts.required, 0.0001);
  const covered = parts.required - (parts.shortage ?? 0);
  const described = SEGMENTS.filter((s) => (parts[s.key] ?? 0) > 0).map((s) => `${s.label} ${qty(parts[s.key], unit)}`).join(', ');
  return (
    <div className="ax-cover">
      <div className="ax-cover-bar" role="img" aria-label={`Requerido ${qty(parts.required, unit)}: ${described || 'nada coberto'}`}>
        {SEGMENTS.map((s) => {
          const v = parts[s.key] ?? 0;
          return v > 0 ? <i key={s.key} className={s.cls} style={{ width: `${Math.min(100, (v / total) * 100)}%` }} /> : null;
        })}
      </div>
      {showMeta && (
        <div className="ax-cover-meta">
          <span><strong>{qty(Math.max(0, covered), unit)}</strong> de {qty(parts.required, unit)}</span>
          {(parts.shortage ?? 0) > 0 ? <span style={{ color: 'var(--ax-danger)', fontWeight: 650 }}>falta {qty(parts.shortage, unit)}</span>
            : <span style={{ color: 'var(--ax-success)', fontWeight: 650 }}>coberto</span>}
        </div>
      )}
    </div>
  );
}

export function CoverageLegend() {
  const color: Record<string, string> = {
    consumed: 'color-mix(in srgb, var(--ax-success) 70%, var(--ax-fg-strong))', reserved: 'var(--ax-accent)',
    transit: 'var(--ax-info)', inspection: 'var(--ax-warning)', onorder: 'color-mix(in srgb, var(--ax-info) 55%, transparent)',
    shortage: 'var(--ax-danger)',
  };
  return (
    <div className="ax-legend" aria-hidden>
      {SEGMENTS.map((s) => <span key={s.key}><i style={{ background: color[s.cls] }} />{s.label}</span>)}
    </div>
  );
}

/* ── Fluxo em etapas ───────────────────────────────────────────────────── */
export interface FlowStep { id: string; label: string; count: number; sub?: ReactNode; tone?: Tone; href?: string; onClick?: () => void }

export function FlowPipeline({ steps, current, label }: { steps: FlowStep[]; current?: string; label: string }) {
  return (
    <nav className="ax-flow" aria-label={label}>
      {steps.map((s, i) => {
        const inner = (
          <>
            <span className="l">{s.label}</span>
            <span className="n">{s.count.toLocaleString('pt-BR')}</span>
            {s.sub && <span className="s">{s.sub}</span>}
            {i < steps.length - 1 && <ChevronRight size={14} className="arrow" aria-hidden />}
          </>
        );
        const props = { className: 'ax-flow-step', 'data-tone': s.tone, 'aria-current': s.id === current ? ('step' as const) : undefined };
        if (s.href) return <Link key={s.id} href={s.href} {...props}>{inner}</Link>;
        return <button key={s.id} type="button" onClick={s.onClick} {...props}>{inner}</button>;
      })}
    </nav>
  );
}

/* ── Horizonte de execução (linha do tempo) ────────────────────────────── */
export interface HorizonItem { id: string; date: string; title: string; kind: 'milestone' | 'activity' | 'need' | 'delivery'; tone?: Tone; href?: string }
export interface HorizonLane { id: string; label: string; items: HorizonItem[] }

const TONE_FILL: Record<Tone, string> = {
  danger: 'var(--ax-danger)', warning: 'var(--ax-warning)', success: 'var(--ax-success)', info: 'var(--ax-info)',
  accent: 'var(--ax-accent)', neutral: 'var(--ig-tone-neutral)',
};

/**
 * Próximos N dias numa régua: marco (◆), atividade (●), necessidade de
 * material (▲) e entrega prevista (■). Cor = gravidade. Clique abre o registro.
 */
export function HorizonTimeline({ today, days = 30, lanes, height }: { today: string; days?: number; lanes: HorizonLane[]; height?: number }) {
  const W = 1000; const left = 150; const right = 16; const laneH = 40; const top = 24;
  const H = height ?? top + lanes.length * laneH + 8;
  const x = (d: string) => left + ((Math.min(Math.max(daysBetween(today, d), 0), days)) / days) * (W - left - right);
  const ticks = [0, 7, 14, 21, 28].filter((t) => t <= days);
  const tickDate = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  return (
    <div className="ax-horizon">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Próximos ${days} dias`}>
        <rect className="band" x={x(today)} y={top - 6} width={x(tickDate(7)) - x(today)} height={H - top} rx="4" />
        {ticks.map((t) => (
          <g key={t}>
            <line className="axis" x1={x(tickDate(t))} x2={x(tickDate(t))} y1={top - 6} y2={H - 4} strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text className="tick" x={x(tickDate(t))} y={12} textAnchor={t === 0 ? 'start' : 'middle'}>{t === 0 ? 'hoje' : `${dateShort(tickDate(t))}`}</text>
          </g>
        ))}
        {lanes.map((lane, li) => {
          const y = top + li * laneH + laneH / 2;
          return (
            <g key={lane.id}>
              <text className="lane-label" x={0} y={y + 4}>{lane.label.length > 22 ? `${lane.label.slice(0, 21)}…` : lane.label}</text>
              <line className="axis" x1={left} x2={W - right} y1={y} y2={y} strokeOpacity={0.5} />
              {lane.items.map((it) => {
                const cx = x(it.date); const fill = TONE_FILL[it.tone ?? 'accent'];
                // Necessidade acima da linha, entrega abaixo: marcadores da mesma data não se sobrepõem.
                const ny = y - 9; const dy = y + 9;
                const shape = it.kind === 'milestone'
                  ? <rect x={cx - 6} y={y - 6} width={12} height={12} transform={`rotate(45 ${cx} ${y})`} fill={fill} rx="1.5" />
                  : it.kind === 'need' ? <path d={`M${cx} ${ny - 6} L${cx + 6} ${ny + 5} L${cx - 6} ${ny + 5} Z`} fill={fill} />
                    : it.kind === 'delivery' ? <rect x={cx - 5} y={dy - 5} width={10} height={10} fill={fill} rx="2" />
                      : <circle cx={cx} cy={y} r={5.5} fill={fill} />;
                const node = <g><title>{`${dateShort(it.date)} — ${it.title}`}</title>{shape}</g>;
                return it.href
                  ? <a key={it.id} href={it.href} aria-label={`${dateShort(it.date)}: ${it.title}`}>{node}</a>
                  : <Fragment key={it.id}>{node}</Fragment>;
              })}
            </g>
          );
        })}
        <line className="today" x1={x(today)} x2={x(today)} y1={top - 6} y2={H - 4} />
      </svg>
    </div>
  );
}

export function HorizonLegend() {
  return (
    <div className="ax-legend" aria-hidden>
      <span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" transform="rotate(45 6 6)" fill="var(--ax-accent)" /></svg>Marco</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="var(--ax-accent)" /></svg>Atividade</span>
      <span><svg width="12" height="12"><path d="M6 1 L11 10 L1 10 Z" fill="var(--ax-accent)" /></svg>Necessidade de material</span>
      <span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="var(--ax-info)" /></svg>Entrega prevista</span>
      <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="var(--ax-danger)" /></svg>Crítico / em falta</span>
    </div>
  );
}

/* ── Matriz de saúde (projetos × travas) ───────────────────────────────── */
export interface HealthColumn { key: string; label: string }
export interface HealthRow { id: string; label: string; sub?: string; href?: string; cells: Record<string, { n: number; href?: string }> }

export function HealthMatrix({ columns, rows, caption }: { columns: HealthColumn[]; rows: HealthRow[]; caption: string }) {
  const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3);
  return (
    <div className="ax-table-wrap">
      <table className="ax-heat">
        <caption className="sr-only-ax">{caption}</caption>
        <thead><tr><th scope="col">Projeto</th>{columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row" style={{ textAlign: 'left', fontWeight: 600, textTransform: 'none', letterSpacing: 0, fontSize: 12.5, color: 'var(--ax-fg-strong)', paddingLeft: 16 }}>
                <span className="ax-truncate" style={{ display: 'block', maxWidth: 240 }}>
                  {r.href ? <Link className="ax-link" href={r.href} style={{ color: 'inherit' }}>{r.label}</Link> : r.label}
                </span>
                {r.sub && <small className="ax-subtle" style={{ fontWeight: 500 }}>{r.sub}</small>}
              </th>
              {columns.map((c) => {
                const cell = r.cells[c.key] ?? { n: 0 };
                const text = cell.n > 0 ? String(cell.n) : '·';
                const label = `${r.label} — ${c.label}: ${cell.n}`;
                return (
                  <td key={c.key}>
                    {cell.href && cell.n > 0
                      ? <Link className="cell" data-level={level(cell.n)} href={cell.href} aria-label={label}>{text}</Link>
                      : <span className="cell" data-level={level(cell.n)} aria-label={label} role="img">{text}</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Meter({ value, tone, label }: { value: number; tone?: Tone; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return <div className="ax-meter" data-tone={tone} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}><i style={{ width: `${v * 100}%` }} /></div>;
}

/* ── Cadeia causal ("por que isto importa") ────────────────────────────── */
export interface ChainNode { label: ReactNode; href?: string; end?: boolean }
export function Chain({ nodes, label }: { nodes: ChainNode[]; label: string }) {
  return (
    <div className="ax-chain" role="list" aria-label={label}>
      {nodes.map((n, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight size={12} aria-hidden />}
          {n.href
            ? <Link role="listitem" href={n.href} className={n.end ? 'end' : undefined}>{n.label}</Link>
            : <span role="listitem" className={n.end ? 'end' : undefined}>{n.label}</span>}
        </Fragment>
      ))}
    </div>
  );
}
