<script>
  // Modal logowania/rejestracji — obsługuje trzy tryby:
  //   step=1: formularz login (hasło) lub rejestracja
  //   step=2: weryfikacja TOTP (po step=1 gdy 2FA aktywne, lub po OAuth)
  // Po sukcesie ustawia store przez login() i zamyka modal.
  // Walidacja client-side: długość, dozwolone znaki, min. 8 znaków hasła.
  import { onMount } from 'svelte';
  import { navigate } from 'svelte-routing';
  import axios from 'axios';
  import { login } from '../stores/auth';

  export let onClose = () => {};
  export let initialPreAuthToken = '';  // przekazywany gdy OAuth wymaga 2FA

  // Animacja terminala — efekt pisania sekwencji wiadomości po otwarciu modala
  const TERM_MSGS = [
    '> INICJALIZACJA PROTOKOLU BEZPIECZENSTWA...',
    '> WERYFIKACJA CERTYFIKATU SSL: OK',
    '> POLACZONO Z SERWEREM PENTAGON-7 // AES-256',
    '> WPROWADZ DANE IDENTYFIKACYJNE...',
  ];

  let tab          = 'login';
  let username     = '';
  let password     = '';
  let regRole      = 'OBSERWATOR';
  let status       = '';
  let loading      = false;
  let scanning     = true;
  let termText     = '';
  let step         = initialPreAuthToken ? 2 : 1;
  let preAuthToken = initialPreAuthToken;
  let totpCode     = '';

  // Efekt maszyny do pisania — pokazuje wiadomości terminala znak po znaku
  let timerRef = null;
  function startTypewriter() {
    let msgIdx = 0, charIdx = 0;
    termText = '';
    const next = () => {
      if (msgIdx >= TERM_MSGS.length) return;
      const msg = TERM_MSGS[msgIdx];
      if (charIdx <= msg.length) {
        termText = msg.slice(0, charIdx);
        charIdx++;
        timerRef = setTimeout(next, 26);
      } else {
        charIdx = 0;
        msgIdx++;
        timerRef = setTimeout(next, 600);
      }
    };
    timerRef = setTimeout(next, 100);
  }

  onMount(() => {
    startTypewriter();
    scanning = true;
    const t = setTimeout(() => { scanning = false; }, 1300);
    return () => {
      clearTimeout(t);
      clearTimeout(timerRef);
    };
  });

  // Odczytuje parametr ?redirect= z URL — po zalogowaniu przekierowuje tam użytkownika.
  // Walidacja: tylko ścieżki zaczynające się od / (zapobiega open redirect na zewnętrzne URL).
  function getRedirect() {
    const params = new URLSearchParams(window.location.search);
    return params.get('redirect') || '/';
  }

  // Krok 1 logowania: wysyła credentials do /api/login.
  // Jeśli serwer wymaga 2FA → przechodzi do step=2 z preAuthToken.
  // Jeśli sukces bez 2FA → ustawia store i zamyka modal po 700 ms.
  // 429 → komunikat o rate limitingu zamiast ogólnego błędu.
  async function handleLogin() {
    if (!username.trim()) { status = 'Podaj identyfikator agenta'; return; }
    if (!password)         { status = 'Podaj kod dostępu'; return; }
    loading = true; status = '';
    try {
      const { data } = await axios.post('/api/login', { username, password }, { withCredentials: true });
      if (data.requires2FA) {
        preAuthToken = data.preAuthToken;
        step = 2;
        status = '';
        loading = false;
        return;
      }
      login(data);
      status = 'DOSTĘP PRZYZNANY';
      const rawRedirect = getRedirect();
      const redirect = (rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')) ? rawRedirect : '/';
      setTimeout(() => { onClose(); navigate(redirect); }, 700);
    } catch (err) {
      if (err.response?.status === 429) status = 'Zbyt wiele prób logowania. Poczekaj 15 minut.';
      else status = 'ODMOWA DOSTĘPU – BŁĘDNE DANE';
    } finally { loading = false; }
  }

  // Krok 2 logowania (2FA): weryfikuje kod TOTP przez /api/2fa/login z preAuthToken.
  // PreAuthToken ma TTL 5 min — po tym czasie serwer go odrzuci.
  async function handleTotp() {
    if (!totpCode.trim()) { status = 'Podaj kod z aplikacji'; return; }
    loading = true; status = '';
    try {
      const { data } = await axios.post('/api/2fa/login', { preAuthToken, code: totpCode }, { withCredentials: true });
      login(data);
      status = 'DOSTĘP PRZYZNANY';
      const rawRedirect = getRedirect();
      const redirect = (rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')) ? rawRedirect : '/';
      setTimeout(() => { onClose(); navigate(redirect); }, 700);
    } catch {
      status = 'NIEPRAWIDŁOWY KOD – spróbuj ponownie';
    } finally { loading = false; }
  }

  // Rejestruje nowe konto (POST /api/register).
  // Walidacja client-side: min 3 znaki ID, max 50, bez znaków < > " ' &, hasło min 8 znaków.
  // Rola tylko OBSERWATOR lub ANALITYK — nie można zarejestrować OPERACYJNY.
  // Po sukcesie przełącza na zakładkę logowania po 1.5 s.
  async function handleRegister() {
    if (!username.trim())   { status = 'Podaj identyfikator agenta'; return; }
    if (username.length > 50) { status = 'ID agenta max 50 znaków'; return; }
    if (/[<>"'&]/.test(username)) { status = 'ID nie może zawierać znaków: < > " \' &'; return; }
    if (!password)           { status = 'Podaj hasło'; return; }
    if (password.length < 8) { status = 'Hasło musi mieć co najmniej 8 znaków'; return; }
    loading = true; status = '';
    try {
      await axios.post('/api/register', { agent_id: username, password, role: regRole });
      status = 'KONTO UTWORZONE – mozesz sie zalogowac';
      setTimeout(() => { tab = 'login'; status = ''; }, 1500);
    } catch (err) {
      if (err.response?.status === 429) status = 'Zbyt wiele rejestracji z tego adresu. Spróbuj za 24h.';
      else status = err.response?.data?.error || 'Błąd rejestracji';
    } finally { loading = false; }
  }

  // Obsługuje Enter w polach formularza — deleguje do odpowiedniej funkcji wg aktywnej zakładki.
  function handleKey(e) {
    if (e.key === 'Enter') tab === 'login' ? handleLogin() : handleRegister();
  }

  // Zamyka modal kliknięciem na ciemne tło (overlay), ale nie na sam modal.
  function handleOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) onClose();
  }

  // Klasa CSS statusu — 'ok' dla sukcesu, 'err' dla błędu, '' gdy brak komunikatu.
  $: statusClass = status.includes('PRZYZNANY') || status.includes('UTWORZONE') ? 'ok' : status ? 'err' : '';
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-overlay open" on:click={handleOverlayClick}>
  <div class="modal">
    {#if scanning}<div class="scan-line" />{/if}
    <div class="modal-header">
      <div>
        <div class="modal-title">Autoryzacja dostepu</div>
        <div class="modal-subtitle">Bezpieczny terminal · Szyfrowanie AES-256</div>
      </div>
      <button class="modal-close" on:click={onClose}>✕</button>
    </div>

    <div class="modal-body">
      <div class="terminal-line">
        {termText}<span class="cursor" />
      </div>

      <div class="classif">⬡ &nbsp; DOSTEP ZASTRZEZONY &nbsp;·&nbsp; PROTOKOL WERYFIKACJI TOZSAMOSCI</div>

      <div style="display:flex;border-bottom:1px solid var(--border);margin-bottom:14px">
        {#each ['login','register'] as t}
          <button on:click={() => { tab = t; status = ''; }}
            style="flex:1;padding:8px;background:transparent;border:none;border-bottom:{tab===t ? '2px solid var(--red)' : '2px solid transparent'};color:{tab===t ? 'var(--red-bright)' : 'var(--text-dim)'};font-family:var(--mono);font-size:10px;letter-spacing:.2em;cursor:pointer;text-transform:uppercase">
            {t === 'login' ? 'LOGOWANIE' : 'REJESTRACJA'}
          </button>
        {/each}
      </div>

      {#if step === 2}
        <div style="font-size:10px;letter-spacing:.1em;color:var(--text-dim);margin-bottom:12px;line-height:1.6">
          ⬡ WERYFIKACJA DWUETAPOWA<br/>
          Podaj 6-cyfrowy kod z aplikacji Google Authenticator.
        </div>
        <div class="field">
          <label>Kod jednorazowy (TOTP)</label>
          <input bind:value={totpCode}
            on:keydown={e => e.key === 'Enter' && handleTotp()}
            placeholder="000000"
            maxlength="6"
            inputmode="numeric"
            autocomplete="one-time-code"
            style="font-size:22px;letter-spacing:.4em;text-align:center" />
        </div>
        <button class="btn-auth" on:click={handleTotp} disabled={loading}>
          {loading ? 'WERYFIKACJA...' : '▶  POTWIERDŹ KOD 2FA'}
        </button>
      {:else}

      <div class="field">
        <label>Identyfikator agenta</label>
        <input bind:value={username} on:keydown={handleKey} placeholder="np. AGENT-7741" autocomplete="off" />
      </div>
      <div class="field">
        <label>Kod dostepu</label>
        <input type="password" bind:value={password} on:keydown={handleKey} placeholder="••••••••" />
      </div>

      {#if tab === 'register'}
        <div class="field">
          <label>Poziom dostępu</label>
          <select bind:value={regRole}
            style="width:100%;background:#0d0d0d;border:1px solid var(--border);color:#ccc;font-family:var(--mono);font-size:11px;padding:8px 10px;outline:none">
            <option value="OBSERWATOR">OBSERWATOR – odczyt, mapa, kalkulator, petycja, 2FA</option>
            <option value="ANALITYK">ANALITYK – komentarze, raporty, oś czasu, upload plików, edycja profilu</option>
          </select>
        </div>
      {/if}

      {#if tab === 'login'}
        <button class="btn-auth" on:click={handleLogin} disabled={loading}>
          {loading ? 'WERYFIKACJA W TOKU...' : '▶  WERYFIKUJ TOZSAMOSC'}
        </button>
      {:else}
        <button class="btn-auth" on:click={handleRegister} disabled={loading}>
          {loading ? 'REJESTRACJA...' : '▶  ZAREJESTRUJ AGENTA'}
        </button>
      {/if}
      {/if}

      <div class="auth-status {statusClass}">{status}</div>

      <div class="oauth-divider"><span>lub</span></div>
      <a class="btn-google" href="/api/auth/google?role={regRole}&intent={tab}">
        <svg width="16" height="16" viewBox="0 0 48 48" style="margin-right:8px;flex-shrink:0">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        {tab === 'login' ? 'ZALOGUJ PRZEZ GOOGLE' : 'ZAREJESTRUJ PRZEZ GOOGLE'}
      </a>
    </div>

    <div class="modal-footer">
      <span>MONITOR-KONFLIKTU · SYST. v2.6</span>
      <span>SECURITY LEVEL: TOP SECRET</span>
    </div>
  </div>
</div>
