export const CONFIG = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? '',
};

if (!CONFIG.supabaseUrl || !CONFIG.apiBaseUrl) {
  // eslint-disable-next-line no-console
  console.warn('[config] Defina EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY / _API_BASE_URL no .env');
}
