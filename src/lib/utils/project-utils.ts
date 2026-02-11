/**
 * Project Utilities — health score, alerts, money formatting, risk computation
 */

import type {
    MoneyAmount,
    ProjectV2,
    ProjectAlert,
    ProjectRiskItem,
    AlertSeverity,
    ActionItem,
    ActionItemSeverity,
    RiskLevel,
    DeliberationDraft,
} from '@/lib/types/project-v2';

// ─── Money Formatting ────────────────────────────────────────────

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});

export function formatMoney(amount: MoneyAmount | undefined | null, compact = false): string {
    if (!amount) return 'R$ 0,00';
    const value = amount.amountCents / 100;
    return compact ? BRL_COMPACT.format(value) : BRL_FORMATTER.format(value);
}

export function centsFromReais(reais: number): number {
    return Math.round(reais * 100);
}

export function reaisFromCents(cents: number): number {
    return cents / 100;
}

export function makeMoney(reais: number, currency = 'BRL'): MoneyAmount {
    return { amountCents: centsFromReais(reais), currency };
}

/**
 * Compact BRL formatter — standardized "R$ 220 mi" display.
 * Single source of truth for compact currency across all charts, tables, tooltips.
 */
const BRL_COMPACT_NOTATION = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
});

export function compactBRL(value: number): string {
    return BRL_COMPACT_NOTATION.format(value);
}

// ─── Risk Score Computation ──────────────────────────────────────

export function computeRiskScore(
    probability: number,
    impact: number
): { level: number; severity: 'low' | 'medium' | 'high' | 'critical'; rationale: string } {
    const level = probability * impact;
    let severity: 'low' | 'medium' | 'high' | 'critical';

    if (level >= 20) severity = 'critical';
    else if (level >= 12) severity = 'high';
    else if (level >= 6) severity = 'medium';
    else severity = 'low';

    const probLabel = ['Muito Baixa', 'Baixa', 'Moderada', 'Alta', 'Muito Alta'][probability - 1] || `${probability}`;
    const impactLabel = ['Insignificante', 'Menor', 'Moderado', 'Maior', 'Catastrófico'][impact - 1] || `${impact}`;

    return {
        level,
        severity,
        rationale: `Probabilidade ${probLabel} (${probability}/5) × Impacto ${impactLabel} (${impact}/5) = Score ${level}/25 → ${severity.toUpperCase()}`,
    };
}

export function deriveOverallRisk(
    risks: ProjectRiskItem[]
): { level: 'baixo' | 'medio' | 'alto'; summary: string } {
    const openRisks = risks.filter(r => r.status !== 'resolved');
    if (openRisks.length === 0) {
        return { level: 'baixo', summary: 'Sem riscos abertos identificados.' };
    }

    const maxLevel = Math.max(...openRisks.map(r => r.level));
    const criticalCount = openRisks.filter(r => r.severity === 'critical' || r.severity === 'high').length;
    const unmitigated = openRisks.filter(r => !r.mitigation).length;

    let level: 'baixo' | 'medio' | 'alto';
    if (maxLevel >= 16 || criticalCount >= 2) level = 'alto';
    else if (maxLevel >= 8 || criticalCount >= 1) level = 'medio';
    else level = 'baixo';

    const parts: string[] = [];
    parts.push(`${openRisks.length} risco(s) aberto(s)`);
    if (criticalCount > 0) parts.push(`${criticalCount} alto/crítico`);
    if (unmitigated > 0) parts.push(`${unmitigated} sem mitigação`);

    return { level, summary: parts.join(', ') + '.' };
}

// ─── Health Score ─────────────────────────────────────────────────

export function computeHealthScore(
    project: ProjectV2
): { score: number; reasons: string[] } {
    let score = 100;
    const reasons: string[] = [];

    // 1. EAC > BAC penalty (up to -25)
    if (project.finance) {
        const { bac, eac, variancePercent } = project.finance;
        if (eac.amountCents > bac.amountCents) {
            const penalty = Math.min(25, Math.abs(variancePercent) * 0.5);
            score -= penalty;
            reasons.push(`Orçamento estourado: EAC ${variancePercent > 0 ? '+' : ''}${variancePercent.toFixed(1)}% acima do BAC`);
        }
    }

    // 2. High/critical open risks (up to -20)
    const openHighRisks = (project.risks || []).filter(
        r => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical')
    );
    if (openHighRisks.length > 0) {
        const penalty = Math.min(20, openHighRisks.length * 7);
        score -= penalty;
        reasons.push(`${openHighRisks.length} risco(s) alto/crítico aberto(s)`);
    }

    // 3. Risks without mitigation (up to -10)
    const unmitigated = (project.risks || []).filter(
        r => r.status !== 'resolved' && !r.mitigation
    );
    if (unmitigated.length > 0) {
        const penalty = Math.min(10, unmitigated.length * 4);
        score -= penalty;
        reasons.push(`${unmitigated.length} risco(s) sem plano de mitigação`);
    }

    // 4. Overdue tasks (up to -20)
    const now = new Date().toISOString();
    const overdueTasks = (project.tasks || []).filter(
        t => t.status !== 'completed' && t.endDate < now
    );
    if (overdueTasks.length > 0) {
        const penalty = Math.min(20, overdueTasks.length * 5);
        score -= penalty;
        reasons.push(`${overdueTasks.length} tarefa(s) atrasada(s)`);
    }

    // 5. Missing required docs (up to -15)
    const requiredDocs = (project.documents || []).filter(d => d.required);
    const missingDocs = requiredDocs.filter(d => !d.url);
    if (missingDocs.length > 0) {
        const penalty = Math.min(15, missingDocs.length * 5);
        score -= penalty;
        reasons.push(`${missingDocs.length} documento(s) obrigatório(s) pendente(s)`);
    }

    // 6. Overdue milestones (up to -10)
    const overdueMilestones = (project.milestones || []).filter(
        m => m.status === 'overdue'
    );
    if (overdueMilestones.length > 0) {
        const penalty = Math.min(10, overdueMilestones.length * 5);
        score -= penalty;
        reasons.push(`${overdueMilestones.length} marco(s) atrasado(s)`);
    }

    return { score: Math.max(0, Math.round(score)), reasons };
}

// ─── Alert Generation ────────────────────────────────────────────

export function generateProjectAlerts(project: ProjectV2): ProjectAlert[] {
    const alerts: ProjectAlert[] = [];
    const now = new Date().toISOString();
    let alertId = 0;

    // 1. Risks without mitigation
    const unmitigated = (project.risks || []).filter(
        r => r.status !== 'resolved' && !r.mitigation
    );
    for (const risk of unmitigated.slice(0, 2)) {
        alerts.push({
            id: `alert-${++alertId}`,
            severity: risk.severity === 'critical' ? 'critical' : risk.severity === 'high' ? 'high' : 'medium',
            message: `Risco "${risk.title}" sem plano de mitigação`,
            action: 'register_risk',
            actionLabel: 'Registrar Mitigação',
            category: 'risk',
        });
    }

    // 2. Overdue tasks
    const overdueTasks = (project.tasks || []).filter(
        t => t.status !== 'completed' && t.endDate < now
    );
    for (const task of overdueTasks.slice(0, 2)) {
        alerts.push({
            id: `alert-${++alertId}`,
            severity: 'high',
            message: `Tarefa "${task.name}" atrasada`,
            action: 'add_task',
            actionLabel: 'Ver Tarefa',
            category: 'task',
        });
    }

    // 3. Overdue milestones
    const overdueMilestones = (project.milestones || []).filter(
        m => m.status === 'overdue'
    );
    for (const ms of overdueMilestones.slice(0, 1)) {
        alerts.push({
            id: `alert-${++alertId}`,
            severity: 'critical',
            message: `Marco "${ms.name}" ultrapassou a data planejada`,
            action: 'view_details',
            actionLabel: 'Ver Marco',
            category: 'schedule',
        });
    }

    // 4. Missing required docs
    const missingDocs = (project.documents || []).filter(d => d.required && !d.url);
    if (missingDocs.length > 0) {
        alerts.push({
            id: `alert-${++alertId}`,
            severity: 'medium',
            message: `${missingDocs.length} documento(s) obrigatório(s) pendente(s)`,
            action: 'upload_evidence',
            actionLabel: 'Upload Documento',
            category: 'document',
        });
    }

    // 5. Cost variance (EAC > BAC by > 5%)
    if (project.finance && project.finance.variancePercent > 5) {
        alerts.push({
            id: `alert-${++alertId}`,
            severity: project.finance.variancePercent > 15 ? 'critical' : 'high',
            message: `Variação de custo: EAC ${project.finance.variancePercent.toFixed(1)}% acima do baseline`,
            action: 'open_financial_review',
            actionLabel: 'Revisão Financeira',
            category: 'finance',
        });
    }

    // 6. Pending governance (no deliberations linked)
    if ((project.governance?.deliberation_ids?.length || 0) === 0 && project.status === 'em_andamento') {
        alerts.push({
            id: `alert-${++alertId}`,
            severity: 'low',
            message: 'Nenhuma deliberação vinculada ao projeto',
            action: 'create_deliberation',
            actionLabel: 'Criar Deliberação',
            category: 'approval',
        });
    }

    // Sort by severity priority
    const severityOrder: Record<AlertSeverity, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
        info: 4,
    };

    return alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

// ─── Severity Helpers ────────────────────────────────────────────

export function getSeverityColor(severity: AlertSeverity): string {
    const colors: Record<AlertSeverity, string> = {
        critical: '#FF4040',
        high: '#FF8C42',
        medium: '#FFB84D',
        low: '#00C8FF',
        info: 'rgba(255,255,255,0.50)',
    };
    return colors[severity];
}

export function getSeverityBgColor(severity: AlertSeverity): string {
    const colors: Record<AlertSeverity, string> = {
        critical: 'rgba(255,64,64,0.12)',
        high: 'rgba(255,140,66,0.12)',
        medium: 'rgba(255,184,77,0.12)',
        low: 'rgba(0,200,255,0.12)',
        info: 'rgba(255,255,255,0.05)',
    };
    return colors[severity];
}

export function getHealthScoreColor(score: number): string {
    if (score >= 80) return '#00FFB4';
    if (score >= 60) return '#FFB84D';
    if (score >= 40) return '#FF8C42';
    return '#FF4040';
}

export function getHealthScoreLabel(score: number): string {
    if (score >= 80) return 'Excelente';
    if (score >= 60) return 'Bom';
    if (score >= 40) return 'Atenção';
    return 'Crítico';
}

// ─── Risk Level from Score ───────────────────────────────────────

export function getRiskLevelFromScore(score: number): RiskLevel {
    if (score >= 16) return 'critical';
    if (score >= 11) return 'high';
    if (score >= 6) return 'medium';
    return 'low';
}

export function getRiskLevelLabel(level: RiskLevel): string {
    const labels: Record<RiskLevel, string> = {
        critical: 'Crítico',
        high: 'Alto',
        medium: 'Médio',
        low: 'Baixo',
    };
    return labels[level];
}

export function getRiskLevelColor(level: RiskLevel): string {
    const colors: Record<RiskLevel, string> = {
        critical: '#FF4040',
        high: '#FF8C42',
        medium: '#FFB84D',
        low: '#00FFB4',
    };
    return colors[level];
}

// ─── ActionItem Severity Colors ─────────────────────────────────

export function getActionSeverityColor(severity: ActionItemSeverity): string {
    if (severity === 'critical') return '#FF4040';
    if (severity === 'warning') return '#FFB84D';
    return '#00C8FF';
}

export function getActionSeverityBg(severity: ActionItemSeverity): string {
    if (severity === 'critical') return 'rgba(255,64,64,0.12)';
    if (severity === 'warning') return 'rgba(255,184,77,0.10)';
    return 'rgba(0,200,255,0.08)';
}

// ─── Compute Action Items (governance-grade) ────────────────────

export function computeActionItems(project: ProjectV2): ActionItem[] {
    const items: ActionItem[] = [];
    const now = new Date();
    const nowISO = now.toISOString();
    let seq = 0;

    // 1. Risks without mitigation
    for (const risk of (project.risks || []).filter(r => r.status !== 'resolved' && !r.mitigation)) {
        const score = risk.probability * risk.impact;
        items.push({
            id: `act-${++seq}`,
            type: 'risk',
            severity: score >= 11 ? 'critical' : 'warning',
            title: `Risco "${risk.title}" sem plano de mitigação`,
            description: risk.description,
            owner: risk.ownerName ? { id: risk.ownerId, name: risk.ownerName } : undefined,
            status: 'open',
            source: { entity: 'risk', entityId: risk.id, ruleId: 'risk-no-mitigation' },
            meta: { riskScore: score, mitigationStatus: 'Sem mitigação' },
            createdAt: risk.createdAt,
        });
    }

    // 2. Risks without owner
    for (const risk of (project.risks || []).filter(r => r.status !== 'resolved' && !r.ownerName)) {
        if (items.some(i => i.source.entityId === risk.id)) continue; // already flagged
        const score = risk.probability * risk.impact;
        items.push({
            id: `act-${++seq}`,
            type: 'risk',
            severity: 'warning',
            title: `Risco "${risk.title}" sem responsável designado`,
            owner: undefined,
            status: 'open',
            source: { entity: 'risk', entityId: risk.id, ruleId: 'risk-no-owner' },
            meta: { riskScore: score, mitigationStatus: risk.mitigation ? 'Com mitigação' : 'Sem mitigação' },
            createdAt: risk.createdAt,
        });
    }

    // 3. Overdue tasks
    for (const task of (project.tasks || []).filter(t => t.status !== 'completed' && t.endDate < nowISO)) {
        const dueDate = new Date(task.endDate);
        const daysOverdue = Math.ceil((now.getTime() - dueDate.getTime()) / 86400000);
        items.push({
            id: `act-${++seq}`,
            type: 'task',
            severity: daysOverdue > 14 ? 'critical' : 'warning',
            title: `Tarefa "${task.name}" atrasada`,
            description: task.overdueReason,
            owner: task.responsibleName ? { id: task.responsibleId, name: task.responsibleName } : undefined,
            dueAt: task.endDate,
            status: task.status === 'in_progress' ? 'in_progress' : 'open',
            source: { entity: 'task', entityId: task.id, ruleId: 'task-overdue' },
            meta: {
                baselineEnd: task.baselineEnd,
                currentEnd: task.endDate,
                slipDays: task.baselineEnd ? Math.ceil((new Date(task.endDate).getTime() - new Date(task.baselineEnd).getTime()) / 86400000) : undefined,
            },
            createdAt: task.startDate || nowISO,
        });
    }

    // 4. Overdue milestones
    for (const ms of (project.milestones || []).filter(m => m.status === 'overdue')) {
        items.push({
            id: `act-${++seq}`,
            type: 'schedule',
            severity: 'critical',
            title: `Marco "${ms.name}" ultrapassou a data planejada`,
            dueAt: ms.date,
            status: 'open',
            source: { entity: 'schedule', entityId: ms.id, ruleId: 'milestone-overdue' },
            createdAt: ms.date,
        });
    }

    // 5. Missing required documents
    const missingDocs = (project.documents || []).filter(d => d.required && !d.url);
    if (missingDocs.length > 0) {
        items.push({
            id: `act-${++seq}`,
            type: 'doc',
            severity: missingDocs.length >= 3 ? 'critical' : 'warning',
            title: `${missingDocs.length} documento(s) obrigatório(s) pendente(s)`,
            status: 'open',
            source: { entity: 'document', ruleId: 'doc-missing-required' },
            createdAt: nowISO,
        });
    }

    // 6. Finance variance (EAC > BAC)
    if (project.finance && project.finance.variancePercent > 5) {
        const pct = project.finance.variancePercent;
        const deltaReais = (project.finance.eac.amountCents - project.finance.bac.amountCents) / 100;
        const deltaFmt = BRL_COMPACT.format(deltaReais);
        items.push({
            id: `act-${++seq}`,
            type: 'finance',
            severity: pct > 15 ? 'critical' : 'warning',
            title: `Variação de custo: EAC ${pct.toFixed(1)}% acima do baseline`,
            description: project.finance.drivers?.join('; '),
            status: 'open',
            source: { entity: 'finance', ruleId: 'finance-eac-variance' },
            meta: { eacDelta: `+${deltaFmt} (${pct.toFixed(1)}%)` },
            createdAt: project.finance.updatedAt,
        });
    }

    // 7. Schedule variance (tasks with baseline slipped)
    for (const task of (project.tasks || []).filter(t => t.baselineEnd && t.endDate > t.baselineEnd && t.status !== 'completed')) {
        const daysSlip = Math.ceil((new Date(task.endDate).getTime() - new Date(task.baselineEnd!).getTime()) / 86400000);
        if (daysSlip > 7) {
            items.push({
                id: `act-${++seq}`,
                type: 'schedule',
                severity: daysSlip > 30 ? 'critical' : 'warning',
                title: `Tarefa "${task.name}" deslizou do baseline`,
                owner: task.responsibleName ? { id: task.responsibleId, name: task.responsibleName } : undefined,
                dueAt: task.endDate,
                status: 'open',
                source: { entity: 'schedule', entityId: task.id, ruleId: 'schedule-baseline-slip' },
                meta: {
                    baselineEnd: task.baselineEnd!,
                    currentEnd: task.endDate,
                    slipDays: daysSlip,
                },
                createdAt: task.startDate || nowISO,
            });
        }
    }

    // 8. Pending approvals (no link to deliberations)
    if ((project.governance?.deliberation_ids?.length || 0) === 0 && project.status === 'em_andamento') {
        items.push({
            id: `act-${++seq}`,
            type: 'approval',
            severity: 'info',
            title: 'Nenhuma deliberação vinculada ao projeto',
            status: 'open',
            source: { entity: 'deliberation', ruleId: 'no-linked-deliberation' },
            createdAt: nowISO,
        });
    }

    // Sort: critical > warning > info, then dueSoon, then newest
    const sevOrder: Record<ActionItemSeverity, number> = { critical: 0, warning: 1, info: 2 };
    return items.sort((a, b) => {
        const ds = sevOrder[a.severity] - sevOrder[b.severity];
        if (ds !== 0) return ds;
        // Due soonest first
        if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
        if (a.dueAt) return -1;
        if (b.dueAt) return 1;
        // Newest first
        return b.createdAt.localeCompare(a.createdAt);
    });
}

// ─── Deliberation Draft Factory (enriched) ─────────────────────

export function createDeliberationDraftFromAction(
    projectId: string,
    projectCode: string,
    action: ActionItem,
    extraContext?: string,
): DeliberationDraft {
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Build enriched context from meta
    const contextLines: string[] = [
        `Projeto: ${projectCode}`,
        `Tipo de alerta: ${action.type}`,
        `Severidade: ${action.severity}`,
    ];
    if (action.description) contextLines.push(`Detalhes: ${action.description}`);
    if (action.owner?.name) contextLines.push(`Responsável: ${action.owner.name}`);
    if (action.dueAt) contextLines.push(`Prazo: ${new Date(action.dueAt).toLocaleDateString('pt-BR')}`);

    // Schedule context
    if (action.meta?.baselineEnd && action.meta?.currentEnd) {
        contextLines.push(`Cronograma: Baseline ${new Date(action.meta.baselineEnd).toLocaleDateString('pt-BR')} → Atual ${new Date(action.meta.currentEnd).toLocaleDateString('pt-BR')} (+${action.meta.slipDays || 0}d)`);
    }
    // Finance context
    if (action.meta?.eacDelta) {
        contextLines.push(`Variação Financeira: EAC-BAC ${action.meta.eacDelta}`);
    }
    // Risk context
    if (action.meta?.riskScore) {
        contextLines.push(`Score P×I: ${action.meta.riskScore}`);
        if (action.meta.mitigationStatus) contextLines.push(`Mitigação: ${action.meta.mitigationStatus}`);
    }
    if (extraContext) contextLines.push(extraContext);

    const draft: DeliberationDraft = {
        id,
        projectId,
        title: `[${projectCode}] Decisão: ${action.title}`,
        contextSummary: contextLines.filter(Boolean).join('\n'),
        recommendedOptions: [
            'Aprovar mitigação proposta',
            'Aprovar aditivo contratual',
            'Escalar para diretoria',
            'Aceitar risco',
        ],
        attachmentSuggestions: [],
        sourceActionId: action.id,
        createdAt: new Date().toISOString(),
    };

    // Store in localStorage
    if (typeof window !== 'undefined') {
        try {
            const existing = JSON.parse(localStorage.getItem('deliberation_drafts') || '[]');
            existing.push(draft);
            localStorage.setItem('deliberation_drafts', JSON.stringify(existing));
        } catch { /* SSR or unavailable */ }
    }

    return draft;
}

// ─── Action Target Resolver ─────────────────────────────────────
// Returns either a same-page tab switch or an external route navigation

export type ActionTarget =
    | { type: 'tab'; tab: string }
    | { type: 'route'; url: string };

export function resolveActionTarget(item: ActionItem, projectId: string): ActionTarget {
    switch (item.source.entity) {
        case 'task':
        case 'schedule':
            return { type: 'tab', tab: 'timeline' };
        case 'finance':
            return { type: 'tab', tab: 'finance' };
        case 'document':
            return { type: 'tab', tab: 'overview' };
        case 'risk':
            return { type: 'route', url: `/riscos` };
        case 'deliberation':
            return { type: 'route', url: `/pautas` };
        default:
            return { type: 'tab', tab: 'overview' };
    }
}

// ─── Schedule Display Helpers ───────────────────────────────────

export function getScheduleSlipLabel(
    baselineEnd?: string,
    currentEnd?: string,
): string | null {
    if (!baselineEnd || !currentEnd) return null;
    const bDate = new Date(baselineEnd);
    const cDate = new Date(currentEnd);
    const slipMs = cDate.getTime() - bDate.getTime();
    const slipDays = Math.ceil(slipMs / 86400000);
    const bFmt = bDate.toLocaleDateString('pt-BR');
    const cFmt = cDate.toLocaleDateString('pt-BR');
    const sign = slipDays >= 0 ? '+' : '';
    return `Baseline: ${bFmt} → Atual: ${cFmt} (${sign}${slipDays}d)`;
}
