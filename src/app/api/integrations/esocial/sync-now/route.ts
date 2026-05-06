import { NextResponse } from "next/server";
import { esocialIntegrationService } from "@/lib/integrations/esocial";
import type { EsocialSyncNowRequest } from "@/lib/integrations/esocial";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<EsocialSyncNowRequest>;
  const result = await esocialIntegrationService.runSyncByCompetence({
    environment: body.environment ?? "homologation",
    competence: body.competence ?? "2026-04",
    periodFrom: body.periodFrom ?? body.competence ?? "2026-04",
    periodTo: body.periodTo ?? body.competence ?? "2026-04",
  });

  return NextResponse.json(result);
}
