import { appConfig } from './config';
import { getSupabase } from './supabase';

async function accessToken() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('Tu sesión terminó. Inicia sesión nuevamente.');
  return token;
}

export async function api(path, options = {}) {
  const token = await accessToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' ? payload.detail : payload;
    throw new Error(message || `Error ${response.status}`);
  }
  return payload;
}

export async function downloadExport(path, fallbackFilename = 'aura-grow-export.csv') {
  const token = await accessToken();
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Ignore parsing error.
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const basicMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const filename = utf8Match?.[1]
    ? decodeURIComponent(utf8Match[1])
    : (basicMatch?.[1] || fallbackFilename);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
