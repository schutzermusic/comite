import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BrandingBody = {
  name?: string;
  workspace_name?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
  email_from_name?: string | null;
  notification_name?: string | null;
  branding_enabled?: boolean;
};

function sanitize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  const guard = await requireApiPermission('admin.manage_organization');
  if (!guard.ok) return guard.response;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();

  if (!profile?.organization_id) {
    return NextResponse.json({ ok: false, error: 'Sem organização.' }, { status: 403 });
  }

  const { data: org, error } = await supabase
    .from('organizations')
    .select('id,name,slug,status,workspace_name,logo_url,brand_color,email_from_name,notification_name,branding_enabled')
    .eq('id', profile.organization_id)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, organization: org });
}

export async function PATCH(req: Request) {
  const guard = await requireApiPermission('admin.manage_organization');
  if (!guard.ok) return guard.response;

  let body: BrandingBody = {};
  try {
    body = (await req.json()) as BrandingBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();

  if (!profile?.organization_id) {
    return NextResponse.json({ ok: false, error: 'Sem organização.' }, { status: 403 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ ok: false, error: 'Nome obrigatório.' }, { status: 400 });
    update.name = name;
  }
  if ('workspace_name' in body) update.workspace_name = sanitize(body.workspace_name);
  if ('logo_url' in body) update.logo_url = sanitize(body.logo_url);
  // brand_color is intentionally not exposed: colors follow the standard
  // Insight Apex visual identity and are not customizable per tenant.
  if ('email_from_name' in body) update.email_from_name = sanitize(body.email_from_name);
  if ('notification_name' in body) update.notification_name = sanitize(body.notification_name);
  if (typeof body.branding_enabled === 'boolean') update.branding_enabled = body.branding_enabled;
  update.updated_at = new Date().toISOString();

  // RLS-scoped update: the .eq on profile-derived org id ensures the caller
  // cannot touch another tenant's branding even if RLS were misconfigured.
  const { data: org, error } = await supabase
    .from('organizations')
    .update(update)
    .eq('id', profile.organization_id)
    .select('id,name,slug,status,workspace_name,logo_url,brand_color,email_from_name,notification_name,branding_enabled')
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, organization: org });
}
