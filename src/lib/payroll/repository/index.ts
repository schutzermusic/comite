/**
 * Server-side payroll repository factory. SERVER ONLY — imports the Supabase
 * service client. Mode is chosen by PAYROLL_CLOSING_REPOSITORY_MODE
 * ('mock' | 'supabase'); defaults to 'mock' so the app runs without a DB.
 */

import type { PayrollRepository, PayrollRepositoryMode } from './types';
import { InMemoryServerRepository } from './in-memory-server';
import { SupabasePayrollRepository } from './supabase';

export * from './types';

export function getRepositoryMode(): PayrollRepositoryMode {
  return process.env.PAYROLL_CLOSING_REPOSITORY_MODE === 'supabase' ? 'supabase' : 'mock';
}

let _instance: PayrollRepository | null = null;

export function getServerRepository(): PayrollRepository {
  if (_instance) return _instance;
  // SupabasePayrollRepository only constructs the service client when used,
  // so importing it in mock mode is harmless.
  _instance = getRepositoryMode() === 'supabase'
    ? new SupabasePayrollRepository()
    : new InMemoryServerRepository();
  return _instance;
}
