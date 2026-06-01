<script>
  // Pasek nawigacyjny — wyświetla logo, linki, status sesji i przyciski akcji.
  // Renderuje Panel Admina (OPERACYJNY), timer tokenu i modal logowania/profilu
  // w zależności od roli zalogowanego użytkownika.
  import { navigate } from 'svelte-routing';
  import { onMount, onDestroy } from 'svelte';
  import axios from 'axios';
  import { user, logout } from '../stores/auth';
  import LoginModal    from './LoginModal.svelte';
  import ProfileModal  from './ProfileModal.svelte';
  import AdminPanel    from '../pages/AdminPanel.svelte';

  let showLogin   = false;
  let showProfile = false;
  let showAdmin   = false;

  // ── Timer odliczający czas do wygaśnięcia JWT ────────────────────
  // Zmienia kolor: szary → żółty (< 2 min) → czerwony migający (< 1 min).
  let timeLeft = '';
  let timerClass = '';
  let timerInterval;

  // Oblicza pozostały czas sesji i ustawia klasę CSS dla koloru (normalny / warn / danger).
  // Wywoływana co sekundę — gdy ms <= 0 pokazuje 00:00 (nie ukrywa timera).
  function updateTimer() {
    const exp = $user?.expiresAt;
    if (!$user?.loggedIn || !exp) { timeLeft = ''; return; }
    const ms = exp - Date.now();
    if (ms <= 0) { timeLeft = '00:00'; timerClass = 'danger'; return; }
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    timeLeft   = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    timerClass = ms < 60_000 ? 'danger' : ms < 2 * 60_000 ? 'warn' : '';
  }

  onMount(() => { updateTimer(); timerInterval = setInterval(updateTimer, 1000); });
  onDestroy(() => clearInterval(timerInterval));  // zatrzymuje timer gdy navbar zniknie z DOM

  // Wysyła żądanie wylogowania do serwera (usuwa ciasteczko JWT), czyści store i przekierowuje.
  async function handleLogout() {
    await axios.post('/api/logout', {}, { withCredentials: true });
    logout();
    navigate('/');
  }
</script>

<nav class="nav-bar">
  <div class="nav-left">
    <span class="nav-logo"><span class="logo-dot">⬢</span> MONITOR KONFLIKTU W IRANIE</span>
    <div class="nav-links">
      <a href="/">Dashboard</a>
      <a href="#feed">Live Feed</a>
      <a href="#intel">Wywiad</a>
      <a href="#casualties">Straty</a>
      <a href="#kalkulator">Kalkulator</a>
    </div>
  </div>
  <div class="nav-right">
    <span class="nav-status">
      <span class="dot"></span><span>SYSTEM ONLINE</span>
    </span>
    {#if $user?.loggedIn}
      {#if $user?.role === 'OPERACYJNY'}
        <div class="admin-pill">
          <button class="btn-nav-admin" on:click={() => showAdmin = true}>⚠ PANEL ADMINA</button>
        </div>
      {/if}
      {#if timeLeft}
        <span class="token-timer {timerClass}">
          CZAS TRWANIA SESJI: {timeLeft}
        </span>
      {/if}
      <button class="btn-nav" style="color:var(--gold)" on:click={() => showProfile = true}>
        ▸ {$user.agent_id}
      </button>
      <button class="btn-nav" on:click={handleLogout}>⏻ WYLOGUJ</button>
    {:else}
      <button class="btn-nav" on:click={() => showLogin = true}>⬡ ZALOGUJ SIĘ</button>
    {/if}
  </div>
</nav>

{#if showLogin}
  <LoginModal onClose={() => showLogin = false} />
{/if}

{#if showProfile}
  <ProfileModal onClose={() => showProfile = false} />
{/if}

{#if showAdmin}
  <AdminPanel onClose={() => showAdmin = false} />
{/if}

<style>
  .logo-dot {
    color: #c0392b;
    animation: logo-pulse 2s ease-in-out infinite;
    display: inline-block;
  }

  @keyframes logo-pulse {
    0%   { opacity: 1; }
    50%  { opacity: 0.1; }
    100% { opacity: 1; }
  }

  .token-timer {
    font-family: var(--mono, monospace);
    font-size: 10px;
    letter-spacing: .18em;
    color: #bbb;
    transition: color .3s, border-color .3s;
    border: 1px solid #555;
    padding: 4px 10px;
  }
  .token-timer.warn   { color: #d4a017; border-color: #d4a01766; }
  .token-timer.danger { color: #c0392b; border-color: #c0392b66; animation: timer-blink .6s step-end infinite; }

  @keyframes timer-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }

  .admin-pill {
    border: 1px solid #3a1a1a;
    padding: 2px 4px;
    display: flex;
    align-items: center;
  }

  .btn-nav-admin {
    background: none;
    border: none;
    color: var(--red-bright, #c0392b);
    font-family: inherit;
    font-size: 11px;
    letter-spacing: .1em;
    cursor: pointer;
    padding: 2px 6px;
    opacity: .85;
    transition: opacity .15s;
  }
  .btn-nav-admin:hover {
    opacity: 1;
  }
</style>
