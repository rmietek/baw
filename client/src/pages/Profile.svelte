<script>
  // Strona profilu (pełnoekranowa) — analogiczna do ProfileModal, ale jako osobna strona.
  // Zawiera: dane profilu (bio, dochód), zarządzanie 2FA.
  // Edycja bio/dochodu: tylko ANALITYK+. OBSERWATOR widzi dane tylko do odczytu.
  import { onMount } from 'svelte';
  import axios from 'axios';
  let profile = {};
  let form    = {};
  let saved   = false;
  let saveErr = '';

  $: canEdit = profile.role === 'ANALITYK' || profile.role === 'OPERACYJNY';

  // Stan maszyny 2FA: idle → verify (po setup QR) → z powrotem do idle po aktywacji
  let tfaStep   = 'idle';  // idle | setup | verify | disabling
  let qrDataUrl = '';
  let tfaCode   = '';
  let tfaMsg    = '';

  onMount(async () => {
    try {
      const { data } = await axios.get('/api/profile', { withCredentials: true });
      profile = data;
      form = { ...data };
    } catch {}
  });

  async function save() {
    saveErr = '';
    try {
      const payload = { bio: form.bio, income: form.income };
      await axios.put('/api/profile', payload, { withCredentials: true });
      saved = true;
      setTimeout(() => saved = false, 2000);
    } catch (e) {
      saveErr = e.response?.data?.error || 'Nie udało się zapisać profilu';
    }
  }

  async function setup2FA() {
    tfaMsg = '';
    try {
      const { data } = await axios.post('/api/2fa/setup', {}, { withCredentials: true });
      qrDataUrl = data.qrDataUrl;
      tfaStep = 'verify';
    } catch { tfaMsg = 'Błąd generowania kodu QR'; }
  }

  async function enable2FA() {
    tfaMsg = '';
    try {
      await axios.post('/api/2fa/enable', { code: tfaCode }, { withCredentials: true });
      profile = { ...profile, totp_enabled: true };
      tfaStep = 'idle'; tfaCode = '';
      tfaMsg = '✓ 2FA aktywowane';
    } catch (e) { tfaMsg = e.response?.data?.error || 'Nieprawidłowy kod'; }
  }

  async function disable2FA() {
    tfaMsg = '';
    try {
      await axios.post('/api/2fa/disable', { code: tfaCode }, { withCredentials: true });
      profile = { ...profile, totp_enabled: false };
      tfaStep = 'idle'; tfaCode = '';
      tfaMsg = '✓ 2FA wyłączone';
    } catch (e) { tfaMsg = e.response?.data?.error || 'Nieprawidłowy kod'; }
  }
</script>

<div style="min-height:100vh;background:var(--bg)">
  <div class="container">
    <div class="site-header">
      <div class="site-title">PROFIL AGENTA</div>
      <div class="site-subtitle">{profile.agent_id}</div>
    </div>

    <div class="sec">
      <div class="section-header">Dane profilu</div>
      <div class="calc-card">
        <div class="calc-row">
          <div class="calc-field">
            <label>ID Agenta</label>
            <input value={form.agent_id || ''} disabled style="opacity:.5" />
          </div>
          <div class="calc-field">
            <label>Rola (tylko do odczytu)</label>
            <input value={form.role || ''} disabled style="opacity:.5" />
          </div>
        </div>
        {#if canEdit}
          <div class="calc-row">
            <div class="calc-field" style="flex:2">
              <label>Bio</label>
              <input value={form.bio || ''}
                on:input={e => form = {...form, bio: e.target.value}}
                placeholder="Opis agenta..." />
            </div>
            <div class="calc-field">
              <label>Roczny dochód (USD)</label>
              <input type="number" value={form.income || ''}
                on:input={e => form = {...form, income: e.target.value}} />
            </div>
          </div>
          <button class="btn-calc" on:click={save}>
            {saved ? '✓ ZAPISANO' : '▶ ZAPISZ PROFIL'}
          </button>
          {#if saveErr}
            <div style="margin-top:8px;font-size:10px;letter-spacing:.08em;color:var(--red-bright)">{saveErr}</div>
          {/if}
        {:else}
          <div style="font-size:11px;color:var(--text-dim);letter-spacing:.07em;line-height:1.7">
            Rola OBSERWATOR ma dostęp tylko do odczytu. Edycja profilu wymaga roli ANALITYK lub wyższej.
          </div>
        {/if}
      </div>
    </div>

    <div class="sec">
      <div class="section-header">Weryfikacja dwuetapowa (2FA)</div>
      <div class="calc-card">

        {#if profile.totp_enabled}
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
            <span style="color:var(--green);font-size:11px;letter-spacing:.1em">● 2FA AKTYWNE</span>
          </div>
          {#if tfaStep === 'disabling'}
            <div style="font-size:10px;color:var(--text-dim);margin-bottom:10px;letter-spacing:.07em">
              Podaj kod z aplikacji aby wyłączyć 2FA:
            </div>
            <div style="display:flex;gap:8px;align-items:flex-end">
              <div class="calc-field" style="flex:1">
                <label>Kod TOTP</label>
                <input bind:value={tfaCode} maxlength="6" inputmode="numeric"
                  placeholder="000000"
                  style="font-size:18px;letter-spacing:.3em;text-align:center"
                  on:keydown={e => e.key === 'Enter' && disable2FA()} />
              </div>
              <button class="btn-calc" style="border-color:var(--red-dim);color:var(--red-bright)" on:click={disable2FA}>
                ▶ WYŁĄCZ
              </button>
              <button class="btn-calc" on:click={() => { tfaStep='idle'; tfaCode=''; tfaMsg=''; }}>
                ANULUJ
              </button>
            </div>
          {:else}
            <button class="btn-calc" style="border-color:#555;color:#aaa" on:click={() => { tfaStep='disabling'; tfaMsg=''; }}>
              ✕ WYŁĄCZ 2FA
            </button>
          {/if}

        {:else}
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
            <span style="color:#666;font-size:11px;letter-spacing:.1em">○ 2FA NIEAKTYWNE</span>
          </div>
          {#if tfaStep === 'verify'}
            <div style="font-size:10px;color:var(--text-dim);margin-bottom:12px;letter-spacing:.07em;line-height:1.7">
              Zeskanuj kod QR aplikacją <strong style="color:#ccc">Google Authenticator</strong>,
              następnie wpisz wyświetlany 6-cyfrowy kod aby potwierdzić aktywację.
            </div>
            <div style="text-align:center;margin-bottom:14px">
              <img src={qrDataUrl} alt="QR 2FA" style="width:180px;height:180px;border:4px solid #222" />
            </div>
            <div style="display:flex;gap:8px;align-items:flex-end">
              <div class="calc-field" style="flex:1">
                <label>Kod weryfikacyjny</label>
                <input bind:value={tfaCode} maxlength="6" inputmode="numeric"
                  placeholder="000000"
                  style="font-size:18px;letter-spacing:.3em;text-align:center"
                  on:keydown={e => e.key === 'Enter' && enable2FA()} />
              </div>
              <button class="btn-calc" on:click={enable2FA}>▶ AKTYWUJ</button>
              <button class="btn-calc" style="border-color:#555;color:#aaa"
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

  </div>
</div>
