/**
 * Lazy server-only clients shared by the AI risk scanners. Throws a friendly
 * error if ANTHROPIC_API_KEY or SUPABASE_SERVICE_ROLE_KEY is missing — that
 * propagates as a 500 with a readable body in the route handler.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/server-clients.ts must not be imported in the browser');
}

import Anthropic from '@anthropic-ai/sdk';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';

export const AI_MODEL = 'claude-sonnet-4-6' as const;

let _anthropic: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY não está configurado. Adicione-o em .env / .env.local antes de disparar a análise IA.',
    );
  }
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

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
