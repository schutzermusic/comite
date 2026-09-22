"use client";

import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { HudPanel } from "@/components/hud";
import { brl } from "./shared";
import "./commercial.css";

export function WorkspaceHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="crm-heading">
      <div>
        <p className="crm-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="crm-muted">{description}</p>
      </div>
      <div className="crm-actions">{action}</div>
    </div>
  );
}
export function Metrics({
  items,
}: {
  items: {
    label: string;
    value: ReactNode;
    hint: string;
    accent?: boolean;
    onClick?: () => void;
  }[];
}) {
  return (
    <div className="crm-metrics">
      {items.map((item) => {
        const content = (
          <>
            <span className="crm-eyebrow">
              {item.label}
              {item.onClick && <ArrowUpRight size={14} aria-hidden />}
            </span>
            <strong className={item.accent ? "crm-accent" : ""}>
              {item.value}
            </strong>
            <span className="crm-muted">{item.hint}</span>
          </>
        );
        return item.onClick ? (
          <button
            key={item.label}
            className="crm-metric"
            onClick={item.onClick}
          >
            {content}
          </button>
        ) : (
          <div key={item.label} className="crm-metric">
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
  return (
    <>
      <div
        className="crm-table-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        <table className="crm-table">
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
                <td colSpan={columns.length}>
                  <div className="crm-table-empty">{empty}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="crm-table-footer">
        <span>{count} registro(s) exibido(s)</span>
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
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="crm-empty-note">
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
      <ShieldCheck size={17} aria-hidden />
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
