'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    AlertTriangle,
    ShieldAlert,
    FileWarning,
    Clock,
    DollarSign,
    Gavel,
    ChevronRight,
    Bell,
    CalendarClock,
    Filter,
    X,
    Users,
    ExternalLink,
    Plus,
    LayoutList,
    AlignJustify,
    UserX,
    ShieldX,
    FileX,
} from 'lucide-react';
import { HUDCard } from '@/components/ui/hud-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type {
    ProjectV2,
    ActionItem,
    ActionItemType,
    ActionItemSeverity,
    ActionItemStatus,
} from '@/lib/types/project-v2';
import {
    computeActionItems,
    createDeliberationDraftFromAction,
    getActionSeverityColor,
    getActionSeverityBg,
    resolveActionTarget,
    getScheduleSlipLabel,
} from '@/lib/utils/project-utils';

// ── Helpers ─────────────────────────────────────────────────────

function getTypeIcon(type: ActionItemType) {
    switch (type) {
        case 'risk': return ShieldAlert;
        case 'task': return Clock;
        case 'approval': return Gavel;
        case 'doc': return FileWarning;
        case 'finance': return DollarSign;
        case 'schedule': return CalendarClock;
        default: return Bell;
    }
}

function getTypeLabel(type: ActionItemType): string {
    const labels: Record<ActionItemType, string> = {
        risk: 'Risco',
        task: 'Tarefa',
        doc: 'Documento',
        approval: 'Aprovação',
        finance: 'Financeiro',
        schedule: 'Cronograma',
    };
    return labels[type];
}

function getSeverityLabel(severity: ActionItemSeverity): string {
    if (severity === 'critical') return 'Crítico';
    if (severity === 'warning') return 'Alerta';
    return 'Info';
}

function getStatusLabel(status: ActionItemStatus): string {
    const labels: Record<ActionItemStatus, string> = {
        open: 'Aberto',
        in_progress: 'Em Progresso',
        resolved: 'Resolvido',
        accepted: 'Aceito',
    };
    return labels[status];
}

function getStatusColor(status: ActionItemStatus): string {
    if (status === 'resolved' || status === 'accepted') return '#00FFB4';
    if (status === 'in_progress') return '#00C8FF';
    return 'rgba(255,255,255,0.50)';
}

function getDueLabel(dueAt?: string): { text: string; color: string } | null {
    if (!dueAt) return null;
    const now = new Date();
    const due = new Date(dueAt);
    const diffMs = due.getTime() - now.getTime();
    const days = Math.ceil(diffMs / 86400000);
    if (days < 0) return { text: `Atrasado ${Math.abs(days)}d`, color: '#FF4040' };
    if (days === 0) return { text: 'Vence hoje', color: '#FFB84D' };
    if (days <= 7) return { text: `Vence em ${days}d`, color: '#FFB84D' };
    return { text: `Vence em ${days}d`, color: 'rgba(255,255,255,0.50)' };
}

// CTA mapping by action item type
function getPrimaryCTALabel(type: ActionItemType): string {
    switch (type) {
        case 'risk': return 'Registrar Mitigação';
        case 'task': return 'Abrir Tarefa';
        case 'doc': return 'Upload Evidência';
        case 'approval': return 'Revisar / Votar';
        case 'finance': return 'Abrir Financeiro';
        case 'schedule': return 'Abrir Timeline';
        default: return 'Ver Detalhes';
    }
}

// ── Component Props ─────────────────────────────────────────────

type ViewMode = 'compact' | 'detailed';

interface ActionCenterProps {
    project: ProjectV2;
    maxAlerts?: number;
    onTabChange?: (tab: string) => void;
}

// ── Quick Toggles ───────────────────────────────────────────────
type QuickToggle = 'no_owner' | 'no_mitigation' | 'no_evidence';

// ── Time Window Options ─────────────────────────────────────────
const TIME_WINDOWS = [
    { label: 'Todos', value: 0 },
    { label: '7d', value: 7 },
    { label: '14d', value: 14 },
    { label: '30d', value: 30 },
] as const;

// ── Main Component ──────────────────────────────────────────────

export function ActionCenter({ project, maxAlerts = 4, onTabChange }: ActionCenterProps) {
    const router = useRouter();
    const [viewMode, setViewMode] = useState<ViewMode>('compact');
    const [showAll, setShowAll] = useState(false);
    const [filterSeverity, setFilterSeverity] = useState<ActionItemSeverity | 'all'>('all');
    const [filterType, setFilterType] = useState<ActionItemType | 'all'>('all');
    const [filterStatus, setFilterStatus] = useState<ActionItemStatus | 'all'>('all');
    const [filterDueWindow, setFilterDueWindow] = useState(0);
    const [quickToggles, setQuickToggles] = useState<Set<QuickToggle>>(new Set());

    // Compute action items
    const allItems = useMemo(() => computeActionItems(project), [project]);

    // Filtered items for the drawer
    const filteredItems = useMemo(() => {
        let items = [...allItems];
        if (filterSeverity !== 'all') items = items.filter(i => i.severity === filterSeverity);
        if (filterType !== 'all') items = items.filter(i => i.type === filterType);
        if (filterStatus !== 'all') items = items.filter(i => i.status === filterStatus);
        if (filterDueWindow > 0) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() + filterDueWindow);
            items = items.filter(i => i.dueAt && new Date(i.dueAt) <= cutoff);
        }
        // Quick toggles
        if (quickToggles.has('no_owner')) items = items.filter(i => !i.owner?.name);
        if (quickToggles.has('no_mitigation')) items = items.filter(i => i.meta?.mitigationStatus === 'Sem mitigação');
        if (quickToggles.has('no_evidence')) items = items.filter(i => i.source.entity === 'document');
        return items;
    }, [allItems, filterSeverity, filterType, filterStatus, filterDueWindow, quickToggles]);

    // Severity counts
    const criticalCount = allItems.filter(i => i.severity === 'critical').length;
    const warningCount = allItems.filter(i => i.severity === 'warning').length;
    const infoCount = allItems.filter(i => i.severity === 'info').length;
    const totalCount = allItems.length;

    // Items to display (collapsed vs expanded)
    const displayItems = showAll ? filteredItems : allItems.slice(0, maxAlerts);

    // Toggle quick filter
    const toggleQuick = useCallback((key: QuickToggle) => {
        setQuickToggles(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    // Handle "Criar Pauta" — create draft + navigate to /pautas/nova
    const handleCriarPauta = useCallback((item: ActionItem) => {
        const projectCode = project.contract_id || project.id || 'PROJ';
        const draft = createDeliberationDraftFromAction(
            project.id,
            projectCode,
            item,
        );
        router.push(`/pautas/nova?projectId=${project.id}&draftId=${draft.id}`);
    }, [project, router]);

    // Handle primary CTA — resolve target: tab switch or route navigation
    const handlePrimaryCTA = useCallback((item: ActionItem) => {
        const target = resolveActionTarget(item, project.id);
        if (target.type === 'tab') {
            onTabChange?.(target.tab);
            // Scroll to the tabs section
            setTimeout(() => {
                document.getElementById('project-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        } else {
            router.push(target.url);
        }
    }, [project.id, router, onTabChange]);

    // Empty state
    if (totalCount === 0) {
        return (
            <HUDCard>
                <div className="flex items-center gap-3 py-2">
                    <div className="p-2 rounded-lg" style={{ background: 'rgba(0,255,180,0.12)' }}>
                        <Bell className="w-5 h-5 text-[#00FFB4]" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">Central de Ações</h3>
                        <p className="text-xs text-[rgba(255,255,255,0.50)]">Nenhuma pendência identificada ✓</p>
                    </div>
                </div>
            </HUDCard>
        );
    }

    return (
        <HUDCard>
            {/* ── Header Row 1: Title + Severity Badges ── */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <div
                        className="p-2 rounded-lg"
                        style={{
                            background: criticalCount > 0
                                ? 'rgba(255,64,64,0.15)'
                                : warningCount > 0
                                    ? 'rgba(255,184,77,0.12)'
                                    : 'rgba(0,200,255,0.10)',
                        }}
                    >
                        <AlertTriangle
                            className="w-5 h-5"
                            style={{
                                color: criticalCount > 0
                                    ? '#FF4040'
                                    : warningCount > 0
                                        ? '#FFB84D'
                                        : '#00C8FF',
                            }}
                        />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white">Central de Ações</h3>
                        <p className="text-xs text-[rgba(255,255,255,0.40)] uppercase tracking-wider">
                            Pendências & Alertas
                        </p>
                    </div>
                </div>

                {/* Severity count badges */}
                <div className="flex items-center gap-2">
                    {criticalCount > 0 && (
                        <Badge
                            className="text-[10px] font-semibold border-0 px-2 py-0.5"
                            style={{ background: 'rgba(255,64,64,0.15)', color: '#FF4040' }}
                        >
                            {criticalCount} Crítico{criticalCount > 1 ? 's' : ''}
                        </Badge>
                    )}
                    {warningCount > 0 && (
                        <Badge
                            className="text-[10px] font-semibold border-0 px-2 py-0.5"
                            style={{ background: 'rgba(255,184,77,0.12)', color: '#FFB84D' }}
                        >
                            {warningCount} Alerta{warningCount > 1 ? 's' : ''}
                        </Badge>
                    )}
                    {infoCount > 0 && (
                        <Badge
                            className="text-[10px] font-semibold border-0 px-2 py-0.5"
                            style={{ background: 'rgba(0,200,255,0.08)', color: '#00C8FF' }}
                        >
                            {infoCount} Info
                        </Badge>
                    )}
                </div>
            </div>

            {/* ── Header Row 2: Compact / Detailed Toggle ── */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[rgba(255,255,255,0.06)]">
                <div className="flex items-center rounded-lg overflow-hidden border border-[rgba(255,255,255,0.10)]">
                    <button
                        onClick={() => setViewMode('compact')}
                        className={`flex items-center gap-1 px-3 py-1 text-[11px] font-medium transition-all ${viewMode === 'compact'
                            ? 'bg-[rgba(255,255,255,0.10)] text-white'
                            : 'text-[rgba(255,255,255,0.40)] hover:text-white'
                            }`}
                    >
                        <AlignJustify className="w-3 h-3" />
                        Compact
                    </button>
                    <button
                        onClick={() => setViewMode('detailed')}
                        className={`flex items-center gap-1 px-3 py-1 text-[11px] font-medium transition-all ${viewMode === 'detailed'
                            ? 'bg-[rgba(255,255,255,0.10)] text-white'
                            : 'text-[rgba(255,255,255,0.40)] hover:text-white'
                            }`}
                    >
                        <LayoutList className="w-3 h-3" />
                        Detailed
                    </button>
                </div>
                <span className="text-[10px] text-[rgba(255,255,255,0.30)]">
                    {totalCount} pendência{totalCount !== 1 ? 's' : ''}
                </span>
            </div>

            {/* ── Action Items List ────────────────── */}
            <div className={viewMode === 'compact' ? 'space-y-1' : 'space-y-2'}>
                {displayItems.map((item) => viewMode === 'compact'
                    ? <CompactRow key={item.id} item={item} onPrimary={handlePrimaryCTA} onPauta={handleCriarPauta} />
                    : <DetailedRow key={item.id} item={item} onPrimary={handlePrimaryCTA} onPauta={handleCriarPauta} />
                )}
            </div>

            {/* ── Ver Todos / Collapse toggle ──────── */}
            {totalCount > maxAlerts && (
                <button
                    onClick={() => setShowAll(!showAll)}
                    className="w-full mt-3 py-2 text-xs text-[rgba(255,255,255,0.50)] hover:text-white transition-colors flex items-center justify-center gap-1"
                >
                    {showAll ? (
                        <>
                            <X className="w-3 h-3" /> Recolher
                        </>
                    ) : (
                        <>
                            <Filter className="w-3 h-3" /> Ver Todos ({totalCount - maxAlerts} mais)
                        </>
                    )}
                </button>
            )}

            {/* ── Filter Drawer (shown when expanded) ── */}
            {showAll && (
                <div className="mt-3 pt-3 border-t border-[rgba(255,255,255,0.08)]">
                    <div className="flex items-center gap-3 flex-wrap">
                        {/* Severity filter */}
                        <FilterGroup label="Sev">
                            {(['all', 'critical', 'warning', 'info'] as const).map(sev => (
                                <FilterPill key={sev} active={filterSeverity === sev} onClick={() => setFilterSeverity(sev)}>
                                    {sev === 'all' ? 'Todos' : getSeverityLabel(sev)}
                                </FilterPill>
                            ))}
                        </FilterGroup>

                        {/* Type filter */}
                        <FilterGroup label="Tipo">
                            {(['all', 'risk', 'task', 'doc', 'finance', 'schedule', 'approval'] as const).map(t => (
                                <FilterPill key={t} active={filterType === t} onClick={() => setFilterType(t)}>
                                    {t === 'all' ? 'Todos' : getTypeLabel(t)}
                                </FilterPill>
                            ))}
                        </FilterGroup>

                        {/* Due window filter */}
                        <FilterGroup label="Prazo">
                            {TIME_WINDOWS.map(tw => (
                                <FilterPill key={tw.value} active={filterDueWindow === tw.value} onClick={() => setFilterDueWindow(tw.value)}>
                                    {tw.label}
                                </FilterPill>
                            ))}
                        </FilterGroup>

                        {/* Status filter */}
                        <FilterGroup label="Status">
                            {(['all', 'open', 'in_progress', 'resolved'] as const).map(s => (
                                <FilterPill key={s} active={filterStatus === s} onClick={() => setFilterStatus(s)}>
                                    {s === 'all' ? 'Todos' : getStatusLabel(s)}
                                </FilterPill>
                            ))}
                        </FilterGroup>
                    </div>

                    {/* Quick Toggles */}
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[rgba(255,255,255,0.04)]">
                        <span className="text-[10px] text-[rgba(255,255,255,0.30)] uppercase mr-1">Filtros rápidos:</span>
                        <QuickToggleButton
                            icon={<UserX className="w-3 h-3" />}
                            label="Sem owner"
                            active={quickToggles.has('no_owner')}
                            onClick={() => toggleQuick('no_owner')}
                        />
                        <QuickToggleButton
                            icon={<ShieldX className="w-3 h-3" />}
                            label="Sem mitigação"
                            active={quickToggles.has('no_mitigation')}
                            onClick={() => toggleQuick('no_mitigation')}
                        />
                        <QuickToggleButton
                            icon={<FileX className="w-3 h-3" />}
                            label="Sem evidência"
                            active={quickToggles.has('no_evidence')}
                            onClick={() => toggleQuick('no_evidence')}
                        />
                    </div>

                    {/* Filtered count */}
                    <p className="text-[10px] text-[rgba(255,255,255,0.30)] mt-2">
                        {filteredItems.length} de {totalCount} item(ns) exibido(s)
                    </p>
                </div>
            )}
        </HUDCard>
    );
}

// ── Compact Row Component ──────────────────────────────────────

function CompactRow({ item, onPrimary, onPauta }: {
    item: ActionItem;
    onPrimary: (item: ActionItem) => void;
    onPauta: (item: ActionItem) => void;
}) {
    const dueInfo = getDueLabel(item.dueAt);

    return (
        <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all hover:bg-[rgba(255,255,255,0.04)]"
            style={{ background: getActionSeverityBg(item.severity) }}
        >
            {/* Severity dot */}
            <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: getActionSeverityColor(item.severity) }}
            />

            {/* Title */}
            <p className="text-[13px] text-white truncate flex-1 min-w-0">{item.title}</p>

            {/* Owner (inline, if any) */}
            {item.owner?.name && (
                <span className="text-[10px] text-[rgba(255,255,255,0.45)] truncate max-w-[80px] shrink-0">
                    {item.owner.name}
                </span>
            )}

            {/* Due label */}
            {dueInfo && (
                <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                    style={{
                        color: dueInfo.color,
                        background: dueInfo.color === '#FF4040'
                            ? 'rgba(255,64,64,0.12)'
                            : 'rgba(255,255,255,0.05)',
                    }}
                >
                    {dueInfo.text}
                </span>
            )}

            {/* Primary CTA */}
            <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.08)] hover:text-white shrink-0"
                onClick={() => onPrimary(item)}
            >
                {getPrimaryCTALabel(item.type)}
                <ChevronRight className="w-2.5 h-2.5 ml-0.5" />
            </Button>

            {/* Criar Pauta CTA */}
            <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] border-[rgba(0,200,255,0.20)] text-[#00C8FF] hover:bg-[rgba(0,200,255,0.10)] shrink-0"
                onClick={() => onPauta(item)}
                title="Criar uma deliberação vinculada a esta pendência para decisão do comitê/conselho."
            >
                <Gavel className="w-2.5 h-2.5 mr-0.5" />
                Pauta
            </Button>
        </div>
    );
}

// ── Detailed Row Component ─────────────────────────────────────

function DetailedRow({ item, onPrimary, onPauta }: {
    item: ActionItem;
    onPrimary: (item: ActionItem) => void;
    onPauta: (item: ActionItem) => void;
}) {
    const Icon = getTypeIcon(item.type);
    const dueInfo = getDueLabel(item.dueAt);
    const scheduleSlip = (item.type === 'schedule' || item.type === 'task')
        ? getScheduleSlipLabel(item.meta?.baselineEnd, item.meta?.currentEnd)
        : null;

    return (
        <div
            className="flex items-start gap-3 p-3 rounded-xl transition-all hover:scale-[1.002]"
            style={{ background: getActionSeverityBg(item.severity) }}
        >
            {/* Severity dot */}
            <div
                className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                style={{ background: getActionSeverityColor(item.severity) }}
            />

            {/* Type icon */}
            <div
                className="p-1.5 rounded-md flex-shrink-0"
                style={{ background: 'rgba(255,255,255,0.05)' }}
            >
                <Icon
                    className="w-4 h-4"
                    style={{ color: getActionSeverityColor(item.severity) }}
                />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{item.title}</p>

                {/* Schedule baseline info (detailed only) */}
                {scheduleSlip && (
                    <p className="text-[10px] text-[rgba(255,255,255,0.45)] mt-0.5 font-mono">
                        {scheduleSlip}
                    </p>
                )}

                <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {/* Type badge */}
                    <span className="text-[10px] text-[rgba(255,255,255,0.40)] uppercase tracking-wider">
                        {getTypeLabel(item.type)}
                    </span>

                    {/* Owner */}
                    {item.owner?.name && (
                        <span className="flex items-center gap-1 text-[10px] text-[rgba(255,255,255,0.55)]">
                            <Users className="w-3 h-3" />
                            {item.owner.name}
                        </span>
                    )}

                    {/* Due chip */}
                    {dueInfo && (
                        <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                            style={{
                                color: dueInfo.color,
                                background: dueInfo.color === '#FF4040'
                                    ? 'rgba(255,64,64,0.12)'
                                    : 'rgba(255,255,255,0.06)',
                            }}
                        >
                            {dueInfo.text}
                        </span>
                    )}

                    {/* Risk score chip (risk items only) */}
                    {item.meta?.riskScore && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-[#FF8C42] bg-[rgba(255,140,66,0.10)]">
                            P×I={item.meta.riskScore}
                        </span>
                    )}

                    {/* Finance delta chip */}
                    {item.meta?.eacDelta && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-[#FFB84D] bg-[rgba(255,184,77,0.10)]">
                            {item.meta.eacDelta}
                        </span>
                    )}

                    {/* Status chip */}
                    <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{
                            color: getStatusColor(item.status),
                            background: 'rgba(255,255,255,0.05)',
                        }}
                    >
                        {getStatusLabel(item.status)}
                    </span>
                </div>
            </div>

            {/* CTA Group */}
            <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                {/* Primary CTA → deep link */}
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px] border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.08)] hover:text-white"
                    onClick={() => onPrimary(item)}
                >
                    {getPrimaryCTALabel(item.type)}
                    <ChevronRight className="w-3 h-3 ml-0.5" />
                </Button>

                {/* Criar Pauta CTA */}
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[10px] border-[rgba(0,200,255,0.25)] text-[#00C8FF] hover:bg-[rgba(0,200,255,0.10)]"
                    onClick={() => onPauta(item)}
                    title="Criar uma deliberação vinculada a esta pendência para decisão do comitê/conselho."
                >
                    <Gavel className="w-3 h-3 mr-1" />
                    Criar Pauta
                </Button>
            </div>
        </div>
    );
}

// ── Filter Pill Sub-components ──────────────────────────────────

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-1">
            <span className="text-[10px] text-[rgba(255,255,255,0.35)] uppercase mr-1">{label}:</span>
            {children}
        </div>
    );
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-all ${active
                ? 'bg-[rgba(255,255,255,0.12)] text-white font-medium'
                : 'text-[rgba(255,255,255,0.40)] hover:text-white'
                }`}
        >
            {children}
        </button>
    );
}

function QuickToggleButton({ icon, label, active, onClick }: {
    icon: React.ReactNode;
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md border transition-all ${active
                ? 'border-[rgba(0,200,255,0.30)] bg-[rgba(0,200,255,0.08)] text-[#00C8FF] font-medium'
                : 'border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.40)] hover:text-white hover:border-[rgba(255,255,255,0.15)]'
                }`}
            title={label}
        >
            {icon}
            {label}
        </button>
    );
}

export default ActionCenter;
