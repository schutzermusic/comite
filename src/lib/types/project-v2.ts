/**
 * Project V2 — Governance-grade data model
 * Schema version 2 with substructures for tasks, risks, docs, finance, audit
 */

import { Project, User } from '@/lib/types';

// ─── Money ───────────────────────────────────────────────────────
export type MoneyAmount = {
    amountCents: number;
    currency: string; // ISO 4217 e.g. "BRL"
};

// ─── Tasks (Gantt-ready) ─────────────────────────────────────────
export type ProjectTaskV2 = {
    id: string;
    projectId: string;
    name: string;
    description?: string;
    startDate: string;   // ISO date
    endDate: string;     // ISO date
    baselineStart?: string;
    baselineEnd?: string;
    status: 'not_started' | 'in_progress' | 'completed' | 'delayed';
    responsibleId?: string;
    responsibleName?: string;
    milestone?: boolean;
    dependencies?: string[];  // task IDs
    progress: number;  // 0-100
    overdueReason?: string;
};

// ─── Milestones ──────────────────────────────────────────────────
export type ProjectMilestone = {
    id: string;
    name: string;
    date: string;            // ISO date, fixed
    status: 'pending' | 'completed' | 'overdue';
    linkedTaskIds?: string[];
};

// ─── Risk Items ──────────────────────────────────────────────────
export type ProjectRiskItem = {
    id: string;
    title: string;
    description?: string;
    category: 'Operational' | 'Financial' | 'Legal' | 'Contractual' | 'Environmental' | 'Schedule' | string;
    probability: number;  // 1-5
    impact: number;        // 1-5  (severity: "how bad if it occurs")
    level: number;         // computed: probability × impact
    severity: 'low' | 'medium' | 'high' | 'critical';
    exposure?: MoneyAmount;
    mitigation?: string;
    evidence?: string[];   // doc IDs or URLs
    ownerId?: string;
    ownerName?: string;
    status: 'open' | 'mitigating' | 'resolved';
    createdAt: string;
    updatedAt: string;
};

// ─── Documents ───────────────────────────────────────────────────
export type ProjectDocument = {
    id: string;
    name: string;
    category: 'contract' | 'license' | 'report' | 'evidence' | 'proposal' | 'minutes' | 'other';
    version: number;
    required: boolean;
    uploadedAt: string;
    url?: string;
    uploadedBy?: string;
};

// ─── Required Document Checklist ─────────────────────────────────
export type RequiredDocChecklist = {
    category: ProjectDocument['category'];
    label: string;
    required: boolean;
};

// ─── Finance ─────────────────────────────────────────────────────
export type ProjectFinance = {
    bac: MoneyAmount;               // Budget at Completion (baseline)
    ac: MoneyAmount;                // Actual Cost
    eac: MoneyAmount;               // Estimate at Completion
    etc: MoneyAmount;               // Estimate to Complete
    forecastMethod: 'ac_plus_etc' | 'manual';
    confidence: 'high' | 'medium' | 'low';
    varianceAmount: MoneyAmount;    // EAC - BAC
    variancePercent: number;        // (EAC - BAC) / BAC * 100
    drivers?: string[];
    updatedAt: string;
};

// ─── Revenue (Contract-side) ─────────────────────────────────────
export type ProjectRevenue = {
    totalContracted: MoneyAmount;  // full contract value
    billed: MoneyAmount;           // invoiced so far
    received: MoneyAmount;         // cash collected
    toBill: MoneyAmount;           // contracted - billed
    toReceive: MoneyAmount;        // billed - received
    updatedAt: string;             // ISO datetime
};

// ─── S-Curve Data Points ─────────────────────────────────────────
export type CostCurvePoint = {
    period: string;                // "YYYY-MM"
    bacCumulative: number;         // cents
    acCumulative: number;          // cents
    eacCumulative: number;         // cents
};

export type RevenueCurvePoint = {
    period: string;                // "YYYY-MM"
    plannedCumulative: number;     // cents
    billedCumulative: number;      // cents
    receivedCumulative: number;    // cents
};

// ─── Billing Eventogram ──────────────────────────────────────────
export type BillingEvent = {
    id: string;
    projectId: string;
    contractId?: string;
    datePlanned: string;           // ISO date
    dateActual?: string;           // ISO date
    title: string;
    amountPlannedCents: number;
    amountActualCents?: number;
    status: 'planned' | 'billed' | 'partial' | 'delayed' | 'cancelled';
    linked: {
        milestoneId?: string;
        taskId?: string;
        documentIds?: string[];
        deliberationIds?: string[];
    };
};

// ─── Cost Breakdown ──────────────────────────────────────────────
export type CostBreakdownItem = {
    category: string;
    bac: MoneyAmount;
    ac: MoneyAmount;
    eac: MoneyAmount;
};

// ─── Governance Links ────────────────────────────────────────────
export type GovernanceLinks = {
    deliberation_ids: string[];
    meeting_ids: string[];
};

// ─── Audit Log ───────────────────────────────────────────────────
export type ProjectAuditEvent = {
    id: string;
    path: string;           // dot-path e.g. "finance.eac.amountCents"
    before: string | null;
    after: string | null;
    timestamp: string;       // ISO datetime
    actor: string;           // user name or id
    action: 'created' | 'updated' | 'deleted' | 'migrated';
};

// ─── Location ────────────────────────────────────────────────────
export type ProjectLocation = {
    city?: string;
    lat?: number;
    lng?: number;
};

// ─── Project V2 (full enriched type) ─────────────────────────────
export type ProjectV2 = Project & {
    schemaVersion: 2;

    // Substructures
    tasks: ProjectTaskV2[];
    milestones: ProjectMilestone[];
    risks: ProjectRiskItem[];
    documents: ProjectDocument[];
    finance: ProjectFinance;
    revenue?: ProjectRevenue;
    costCurve?: CostCurvePoint[];
    revenueCurve?: RevenueCurvePoint[];
    costBreakdown?: CostBreakdownItem[];
    billing_eventogram?: BillingEvent[];    // billing events (previsto × realizado)
    cutoffPeriod?: string;              // "YYYY-MM" — actual data stops here
    governance: GovernanceLinks;
    audit_log: ProjectAuditEvent[];

    // New scalar fields
    contract_id?: string;
    uf?: string;
    location?: ProjectLocation;
    health_score: number;            // 0-100
    health_reasons?: string[];
    last_activity_at?: string;       // ISO datetime
    next_milestone_at?: string;      // ISO date

    // Template reference
    templateType?: 'solar' | 'wind' | 'transmission' | 'maintenance' | 'offshore' | 'industrial';
};

// ─── Alerts ──────────────────────────────────────────────────────
export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AlertActionType =
    | 'create_deliberation'
    | 'register_risk'
    | 'upload_evidence'
    | 'add_task'
    | 'open_financial_review'
    | 'view_details';

export type ProjectAlert = {
    id: string;
    severity: AlertSeverity;
    message: string;
    action: AlertActionType;
    actionLabel: string;
    category: 'risk' | 'task' | 'approval' | 'document' | 'finance' | 'schedule';
};

// ─── Action Items (computed, governance-grade) ──────────────────
export type ActionItemType = 'risk' | 'task' | 'doc' | 'approval' | 'finance' | 'schedule';
export type ActionItemSeverity = 'info' | 'warning' | 'critical';
export type ActionItemStatus = 'open' | 'in_progress' | 'resolved' | 'accepted';

export type ActionItem = {
    id: string;
    type: ActionItemType;
    severity: ActionItemSeverity;
    title: string;
    description?: string;
    owner?: { id?: string; name?: string };
    dueAt?: string;           // ISO date
    status: ActionItemStatus;
    source: {
        entity: 'risk' | 'task' | 'document' | 'deliberation' | 'finance' | 'schedule';
        entityId?: string;
        ruleId: string;
    };
    meta?: {
        baselineEnd?: string;   // ISO date — schedule items
        currentEnd?: string;    // ISO date — schedule items
        slipDays?: number;      // positive = slipped
        eacDelta?: string;      // formatted finance delta string
        riskScore?: number;     // P×I — risk items
        mitigationStatus?: string;
    };
    createdAt: string;
};

// ─── Deliberation Drafts (localStorage-backed) ─────────────────
export type DeliberationDraft = {
    id: string;
    projectId: string;
    title: string;
    contextSummary: string;
    recommendedOptions: string[];
    attachmentSuggestions: string[];
    sourceActionId?: string;
    createdAt: string;
};

// ─── Risk Level Thresholds ──────────────────────────────────────
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// ─── Team Allocation V2 ─────────────────────────────────────────
export type ProjectAllocationV2 = {
    id: string;
    projectId: string;
    memberId: string;
    memberName: string;
    role: string;
    allocationPercent: number;
    hoursPerWeek?: number;
    plannedHH: number;           // total planned hours
    actualHH: number;            // total actual hours
    hourlyRate?: MoneyAmount;
    critical?: boolean;
    startDate?: string;
    endDate?: string;
};

// ─── Project Type Templates ──────────────────────────────────────
export type ProjectTemplate = {
    type: ProjectV2['templateType'];
    label: string;
    defaultTasks: Omit<ProjectTaskV2, 'id' | 'projectId'>[];
    defaultMilestones: Omit<ProjectMilestone, 'id'>[];
    requiredDocs: RequiredDocChecklist[];
};
