import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { createDemoBackend } from './demo.js';

export async function createBackend() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const [{ createSupabaseBackend }, { withOffline }] = await Promise.all([import('./supabase.js'), import('../lib/offline.js')]);
    return withOffline(await createSupabaseBackend(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return createDemoBackend();
}
