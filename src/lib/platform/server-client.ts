/**
 * Cliente de serviço da PLATAFORMA — server-only.
 *
 * `domain_events` e `apex_jobs` não concedem nada a `anon` nem a
 * `authenticated`: não há caminho de navegador para eles, por desenho. Quem
 * fala com essas tabelas é este módulo, pelo service role, depois que a rota já
 * decidiu a autorização.
 */
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';

if (typeof window !== 'undefined') {
  throw new Error('platform/server-client.ts não pode ser importado no navegador.');
}

let client: SupabaseClient | null = null;

export function platformServiceClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado no servidor.');
  client = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Somente para teste: descarta o cliente memoizado. */
export function __resetPlatformServiceClient(): void {
  client = null;
}
