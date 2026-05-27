import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiPermission('admin.manage_users');
  if (!guard.ok) return guard.response;

  const presence = (key: string) => {
    const value = process.env[key];
    if (!value) return { set: false, length: 0 };
    return { set: true, length: value.length, prefix: value.slice(0, 4) };
  };

  return NextResponse.json({
    ok: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: presence('NEXT_PUBLIC_SUPABASE_URL'),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: presence('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      SUPABASE_SERVICE_ROLE_KEY: presence('SUPABASE_SERVICE_ROLE_KEY'),
      ANTHROPIC_API_KEY: presence('ANTHROPIC_API_KEY'),
    },
    runtime: process.env.NEXT_RUNTIME ?? 'unknown',
    vercel_env: process.env.VERCEL_ENV ?? 'not-vercel',
  });
}
