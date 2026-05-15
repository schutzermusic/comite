import { NextResponse } from "next/server";
import { esocialIntegrationService } from "@/lib/integrations/esocial";
import type { EsocialSyncNowRequest } from "@/lib/integrations/esocial";
import { requireApiPermission } from "@/lib/auth/api-guard";

export async function POST(request: Request) {
  const guard = await requireApiPermission("admin.manage_integrations");
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Partial<EsocialSyncNowRequest>;
  const result = await esocialIntegrationService.runSyncByCompetence({
    environment: body.environment ?? "homologation",
    competence: body.competence ?? "2026-04",
    periodFrom: body.periodFrom ?? body.competence ?? "2026-04",
    periodTo: body.periodTo ?? body.competence ?? "2026-04",
  });

  return NextResponse.json(result);
}
