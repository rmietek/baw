<script>
  // Modal profilu agenta — trzy sekcje: dane profilu, zmiana hasła, konfiguracja 2FA.
  // Edycja dostępna dla ANALITYK+ (OBSERWATOR ma dostęp tylko do odczytu).
  // 2FA: sekwencja setup → weryfikacja kodu → aktywacja (lub dezaktywacja z potwierdzeniem).
  import { onMount } from 'svelte';
  import axios from 'axios';

  export let onClose = () => {};

  let profile = {};
  let form    = { bio: '', income: '' };
  let savedProfile = false;
  let saveErr = '';

  $: canEdit = profile.role === 'ANALITYK' || profile.role === 'OPERACYJNY';

  let pwForm  = { old_password: '', new_password: '', confirm: '' };
  let pwMsg   = '';
  let pwOk    = false;

  // Stan maszyny 2FA: idle → setup (QR) → verify (kod) → powrót do idle
  // Dezaktywacja: idle → disabling (wymaga kodu) → idle
  let tfaStep   = 'idle';
  let qrDataUrl = '';
  let tfaCode   = '';
  let tfaMsg    = '';

  onMount(async () => {
    try {
      const { data } = await axios.get('/api/profile', { withCredentials: true });
      profile = data;
      form = { bio: data.bio || '', income: data.income || '' };
    } catch {}
  });

  // Zapisuje bio i dochód (PUT /api/profile). Allowlisting po stronie serwera —
  // przesyłane są tylko dozwolone pola, nie można przez to zmienić roli.
  async function saveProfile() {
    saveErr = '';
    try {
      await axios.put('/api/profile', { bio: form.bio, income: form.income }, { withCredentials: true });
      savedProfile = true;
      setTimeout(() => savedProfile = false, 2000);
    } catch (e) {
      saveErr = e.response?.data?.error || 'Nie udało się zapisać profilu';
    }
  }

  // Zmienia hasło (PUT /api/profile/password). Walidacja client-side:
  // obecne hasło wymagane, nowe min. 8 znaków, oba pola muszą być zgodne.
  async function changePassword() {
    pwMsg = ''; pwOk = false;
    if (!pwForm.old_password) { pwMsg = 'Podaj obecne hasło'; return; }
    if (!pwForm.new_password || pwForm.new_password.length < 8) { pwMsg = 'Nowe hasło musi mieć co najmniej 8 znaków'; return; }
    if (pwForm.new_password !== pwForm.confirm) { pwMsg = 'Hasła nie są zgodne'; return; }
    try {
      await axios.put('/api/profile/password', {
        old_password: pwForm.old_password,
        new_password: pwForm.new_password
      }, { withCredentials: true });
      pwOk = true;
      pwMsg = '✓ Hasło zostało zmienione';
      pwForm = { old_password: '', new_password: '', confirm: '' };
    } catch (e) { pwMsg = e.response?.data?.error || 'Błąd zmiany hasła'; }
  }

  // Krok 1 konfiguracji 2FA: generuje sekret TOTP i pobiera QR kod jako data URL.
  // Po wywołaniu tfaStep = 'verify' — użytkownik skanuje QR i wpisuje kod.
  async function setup2FA() {
    tfaMsg = '';
    try {
      const { data } = await axios.post('/api/2fa/setup', {}, { withCredentials: true });
      qrDataUrl = data.qrDataUrl;
      tfaStep = 'verify';
    } catch { tfaMsg = 'Błąd generowania kodu QR'; }
  }

  // Krok 2 konfiguracji 2FA: aktywuje 2FA po zweryfikowaniu pierwszego kodu TOTP.
  // Dopiero po enable serwer oznacza totp_enabled=true — sam setup nie aktywuje.
  async function enable2FA() {
    tfaMsg = '';
    try {
      await axios.post('/api/2fa/enable', { code: tfaCode }, { withCredentials: true });
      profile = { ...profile, totp_enabled: true };
      tfaStep = 'idle'; tfaCode = '';
      tfaMsg = '✓ 2FA aktywowane';
    } catch (e) { tfaMsg = e.response?.data?.error || 'Nieprawidłowy kod'; }
  }

  // Dezaktywuje 2FA — wymaga podania aktualnego kodu z aplikacji jako potwierdzenie.
  // Po sukcesie zeruje totp_secret i totp_enabled w bazie.
  async function disable2FA() {
    tfaMsg = '';
    try {
      await axios.post('/api/2fa/disable', { code: tfaCode }, { withCredentials: true });
      profile = { ...profile, totp_enabled: false };
      tfaStep = 'idle'; tfaCode = '';
      tfaMsg = '✓ 2FA wyłączone';
    } catch (e) { tfaMsg = e.response?.data?.error || 'Nieprawidłowy kod'; }
  }

  // Zamyka modal kliknięciem poza jego obszarem (na ciemne tło overlay).
  function handleOverlayClick(e) {
    if (e.target.classList.contains('modal-overlay')) onClose();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="modal-overlay open" on:click={handleOverlayClick}>
  <div class="modal profile-modal">

    <div class="modal-header">
      <div>
        <div class="modal-title">Profil agenta</div>
        <div class="modal-subtitle">{profile.agent_id || ''} · {profile.role || ''}</div>
      </div>
      <button class="modal-close" on:click={onClose}>✕</button>
    </div>

    <div class="modal-body" style="padding:0">

      <!-- DANE PROFILU -->
      <div class="prof-section">
        <div class="prof-section-title">◉ Dane profilu</div>
        <div class="calc-row">
          <div class="calc-field">
            <label>ID Agenta</label>
            <input value={profile.agent_id || ''} disabled style="opacity:.4" />
          </div>
          <div class="calc-field">
            <label>Rola</label>
            <input value={profile.role || ''} disabled style="opacity:.4" />
          </div>
        </div>
        {#if canEdit}
          <div class="calc-row">
            <div class="calc-field" style="flex:2">
              <label>Bio</label>
              <input bind:value={form.bio} placeholder="Opis agenta..." />
            </div>
            <div class="calc-field">
              <label>Roczny dochód (USD)</label>
              <input type="number" bind:value={form.income} />
            </div>
          </div>
          <button class="btn-calc" on:click={saveProfile}>
            {savedProfile ? '✓ ZAPISANO' : '▶ ZAPISZ PROFIL'}
          </button>
          {#if saveErr}
            <div style="margin-top:8px;font-size:10px;letter-spacing:.08em;color:var(--red-bright)">{saveErr}</div>
          {/if}
        {:else}
          <div style="font-size:11px;color:#666;letter-spacing:.07em;line-height:1.7;margin-top:4px">
            Rola OBSERWATOR ma dostęp tylko do odczytu. Edycja profilu wymaga roli ANALITYK lub wyższej.
          </div>
        {/if}
      </div>

      <!-- ZMIANA HASŁA -->
      {#if canEdit}
      <div class="prof-section">
        <div class="prof-section-title">◉ Zmiana hasła</div>
        <div class="calc-row">
          <div class="calc-field">
            <label>Obecne hasło</label>
            <input type="password" bind:value={pwForm.old_password}
              placeholder="••••••••"
              on:keydown={e => e.key === 'Enter' && changePassword()} />
          </div>
          <div class="calc-field">
            <label>Nowe hasło</label>
            <input type="password" bind:value={pwForm.new_password}
              placeholder="min. 8 znaków"
              on:keydown={e => e.key === 'Enter' && changePassword()} />
          </div>
          <div class="calc-field">
            <label>Potwierdź hasło</label>
            <input type="password" bind:value={pwForm.confirm}
              placeholder="••••••••"
              on:keydown={e => e.key === 'Enter' && changePassword()} />
          </div>
          <button class="btn-calc" style="align-self:flex-end" on:click={changePassword}>
            ▶ ZMIEŃ
          </button>
        </div>
        {#if pwMsg}
          <div style="font-size:10px;letter-spacing:.08em;margin-top:6px;color:{pwOk ? 'var(--green)' : 'var(--red-bright)'}">
            {pwMsg}
          </div>
        {/if}
      </div>
      {/if}

      <!-- 2FA -->
      <div class="prof-section" style="border-bottom:none">
        <div class="prof-section-title">◉ Weryfikacja dwuetapowa (2FA)</div>

        {#if profile.totp_enabled}
          <div style="color:var(--green);font-size:11px;letter-spacing:.1em;margin-bottom:12px">● 2FA AKTYWNE</div>
          {#if tfaStep === 'disabling'}
            <div class="calc-row">
              <div class="calc-field" style="flex:1">
                <label>Kod TOTP</label>
                <input bind:value={tfaCode} maxlength="6" inputmode="numeric"
                  placeholder="000000"
                  style="font-size:18px;letter-spacing:.3em;text-align:center"
                  on:keydown={e => e.key === 'Enter' && disable2FA()} />
              </div>
              <button class="btn-calc" style="border-color:var(--red-dim);color:var(--red-bright);align-self:flex-end" on:click={disable2FA}>▶ WYŁĄCZ</button>
              <button class="btn-calc" style="border-color:#555;color:#aaa;align-self:flex-end" on:click={() => { tfaStep='idle'; tfaCode=''; tfaMsg=''; }}>ANULUJ</button>
            </div>
          {:else}
            <button class="btn-calc" style="border-color:#555;color:#aaa" on:click={() => { tfaStep='disabling'; tfaMsg=''; }}>✕ WYŁĄCZ 2FA</button>
          {/if}
        {:else}
          <div style="color:#666;font-size:11px;letter-spacing:.1em;margin-bottom:12px">○ 2FA NIEAKTYWNE</div>
          {#if tfaStep === 'verify'}
            <div style="font-size:10px;color:var(--text-dim);margin-bottom:12px;letter-spacing:.07em;line-height:1.7">
              Zeskanuj kod QR aplikacją <strong style="color:#ccc">Google Authenticator</strong>,
              następnie wpisz 6-cyfrowy kod aby potwierdzić aktywację.
            </div>
            <div style="text-align:center;margin-bottom:14px">
              <img src={qrDataUrl} alt="QR 2FA" style="width:160px;height:160px;border:4px solid #222" />
            </div>
            <div class="calc-row">
              <div class="calc-field" style="flex:1">
                <label>Kod weryfikacyjny</label>
                <input bind:value={tfaCode} maxlength="6" inputmode="numeric"
                  placeholder="000000"
                  style="font-size:18px;letter-spacing:.3em;text-align:center"
                  on:keydown={e => e.key === 'Enter' && enable2FA()} />
              </div>
              <button class="btn-calc" style="align-self:flex-end" on:click={enable2FA}>▶ AKTYWUJ</button>
              <button class="btn-calc" style="border-color:#555;color:#aaa;align-self:flex-end"
                on:click={() => { tfaStep='idle'; tfaCode=''; tfaMsg=''; }}>ANULUJ</button>
            </div>
          {:else}
            <button class="btn-calc" on:click={setup2FA}>▶ SKONFIGURUJ 2FA</button>
          {/if}
        {/if}

        {#if tfaMsg}
          <div style="margin-top:10px;font-size:10px;letter-spacing:.1em;color:{tfaMsg.startsWith('✓') ? 'var(--green)' : 'var(--red-bright)'}">
            {tfaMsg}
          </div>
        {/if}
      </div>

    </div>

    <div class="modal-footer">
      <span>MONITOR-KONFLIKTU · SYST. v2.6</span>
      <span>SECURITY LEVEL: TOP SECRET</span>
    </div>
  </div>
</div>
