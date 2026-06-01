// Globalny store sesji i konfiguracja axios — jedyne miejsce zarządzające stanem uwierzytelnienia.
// Wszystkie komponenty importują stąd `user`, `login`, `logout`, `initAuth`, `refreshSession`.
import { writable } from 'svelte/store';
import axios from 'axios';

// Reaktywny store Svelte — trzyma rolę, ID agenta i czas wygaśnięcia JWT.
// Każdy komponent może subskrybować ($user) i reagować na zmiany bez prop drilling.
export const user = writable({ role: null, agent_id: null, loggedIn: false, expiresAt: null });

// Wylogowuje użytkownika lokalnie (czyści store) i wysyła żądanie DELETE ciasteczka JWT do serwera.
// Błąd HTTP ignorowany — stan lokalny zawsze resetowany niezależnie od odpowiedzi.
export function logout() {
  user.set({ role: null, agent_id: null, loggedIn: false });
  axios.post('/api/logout', {}, { withCredentials: true }).catch(() => {});
}

// ── Interceptor żądań: dołącza token CSRF ───────────────────────────────────
// Anti-CSRF (double-submit): przy każdym żądaniu axios odczytuje csrf_token
// z ciasteczka i wstawia go jako nagłówek X-CSRF-Token.
// Serwer porównuje nagłówek z ciasteczkiem — niezgodność = błąd 403.
// Ciasteczko jest nie-HttpOnly, więc JS może je odczytać; obca domena nie może
// (Same-Origin Policy), więc nie jest w stanie podrobić nagłówka.
function readCookie(name) {
  return document.cookie
    .split('; ')
    .find(row => row.startsWith(name + '='))
    ?.split('=')[1];
}
// Dodaje nagłówek X-CSRF-Token do każdego wychodzącego żądania axios.
axios.interceptors.request.use(cfg => {
  const csrf = readCookie('csrf_token');
  if (csrf) cfg.headers['X-CSRF-Token'] = csrf;
  return cfg;
});

// ── Interceptor odpowiedzi: obsługa błędów auth ──────────────────────────────
// 401 z dowolnego chronionego endpointu → automatyczne wylogowanie i przekierowanie na /.
// Wyjątek: endpointy auth (/api/me, /api/login itp.) — tam 401 jest oczekiwany (np. nie zalogowany).
// 403 z flagą requires2FA → przekierowanie na /?need2fa=1 (wymuszenie konfiguracji TOTP).
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

// Sprawdza przy starcie aplikacji czy ciasteczko JWT jest ważne (GET /api/me).
// Jeśli tak — uzupełnia store danymi sesji. Błąd jest ignorowany (użytkownik niezalogowany).
export async function initAuth() {
  try {
    const { data } = await axios.get('/api/me', { withCredentials: true });
    user.set({ role: data.role, agent_id: data.agent_id, loggedIn: true, expiresAt: data.expiresAt });
  } catch {}
}

// Ustawia stan zalogowania po pomyślnym logowaniu lub weryfikacji 2FA.
// Wywoływane z LoginModal po odpowiedzi z /api/login lub /api/2fa/login.
export function login(data) {
  user.set({ role: data.role, agent_id: data.agent_id, loggedIn: true,
    expiresAt: data.expiresAt ?? null });
}

// Odświeża token JWT przed jego wygaśnięciem (wywołuje /api/refresh).
// Aktualizuje tylko expiresAt w store — rola i agent_id pozostają niezmienione.
// Wywoływane przez SessionWarning gdy pozostało < 2 minuty sesji.
export async function refreshSession() {
  const { data } = await axios.post('/api/refresh', {}, { withCredentials: true });
  user.update(u => ({ ...u, expiresAt: data.expiresAt }));
}
