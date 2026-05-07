import 'dotenv/config';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { projects } from '../src/lib/mock-data';
import { loadV2Projects } from '../src/lib/services/project-migration';

config({ path: '.env.local', override: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY em .env.local.');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const projectsV2 = loadV2Projects(projects);
const v2ById = new Map(projectsV2.map((project) => [project.id, project]));

const rows = projects.map((project) => {
  const projectV2 = v2ById.get(project.id) || null;
  const clientLogoUrl = project.clientLogoUrl || projectV2?.clientLogoUrl || null;

  return {
    id: project.id,
    project: { ...project, clientLogoUrl: clientLogoUrl || undefined },
    project_v2: projectV2 ? { ...projectV2, clientLogoUrl: clientLogoUrl || undefined } : null,
    client_logo_url: clientLogoUrl,
  };
});

async function main() {
  const { error } = await supabase.from('projects').upsert(rows, { onConflict: 'id' });

  if (error) {
    if (error.code === 'PGRST205') {
      throw new Error(
        'A tabela public.projects ainda nao existe. Aplique primeiro supabase/migrations/004_projects_supabase_storage.sql no SQL Editor do Supabase.',
      );
    }
    throw new Error(`Erro ao migrar projetos para o Supabase: ${error.message}`);
  }

  console.log(`Migrados ${rows.length} projetos para o Supabase.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
