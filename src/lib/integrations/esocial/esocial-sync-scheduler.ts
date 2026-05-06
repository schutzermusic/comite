import type { EsocialScheduleConfig, EsocialSyncFrequency } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function calculateNextEsocialSync(
  frequency: EsocialSyncFrequency,
  from = new Date("2026-05-05T09:30:00-03:00"),
): string | undefined {
  if (frequency === "manual") return undefined;

  const next = new Date(from);
  if (frequency === "daily") next.setTime(next.getTime() + DAY_MS);
  if (frequency === "weekly") next.setTime(next.getTime() + 7 * DAY_MS);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  next.setHours(2, 15, 0, 0);
  return next.toISOString();
}

export function patchEsocialSchedule(
  current: EsocialScheduleConfig,
  patch: Partial<EsocialScheduleConfig>,
): EsocialScheduleConfig {
  const frequency = patch.frequency ?? current.frequency;
  const automaticSyncEnabled = patch.automaticSyncEnabled ?? current.automaticSyncEnabled;
  return {
    ...current,
    ...patch,
    automaticSyncEnabled,
    frequency,
    nextScheduledSyncAt: automaticSyncEnabled ? calculateNextEsocialSync(frequency) : undefined,
  };
}
