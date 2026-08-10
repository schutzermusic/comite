"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/i18n/format";

/* ═══════════════════════════════════════════════════════════════
   MAPA DE RISCO — plano iso-risco (score = probabilidade × impacto)

   Diferente da Matriz 5×5 (que é discreta, célula a célula), aqui o
   plano é contínuo: as curvas p·i = k desenham as faixas de score, e
   cada risco é posicionado como um corpo com massa (exposição).
   SVG próprio — ECharts não desenha contorno hiperbólico nem sincroniza
   highlight com uma lista externa.
   ═══════════════════════════════════════════════════════════════ */

export interface RiskMapPoint {
  id: string;
  title: string;
  probability: number;
  impact: number;
  exposure: number;
  severity: string;
}

interface Props {
  data: RiskMapPoint[];
  height?: number;
  onSelect?: (riskId: string) => void;
}

const SEV_VAR: Record<string, string> = {
  critical: "var(--ig-danger)",
  high: "var(--ig-warning)",
  medium: "var(--ig-info)",
  low: "var(--ig-success)",
};
const SEV_LABEL: Record<string, string> = {
  critical: "Crítico", high: "Alto", medium: "Médio", low: "Baixo",
};
const sevVar = (s: string) => SEV_VAR[s] ?? "var(--ig-info)";
const tint = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct}%, transparent)`;

/* ── Geometria do plano ── */
const VB = 340;
const PAD_L = 32, PAD_R = 12, PAD_T = 14, PAD_B = 28;
const PLOT_W = VB - PAD_L - PAD_R;
const PLOT_H = VB - PAD_T - PAD_B;
const DOM_MIN = 0.5, DOM_MAX = 5.5, DOM_SPAN = DOM_MAX - DOM_MIN;

const xOf = (p: number) => PAD_L + ((p - DOM_MIN) / DOM_SPAN) * PLOT_W;
const yOf = (i: number) => PAD_T + (1 - (i - DOM_MIN) / DOM_SPAN) * PLOT_H;

/* Contorno iso-risco: fronteira da região p·i ≥ k, fechada pelo canto crítico. */
function isoCurve(k: number): { p: number; i: number }[] {
  const pts: { p: number; i: number }[] = [];
  const STEPS = 90;
  for (let s = 0; s <= STEPS; s++) {
    const p = DOM_MIN + (s / STEPS) * DOM_SPAN;
    const i = k / p;
    if (i >= DOM_MIN && i <= DOM_MAX) pts.push({ p, i });
  }
  return pts;
}

function isoRegionPath(k: number): string {
  const pts = isoCurve(k);
  if (pts.length < 2) return "";
  const first = pts[0], last = pts[pts.length - 1];
  const d = [`M ${xOf(first.p).toFixed(2)} ${yOf(first.i).toFixed(2)}`];
  pts.slice(1).forEach((pt) => d.push(`L ${xOf(pt.p).toFixed(2)} ${yOf(pt.i).toFixed(2)}`));
  // A curva sai pela direita ou pelo fundo — fecha pela borda correspondente.
  // A amostragem inclui p = DOM_MAX exato, então comparar por p é confiável.
  if (last.p < DOM_MAX - 1e-6) d.push(`L ${xOf(DOM_MAX).toFixed(2)} ${yOf(DOM_MIN).toFixed(2)}`);
  d.push(`L ${xOf(DOM_MAX).toFixed(2)} ${yOf(DOM_MAX).toFixed(2)}`);
  d.push(`L ${xOf(first.p).toFixed(2)} ${yOf(DOM_MAX).toFixed(2)}`);
  return `${d.join(" ")} Z`;
}

function isoLinePath(k: number): string {
  const pts = isoCurve(k);
  if (pts.length < 2) return "";
  return pts
    .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${xOf(pt.p).toFixed(2)} ${yOf(pt.i).toFixed(2)}`)
    .join(" ");
}

/* Faixas empilhadas: a tinta acumula em direção ao canto de ação imediata. */
const ISO_BANDS = [
  { k: 6, label: "6" },
  { k: 11, label: "11" },
  { k: 16, label: "16" },
];

const TICKS = [1, 2, 3, 4, 5];

/* ── Altura canônica ──
   O mapa é plano + rodapé de legenda; painéis vizinhos que precisem casar a
   altura devem usar RISK_MAP_TOTAL_HEIGHT em vez de repetir o número solto. */
export const RISK_MAP_PLOT_HEIGHT = 318;
/** gap-3 (12) + borda (1) + pt-2.5 (10) + linha da legenda (~17). */
const RISK_MAP_FOOTER_HEIGHT = 40;
export const RISK_MAP_TOTAL_HEIGHT = RISK_MAP_PLOT_HEIGHT + RISK_MAP_FOOTER_HEIGHT;

export function RiskMap({ data, height = RISK_MAP_PLOT_HEIGHT, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const maxExp = useMemo(() => Math.max(...data.map((d) => d.exposure), 1), [data]);

  /* Ordem de pintura: bolhas maiores atrás, para as menores continuarem clicáveis. */
  const painted = useMemo(() => [...data].sort((a, b) => b.exposure - a.exposure), [data]);
  const ranked = useMemo(() => painted.slice(0, 6), [painted]);

  const legend = useMemo(() => {
    const counts = data.reduce<Record<string, number>>((acc, d) => {
      acc[d.severity] = (acc[d.severity] ?? 0) + 1;
      return acc;
    }, {});
    return (["critical", "high", "medium", "low"] as const)
      .map((key) => ({ key, label: SEV_LABEL[key], count: counts[key] ?? 0 }))
      .filter((s) => s.count > 0);
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 text-center" style={{ height }}>
        <span className="text-[11px] font-medium text-ig-fg-muted">Sem dados no recorte atual</span>
        <span className="text-[10px] text-ig-fg-subtle">Ajuste os filtros ou cadastre riscos</span>
      </div>
    );
  }

  const radiusOf = (exposure: number) => 5 + Math.sqrt(exposure / maxExp) * 13;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* ── Plano iso-risco ── */}
        <div className="relative rounded-xl border border-ig-border-subtle bg-ig-bg-canvas/40 p-1">
          <svg
            viewBox={`0 0 ${VB} ${VB}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", height }}
            role="img"
            aria-label="Mapa de risco por probabilidade e impacto"
          >
            {/* faixas de score acumuladas */}
            {ISO_BANDS.map((b) => (
              <path
                key={`band-${b.k}`}
                d={isoRegionPath(b.k)}
                style={{ fill: tint("var(--ig-danger)", 5) }}
              />
            ))}

            {/* grade 5×5 */}
            {TICKS.map((t) => (
              <React.Fragment key={`grid-${t}`}>
                <line
                  x1={xOf(t)} y1={yOf(DOM_MIN)} x2={xOf(t)} y2={yOf(DOM_MAX)}
                  strokeDasharray="2 4" strokeWidth={0.75}
                  style={{ stroke: "var(--ig-border-subtle)", opacity: 0.7 }}
                />
                <line
                  x1={xOf(DOM_MIN)} y1={yOf(t)} x2={xOf(DOM_MAX)} y2={yOf(t)}
                  strokeDasharray="2 4" strokeWidth={0.75}
                  style={{ stroke: "var(--ig-border-subtle)", opacity: 0.7 }}
                />
              </React.Fragment>
            ))}

            {/* contornos iso-risco + cota do score */}
            {ISO_BANDS.map((b) => {
              const pts = isoCurve(b.k);
              const anchor = pts[Math.floor(pts.length * 0.5)];
              return (
                <g key={`iso-${b.k}`}>
                  <path
                    d={isoLinePath(b.k)}
                    fill="none"
                    strokeWidth={0.9}
                    strokeDasharray="5 4"
                    style={{ stroke: tint("var(--ig-danger)", 34) }}
                  />
                  {anchor && (
                    <text
                      x={xOf(anchor.p) + 4}
                      y={yOf(anchor.i) - 4}
                      style={{
                        fontSize: 8, fontWeight: 700, letterSpacing: 0.4,
                        fill: tint("var(--ig-danger)", 62),
                      }}
                    >
                      {b.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* moldura */}
            <rect
              x={xOf(DOM_MIN)} y={yOf(DOM_MAX)} width={PLOT_W} height={PLOT_H}
              fill="none" strokeWidth={0.75}
              style={{ stroke: "var(--ig-border-subtle)" }}
            />

            {/* ticks */}
            {TICKS.map((t) => (
              <React.Fragment key={`tick-${t}`}>
                <text
                  x={xOf(t)} y={VB - PAD_B + 12} textAnchor="middle"
                  style={{ fontSize: 9, fontWeight: 600, fill: "var(--ig-fg-subtle)" }}
                >
                  {t}
                </text>
                <text
                  x={PAD_L - 8} y={yOf(t) + 3} textAnchor="end"
                  style={{ fontSize: 9, fontWeight: 600, fill: "var(--ig-fg-subtle)" }}
                >
                  {t}
                </text>
              </React.Fragment>
            ))}

            {/* eixos */}
            <text
              x={xOf(DOM_MIN)} y={VB - 4}
              style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, fill: "var(--ig-fg-subtle)" }}
            >
              PROBABILIDADE →
            </text>
            <text
              x={-yOf(DOM_MIN)} y={11} transform="rotate(-90)"
              style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, fill: "var(--ig-fg-subtle)" }}
            >
              IMPACTO →
            </text>

            {/* corpos de risco */}
            {painted.map((d) => {
              const color = sevVar(d.severity);
              const on = hover === d.id;
              const dim = hover !== null && !on;
              const r = radiusOf(d.exposure);
              return (
                <g
                  key={d.id}
                  style={{
                    opacity: dim ? 0.22 : 1,
                    cursor: onSelect ? "pointer" : "default",
                    transition: "opacity .15s ease",
                  }}
                  onMouseEnter={() => setHover(d.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={onSelect ? () => onSelect(d.id) : undefined}
                >
                  <circle
                    cx={xOf(d.probability)} cy={yOf(d.impact)} r={r}
                    style={{
                      fill: tint(color, 16),
                      stroke: color,
                      strokeWidth: on ? 2 : 1.2,
                      transition: "stroke-width .15s ease",
                    }}
                  />
                  {/* núcleo: marca o centro exato quando o corpo é grande */}
                  <circle
                    cx={xOf(d.probability)} cy={yOf(d.impact)} r={1.6}
                    style={{ fill: color }}
                  />
                  <title>{`${d.title}\nProb. ${d.probability} × Impacto ${d.impact} · Score ${d.probability * d.impact}\nExposição ${formatCurrency(d.exposure, { compact: true })}`}</title>
                </g>
              );
            })}
          </svg>
        </div>

        {/* ── Trilha de maiores exposições, sincronizada com o plano ── */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">
            Maiores exposições
          </span>
          <ul className="flex flex-col gap-1">
            {ranked.map((d, idx) => {
              const color = sevVar(d.severity);
              const on = hover === d.id;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setHover(d.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={onSelect ? () => onSelect(d.id) : undefined}
                    className={cn(
                      "group flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left",
                      "transition-colors duration-150",
                      on
                        ? "border-ig-border-strong bg-ig-bg-overlay"
                        : "border-transparent bg-ig-raised/50 hover:border-ig-border-subtle",
                    )}
                  >
                    <span className="w-[3px] shrink-0 self-stretch rounded-full" style={{ backgroundColor: color }} />
                    <span className="text-[10px] font-semibold tabular-nums text-ig-fg-subtle">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-semibold text-ig-fg-strong" title={d.title}>
                        {d.title}
                      </span>
                      <span className="block text-[10px] font-medium tabular-nums text-ig-fg-subtle">
                        P{d.probability} × I{d.impact} · {formatCurrency(d.exposure, { compact: true })}
                      </span>
                    </span>
                    <span
                      className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                      style={{ backgroundColor: tint(color, 12), color }}
                      title="Score = probabilidade × impacto"
                    >
                      {d.probability * d.impact}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* ── Legenda + escala ── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-ig-border-subtle pt-2.5">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          {legend.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full border"
                style={{ backgroundColor: tint(sevVar(s.key), 16), borderColor: sevVar(s.key) }}
              />
              <span className="text-[11px] font-medium text-ig-fg-muted">{s.label}</span>
              <span className="text-[11px] font-semibold tabular-nums text-ig-fg-subtle">{s.count}</span>
            </span>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5" title="As curvas tracejadas marcam os limiares de score 6, 11 e 16">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">Iso-score</span>
            <svg width="26" height="8" aria-hidden>
              <path d="M0 7 Q 13 7 25 1" fill="none" strokeWidth={1} strokeDasharray="4 3" style={{ stroke: tint("var(--ig-danger)", 55) }} />
            </svg>
          </span>
          <span className="inline-flex items-center gap-1.5" title="O diâmetro representa a exposição financeira">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">Exposição</span>
            <span className="inline-flex items-end gap-1">
              {[4, 7, 10].map((d) => (
                <span key={d} className="shrink-0 rounded-full border border-ig-border-strong" style={{ height: d, width: d }} />
              ))}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
