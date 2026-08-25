/**
 * Reprocessa logos de cliente já gravadas para o frame 1280×337.
 *
 *   npx tsx scripts/normalize-project-client-logos.ts
 */

import 'dotenv/config';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { normalizeClientLogoBuffer } from '../src/lib/utils/normalize-client-logo.node';

config({ path: '.env.local', override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL em .env.local.');
if (!serviceRoleKey) throw new Error('Defina SUPABASE_SERVICE_ROLE_KEY em .env.local.');

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = 'project-files';

type ProjectRow = {
  id: string;
  organization_id: string;
  client_logo_url: string | null;
  project: { clientLogoUrl?: string } | null;
  project_v2: { clientLogoUrl?: string } | null;
};

async function main() {
  const { data, error } = await supabase
    .from('projects')
    .select('id, organization_id, client_logo_url, project, project_v2');
  if (error) throw error;

  const rows = ((data ?? []) as ProjectRow[]).filter((row) => {
    const url = row.client_logo_url || row.project?.clientLogoUrl || row.project_v2?.clientLogoUrl;
    return Boolean(url);
  });

  console.log(`Logos a padronizar: ${rows.length}`);

  for (const row of rows) {
    const sourceUrl =
      row.client_logo_url || row.project?.clientLogoUrl || row.project_v2?.clientLogoUrl || '';
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      console.warn(`skip ${row.id}: HTTP ${res.status}`);
      continue;
    }
    const input = Buffer.from(await res.arrayBuffer());
    const png = await normalizeClientLogoBuffer(input);
    const path = `${row.organization_id}/${row.id}/${Date.now()}-logo-client-logo.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, png, {
      contentType: 'image/png',
      upsert: true,
      cacheControl: '3600',
    });
    if (upErr) throw new Error(`${row.id}: ${upErr.message}`);

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    const project = { ...(row.project ?? {}), clientLogoUrl: publicUrl };
    const projectV2 = row.project_v2 ? { ...row.project_v2, clientLogoUrl: publicUrl } : row.project_v2;

    const { error: updErr } = await supabase
      .from('projects')
      .update({
        client_logo_url: publicUrl,
        project,
        project_v2: projectV2,
      })
      .eq('id', row.id);
    if (updErr) throw new Error(`${row.id} update: ${updErr.message}`);

    const { error: fileErr } = await supabase.from('project_files').insert({
      project_id: row.id,
      organization_id: row.organization_id,
      bucket_id: BUCKET,
      object_path: path,
      public_url: publicUrl,
      file_name: 'client-logo.png',
      content_type: 'image/png',
      file_size: png.length,
      category: 'logo',
    });
    if (fileErr) console.warn(`project_files ${row.id}: ${fileErr.message}`);

    console.log(`ok ${row.id} → ${png.length} bytes  ${publicUrl}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
