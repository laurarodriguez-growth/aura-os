const raw = window.AURA_CONFIG || {};

export const appConfig = {
  supabaseUrl: String(raw.SUPABASE_URL || '').trim(),
  supabasePublishableKey: String(raw.SUPABASE_PUBLISHABLE_KEY || '').trim(),
  apiBaseUrl: String(raw.API_BASE_URL || '').replace(/\/$/, '').trim(),
};

export function configProblems() {
  const problems = [];
  if (!appConfig.supabaseUrl || appConfig.supabaseUrl.includes('PEGA_AQUI')) {
    problems.push('Falta SUPABASE_URL en frontend/public/config.js');
  }
  if (!appConfig.supabasePublishableKey || appConfig.supabasePublishableKey.includes('PEGA_AQUI')) {
    problems.push('Falta SUPABASE_PUBLISHABLE_KEY en frontend/public/config.js');
  }
  if (!appConfig.apiBaseUrl || appConfig.apiBaseUrl.includes('PEGA_AQUI')) {
    problems.push('Falta API_BASE_URL en frontend/public/config.js');
  }
  return problems;
}
