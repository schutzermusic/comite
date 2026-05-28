import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getServiceClient } from '@/lib/ai/server-clients';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'org-branding';
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'logo';
}

export async function POST(req: Request) {
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Form inválido.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: 'Arquivo ausente.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'Arquivo excede 2MB.' }, { status: 400 });
  }
  const type = file.type || 'application/octet-stream';
  if (!ALLOWED.has(type)) {
    return NextResponse.json(
      { ok: false, error: 'Formato inválido. Use PNG, JPG, WEBP ou SVG.' },
      { status: 400 },
    );
  }

  const originalName = (form.get('filename') as string | null) || 'logo';
  const ext = type === 'image/svg+xml' ? 'svg' : type.split('/')[1] || 'png';
  const path = `${profile.organization_id}/logo-${Date.now()}-${sanitize(originalName)}.${ext}`;

  const service = getServiceClient();
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, bytes, {
    contentType: type,
    upsert: true,
    cacheControl: '3600',
  });
  if (upErr) {
    return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
  }

  const { data: pub } = service.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;

  // Persist on the org so the topbar updates immediately.
  const { error: updErr } = await service
    .from('organizations')
    .update({ logo_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', profile.organization_id);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, logo_url: publicUrl, path });
}
