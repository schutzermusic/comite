import { NextResponse } from "next/server";
import { esocialIntegrationService } from "@/lib/integrations/esocial";

export async function POST() {
  const result = await esocialIntegrationService.validateCertificate();
  return NextResponse.json(result);
}
