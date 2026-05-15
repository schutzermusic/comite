// SERVER-ONLY seed script. Requires SUPABASE_SERVICE_ROLE_KEY in env. Bypasses RLS.
//
// Required env vars (read from .env.local or process.env):
//   NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY     — service-role key (server-only, never expose to client)
//
// Optional env vars (if absent, the script resolves defaults via queries):
//   SUPABASE_SEED_ORG_ID          — organization_id assigned to each seeded project.
//                                   Default: first row from `organizations` (oldest by created_at).
//   SUPABASE_SEED_USER_ID         — user_id used for `created_by`.
//                                   Default: first user_id from `profiles` whose role is
//                                   `owner_admin` (falls back to first profile if none found).
//
// Usage: npx tsx scripts/seed-projects-to-supabase.ts

import 'dotenv/config';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { projects } from '../src/lib/mock-data';
import { loadV2Projects } from '../src/lib/services/project-migration';

config({ path: '.env.local', override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL em .env.local.');
}
if (!serviceRoleKey) {
  throw new Error(
    'Defina SUPABASE_SERVICE_ROLE_KEY em .env.local. Esse script é SERVER-ONLY e bypassa RLS — nunca use a anon key.',
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function resolveOrgId(): Promise<string> {
  const explicit = process.env.SUPABASE_SEED_ORG_ID;
  if (explicit) return explicit;

  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Erro ao resolver organization_id padrão: ${error.message}`);
  if (!data?.id) {
    throw new Error(
      'Nenhuma organização encontrada. Defina SUPABASE_SEED_ORG_ID ou crie uma organização primeiro.',
    );
  }
  return data.id as string;
}

async function resolveUserId(): Promise<string> {
  const explicit = process.env.SUPABASE_SEED_USER_ID;
  if (explicit) return explicit;

  // Try owner_admin first via user_roles join, fall back to any profile.
  const { data: ownerData } = await supabase
    .from('user_roles')
    .select('user_id, roles!inner(slug)')
    .eq('roles.slug', 'owner_admin')
    .limit(1)
    .maybeSingle();
  const ownerId = (ownerData as { user_id?: string } | null)?.user_id;
  if (ownerId) return ownerId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('user_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Erro ao resolver created_by padrão: ${error.message}`);
  if (!profile?.user_id) {
    throw new Error(
      'Nenhum perfil encontrado. Defina SUPABASE_SEED_USER_ID ou crie um usuário primeiro.',
    );
  }
  return profile.user_id as string;
}

async function main() {
  const [orgId, userId] = await Promise.all([resolveOrgId(), resolveUserId()]);

  const projectsV2 = loadV2Projects(projects);
  const v2ById = new Map(projectsV2.map((project) => [project.id, project]));

  const rows = projects.map((project) => {
    const projectV2 = v2ById.get(project.id) || null;
    const clientLogoUrl = project.clientLogoUrl || projectV2?.clientLogoUrl || null;

    return {
      id: project.id,
      organization_id: orgId,
      created_by: userId,
      project: { ...project, clientLogoUrl: clientLogoUrl || undefined },
      project_v2: projectV2 ? { ...projectV2, clientLogoUrl: clientLogoUrl || undefined } : null,
      client_logo_url: clientLogoUrl,
    };
  });

  const { error } = await supabase.from('projects').upsert(rows, { onConflict: 'id' });

  if (error) {
    if (error.code === 'PGRST205') {
      throw new Error(
        'A tabela public.projects ainda nao existe. Aplique primeiro as migrations 004 e 008 no SQL Editor do Supabase.',
      );
    }
    throw new Error(`Erro ao migrar projetos para o Supabase: ${error.message}`);
  }

  console.log(
    `Migrados ${rows.length} projetos para o Supabase (organization_id=${orgId}, created_by=${userId}).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
