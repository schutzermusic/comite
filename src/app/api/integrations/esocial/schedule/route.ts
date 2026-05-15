import { NextResponse } from "next/server";
import {
  defaultEsocialScheduleConfig,
  patchEsocialSchedule,
  type EsocialScheduleConfig,
} from "@/lib/integrations/esocial";
import { requireApiPermission } from "@/lib/auth/api-guard";

export async function PATCH(request: Request) {
  const guard = await requireApiPermission("admin.manage_integrations");
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Partial<EsocialScheduleConfig>;
  return NextResponse.json({
    schedule: patchEsocialSchedule(defaultEsocialScheduleConfig, body),
    simulated: true,
    safeMessage: "Agenda atualizada em modo stub. Persistencia real deve ser ligada ao backend.",
  });
}
