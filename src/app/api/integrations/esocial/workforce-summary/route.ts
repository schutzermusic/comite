import { NextResponse } from "next/server";
import { esocialIntegrationService } from "@/lib/integrations/esocial";

export async function GET() {
  return NextResponse.json(esocialIntegrationService.getWorkforceSummary());
}
