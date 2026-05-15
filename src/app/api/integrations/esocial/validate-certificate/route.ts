import { NextResponse } from "next/server";
import { esocialIntegrationService } from "@/lib/integrations/esocial";
import { requireApiPermission } from "@/lib/auth/api-guard";

export async function POST() {
  const guard = await requireApiPermission("admin.manage_integrations");
  if (!guard.ok) return guard.response;

  const result = await esocialIntegrationService.validateCertificate();
  return NextResponse.json(result);
}
