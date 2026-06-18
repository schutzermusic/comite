'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { HudModal, HudButton } from '@/components/hud';

// ── Types ───────────────────────────────────────────────────────

export type EditorCellValue = string | number | null;
export type EditorRow = Record<string, EditorCellValue>;

export interface EditorColumn {
    key: string;
    label: string;
    type: 'period' | 'date' | 'text' | 'money' | 'select';
    options?: { value: string; label: string }[];
    /** Empty cell allowed — maps to null (ex.: AC além do cutoff). */
    nullable?: boolean;
    /** Cumulative series — warn (non-blocking) when a later period decreases. */
    cumulative?: boolean;
}

interface ChartDataEditorModalProps {
    open: boolean;
    title: string;
    subtitle?: string;
    columns: EditorColumn[];
    rows: EditorRow[];
    /** Column used to sort rows and check uniqueness (default: 'period'). */
    rowKey?: string;
    newRow: () => EditorRow;
    /** Extra content above the table (ex.: campo de pass-through). */
    prelude?: React.ReactNode;
    saving?: boolean;
    error?: string | null;
    onClose: () => void;
    onSave: (rows: EditorRow[]) => void | Promise<void>;
}

// ── Internal draft model (cells edited as strings) ──────────────

interface DraftRow {
    localId: string;
    /** Original row — preserves passthrough keys not shown as columns (ex.: _id). */
    orig: EditorRow;
    cells: Record<string, string>;
}

function genLocalId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toCellString(value: EditorCellValue, col: EditorColumn): string {
    if (value == null) return '';
    if (col.type === 'money' && typeof value === 'number') {
        // keep cents precision without float noise
        return String(Math.round(value * 100) / 100);
    }
    return String(value);
}

function toDraft(rows: EditorRow[], columns: EditorColumn[]): DraftRow[] {
    return rows.map(row => ({
        localId: genLocalId(),
        orig: row,
        cells: Object.fromEntries(columns.map(col => [col.key, toCellString(row[col.key] ?? null, col)])),
    }));
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface CellError { localId: string; colKey: string; message: string }

// ── Component ───────────────────────────────────────────────────

export function ChartDataEditorModal({
    open,
    title,
    subtitle,
    columns,
    rows,
    rowKey = 'period',
    newRow,
    prelude,
    saving,
    error,
    onClose,
    onSave,
}: ChartDataEditorModalProps) {
    const [draft, setDraft] = useState<DraftRow[]>([]);
    const [cellErrors, setCellErrors] = useState<CellError[]>([]);

    useEffect(() => {
        if (open) {
            setDraft(toDraft(rows, columns));
            setCellErrors([]);
        }
        // re-init only when the modal opens — edits must not be clobbered mid-session
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const setCell = (localId: string, colKey: string, value: string) => {
        setDraft(prev => prev.map(r => (r.localId === localId ? { ...r, cells: { ...r.cells, [colKey]: value } } : r)));
        setCellErrors(prev => prev.filter(e => !(e.localId === localId && e.colKey === colKey)));
    };

    const addRow = () => {
        const created = newRow();
        setDraft(prev => [...prev, ...toDraft([created], columns)]);
    };

    const removeRow = (localId: string) => {
        setDraft(prev => prev.filter(r => r.localId !== localId));
        setCellErrors(prev => prev.filter(e => e.localId !== localId));
    };

    // ── Non-blocking cumulative warnings (live) ──────────────────
    const cumulativeWarnings = useMemo(() => {
        const warnings: string[] = [];
        const sorted = [...draft].sort((a, b) => (a.cells[rowKey] ?? '').localeCompare(b.cells[rowKey] ?? ''));
        for (const col of columns.filter(c => c.cumulative && c.type === 'money')) {
            let prev: number | null = null;
            for (const row of sorted) {
                const raw = row.cells[col.key];
                if (raw === '' || raw == null) continue;
                const v = Number(raw);
                if (!Number.isFinite(v)) continue;
                if (prev != null && v < prev) {
                    warnings.push(`${col.label}: série acumulada decresce em ${row.cells[rowKey] || '(sem período)'} — verifique.`);
                    break;
                }
                prev = v;
            }
        }
        return warnings;
    }, [draft, columns, rowKey]);

    // ── Validation + save ────────────────────────────────────────
    const handleSave = async () => {
        const errors: CellError[] = [];
        const keySeen = new Map<string, number>();

        for (const row of draft) {
            for (const col of columns) {
                const raw = (row.cells[col.key] ?? '').trim();
                if (raw === '') {
                    if (!col.nullable) errors.push({ localId: row.localId, colKey: col.key, message: `${col.label}: obrigatório` });
                    continue;
                }
                if (col.type === 'money') {
                    const v = Number(raw);
                    if (!Number.isFinite(v)) errors.push({ localId: row.localId, colKey: col.key, message: `${col.label}: valor inválido` });
                    else if (v < 0) errors.push({ localId: row.localId, colKey: col.key, message: `${col.label}: deve ser ≥ 0` });
                } else if (col.type === 'period' && !PERIOD_RE.test(raw)) {
                    errors.push({ localId: row.localId, colKey: col.key, message: `${col.label}: use o formato AAAA-MM` });
                } else if (col.type === 'select' && col.options && !col.options.some(o => o.value === raw)) {
                    errors.push({ localId: row.localId, colKey: col.key, message: `${col.label}: opção inválida` });
                }
            }
            const keyVal = (row.cells[rowKey] ?? '').trim();
            if (keyVal) keySeen.set(keyVal, (keySeen.get(keyVal) ?? 0) + 1);
        }
        for (const [keyVal, count] of keySeen) {
            if (count > 1) {
                for (const row of draft.filter(r => (r.cells[rowKey] ?? '').trim() === keyVal)) {
                    errors.push({ localId: row.localId, colKey: rowKey, message: `Valor duplicado: ${keyVal}` });
                }
            }
        }

        setCellErrors(errors);
        if (errors.length > 0) return;

        const result: EditorRow[] = [...draft]
            .sort((a, b) => (a.cells[rowKey] ?? '').localeCompare(b.cells[rowKey] ?? ''))
            .map(row => {
                const parsed: EditorRow = { ...row.orig };
                for (const col of columns) {
                    const raw = (row.cells[col.key] ?? '').trim();
                    if (raw === '') parsed[col.key] = null;
                    else if (col.type === 'money') parsed[col.key] = Number(raw);
                    else parsed[col.key] = raw;
                }
                return parsed;
            });
        await onSave(result);
    };

    const hasCellError = (localId: string, colKey: string) =>
        cellErrors.some(e => e.localId === localId && e.colKey === colKey);

    const inputBase =
        'w-full rounded-md border bg-[color-mix(in_oklab,var(--ig-bg-raised)_82%,var(--ig-bg-base))] px-2 py-1 text-xs text-[var(--ig-fg-strong)] tabular-nums placeholder:text-[var(--ig-fg-disabled)] focus:border-[color:var(--ig-border-focus)] focus:outline-none focus:ring-1 focus:ring-[color-mix(in_oklab,var(--ig-accent)_18%,transparent)]';

    const cellInput = (row: DraftRow, col: EditorColumn) => {
        const value = row.cells[col.key] ?? '';
        const invalid = hasCellError(row.localId, col.key);
        const borderClass = invalid ? 'border-[var(--ig-danger)]' : 'border-[var(--ig-border-default)]';
        if (col.type === 'select') {
            return (
                <select
                    value={value}
                    onChange={e => setCell(row.localId, col.key, e.target.value)}
                    className={`${inputBase} ${borderClass} appearance-none`}
                >
                    {col.nullable && <option value="">—</option>}
                    {(col.options ?? []).map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            );
        }
        if (col.type === 'money') {
            return (
                <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={value}
                    placeholder={col.nullable ? '—' : '0,00'}
                    onChange={e => setCell(row.localId, col.key, e.target.value)}
                    className={`${inputBase} ${borderClass} text-right font-mono`}
                />
            );
        }
        if (col.type === 'date') {
            return (
                <input
                    type="date"
                    value={value}
                    onChange={e => setCell(row.localId, col.key, e.target.value)}
                    className={`${inputBase} ${borderClass} font-mono`}
                />
            );
        }
        return (
            <input
                type="text"
                value={value}
                placeholder={col.type === 'period' ? 'AAAA-MM' : ''}
                onChange={e => setCell(row.localId, col.key, e.target.value)}
                className={`${inputBase} ${borderClass} ${col.type === 'period' ? 'font-mono' : ''}`}
            />
        );
    };

    return (
        <HudModal
            isOpen={open}
            onClose={onClose}
            title={title}
            subtitle={subtitle ?? 'Valores monetários em reais (R$) · alterações são salvas no projeto'}
            size="xl"
            footer={
                <>
                    <HudButton variant="ghost" onClick={onClose} disabled={saving}>
                        Cancelar
                    </HudButton>
                    <HudButton variant="primary" onClick={handleSave} disabled={saving}>
                        {saving ? (
                            <span className="flex items-center gap-1.5">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />Salvando...
                            </span>
                        ) : 'Salvar alterações'}
                    </HudButton>
                </>
            }
        >
            <div className="space-y-3">
                {prelude}

                {cumulativeWarnings.length > 0 && (
                    <div className="rounded-lg border border-[color-mix(in_srgb,var(--ig-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--ig-warning)_8%,transparent)] px-3 py-2">
                        {cumulativeWarnings.map((w, i) => (
                            <p key={i} className="flex items-center gap-1.5 text-[11px] text-[var(--ig-warning)]">
                                <AlertTriangle className="h-3 w-3 shrink-0" />{w}
                            </p>
                        ))}
                    </div>
                )}

                <div className="overflow-x-auto rounded-xl border border-[color:var(--ig-border-subtle)]">
                    <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10">
                            <tr className="border-b border-[var(--ig-border-default)]">
                                {columns.map(col => (
                                    <th
                                        key={col.key}
                                        className={`bg-[color:var(--ig-bg-raised)] px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-[var(--ig-fg-subtle)] ${col.type === 'money' ? 'text-right' : 'text-left'}`}
                                    >
                                        {col.label}
                                    </th>
                                ))}
                                <th className="w-9 bg-[color:var(--ig-bg-raised)]" />
                            </tr>
                        </thead>
                        <tbody>
                            {draft.map(row => (
                                <tr key={row.localId} className="border-b border-[var(--ig-border-subtle)] last:border-0">
                                    {columns.map(col => (
                                        <td key={col.key} className="px-1.5 py-1.5 align-top">
                                            {cellInput(row, col)}
                                        </td>
                                    ))}
                                    <td className="px-1.5 py-1.5 text-center align-top">
                                        <button
                                            type="button"
                                            onClick={() => removeRow(row.localId)}
                                            title="Remover linha"
                                            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ig-fg-subtle)] transition-colors hover:bg-[color-mix(in_srgb,var(--ig-danger)_12%,transparent)] hover:text-[var(--ig-danger)]"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {draft.length === 0 && (
                                <tr>
                                    <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-xs text-[var(--ig-fg-subtle)]">
                                        Nenhum dado — use “Adicionar linha” para alimentar o gráfico manualmente.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <button
                    type="button"
                    onClick={addRow}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--ig-border-default)] bg-[color-mix(in_srgb,var(--ig-fg-strong)_4%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--ig-fg-default)] transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_8%,transparent)]"
                >
                    <Plus className="h-3.5 w-3.5" />Adicionar linha
                </button>

                {cellErrors.length > 0 && (
                    <div className="rounded-lg border border-[color-mix(in_srgb,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_srgb,var(--ig-danger)_8%,transparent)] px-3 py-2">
                        {[...new Set(cellErrors.map(e => e.message))].slice(0, 5).map((m, i) => (
                            <p key={i} className="text-[11px] text-[var(--ig-danger)]">{m}</p>
                        ))}
                    </div>
                )}

                {error && (
                    <p className="text-[11px] text-[var(--ig-danger)]">{error}</p>
                )}
            </div>
        </HudModal>
    );
}

export default ChartDataEditorModal;
