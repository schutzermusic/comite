'use client';

import { createClient } from '@/utils/supabase/client';
import type { InvestorPack, InvestorPackMonth, InvestorPackNarrative, InvestorPackStatus } from './types';

const STORAGE_KEY = 'insight-investor-report-packs-v1';
const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

type PackRow = {
  id: string;
  organization_id: string;
  parent_pack_id: string | null;
  title: string;
  company: string;
  recipient: string;
  period_start: string;
  period_end: string;
  currency: 'BRL';
  reference_date: string;
  confidentiality: InvestorPack['confidentiality'];
  status: InvestorPackStatus;
  version: number;
  narrative: InvestorPackNarrative;
  created_by: string | null;
  author_name: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type MonthRow = {
  id: string;
  pack_id: string;
  period_key: string;
  revenue_actual_cents: number | string;
  revenue_forecast_cents: number | string;
  payroll_actual_cents: number | string;
  payroll_forecast_cents: number | string;
  note: string;
};

export interface InvestorPackActor {
  organizationId: string | null;
  userId: string | null;
  authorName: string;
}

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pack-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyNarrative(): InvestorPackNarrative {
  return { executiveSummary: '', highlights: [''], risks: [''], assumptions: [''], closingMessage: '' };
}

function periodOffset(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function createInvestorPackDraft(actor: InvestorPackActor, now = new Date()): InvestorPack {
  const referenceDate = now.toISOString().slice(0, 10);
  const currentPeriod = referenceDate.slice(0, 7);
  const createdAt = now.toISOString();
  return {
    id: uuid(),
    organizationId: actor.organizationId,
    title: 'Projeção Financeira',
    company: '',
    recipient: '',
    periodStart: periodOffset(currentPeriod, -5),
    periodEnd: periodOffset(currentPeriod, 6),
    currency: 'BRL',
    referenceDate,
    confidentiality: 'confidential',
    status: 'draft',
    version: 1,
    parentPackId: null,
    authorName: actor.authorName,
    createdBy: actor.userId,
    createdAt,
    updatedAt: createdAt,
    publishedAt: null,
    months: Array.from({ length: 12 }, (_, index) => ({
      id: uuid(),
      period: periodOffset(currentPeriod, index - 5),
      revenueActualCents: 0,
      revenueForecastCents: 0,
      payrollActualCents: 0,
      payrollForecastCents: 0,
      note: '',
    })),
    narrative: emptyNarrative(),
  };
}

function readLocal(): InvestorPack[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as InvestorPack[];
  } catch {
    return [];
  }
}

function writeLocal(packs: InvestorPack[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
}

function rowToPack(row: PackRow, months: MonthRow[]): InvestorPack {
  return {
    id: row.id,
    organizationId: row.organization_id,
    parentPackId: row.parent_pack_id,
    title: row.title,
    company: row.company,
    recipient: row.recipient,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    currency: row.currency,
    referenceDate: row.reference_date,
    confidentiality: row.confidentiality,
    status: row.status,
    version: row.version,
    narrative: { ...emptyNarrative(), ...(row.narrative ?? {}) },
    createdBy: row.created_by,
    authorName: row.author_name,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    months: months
      .filter((month) => month.pack_id === row.id)
      .map((month) => ({
        id: month.id,
        period: month.period_key,
        revenueActualCents: Number(month.revenue_actual_cents),
        revenueForecastCents: Number(month.revenue_forecast_cents),
        payrollActualCents: Number(month.payroll_actual_cents),
        payrollForecastCents: Number(month.payroll_forecast_cents),
        note: month.note,
      }))
      .sort((a, b) => a.period.localeCompare(b.period)),
  };
}

function packRow(pack: InvestorPack, actor: InvestorPackActor) {
  return {
    id: pack.id,
    organization_id: pack.organizationId ?? actor.organizationId,
    parent_pack_id: pack.parentPackId,
    title: pack.title,
    company: pack.company,
    recipient: pack.recipient,
    period_start: pack.periodStart,
    period_end: pack.periodEnd,
    currency: pack.currency,
    reference_date: pack.referenceDate,
    confidentiality: pack.confidentiality,
    status: pack.status,
    version: pack.version,
    narrative: pack.narrative,
    created_by: pack.createdBy ?? actor.userId,
    author_name: pack.authorName || actor.authorName,
    published_at: pack.publishedAt,
    created_at: pack.createdAt,
    updated_at: pack.updatedAt,
  };
}

function monthRows(pack: InvestorPack, actor: InvestorPackActor) {
  return pack.months.map((month) => ({
    id: month.id,
    organization_id: pack.organizationId ?? actor.organizationId,
    pack_id: pack.id,
    period_key: month.period,
    revenue_actual_cents: month.revenueActualCents,
    revenue_forecast_cents: month.revenueForecastCents,
    payroll_actual_cents: month.payrollActualCents,
    payroll_forecast_cents: month.payrollForecastCents,
    note: month.note,
    updated_at: pack.updatedAt,
  }));
}

export async function listInvestorPacks(): Promise<InvestorPack[]> {
  if (!SUPABASE_CONFIGURED) return readLocal().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const supabase = createClient();
  const [{ data: packs, error: packError }, { data: months, error: monthError }] = await Promise.all([
    supabase.from('investor_report_packs').select('*').order('updated_at', { ascending: false }),
    supabase.from('investor_report_pack_months').select('*').order('period_key'),
  ]);
  if (packError) throw new Error(packError.message);
  if (monthError) throw new Error(monthError.message);
  return ((packs ?? []) as PackRow[]).map((row) => rowToPack(row, (months ?? []) as MonthRow[]));
}

export async function getInvestorPack(id: string): Promise<InvestorPack | null> {
  if (!SUPABASE_CONFIGURED) return readLocal().find((pack) => pack.id === id) ?? null;
  const supabase = createClient();
  const [{ data: pack, error: packError }, { data: months, error: monthError }] = await Promise.all([
    supabase.from('investor_report_packs').select('*').eq('id', id).maybeSingle(),
    supabase.from('investor_report_pack_months').select('*').eq('pack_id', id).order('period_key'),
  ]);
  if (packError) throw new Error(packError.message);
  if (monthError) throw new Error(monthError.message);
  if (!pack) return null;
  return rowToPack(pack as PackRow, (months ?? []) as MonthRow[]);
}

export async function saveInvestorPack(pack: InvestorPack, actor: InvestorPackActor): Promise<InvestorPack> {
  if (pack.status !== 'draft') throw new Error('Pack publicado é imutável; crie uma nova versão.');
  const next = { ...pack, organizationId: pack.organizationId ?? actor.organizationId, updatedAt: new Date().toISOString() };
  if (!SUPABASE_CONFIGURED) {
    const packs = readLocal();
    const index = packs.findIndex((item) => item.id === next.id);
    if (index >= 0) packs[index] = next;
    else packs.unshift(next);
    writeLocal(packs);
    return next;
  }
  if (!next.organizationId || !actor.userId) {
    throw new Error('Aguarde o carregamento do usuário e da organização antes de salvar.');
  }

  const supabase = createClient();
  const { error: packError } = await supabase.from('investor_report_packs').upsert(packRow(next, actor));
  if (packError) throw new Error(packError.message);
  const { error: deleteError } = await supabase.from('investor_report_pack_months').delete().eq('pack_id', next.id);
  if (deleteError) throw new Error(deleteError.message);
  if (next.months.length) {
    const { error: monthError } = await supabase.from('investor_report_pack_months').insert(monthRows(next, actor));
    if (monthError) throw new Error(monthError.message);
  }
  return next;
}

export async function publishInvestorPack(
  pack: InvestorPack,
  actor: InvestorPackActor,
  saveDraftBeforePublishing = true,
): Promise<InvestorPack> {
  const saved = saveDraftBeforePublishing ? await saveInvestorPack(pack, actor) : pack;
  const next: InvestorPack = { ...saved, status: 'published', publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (!SUPABASE_CONFIGURED) {
    const packs = readLocal().map((item) => item.id === next.id ? next : item);
    writeLocal(packs);
    return next;
  }
  if (!next.organizationId || !actor.userId) {
    throw new Error('Aguarde o carregamento do usuário e da organização antes de publicar.');
  }
  const supabase = createClient();
  const { error } = await supabase.from('investor_report_packs').update({
    status: next.status,
    published_at: next.publishedAt,
    updated_at: next.updatedAt,
  }).eq('id', next.id);
  if (error) throw new Error(error.message);
  return next;
}

export async function cloneInvestorPack(pack: InvestorPack, actor: InvestorPackActor): Promise<InvestorPack> {
  const now = new Date().toISOString();
  const clone: InvestorPack = {
    ...pack,
    id: uuid(),
    parentPackId: pack.parentPackId ?? pack.id,
    status: 'draft',
    version: pack.version + 1,
    authorName: actor.authorName,
    createdBy: actor.userId,
    organizationId: actor.organizationId,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    months: pack.months.map((month) => ({ ...month, id: uuid() })),
  };
  return saveInvestorPack(clone, actor);
}

export async function archiveInvestorPack(pack: InvestorPack): Promise<InvestorPack> {
  const next = { ...pack, status: 'archived' as const, updatedAt: new Date().toISOString() };
  if (!SUPABASE_CONFIGURED || !next.organizationId) {
    writeLocal(readLocal().map((item) => item.id === next.id ? next : item));
    return next;
  }
  const supabase = createClient();
  const { error } = await supabase.from('investor_report_packs').update({ status: 'archived', updated_at: next.updatedAt }).eq('id', pack.id);
  if (error) throw new Error(error.message);
  return next;
}

export function addInvestorPackMonth(pack: InvestorPack, period?: string): InvestorPackMonth {
  const latest = [...pack.months].sort((a, b) => b.period.localeCompare(a.period))[0]?.period ?? pack.periodStart;
  return {
    id: uuid(),
    period: period ?? periodOffset(latest, 1),
    revenueActualCents: 0,
    revenueForecastCents: 0,
    payrollActualCents: 0,
    payrollForecastCents: 0,
    note: '',
  };
}
