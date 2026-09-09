/**
 * Lazy server-only Supabase service client shared by AI persistence modules.
 * Provider clients live exclusively inside Apex AI Gateway adapters.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/server-clients.ts must not be imported in the browser');
}

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';

export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL não está configurado');
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY não está configurado. A análise IA precisa do service-role para bypass de RLS.',
    );
  }
  return createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
