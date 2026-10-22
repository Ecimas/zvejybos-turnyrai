import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { createDemoBackend } from './demo.js';

export async function createBackend() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createSupabaseBackend } = await import('./supabase.js');
    return createSupabaseBackend(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return createDemoBackend();
}
