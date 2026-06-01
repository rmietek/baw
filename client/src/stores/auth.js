import { writable } from 'svelte/store';
import axios from 'axios';

export const user = writable({ role: null, agent_id: null, loggedIn: false, expiresAt: null });

export function logout() {
  user.set({ role: null, agent_id: null, loggedIn: false });
  axios.post('/api/logout', {}, { withCredentials: true }).catch(() => {});
}

// Anti-CSRF (double-submit): doklej token z ciasteczka csrf_token do nagłówka
// X-CSRF-Token przy każdym żądaniu. Serwer porówna nagłówek z ciasteczkiem.
function readCookie(name) {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith(name + '='))
    ?.split('=')[1];
}
axios.interceptors.request.use(cfg => {
  const csrf = readCookie('csrf_token');
  if (csrf) cfg.headers['X-CSRF-Token'] = csrf;
  return cfg;
});

// globalny interceptor – każdy 401 z API automatycznie wylogowuje
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const url = err.config?.url || '';
      const authEndpoints = ['/api/me', '/api/login', '/api/register', '/api/2fa/', '/api/reset-password/'];
      if (!authEndpoints.some(e => url.includes(e))) {
        logout();
        if (typeof window !== 'undefined') window.location.href = '/';
      }
    }
    if (err.response?.status === 403 && err.response?.data?.requires2FA) {
      if (typeof window !== 'undefined') window.location.href = '/?need2fa=1';
    }
    return Promise.reject(err);
  }
);

export async function initAuth() {
  try {
    const { data } = await axios.get('/api/me', { withCredentials: true });
    user.set({ role: data.role, agent_id: data.agent_id, loggedIn: true, expiresAt: data.expiresAt });
  } catch {}
}

export function login(data) {
  user.set({ role: data.role, agent_id: data.agent_id, loggedIn: true,
    expiresAt: data.expiresAt ?? null });
}

export async function refreshSession() {
  const { data } = await axios.post('/api/refresh', {}, { withCredentials: true });
  user.update(u => ({ ...u, expiresAt: data.expiresAt }));
}
