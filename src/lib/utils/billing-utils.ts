'use client';

/**
 * Billing Eventogram Utilities
 * Transforms BillingEvent[] into recharts-ready series for Monthly and Cumulative views.
 */

import type { BillingEvent, ProjectMilestone, ProjectTaskV2 } from '@/lib/types/project-v2';

// ── Types ───────────────────────────────────────────────────────

export type BillingSeriesPoint = {
    period: string;
    previsto: number | null;
    realizado: number | null;
};

export type BillingMonthlyPoint = BillingSeriesPoint & {
    events: BillingEvent[];
};

// ── Helpers ─────────────────────────────────────────────────────

function periodFromISO(iso: string): string {
    return iso.slice(0, 7);
}

function monthsRange(start: string, end: string): string[] {
    const result: string[] = [];
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    let y = sy, m = sm;
    while (y < ey || (y === ey && m <= em)) {
        result.push(`${y}-${String(m).padStart(2, '0')}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return result;
}

// ── Build Billing Series ────────────────────────────────────────

export function buildBillingSeries(
    billingEvents: BillingEvent[],
    mode: 'monthly' | 'cumulative',
    cutoffAt: string,
    projectEndAt: string,
): BillingMonthlyPoint[] {
    if (!billingEvents.length) return [];

    const allPlannedPeriods = billingEvents.map(e => periodFromISO(e.datePlanned));
    const actualPeriods = billingEvents
        .filter(e => e.dateActual)
        .map(e => periodFromISO(e.dateActual!));
    const allPeriods = [...allPlannedPeriods, ...actualPeriods, projectEndAt];
    const startPeriod = allPlannedPeriods.sort()[0];
    const endPeriod = allPeriods.sort().pop()!;

    const periods = monthsRange(startPeriod, endPeriod);

    const previstoMap = new Map<string, number>();
    const realizadoMap = new Map<string, number>();
    const eventsMap = new Map<string, BillingEvent[]>();

    for (const p of periods) {
        previstoMap.set(p, 0);
        realizadoMap.set(p, 0);
        eventsMap.set(p, []);
    }

    for (const evt of billingEvents) {
        const plannedPeriod = periodFromISO(evt.datePlanned);
        if (previstoMap.has(plannedPeriod)) {
            previstoMap.set(plannedPeriod, (previstoMap.get(plannedPeriod) || 0) + evt.amountPlannedCents / 100);
        }

        if (evt.dateActual && (evt.status === 'billed' || evt.status === 'partial')) {
            const actualPeriod = periodFromISO(evt.dateActual);
            if (realizadoMap.has(actualPeriod)) {
                realizadoMap.set(actualPeriod, (realizadoMap.get(actualPeriod) || 0) + (evt.amountActualCents || 0) / 100);
            }
        }

        if (eventsMap.has(plannedPeriod)) {
            eventsMap.get(plannedPeriod)!.push(evt);
        }
    }

    if (mode === 'monthly') {
        return periods.map(p => ({
            period: p,
            previsto: previstoMap.get(p) || 0,
            realizado: p <= cutoffAt ? (realizadoMap.get(p) || 0) : null,
            events: eventsMap.get(p) || [],
        }));
    }

    let cumulativePrevisto = 0;
    let cumulativeRealizado = 0;
    return periods.map(p => {
        cumulativePrevisto += previstoMap.get(p) || 0;
        cumulativeRealizado += realizadoMap.get(p) || 0;
        return {
            period: p,
            previsto: cumulativePrevisto,
            realizado: p <= cutoffAt ? cumulativeRealizado : null,
            events: eventsMap.get(p) || [],
        };
    });
}

// ── Mock Billing Event Generator ────────────────────────────────

export function generateMockBillingEvents(
    projectId: string,
    contractId: string | undefined,
    totalPlannedCents: number,
    startMonth: string,
    totalMonths: number,
    progressMonths: number,
    milestones: ProjectMilestone[],
    tasks: ProjectTaskV2[],
): BillingEvent[] {
    const events: BillingEvent[] = [];
    const [sy, sm] = startMonth.split('-').map(Number);

    const monthlyPlanned: number[] = [];
    let prevCum = 0;
    for (let i = 0; i < totalMonths; i++) {
        const t = (i + 0.5) / totalMonths;
        const s = 1 / (1 + Math.exp(-10 * (t - 0.5)));
        const cumVal = totalPlannedCents * s;
        const monthVal = Math.round(cumVal - prevCum);
        monthlyPlanned.push(monthVal);
        prevCum = cumVal;
    }
    const sumPlanned = monthlyPlanned.reduce((a, b) => a + b, 0);
    monthlyPlanned[monthlyPlanned.length - 1] += (totalPlannedCents - sumPlanned);

    for (let i = 0; i < totalMonths; i++) {
        const month = ((sm - 1 + i) % 12) + 1;
        const year = sy + Math.floor((sm - 1 + i) / 12);
        const periodStr = `${year}-${String(month).padStart(2, '0')}`;
        const plannedDate = `${periodStr}-15`;

        const linkedMilestone = milestones.find(ms => ms.date.startsWith(periodStr));
        const linkedTask = tasks.find(t =>
            t.startDate <= `${periodStr}-28` && t.endDate >= `${periodStr}-01`
        );

        const isActual = i < progressMonths;
        const varianceFactor = 0.85 + (((i * 7 + 3) % 30) / 100);
        const actualCents = isActual ? Math.round(monthlyPlanned[i] * varianceFactor) : undefined;

        let status: BillingEvent['status'];
        if (isActual) {
            status = varianceFactor < 0.95 ? 'partial' : 'billed';
        } else if (i === progressMonths) {
            status = 'delayed';
        } else {
            status = 'planned';
        }

        const title = linkedMilestone
            ? `Marco: ${linkedMilestone.name}`
            : `Medição #${i + 1}`;

        events.push({
            id: `${projectId}-be-${i + 1}`,
            projectId,
            contractId,
            datePlanned: plannedDate,
            dateActual: isActual ? `${periodStr}-${String(15 + (i % 10)).padStart(2, '0')}` : undefined,
            title,
            amountPlannedCents: monthlyPlanned[i],
            amountActualCents: actualCents,
            status,
            linked: {
                milestoneId: linkedMilestone?.id,
                taskId: linkedTask?.id,
                documentIds: [],
                deliberationIds: [],
            },
        });
    }

    return events;
}
