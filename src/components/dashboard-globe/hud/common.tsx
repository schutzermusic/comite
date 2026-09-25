'use client';

import type { ReactNode } from 'react';
import { Lock, TriangleAlert } from 'lucide-react';
import type { FeedRow, HealthLevel, SitePosition } from '@/lib/dashboard/types';

/**
 * Peças comuns do HUD no estilo do protótipo (`.ap-*` → `.dg-*`): rótulos em
 * português, datas no formato do filme ("22 OUT") e as mensagens de estado.
 * Regra da casa: "Restrito" nunca é 0; o que não carregou diz que não
 * carregou — nunca vira calmaria.
 */

export const LEVEL_LABEL: Record<HealthLevel, string> = {
  critical: 'crítico', attention: 'atenção', healthy: 'em dia', unknown: 'sem cronograma',
};

export const levelLabel = (l: HealthLevel | null) => (l ? LEVEL_LABEL[l] : 'fora de execução');

/** Tom do filme por saúde: `danger`/`warn`/`accent`/`neutral`. */
export const levelTone = (l: HealthLevel | null) =>
  (l === 'critical' ? 'danger' : l === 'attention' ? 'warn' : l === 'healthy' ? 'accent' : 'neutral');

export const SEVERITY_LABEL: Record<FeedRow['severity'], string> = { critical: 'Crítico', high: 'Alto', medium: 'Médio' };
export const severityTone = (s: FeedRow['severity']) => (s === 'critical' ? 'danger' : s === 'high' ? 'warn' : 'accent');

/** De onde vem a posição, em palavras ("canteiro · cadastro do Supply", "oficial · contrato"). */
export function sourceShort(p: Pick<SitePosition, 'source'>): string {
  return p.source === 'canonical' ? 'oficial' : 'canteiro';
}
export function sourceLong(p: Pick<SitePosition, 'source' | 'evidence'>): string {
  if (p.source === 'project_site') return 'Canteiro · cadastro do Supply';
  return p.evidence.kind === 'manual' ? 'Localização oficial · registro manual' : 'Localização oficial · contrato';
}

const DAY_FMT = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short' });

/** "22 OUT" — a data no formato do filme (dia de São Paulo). */
export function filmDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '—';
  const d = new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = DAY_FMT.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month').replace('.', '').toUpperCase()}`;
}

export const nf = (n: number) => n.toLocaleString('pt-BR');

/** Seção que o perfil não lê: "Restrito", com o cadeado — nunca 0. */
export function Restricted({ children }: { children?: ReactNode }) {
  return (
    <p className="dg-state" data-kind="restricted">
      <Lock size={14} aria-hidden /><span><b>Restrito</b>{children ? <> — {children}</> : null}</span>
    </p>
  );
}

/** Leitura que falhou: diz que não carregou (nunca "nada aqui"). */
export function Failed({ what, message, onRetry }: { what: string; message?: string | null; onRetry?: () => void }) {
  return (
    <div className="dg-state" data-kind="error" role="status">
      <TriangleAlert size={14} aria-hidden />
      <span><b>{what} não carregou</b>{message ? <> — {message}</> : null}</span>
      {onRetry && <button type="button" className="dg-mini" onClick={onRetry}>Tentar de novo</button>}
    </div>
  );
}

/** Esqueleto em forma de painel (carregando nunca é uma página em branco). */
export function SkeletonLines({ lines = 4 }: { lines?: number }) {
  return (
    <div className="dg-skel" aria-hidden>
      {Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: `${[62, 88, 74, 94, 58, 80][i % 6]}%` }} />)}
    </div>
  );
}

/** O hexágono do projeto (lista e mapa). */
export function Hex({ tone }: { tone: string }) {
  return <i className="dg-hex" data-tone={tone} aria-hidden />;
}
