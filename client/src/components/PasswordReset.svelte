<script>
  // Formularz resetu hasła — dwuetapowy przepływ:
  //   Krok 1: żądanie tokenu przez ID agenta (POST /api/reset-password/request)
  //   Krok 2: ustawienie nowego hasła z tokenem (POST /api/reset-password/confirm)
  // Token TTL 15 min, przechowywany w pamięci serwera (nie wysyłany emailem w tej implementacji).
  import axios from 'axios';
  let agentId   = '';
  let token     = '';      // token resetu (w tej implementacji trzeba go wpisać ręcznie)
  let newPass   = '';
  let reqResult = null;    // wynik żądania tokenu
  let cfmResult = null;    // wynik potwierdzenia resetu
  let step      = 1;       // aktywny krok formularza (1 lub 2)

  // Żąda tokenu resetu hasła dla podanego ID agenta (POST /api/reset-password/request).
  // Po sukcesie przechodzi do kroku 2. Serwer stosuje rate limiting: max 5 żądań/h z IP.
  // Odpowiedź serwera jest taka sama niezależnie od istnienia agenta (zapobiega enumeracji).
  async function requestReset() {
    reqResult = null;
    try {
      const { data } = await axios.post('/api/reset-password/request', { agent_id: agentId });
      reqResult = data;
      step = 2;
    } catch (err) {
      reqResult = { error: err.response?.data?.error || err.message };
    }
  }

  // Potwierdza reset hasła podając token i nowe hasło (POST /api/reset-password/confirm).
  // Token jednorazowy — po użyciu jest usuwany z pamięci serwera.
  // Po sukcesie przechodzi do kroku 3 (komunikat końcowy).
  async function confirmReset() {
    cfmResult = null;
    try {
      const { data } = await axios.post('/api/reset-password/confirm', { token, new_password: newPass });
      cfmResult = data;
      step = 3;
    } catch (err) {
      cfmResult = { error: err.response?.data?.error || err.message };
    }
  }
</script>

<div class="sec" id="reset-pass">
  <div class="section-header">Reset kodu dostępu</div>

  <div class="reset-steps">
    <!-- KROK 1 -->
    <div class="reset-step {step >= 1 ? 'active' : ''}">
      <div class="reset-step-header">
        <span class="reset-step-num">1</span>
        Żądanie resetu — podaj ID agenta
      </div>
      <div class="reset-body">
        <div style="font-size:10px;margin-bottom:8px;letter-spacing:.06em;color:var(--text-dim)">
          Token wysyłany wyłącznie na adres e-mail powiązany z kontem agenta.
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="calc-field" style="flex:1">
            <label>Identyfikator agenta</label>
            <input bind:value={agentId}
              on:keydown={e => e.key === 'Enter' && requestReset()}
              placeholder="np. ADMIN-001" />
          </div>
          <button class="btn-calc" on:click={requestReset} disabled={!agentId}>
            ▶ ŻĄDAJ RESETU
          </button>
        </div>

        {#if reqResult}
          <div class="upload-result {reqResult.error ? 'err' : 'ok'}" style="margin-top:8px">
            {#if reqResult.error}
              ✗ {reqResult.error}
            {:else}
              ✓ {reqResult.message}
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- KROK 2 -->
    <div class="reset-step {step >= 2 ? 'active' : 'disabled'}">
      <div class="reset-step-header">
        <span class="reset-step-num">2</span>
        Zmiana hasła — podaj token i nowe hasło
      </div>
      {#if step >= 2}
        <div class="reset-body">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
            <div class="calc-field" style="flex:1">
              <label>Token resetu (auto-uzupełniony)</label>
              <input bind:value={token}
                style="font-family:var(--mono);letter-spacing:.05em;color:var(--gold)" />
            </div>
            <div class="calc-field" style="flex:1">
              <label>Nowe hasło</label>
              <input type="password" bind:value={newPass}
                on:keydown={e => e.key === 'Enter' && confirmReset()}
                placeholder="Nowe hasło" />
            </div>
            <button class="btn-calc" on:click={confirmReset} disabled={!token || !newPass}>
              ▶ ZMIEŃ HASŁO
            </button>
          </div>

          {#if cfmResult}
            <div class="upload-result {cfmResult.error ? 'err' : 'ok'}" style="margin-top:8px">
              {cfmResult.error ? `✗ ${cfmResult.error}` : `✓ ${cfmResult.message}`}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- KROK 3 -->
    {#if step === 3}
      <div class="reset-step active" style="border-color:#1a3a1a">
        <div class="reset-step-header" style="color:var(--green)">
          <span class="reset-step-num" style="background:var(--green)">3</span>
          Hasło zmienione — zaloguj się nowym hasłem
        </div>
        <div class="reset-body" style="font-size:11px;color:var(--text-dim)">
          Hasło agenta <strong style="color:var(--gold)">{agentId}</strong> zostało zmienione.
          Zaloguj się przez panel logowania używając nowego hasła.
        </div>
      </div>
    {/if}
  </div>
</div>
