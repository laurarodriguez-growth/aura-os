import { createClient } from '@supabase/supabase-js';
import { appConfig, configProblems } from './config';

let client = null;

export function getSupabase() {
  if (client) return client;
  const problems = configProblems();
  if (problems.length) {
    throw new Error(problems.join(' · '));
  }
  client = createClient(appConfig.supabaseUrl, appConfig.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}
