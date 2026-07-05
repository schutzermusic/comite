'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import type {
    ProjectV2,
    CostCurvePoint,
    RevenueCurvePoint,
    BillingEvent,
    CostBreakdownItem,
} from '@/lib/types/project-v2';
import { updateProjectV2 } from '@/lib/services/projects';
import { makeMoney } from '@/lib/utils/project-utils';
import {
    ChartDataEditorModal,
    type EditorColumn,
    type EditorRow,
    type EditorCellValue,
} from './ChartDataEditorModal';

// ── Kinds ───────────────────────────────────────────────────────

export type ProjectChartEditorKind =
    | 'curves'        // Curva S do cockpit + Fluxo Mensal (costCurve + revenueCurve)
    | 'costCurve'     // Custo Acumulado (Controle Interno)
    | 'revenueCurve'  // Receita Acumulada (Controle Interno)
    | 'eventogram'    // Eventograma de Faturamento
    | 'breakdown';    // Resultado Projetado / composição de desembolsos

// ── Helpers ─────────────────────────────────────────────────────

const toReais = (cents: number | null | undefined): number | null =>
    typeof cents === 'number' && Number.isFinite(cents) ? cents / 100 : null;

const toCents = (value: EditorCellValue): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;

const asText = (value: EditorCellValue): string => (value == null ? '' : String(value));

// curve fields nullable na prática (line break no gráfico), mas tipados como
// number — segue o mesmo cast usado em mock-projects-v2.
const asNullableCents = (value: EditorCellValue): number =>
    toCents(value) as unknown as number;

function genId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextPeriod(periods: string[]): string {
    const last = [...periods].sort().at(-1);
    if (!last || !/^\d{4}-\d{2}$/.test(last)) {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const [y, m] = last.split('-').map(Number);
    const month = (m % 12) + 1;
    const year = m === 12 ? y + 1 : y;
    return `${year}-${String(month).padStart(2, '0')}`;
}

const EVENT_STATUS_OPTIONS = [
    { value: 'planned', label: 'Previsto' },
    { value: 'billed', label: 'Faturado' },
    { value: 'partial', label: 'Parcial' },
    { value: 'delayed', label: 'Atrasado' },
    { value: 'cancelled', label: 'Cancelado' },
];

// ── Row builders (cents → reais boundary) ───────────────────────

function buildCurveRows(project: ProjectV2): EditorRow[] {
    const cost = new Map((project.costCurve ?? []).map(p => [p.period, p]));
    const rev = new Map((project.revenueCurve ?? []).map(p => [p.period, p]));
    const periods = Array.from(new Set([...cost.keys(), ...rev.keys()])).sort((a, b) => a.localeCompare(b));
    return periods.map(period => {
        const c = cost.get(period);
        const r = rev.get(period);
        return {
            period,
            planned: toReais(r?.plannedCumulative),
            billed: toReais(r?.billedCumulative),
            received: toReais(r?.receivedCumulative),
            bac: toReais(c?.bacCumulative),
            ac: toReais(c?.acCumulative),
            eac: toReais(c?.eacCumulative),
            tax: toReais(c?.taxCumulative),
        };
    });
}

function splitCurveRows(rows: EditorRow[]): { costCurve: CostCurvePoint[]; revenueCurve: RevenueCurvePoint[] } {
    const costCurve: CostCurvePoint[] = [];
    const revenueCurve: RevenueCurvePoint[] = [];
    for (const row of rows) {
        const period = asText(row.period);
        const planned = toCents(row.planned);
        const billed = toCents(row.billed);
        const received = toCents(row.received);
        if (planned != null || billed != null || received != null) {
            revenueCurve.push({
                period,
                plannedCumulative: planned ?? 0,
                billedCumulative: billed as unknown as number,
                receivedCumulative: received as unknown as number,
            });
        }
        const bac = toCents(row.bac);
        const ac = toCents(row.ac);
        const eac = toCents(row.eac);
        const tax = toCents(row.tax);
        if (bac != null || ac != null || eac != null || tax != null) {
            costCurve.push({
                period,
                bacCumulative: bac ?? 0,
                acCumulative: ac as unknown as number,
                eacCumulative: eac ?? bac ?? 0,
                ...(tax != null ? { taxCumulative: tax } : {}),
            });
        }
    }
    return { costCurve, revenueCurve };
}

// ── Column sets ─────────────────────────────────────────────────

const COL_PERIOD: EditorColumn = { key: 'period', label: 'Período', type: 'period' };
const COST_COLS: EditorColumn[] = [
    { key: 'bac', label: 'BAC (Orçamento)', type: 'money', cumulative: true },
    { key: 'ac', label: 'AC (Realizado)', type: 'money', nullable: true, cumulative: true },
    { key: 'eac', label: 'EAC (Estimativa)', type: 'money', nullable: true, cumulative: true },
    { key: 'tax', label: 'Imposto', type: 'money', nullable: true, cumulative: true },
];
const REVENUE_COLS: EditorColumn[] = [
    { key: 'planned', label: 'Planejado', type: 'money', cumulative: true },
    { key: 'billed', label: 'Faturado', type: 'money', nullable: true, cumulative: true },
    { key: 'received', label: 'Recebido', type: 'money', nullable: true, cumulative: true },
];

// ── Editor configs ──────────────────────────────────────────────

interface EditorConfig {
    title: string;
    subtitle?: string;
    columns: EditorColumn[];
    rows: EditorRow[];
    rowKey: string;
    newRow: () => EditorRow;
    toUpdates: (rows: EditorRow[]) => Partial<ProjectV2>;
}

function buildEditorConfig(kind: ProjectChartEditorKind, project: ProjectV2): EditorConfig {
    switch (kind) {
        case 'curves': {
            const rows = buildCurveRows(project);
            return {
                title: 'Editar dados — Curva S / Fluxo Mensal',
                subtitle: 'Valores acumulados em reais (R$) · alimenta Curva S, Fluxo Mensal e KPIs derivados',
                columns: [
                    COL_PERIOD,
                    { key: 'planned', label: 'Receita planejada', type: 'money', nullable: true, cumulative: true },
                    { key: 'billed', label: 'Faturado', type: 'money', nullable: true, cumulative: true },
                    { key: 'received', label: 'Recebido', type: 'money', nullable: true, cumulative: true },
                    ...COST_COLS.map(c => ({ ...c, nullable: true })),
                ],
                rows,
                rowKey: 'period',
                newRow: () => ({
                    period: nextPeriod(rows.map(r => asText(r.period))),
                    planned: null, billed: null, received: null,
                    bac: null, ac: null, eac: null, tax: null,
                }),
                toUpdates: splitCurveRows,
            };
        }
        case 'costCurve': {
            const rows = (project.costCurve ?? []).map(p => ({
                period: p.period,
                bac: toReais(p.bacCumulative),
                ac: toReais(p.acCumulative),
                eac: toReais(p.eacCumulative),
                tax: toReais(p.taxCumulative),
            }));
            return {
                title: 'Editar dados — Custo Acumulado',
                subtitle: 'Curva de custo acumulado em reais (R$) · BAC × AC × EAC · sobrepõe o ledger no gráfico',
                columns: [COL_PERIOD, ...COST_COLS],
                rows,
                rowKey: 'period',
                newRow: () => ({
                    period: nextPeriod(rows.map(r => asText(r.period))),
                    bac: null, ac: null, eac: null, tax: null,
                }),
                toUpdates: (edited) => ({
                    costCurve: edited.map(row => ({
                        period: asText(row.period),
                        bacCumulative: toCents(row.bac) ?? 0,
                        acCumulative: asNullableCents(row.ac),
                        eacCumulative: toCents(row.eac) ?? toCents(row.bac) ?? 0,
                        ...(toCents(row.tax) != null ? { taxCumulative: toCents(row.tax) as number } : {}),
                    })),
                }),
            };
        }
        case 'revenueCurve': {
            const rows = (project.revenueCurve ?? []).map(p => ({
                period: p.period,
                planned: toReais(p.plannedCumulative),
                billed: toReais(p.billedCumulative),
                received: toReais(p.receivedCumulative),
            }));
            return {
                title: 'Editar dados — Receita Acumulada',
                subtitle: 'Curva de receita acumulada em reais (R$) · planejado × faturado × recebido',
                columns: [COL_PERIOD, ...REVENUE_COLS],
                rows,
                rowKey: 'period',
                newRow: () => ({
                    period: nextPeriod(rows.map(r => asText(r.period))),
                    planned: null, billed: null, received: null,
                }),
                toUpdates: (edited) => ({
                    revenueCurve: edited.map(row => ({
                        period: asText(row.period),
                        plannedCumulative: toCents(row.planned) ?? 0,
                        billedCumulative: asNullableCents(row.billed),
                        receivedCumulative: asNullableCents(row.received),
                    })),
                }),
            };
        }
        case 'eventogram': {
            const events = [...(project.billing_eventogram ?? [])].sort((a, b) => a.datePlanned.localeCompare(b.datePlanned));
            const byId = new Map(events.map(e => [e.id, e]));
            return {
                title: 'Editar dados — Eventograma de Faturamento',
                subtitle: 'Eventos de faturamento previstos · valores em reais (R$)',
                columns: [
                    { key: 'datePlanned', label: 'Data prevista', type: 'date' },
                    { key: 'title', label: 'Evento', type: 'text' },
                    { key: 'amount', label: 'Valor previsto', type: 'money' },
                    { key: 'status', label: 'Status', type: 'select', options: EVENT_STATUS_OPTIONS },
                ],
                rows: events.map(e => ({
                    _id: e.id,
                    datePlanned: e.datePlanned,
                    title: e.title,
                    amount: toReais(e.amountPlannedCents),
                    status: e.status,
                })),
                rowKey: 'datePlanned',
                newRow: () => ({ _id: null, datePlanned: '', title: '', amount: null, status: 'planned' }),
                toUpdates: (edited) => ({
                    billing_eventogram: edited
                        .map<BillingEvent>(row => {
                            const existing = row._id ? byId.get(asText(row._id)) : undefined;
                            const base: BillingEvent = existing ?? {
                                id: genId('evt'),
                                projectId: project.id,
                                datePlanned: '',
                                title: '',
                                amountPlannedCents: 0,
                                status: 'planned',
                                linked: {},
                            };
                            return {
                                ...base,
                                datePlanned: asText(row.datePlanned),
                                title: asText(row.title),
                                amountPlannedCents: toCents(row.amount) ?? 0,
                                status: asText(row.status) as BillingEvent['status'],
                            };
                        })
                        .sort((a, b) => a.datePlanned.localeCompare(b.datePlanned)),
                }),
            };
        }
        case 'breakdown': {
            return {
                title: 'Editar dados — Resultado Projetado',
                subtitle: 'Composição de custos por categoria em reais (R$) · alimenta a ponte e a lista de desembolsos',
                columns: [
                    { key: 'category', label: 'Categoria', type: 'text' },
                    { key: 'bac', label: 'BAC (Orçamento)', type: 'money' },
                    { key: 'ac', label: 'AC (Realizado)', type: 'money' },
                    { key: 'eac', label: 'EAC (Estimativa)', type: 'money' },
                ],
                rows: (project.costBreakdown ?? []).map(item => ({
                    category: item.category,
                    bac: toReais(item.bac.amountCents),
                    ac: toReais(item.ac.amountCents),
                    eac: toReais(item.eac.amountCents),
                })),
                rowKey: 'category',
                newRow: () => ({ category: '', bac: null, ac: null, eac: null }),
                toUpdates: (edited) => ({
                    costBreakdown: edited.map<CostBreakdownItem>(row => ({
                        category: asText(row.category),
                        bac: makeMoney(typeof row.bac === 'number' ? row.bac : 0),
                        ac: makeMoney(typeof row.ac === 'number' ? row.ac : 0),
                        eac: makeMoney(typeof row.eac === 'number' ? row.eac : 0),
                    })),
                }),
            };
        }
    }
}

// ── Edit button (PanelHeader actions slot) ──────────────────────

export function EditDataButton({ onClick, label = 'Editar dados' }: { onClick: () => void; label?: string }) {
    return (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            title="Alimentar ou alterar manualmente os dados deste gráfico"
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-default)] bg-[color-mix(in_oklab,var(--ig-bg-raised)_82%,var(--ig-bg-base))] px-2.5 text-[11px] font-medium text-[color:var(--ig-fg-default)] backdrop-blur-sm transition-colors hover:border-[color:var(--ig-border-strong)] hover:text-[color:var(--ig-fg-strong)]"
        >
            <Pencil className="h-3 w-3" />
            {label}
        </button>
    );
}

// ── Host (single modal instance, persistence) ───────────────────

interface ProjectChartEditorHostProps {
    project: ProjectV2;
    editor: ProjectChartEditorKind | null;
    onClose: () => void;
    /** Re-fetch do projeto após salvar — propaga os novos dados aos gráficos. */
    onSaved?: () => void | Promise<void>;
}

export function ProjectChartEditorHost({ project, editor, onClose, onSaved }: ProjectChartEditorHostProps) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [passThrough, setPassThrough] = useState('');

    useEffect(() => {
        setError(null);
        if (editor === 'breakdown') {
            const reais = toReais(project.directPassThroughCents);
            setPassThrough(reais != null ? String(reais) : '');
        }
    }, [editor, project]);

    const config = useMemo(
        () => (editor ? buildEditorConfig(editor, project) : null),
        [editor, project],
    );

    if (!editor || !config) return null;

    const handleSave = async (rows: EditorRow[]) => {
        setSaving(true);
        setError(null);
        try {
            const updates = config.toUpdates(rows);
            if (editor === 'breakdown') {
                const v = passThrough.trim() === '' ? null : Number(passThrough);
                if (v != null && (!Number.isFinite(v) || v < 0)) {
                    setError('Faturamento direto (pass-through): valor inválido.');
                    return;
                }
                updates.directPassThroughCents = v != null ? Math.round(v * 100) : undefined;
            }
            await updateProjectV2(project.id, updates);
            await onSaved?.();
            onClose();
        } catch (e) {
            console.error('Erro ao salvar dados do gráfico:', e);
            setError(e instanceof Error ? e.message : 'Erro ao salvar os dados. Tente novamente.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <ChartDataEditorModal
            open
            title={config.title}
            subtitle={config.subtitle}
            columns={config.columns}
            rows={config.rows}
            rowKey={config.rowKey}
            newRow={config.newRow}
            prelude={editor === 'breakdown' ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--ig-border-subtle)] bg-[color-mix(in_srgb,var(--ig-fg-strong)_3%,transparent)] px-3 py-2">
                    <div>
                        <p className="text-xs font-medium text-[var(--ig-fg-default)]">Faturamento direto (pass-through)</p>
                        <p className="text-[10px] text-[var(--ig-fg-muted)]">Valor fora do caixa Insight — abate o contrato total na ponte</p>
                    </div>
                    <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={passThrough}
                        placeholder="0,00"
                        onChange={e => setPassThrough(e.target.value)}
                        className="w-40 rounded-md border border-[var(--ig-border-default)] bg-[color-mix(in_oklab,var(--ig-bg-raised)_82%,var(--ig-bg-base))] px-2 py-1 text-right text-xs text-[var(--ig-fg-strong)] tabular-nums focus:border-[color:var(--ig-border-focus)] focus:outline-none focus:ring-1 focus:ring-[color-mix(in_oklab,var(--ig-accent)_18%,transparent)]"
                    />
                </div>
            ) : undefined}
            saving={saving}
            error={error}
            onClose={onClose}
            onSave={handleSave}
        />
    );
}
