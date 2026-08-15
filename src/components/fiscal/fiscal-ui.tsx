'use client';

import Link from 'next/link';
import type { FiscalDocumentStatus } from '@/lib/fiscal/types';

export const STATUS_LABEL: Record<FiscalDocumentStatus, string> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovada internamente',
  queued: 'Na fila',
  processing: 'Processando',
  authorized: 'Autorizada',
  rejected: 'Rejeitada',
  error: 'Erro',
  cancellation_requested: 'Cancelamento solicitado',
  cancelled: 'Cancelada',
  replaced: 'Substituída',
  archived: 'Arquivada',
};

const STATUS_CLASS: Record<FiscalDocumentStatus, string> = {
  draft: 'border-ig-border text-ig-fg-muted bg-ig-panel',
  pending_approval: 'border-[color-mix(in_oklab,var(--ig-warning)_35%,transparent)] text-ig-warning bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)]',
  approved: 'border-[color-mix(in_oklab,var(--ig-info)_35%,transparent)] text-ig-info bg-[color-mix(in_oklab,var(--ig-info)_10%,transparent)]',
  queued: 'border-[color-mix(in_oklab,var(--ig-info)_35%,transparent)] text-ig-info bg-[color-mix(in_oklab,var(--ig-info)_10%,transparent)]',
  processing: 'border-[color-mix(in_oklab,var(--ig-accent)_35%,transparent)] text-ig-accent bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)]',
  authorized: 'border-[color-mix(in_oklab,var(--ig-success)_35%,transparent)] text-ig-success bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)]',
  rejected: 'border-[color-mix(in_oklab,var(--ig-danger)_35%,transparent)] text-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)]',
  error: 'border-[color-mix(in_oklab,var(--ig-danger)_35%,transparent)] text-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)]',
  cancellation_requested: 'border-[color-mix(in_oklab,var(--ig-warning)_35%,transparent)] text-ig-warning bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)]',
  cancelled: 'border-[color-mix(in_oklab,var(--ig-danger)_35%,transparent)] text-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)]',
  replaced: 'border-ig-border text-ig-fg-muted bg-ig-panel',
  archived: 'border-ig-border text-ig-fg-subtle bg-ig-panel',
};

export function FiscalStatusBadge({ status }: { status: FiscalDocumentStatus }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function formatFiscalCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
}

export function FiscalPrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-10 items-center justify-center rounded-lg bg-[linear-gradient(180deg,#17C3B2_0%,#0F9C8F_100%)] px-4 text-sm font-semibold text-white shadow-lg transition hover:brightness-105">
      {children}
    </Link>
  );
}

export async function fiscalFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => ({ ok: false, error: 'Resposta inválida do servidor.' }));
  if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Falha na operação fiscal.');
  return payload as T;
}

export function FiscalEmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-ig-border p-8 text-center">
      <p className="text-sm font-semibold text-ig-fg-strong">{title}</p>
      <p className="mt-2 max-w-xl text-xs text-ig-fg-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

