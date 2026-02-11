/**
 * Project Migration — auto-upgrade insight_projects v1 → insight_projects_v2
 */

import type { Project } from '@/lib/types';
import type { ProjectV2, ProjectFinance, ProjectAuditEvent, ProjectRevenue } from '@/lib/types/project-v2';
import { v2Overlays, V2_ENRICHED_IDS } from '@/data/mock-projects-v2';
import { makeMoney, computeHealthScore } from '@/lib/utils/project-utils';

const STORAGE_KEY_V1 = 'insight_projects';
const STORAGE_KEY_V2 = 'insight_projects_v2';

/**
 * Check if v2 migration has already been performed
 */
export function isV2Migrated(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const v2 = localStorage.getItem(STORAGE_KEY_V2);
        if (v2) {
            const parsed = JSON.parse(v2);
            return Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.schemaVersion === 2;
        }
    } catch {
        // ignore
    }
    return false;
}

/**
 * Migrate a single v1 project to v2 shape.
 * Merges v2 overlay data if available, otherwise creates empty substructures.
 */
function migrateProjectToV2(p: Project): ProjectV2 {
    const overlay = v2Overlays[p.id];

    // Map legacy finance fields to MoneyAmount
    const defaultFinance: ProjectFinance = {
        bac: makeMoney(p.valor_total || 0),
        ac: makeMoney(p.valor_executado || 0),
        eac: makeMoney(p.valor_total || 0),   // initially EAC = BAC
        etc: makeMoney((p.valor_total || 0) - (p.valor_executado || 0)),
        forecastMethod: 'manual',
        confidence: 'medium',
        varianceAmount: { amountCents: 0, currency: 'BRL' },
        variancePercent: 0,
        updatedAt: new Date().toISOString(),
    };

    // Map legacy revenue fields from valor_total / valor_executado
    const totalContracted = p.valor_total || 0;
    const billed = p.valor_executado || 0;
    const received = billed * 0.8; // default assumption: 80% of billed is received
    const defaultRevenue: ProjectRevenue = {
        totalContracted: makeMoney(totalContracted),
        billed: makeMoney(billed),
        received: makeMoney(received),
        toBill: makeMoney(totalContracted - billed),
        toReceive: makeMoney(billed - received),
        updatedAt: new Date().toISOString(),
    };

    const migrationEvent: ProjectAuditEvent = {
        id: `migration-${p.id}`,
        path: 'schemaVersion',
        before: '1',
        after: '2',
        timestamp: new Date().toISOString(),
        actor: 'system',
        action: 'migrated',
    };

    const base: ProjectV2 = {
        ...p,
        schemaVersion: 2,
        tasks: [],
        milestones: [],
        risks: [],
        documents: [],
        finance: defaultFinance,
        revenue: defaultRevenue,
        governance: { deliberation_ids: [], meeting_ids: [] },
        audit_log: [migrationEvent],
        health_score: 100,
        health_reasons: [],
        last_activity_at: p.created_date ? new Date(p.created_date).toISOString() : new Date().toISOString(),
    };

    // Merge overlay data if available
    if (overlay) {
        const merged: ProjectV2 = {
            ...base,
            ...overlay,
            // Keep the original project fields (spread base first, then overlay)
            id: p.id,
            nome: p.nome,
            codigo: p.codigo,
            cliente: p.cliente,
            status: p.status,
            responsavel: p.responsavel,
            valor_total: p.valor_total,
            valor_executado: p.valor_executado,
            progresso_percentual: p.progresso_percentual,
            audit_log: [...(overlay.audit_log || []), migrationEvent],
        };

        // Compute health score
        const { score, reasons } = computeHealthScore(merged);
        merged.health_score = score;
        merged.health_reasons = reasons;

        return merged;
    }

    // Compute health score for base (non-enriched) projects
    const { score, reasons } = computeHealthScore(base);
    base.health_score = score;
    base.health_reasons = reasons;

    return base;
}

/**
 * Run migration: reads v1 data, converts to v2, stores in v2 key.
 * Returns the migrated projects.
 */
export function migrateToV2(v1Projects: Project[]): ProjectV2[] {
    const v2Projects = v1Projects.map(migrateProjectToV2);

    if (typeof window !== 'undefined') {
        try {
            localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(v2Projects));
        } catch (error) {
            console.error('Erro ao salvar migração v2:', error);
        }
    }

    return v2Projects;
}

/**
 * Load v2 projects from storage, or migrate if needed.
 */
export function loadV2Projects(v1Projects: Project[]): ProjectV2[] {
    if (typeof window === 'undefined') {
        return v1Projects.map(migrateProjectToV2);
    }

    // Try to load existing v2 data
    try {
        const stored = localStorage.getItem(STORAGE_KEY_V2);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.schemaVersion === 2) {
                return parsed as ProjectV2[];
            }
        }
    } catch {
        // fall through to migration
    }

    // Run migration
    return migrateToV2(v1Projects);
}

export { STORAGE_KEY_V1, STORAGE_KEY_V2 };
