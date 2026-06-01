<script>
  // Upload dokumentów wywiadowczych — obsługuje kliknięcie i drag-and-drop.
  // Wymaga roli ANALITYK+. Walidacja MIME i magic bytes po stronie serwera
  // (klient nie może obejść weryfikacji przez zmianę rozszerzenia).
  import axios from 'axios';
  import { user } from '../stores/auth';

  let result     = null;
  let loading    = false;
  let dragOver   = false;   // podświetlenie obszaru przy przeciąganiu pliku
  let customName = '';      // opcjonalna własna nazwa pliku (sanityzowana server-side)
  let inputEl;              // referencja do ukrytego <input type="file">

  $: canUpload = $user?.role === 'ANALITYK' || $user?.role === 'OPERACYJNY';

  // Wysyła plik na serwer (POST /api/upload) przez FormData (multipart).
  // Opcjonalna custom_filename zostaje sanityzowana server-side.
  // Walidacja MIME i magic bytes po stronie serwera — klient nie może jej obejść.
  async function doUpload(file) {
    if (!file) return;
    if (!canUpload) { result = { ok: false, error: 'Wymagana rola: ANALITYK lub wyższa' }; return; }
    loading = true; result = null;
    const fd = new FormData();
    fd.append('file', file);
    if (customName) fd.append('custom_filename', customName);
    try {
      const { data } = await axios.post('/api/upload', fd);
      result = { ok: true, ...data };
    } catch (err) {
      result = { ok: false, error: err.response?.data?.error || err.message };
    } finally { loading = false; }
  }

  // Obsługuje upuszczenie pliku w obszarze drag-and-drop.
  // e.preventDefault() zapobiega domyślnemu zachowaniu przeglądarki (otwarciu pliku).
  function handleDrop(e) {
    e.preventDefault();
    dragOver = false;
    doUpload(e.dataTransfer.files[0]);
  }
</script>

<div class="sec" id="upload">
  <div class="section-header">Wgraj dokument wywiadowczy</div>

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="upload-area"
    on:dragover={e => { e.preventDefault(); dragOver = true; }}
    on:dragleave={() => dragOver = false}
    on:drop={handleDrop}
    on:click={() => inputEl.click()}
    style="border-color:{dragOver ? 'var(--red-bright)' : ''}">
    <div class="upload-icon">↑</div>
    <div class="upload-hint">
      {loading ? 'WYSYŁANIE...' : 'Kliknij lub przeciągnij plik'}
    </div>
    <input bind:this={inputEl} type="file" style="display:none"
      on:change={e => doUpload(e.target.files[0])} />
  </div>

  <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
    <input
      bind:value={customName}
      placeholder="Własna nazwa pliku (opcjonalnie)"
      style="flex:1;background:#0d0d0d;border:1px solid #444;color:#e8e8e8;font-family:var(--mono);font-size:11px;padding:6px 10px;outline:none"
    />
    <span style="font-size:9px;color:var(--text-dim);flex-shrink:0">nazwa pliku</span>
  </div>

  {#if result}
    <div class="upload-result {result.ok ? 'ok' : 'err'}">
      {#if result.ok}
        <div>✓ Przesłano: <strong>{result.filename}</strong></div>
        <div style="margin-top:6px">
          <a href={result.url} target="_blank" rel="noreferrer"
            style="color:var(--red-bright);text-decoration:underline;font-size:10px">
            ↗ {result.url}
          </a>
        </div>
      {:else}
        <div>✗ Błąd: {result.error}</div>
      {/if}
    </div>
  {/if}
</div>
