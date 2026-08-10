import type { AttendancePunch } from './people';

export type JourneyShiftTemplate = {
  id: string;
  organizationId: string;
  name: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  breakMinutes: number;
  toleranceBeforeMinutes: number;
  toleranceAfterMinutes: number;
  timezone: string;
  active: boolean;
};

export type JourneyShiftAssignment = {
  id: string;
  organizationId: string;
  personId: string;
  shiftTemplateId: string;
  projectId: string | null;
  validFrom: string;
  validUntil: string | null;
  active: boolean;
};

export type JourneyScheduleExceptionType = 'day_off' | 'custom_shift' | 'planned_absence';

export type JourneyScheduleException = {
  id: string;
  organizationId: string;
  personId: string;
  workDate: string;
  type: JourneyScheduleExceptionType;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number | null;
  toleranceBeforeMinutes: number | null;
  toleranceAfterMinutes: number | null;
  reason: string;
};

export type JourneyManagerScope = {
  id: string;
  organizationId: string;
  managerPersonId: string;
  accessMode: 'direct_team' | 'projects' | 'both';
  active: boolean;
  projectIds: string[];
};

export type JourneyBalanceApprovalStatus = 'pending' | 'approved' | 'rejected';

export type JourneyBalanceApproval = {
  id: string;
  organizationId: string;
  personId: string;
  workDate: string;
  provisionalMinutes: number;
  status: JourneyBalanceApprovalStatus;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

export type JourneyClosingStatus = 'open' | 'manager_review' | 'rh_review' | 'closed';

export type JourneyClosingPeriod = {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  status: JourneyClosingStatus;
  managerReviewAt: string | null;
  rhReviewAt: string | null;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
};

export type JourneyExceptionType =
  | 'no_schedule'
  | 'absent'
  | 'late'
  | 'early_departure'
  | 'incomplete'
  | 'short_break'
  | 'overtime'
  | 'under_review'
  | 'unclassified_time'
  | 'outside_journey';

export type JourneyException = {
  type: JourneyExceptionType;
  severity: 'info' | 'warning' | 'critical';
  label: string;
};

export type JourneyDayStatus =
  | 'no_schedule'
  | 'expected'
  | 'working'
  | 'break'
  | 'closed'
  | 'absent'
  | 'excused'
  | 'incomplete';

export type ResolvedJourneySchedule = {
  personId: string;
  date: string;
  templateId: string | null;
  templateName: string;
  projectId: string | null;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  toleranceBeforeMinutes: number;
  toleranceAfterMinutes: number;
  timezone: string;
  overnight: boolean;
};

export type JourneyDaySummary = {
  personId: string;
  personName: string;
  department: string | null;
  date: string;
  schedule: ResolvedJourneySchedule | null;
  status: JourneyDayStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  breakMinutes: number;
  expectedMinutes: number | null;
  overtimeMinutes: number;
  nightMinutes: number;
  provisionalBalanceMinutes: number;
  consolidatedBalanceMinutes: number;
  approvalStatus: JourneyBalanceApprovalStatus | null;
  exceptions: JourneyException[];
  punches: AttendancePunch[];
  reportedMinutes: number;
  unclassifiedMinutes: number;
  outsideJourneyMinutes: number;
};

export type JourneyAccessiblePerson = {
  id: string;
  fullName: string;
  department: string | null;
  jobTitle: string | null;
  weeklyHours: number;
  managerPersonId: string | null;
  status: string;
};

export type JourneyManagementData = {
  month: string;
  people: JourneyAccessiblePerson[];
  days: JourneyDaySummary[];
  templates: JourneyShiftTemplate[];
  assignments: JourneyShiftAssignment[];
  scheduleExceptions: JourneyScheduleException[];
  approvals: JourneyBalanceApproval[];
  closingPeriod: JourneyClosingPeriod | null;
  managerReviews: Array<{
    id: string;
    managerPersonId: string;
    status: 'pending' | 'submitted';
    submittedAt: string | null;
  }>;
  managerScopes?: JourneyManagerScope[];
  projects?: Array<{ id: string; name: string }>;
  reviewCount: number;
  permissions: {
    canManage: boolean;
    canApprove: boolean;
    canManageSchedules: boolean;
    canAdminScopes: boolean;
    canClose: boolean;
  };
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};
