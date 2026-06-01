<script>
  // Raporty wywiadowcze — widok filtrowany przez clearance server-side.
  // OBSERWATOR widzi tylko JAWNE, ANALITYK + TAJNE, OPERACYJNY wszystkie.
  // Filtr clearance jest wymuszony w SQL na serwerze — nie tylko UI.
  import { onMount } from 'svelte';
  import axios from 'axios';
  import { user } from '../stores/auth';

  // Mapy CSS klas dla oznaczeń klauzuli tajności
  const BADGE = { 'JAWNY': 'jawny', 'TAJNY': 'tajny', 'ŚCIŚLE TAJNY': 'scisle' };
  const CARD  = { 'JAWNY': '',      'TAJNY': 'tajny', 'ŚCIŚLE TAJNY': 'scisle' };

  let reports     = [];
  let form        = { title: '', content: '', source: 'OSINT', clearance: 'JAWNY' };
  let loading     = false;
  let newsLoading = false;
  let flash       = '';

  const api = 'reports';

  // Pobiera raporty dostępne dla roli bieżącego użytkownika (clearance filtrowany server-side).
  async function load() {
    try {
      const { data } = await axios.get(`/api/${api}`);
      reports = data;
    } catch { /* ignoruj */ }
  }

  onMount(() => { load(); });

  // Wyświetla komunikat flash przez 2.5 s — zielony (ok=true) lub czerwony.
  function showFlash(msg, ok = true) {
    flash = { msg, ok };
    setTimeout(() => flash = '', 2500);
  }

  $: canSubmit = $user?.role === 'ANALITYK' || $user?.role === 'OPERACYJNY';

  // Dodaje nowy raport (POST /api/reports). Wymaga ANALITYK+.
  // clearance pobierany z formularza — serwer waliduje i normalizuje do allowlisty.
  async function submit() {
    if (!canSubmit) { showFlash('Wymagana rola: ANALITYK lub wyższa', false); return; }
    if (!form.title.trim() || !form.content.trim()) return;
    loading = true;
    try {
      await axios.post(`/api/${api}`, form, { withCredentials: true });
      form = { title: '', content: '', source: 'OSINT', clearance: 'JAWNY' };
      showFlash('Raport dodany');
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    } finally {
      loading = false;
    }
  }

  // Import z zewnętrznego News API — endpoint niedostępny w obecnej wersji serwera.
  async function fetchNews() {
    return; // fetch-news niedostępny
    newsLoading = true;
    try {
      const { data } = await axios.post('/api/reports/fetch-news', {}, { withCredentials: true });
      showFlash(`Zaimportowano ${data.imported} artykułów`);
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    } finally {
      newsLoading = false;
    }
  }
</script>

<div class="sec" id="intel">
  <div class="section-header">
    Raporty Wywiadowcze
    {#if $user?.role === 'OPERACYJNY'}
      <button class="btn-sm" style="margin-left:auto" on:click={fetchNews} disabled={newsLoading}>
        {newsLoading ? 'POBIERANIE...' : '↓ POBIERZ Z NEWS API'}
      </button>
    {/if}
  </div>

  <div class="file-feed intel-scroll">
    {#if reports.length === 0}
      <div style="font-size:11px;color:var(--text-dim);letter-spacing:.1em;padding:12px">BRAK RAPORTÓW</div>
    {/if}
    {#each reports as r (r.id)}
      <div class="file-card {BADGE[r.clearance] || 'jawny'}">
        <div class="file-topstrip">
          <span class="file-ref">REF-{String(r.id).padStart(5,'0')}</span>
          <span class="file-stamp {BADGE[r.clearance] || 'jawny'}">{r.clearance}</span>
          <span class="file-date">{new Date(r.created_at).toLocaleDateString('pl')}</span>
        </div>
        <div class="file-body">
          <div class="file-from">OD: <span>{r.source}</span></div>
          <div class="file-label">TYTUŁ RAPORTU</div>
          <div class="file-title">{r.title}</div>
          <div class="file-label">TREŚĆ RAPORTU</div>
          <div class="file-content">{r.content}</div>
        </div>
      </div>
    {/each}
  </div>

  {#if canSubmit}
    <div class="cas-form" style="margin-top:12px">
      <div style="font-size:10px;letter-spacing:.25em;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase">
        Dodaj raport wywiadowczy
      </div>

      {#if flash}
        <div style="font-size:10px;letter-spacing:.1em;padding:6px 10px;margin-bottom:8px;background:{flash.ok ? '#0a120a' : '#120808'};border:1px solid {flash.ok ? '#1a3a1a' : 'var(--red-dim)'};color:{flash.ok ? '#3a9a3a' : 'var(--red-bright)'}">
          {flash.msg}
        </div>
      {/if}

      <div class="cas-form-row">
        <input placeholder="Tytuł raportu *" bind:value={form.title} disabled={loading} style="flex:2" />
        <input placeholder="Źródło" bind:value={form.source} disabled={loading} style="flex:0 0 110px" />
        <select bind:value={form.clearance} disabled={loading} style="flex:0 0 150px">
          <option>JAWNY</option>
          <option>TAJNY</option>
          <option>ŚCIŚLE TAJNY</option>
        </select>
      </div>
      <div class="cas-form-row">
        <input placeholder="Treść raportu *" bind:value={form.content}
          on:keydown={e => e.key === 'Enter' && !loading && submit()}
          disabled={loading} style="flex:1" />
        <button class="btn-calc" on:click={submit} disabled={loading || !form.title.trim() || !form.content.trim()}>
          {loading ? 'DODAWANIE...' : '▶ DODAJ'}
        </button>
      </div>
    </div>
  {/if}
</div>
