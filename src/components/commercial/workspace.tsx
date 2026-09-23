"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  Inbox,
  Lock,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { HudPanel } from "@/components/hud";
import { brl } from "./shared";
import "./commercial.css";
import "./commercial-v3.css";

export function WorkspaceHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  // Um cabeçalho só por tela: a área, o estado vivo dela e a ação principal.
  // Nada de frase de efeito empurrando o trabalho para baixo da dobra.
  return (
    <div className="crm-heading">
      <div className="crm-heading-main">
        <p className="crm-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="crm-heading-live">{description}</p>
      </div>
      <div className="crm-actions">{action}</div>
    </div>
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

/** Estado com cor e texto — nunca só cor. */
export function StatePill({
  tone = "neutral",
  children,
  dot = true,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`crm-pill crm-pill-${tone}`}>
      {dot && <i aria-hidden />}
      {children}
    </span>
  );
}

/**
 * Função indisponível AGORA — dita, com o que falta e o botão que resolve.
 * A regra do módulo: nada some em silêncio.
 */
export function UnlockHint({
  children,
  action,
  tone = "neutral",
  icon,
  testId,
}: {
  children: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "warning" | "danger";
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={`crm-unlock crm-unlock-${tone}`} data-testid={testId}>
      <span className="crm-unlock-icon" aria-hidden>
        {icon ?? <Lock size={14} />}
      </span>
      <p>{children}</p>
      {action && <div className="crm-unlock-action">{action}</div>}
    </div>
  );
}
export function Metrics({
  items,
}: {
  items: {
    label: string;
    value: ReactNode;
    hint: ReactNode;
    accent?: boolean;
    tone?: Tone;
    /** 0–1: uma régua fina sob o número (cobertura, conversão, peso). */
    meter?: number | null;
    onClick?: () => void;
  }[];
}) {
  return (
    <div className="crm-metrics">
      {items.map((item) => {
        const tone = item.tone ?? (item.accent ? "accent" : "neutral");
        const content = (
          <>
            <span className="crm-eyebrow">
              {item.label}
              {item.onClick && <ArrowUpRight size={13} aria-hidden />}
            </span>
            <strong className={`crm-metric-value crm-tone-${tone}`}>
              {item.value}
            </strong>
            {item.meter !== undefined && item.meter !== null && (
              <span className="crm-meter" aria-hidden>
                <i style={{ width: `${Math.max(0, Math.min(1, item.meter)) * 100}%` }} />
              </span>
            )}
            <span className="crm-metric-hint">{item.hint}</span>
          </>
        );
        return item.onClick ? (
          <button
            key={item.label}
            className={`crm-metric crm-metric-${tone}`}
            onClick={item.onClick}
          >
            {content}
          </button>
        ) : (
          <div key={item.label} className={`crm-metric crm-metric-${tone}`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
export function Panel({
  title,
  note,
  aside,
  children,
}: {
  title: string;
  note?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <HudPanel elevation={1} interactive={false} noPadding>
      <div className="crm-panel-header">
        <div>
          <h3>{title}</h3>
          {note && <p className="crm-muted">{note}</p>}
        </div>
        {aside}
      </div>
      {children}
    </HudPanel>
  );
}
export function Toolbar({
  search,
  onSearch,
  placeholder,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  children?: ReactNode;
}) {
  return (
    <div className="crm-toolbar">
      <label className="crm-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          aria-label={placeholder}
          placeholder={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <div className="crm-filters">
        <SlidersHorizontal size={14} aria-hidden />
        {children}
      </div>
    </div>
  );
}
export function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="crm-select">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Segments({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; count?: number }[];
}) {
  return (
    <div className="crm-segments" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function DataTable({
  label,
  columns,
  children,
  empty,
  count,
  footer,
}: {
  label: string;
  columns: string[];
  children?: ReactNode;
  empty: ReactNode;
  count: number;
  footer?: string;
}) {
  // No celular a tabela vira cartões; cada célula precisa do nome da coluna.
  const ref = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelectorAll("tbody tr").forEach((row) =>
      row.querySelectorAll(":scope > td").forEach((cell, index) => {
        if (columns[index] !== undefined) cell.setAttribute("data-label", columns[index]);
      }),
    );
  });
  return (
    <>
      <div
        className="crm-table-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        <table className="crm-table crm-table-cards" ref={ref}>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {count > 0 ? (
              children
            ) : (
              <tr>
                <td colSpan={columns.length} className="crm-table-empty-cell">
                  <div className="crm-table-empty">{empty}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="crm-table-footer">
        <span><b>{count}</b> registro(s)</span>
        <span>{footer ?? "Dados do espaço de trabalho"}</span>
      </div>
    </>
  );
}
export function EmptyNote({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="crm-empty-note">
      <span className="crm-empty-glyph" aria-hidden>
        <Inbox size={16} />
      </span>
      <div>
        <strong>{title}</strong>
        <p className="crm-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function GovernanceNote({ children }: { children: ReactNode }) {
  return (
    <div className="crm-governance">
      <ShieldCheck size={13} aria-hidden />
      <p>{children}</p>
    </div>
  );
}
/** Never sum different currencies or disguise an unknown amount as zero. */
export function moneyTotal(
  rows: { currency?: string | null; value: string | number | null }[],
) {
  if (!rows.length) return brl(0);
  const known = rows.filter(
    (r) => r.value !== null && Number.isFinite(Number(r.value)),
  );
  if (!known.length) return "Não informado";
  const totals = new Map<string, number>();
  for (const r of known)
    totals.set(
      r.currency || "BRL",
      (totals.get(r.currency || "BRL") ?? 0) + Number(r.value),
    );
  return (
    [...totals].map(([currency, value]) => brl(value, currency)).join(" · ") +
    (known.length < rows.length ? " + não informados" : "")
  );
}
export const matches = (
  query: string,
  ...values: (string | null | undefined)[]
) =>
  values.some((value) =>
    (value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .includes(
        query
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase(),
      ),
  );
