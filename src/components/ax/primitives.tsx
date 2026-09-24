'use client';

import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, ArrowUpRight, Inbox, Loader2, RefreshCw, Search } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { hasAnyPermission } from '@/lib/auth/permissions';
import { OPERATIONS_NAV } from '@/lib/operations/navigation';
import { SUPPLY_NAV } from '@/lib/supply/navigation';
import { relativeDue } from './format';
import './ax.css';

export type Tone = 'danger' | 'warning' | 'success' | 'info' | 'accent' | 'neutral';

/** Raiz de toda tela de Operações e Supply. O Suspense é o que a URL-estado (useSearchParams) exige. */
export function AxPage({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="ax" data-testid={testId}>
      <div className="ax-page">
        <Suspense fallback={<Skeleton />}>{children}</Suspense>
      </div>
    </div>
  );
}

export function CommandHeader({ domain, area, title, context, actions }: {
  domain: 'operations' | 'supply'; area: string; title: string; context?: ReactNode; actions?: ReactNode;
}) {
  return (
    <>
      <DomainNav domain={domain} />
      <header className="ax-header">
        <div className="ax-header-main">
          <span className="ax-eyebrow"><b>{domain === 'operations' ? 'Operações' : 'Supply Chain'}</b> · {area}</span>
          <h1 className="ax-title">{title}</h1>
          {context && <div className="ax-context">{context}</div>}
        </div>
        {actions && <div className="ax-header-actions">{actions}</div>}
      </header>
    </>
  );
}

/** As seis áreas do domínio, na alçada da pessoa — no celular, o único jeito rápido de trocar de área. */
export function DomainNav({ domain }: { domain: 'operations' | 'supply' }) {
  const pathname = usePathname();
  const { permissions } = useCurrentUser();
  const keys = (permissions ?? []) as string[];
  const items = (domain === 'operations' ? OPERATIONS_NAV : SUPPLY_NAV)
    .filter((i) => keys.length === 0 || hasAnyPermission(keys as never[], i.anyPermission as never[]));
  const current = items.slice().sort((a, b) => b.href.length - a.href.length)
    .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return (
    <nav className="ax-domainnav" aria-label={domain === 'operations' ? 'Áreas de Operações' : 'Áreas de Supply Chain'}>
      {items.map((i) => (
        <Link key={i.id} href={i.href} aria-current={current?.id === i.id ? 'page' : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}

export interface SignalItem {
  label: string; value: ReactNode; unit?: string; hint?: ReactNode; tone?: Tone; href?: string; onClick?: () => void; testId?: string;
}

/** Uma faixa de sinais, não seis caixas. Cada número leva ao registro que o compõe. */
export function SignalStrip({ items, label }: { items: SignalItem[]; label: string }) {
  return (
    <section className="ax-signals" aria-label={label}>
      {items.map((s) => {
        const body = (
          <>
            <span className="ax-signal-label">{s.label}{(s.href || s.onClick) && <ArrowUpRight size={12} className="ax-go" aria-hidden />}</span>
            <span className="ax-signal-value">{s.value}{s.unit && <small>{s.unit}</small>}</span>
            {s.hint && <span className="ax-signal-hint">{s.hint}</span>}
          </>
        );
        if (s.href) return <Link key={s.label} href={s.href} className="ax-signal" data-tone={s.tone} data-testid={s.testId}>{body}</Link>;
        if (s.onClick) return <button key={s.label} type="button" className="ax-signal" data-tone={s.tone} onClick={s.onClick} data-testid={s.testId}>{body}</button>;
        return <div key={s.label} className="ax-signal" data-tone={s.tone} data-testid={s.testId}>{body}</div>;
      })}
    </section>
  );
}

export function Plane({ title, subtitle, count, countTone, action, children, flush, testId, id, bar }: {
  title?: ReactNode; subtitle?: ReactNode; count?: number; countTone?: 'danger' | 'warning'; action?: ReactNode;
  children: ReactNode; flush?: boolean; testId?: string; id?: string; bar?: ReactNode;
}) {
  return (
    <section className="ax-plane" data-testid={testId} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || action) && (
        <div className="ax-plane-head">
          <div>
            {title && <h3>{title}{count !== undefined && <span className={`ax-count ${countTone ?? ''}`}>{count}</span>}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {bar && <div className="ax-plane-bar">{bar}</div>}
      <div className={flush ? 'ax-plane-body flush' : 'ax-plane-body'}>{children}</div>
    </section>
  );
}

/** Estado com cor E texto — nunca só cor. */
export function Chip({ tone = 'neutral', children, quiet, title }: { tone?: Tone; children: ReactNode; quiet?: boolean; title?: string }) {
  return <span className={quiet ? 'ax-chip quiet' : 'ax-chip'} data-tone={tone} title={title}><i aria-hidden />{children}</span>;
}

export function Dot({ tone, label }: { tone: Tone; label: string }) {
  return <span className="ax-dot" data-tone={tone} role="img" aria-label={label} title={label} />;
}

export function Due({ value, today }: { value: string | null | undefined; today?: string }) {
  const d = relativeDue(value, today);
  return <span className="ax-row-due" data-late={d.late ? 'true' : 'false'} title={value ?? undefined}>{d.text}</span>;
}

/** Uma exceção: onde (tipo · projeto), o quê, qual o problema, prazo, dono e a ação — nesta ordem. */
export function AttentionRow({ tone, kind, object, issue, detail, impact, due, owner, href, actionLabel, action, today, testId, hideOwner }: {
  tone: Tone; kind?: string; object: ReactNode; issue: ReactNode; detail?: ReactNode; impact?: ReactNode; due?: string | null; owner?: string | null;
  href?: string; actionLabel?: string; action?: ReactNode; today?: string; testId?: string; hideOwner?: boolean;
}) {
  return (
    <div className={hideOwner ? 'ax-row no-owner' : 'ax-row'} data-tone={tone} data-testid={testId}>
      <div className="ax-row-main">
        {(kind || impact) && (
          <span className="ax-row-eyebrow">
            {kind && <span className="ax-kind">{kind}</span>}
            {impact && <span className="ax-row-where">{impact}</span>}
          </span>
        )}
        <span className="ax-row-object">{object}</span>
        <span className="ax-row-issue">{issue}</span>
      </div>
      <Due value={due} today={today} />
      {!hideOwner && <div className="ax-row-cell optional owner">{owner ? <strong>{owner}</strong> : <span className="ax-subtle">sem dono</span>}</div>}
      <div className="ax-row-actions">
        {action}
        {href && <Link className="ax-btn sm" href={href}>{actionLabel ?? 'Abrir'}<ArrowUpRight size={13} aria-hidden /></Link>}
      </div>
      {/* A evidência (cadeia causal, cobertura, recomendação) ocupa a largura toda, embaixo. */}
      {detail && <div className="ax-row-detail">{detail}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ label, tabs, value, onChange }: {
  label: string; tabs: Array<{ id: T; label: string; count?: number; tone?: 'danger' | 'warning' }>; value: T; onChange: (id: T) => void;
}) {
  return (
    <div className="ax-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" id={`ax-tab-${t.id}`} aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1} className="ax-tab" onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = tabs.findIndex((x) => x.id === value);
            const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            onChange(next.id);
            document.getElementById(`ax-tab-${next.id}`)?.focus();
          }}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className={`ax-count ${t.tone ?? ''}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Filters<T extends string>({ options, value, onChange, label }: {
  options: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (id: T) => void; label: string;
}) {
  return (
    <div className="ax-filters" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className="ax-filter" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}{o.count !== undefined && <span className="ax-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="ax-search">
      <Search size={15} aria-hidden />
      <span className="sr-only-ax">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" />
    </label>
  );
}

export function EmptyState({ title, children, action, icon, compact }: {
  title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={compact ? 'ax-empty compact' : 'ax-empty'} role="status">
      <span className="ax-empty-icon" aria-hidden>{icon ?? <Inbox size={18} />}</span>
      <div>
        <h4>{title}</h4>
        {children && <p>{children}</p>}
        {action}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  return (
    <section className="ax-plane ax-error" role="alert">
      <div className="ax-empty">
        <span className="ax-empty-icon" aria-hidden><AlertTriangle size={18} /></span>
        <div>
          <h4>Não foi possível carregar</h4>
          <p>{message ?? 'O servidor não respondeu. Nada foi alterado.'}</p>
          {onRetry && <button type="button" className="ax-btn sm" onClick={onRetry}><RefreshCw size={13} aria-hidden />Tentar de novo</button>}
        </div>
      </div>
    </section>
  );
}

export function Skeleton() {
  return (
    <div className="ax-skel" role="status" aria-label="Carregando…">
      <i style={{ width: '32%', height: 22 }} />
      <i className="strip" />
      <i className="block" />
      <i className="block" style={{ width: '70%' }} />
    </div>
  );
}

/** Carregando / erro / conteúdo, num lugar só. */
export function Resource<T>({ state, data, message, refresh, children }: {
  state: string; data: T | null; message: string | null; refresh: () => void; children: (data: T) => ReactNode;
}) {
  if (data) return <>{children(data)}</>;
  if (state === 'loading') return <Skeleton />;
  return <ErrorState message={message} onRetry={refresh} />;
}

export function Busy({ on, children }: { on: boolean; children: ReactNode }) {
  return <>{on ? <Loader2 size={14} className="spin" aria-hidden /> : null}{children}</>;
}

export function KV({ items }: { items: Array<[ReactNode, ReactNode]> }) {
  return <dl className="ax-kv">{items.map(([k, v], i) => <FragmentKV key={i} k={k} v={v} />)}</dl>;
}
function FragmentKV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}
