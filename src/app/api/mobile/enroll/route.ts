import { authenticateMobile, json } from '@/lib/mobile/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EnrollBody {
  devicePublicId?: string;
  platform?: 'ios' | 'android' | 'web';
  deviceName?: string;
}

/**
 * Binds a device to the authenticated person (idempotent by
 * device_public_id). New devices start 'pending'; a manager promotes to
 * 'trusted' (or an org policy can auto-trust). Returns the device row.
 */
export async function POST(req: Request) {
  const auth = await authenticateMobile(req);
  if (!auth.ok) return auth.response;
  const { supabase, orgId, personId, userId } = auth.auth;

  let body: EnrollBody = {};
  try {
    body = (await req.json()) as EnrollBody;
  } catch {
    return json({ ok: false, error: 'Corpo inválido' }, 400);
  }
  if (!body.devicePublicId || !body.platform) {
    return json({ ok: false, error: 'devicePublicId e platform são obrigatórios' }, 400);
  }

  const { data, error } = await supabase
    .from('registered_devices')
    .upsert(
      {
        organization_id: orgId,
        person_id: personId,
        platform: body.platform,
        device_public_id: body.devicePublicId,
        device_name: body.deviceName ?? null,
        last_seen_at: new Date().toISOString(),
        created_by: userId,
      },
      { onConflict: 'organization_id,device_public_id' },
    )
    .select('*')
    .single();
  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true, device: data });
}
