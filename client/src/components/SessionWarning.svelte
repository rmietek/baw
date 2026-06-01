<script>
  import { onMount, onDestroy } from 'svelte';
  import { user, logout, refreshSession } from '../stores/auth';

  const WARN_MS    = 2 * 60 * 1000;  // pokaż ostrzeżenie 2 min przed wygaśnięciem
  const TICK_MS    = 5_000;           // sprawdzaj co 5 sekund

  let show      = false;
  let minsLeft  = 5;
  let extending = false;
  let interval;

  function check() {
    const exp = $user.expiresAt;
    if (!$user.loggedIn || !exp) { show = false; return; }
    const remaining = exp - Date.now();
    if (remaining <= 0) { logout(); return; }
    minsLeft = Math.ceil(remaining / 60_000);
    show = remaining <= WARN_MS;
  }

  async function extend() {
    extending = true;
    try {
      await refreshSession();
      show = false;
    } catch {
      logout();
    } finally {
      extending = false;
    }
  }

  onMount(() => { check(); interval = setInterval(check, TICK_MS); });
  onDestroy(() => clearInterval(interval));
</script>

{#if show}
  <div class="session-overlay">
    <div class="session-modal">
      <div class="session-icon">⚠</div>
      <div class="session-title">Sesja wygasa</div>
      <div class="session-body">
        Twoja sesja wygaśnie za <strong>{minsLeft} {minsLeft === 1 ? 'minutę' : 'minut'}</strong>.<br/>
        Czy chcesz ją przedłużyć?
      </div>
      <div class="session-actions">
        <button class="session-btn-extend" on:click={extend} disabled={extending}>
          {extending ? 'Przedłużanie...' : '✓ Przedłuż sesję'}
        </button>
        <button class="session-btn-logout" on:click={logout}>
          Wyloguj
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .session-overlay {
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(0,0,0,.65);
    display: flex; align-items: center; justify-content: center;
  }
  .session-modal {
    background: #0d1117; border: 1px solid #d4a017;
    border-left: 3px solid #d4a017;
    padding: 28px 32px; max-width: 360px; width: 90%;
    font-family: var(--mono); text-align: center;
  }
  .session-icon { font-size: 28px; margin-bottom: 10px; }
  .session-title {
    font-family: var(--display); font-size: 14px;
    letter-spacing: .3em; text-transform: uppercase;
    color: #d4a017; margin-bottom: 14px;
  }
  .session-body {
    font-size: 11px; color: #aaa; line-height: 1.7;
    letter-spacing: .05em; margin-bottom: 20px;
  }
  .session-body strong { color: #d4a017; }
  .session-actions { display: flex; gap: 10px; justify-content: center; }
  .session-btn-extend {
    background: #d4a017; color: #000; border: none;
    font-family: var(--mono); font-size: 10px;
    letter-spacing: .15em; padding: 8px 18px; cursor: pointer;
  }
  .session-btn-extend:disabled { opacity: .5; cursor: not-allowed; }
  .session-btn-extend:hover:not(:disabled) { background: #e8b520; }
  .session-btn-logout {
    background: transparent; color: #888;
    border: 1px solid #444; font-family: var(--mono);
    font-size: 10px; letter-spacing: .15em;
    padding: 8px 18px; cursor: pointer;
  }
  .session-btn-logout:hover { border-color: var(--red-dim); color: var(--red-bright); }
</style>
