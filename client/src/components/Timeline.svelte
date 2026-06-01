<script>
  import { onMount } from 'svelte';
  import axios from 'axios';
  import { user } from '../stores/auth';

  let events   = [];
  let showForm = false;
  let loading  = false;
  let flash    = '';
  let form     = { event_date: '', title: '', description: '', is_major: false };

  const api = 'timeline';

  async function load() {
    try {
      const { data } = await axios.get(`/api/${api}`);
      events = data;
    } catch { /* ignoruj */ }
  }

  onMount(() => { load(); });

  function showFlash(msg, ok = true) {
    flash = { msg, ok };
    setTimeout(() => flash = '', 2500);
  }

  async function submit() {
    if (!form.event_date || !form.title.trim()) return;
    loading = true;
    try {
      await axios.post(`/api/${api}`, form);
      form = { event_date: '', title: '', description: '', is_major: false };
      showFlash('Wydarzenie dodane');
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    } finally {
      loading = false;
    }
  }

  async function remove(id) {
    try {
      await axios.delete(`/api/${api}/${id}`);
      events = events.filter(e => e.id !== id);
      showFlash('Usunięto');
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    }
  }

  async function toggleMajor(ev) {
    try {
      await axios.patch(`/api/timeline/${ev.id}`, { is_major: !ev.is_major });
      events = events.map(e => e.id === ev.id ? { ...e, is_major: !e.is_major } : e);
    } catch { /* ignoruj */ }
  }
</script>

<div class="sec" id="timeline">
  <div class="section-header">
    Oś czasu konfliktu
    {#if $user?.role === 'ANALITYK' || $user?.role === 'OPERACYJNY'}
      <button class="btn-sm" style="margin-left:auto" on:click={() => showForm = !showForm}>
        {showForm ? '✕ ZAMKNIJ' : '+ DODAJ WYDARZENIE'}
      </button>
    {/if}
  </div>

  {#if showForm && ($user?.role === 'ANALITYK' || $user?.role === 'OPERACYJNY')}
    <div class="cas-form" style="margin-bottom:14px">
      {#if flash}
        <div style="font-size:10px;padding:6px 10px;margin-bottom:8px;letter-spacing:.08em;background:{flash.ok ? '#081408' : '#180a0a'};border:1px solid {flash.ok ? '#2a4a2a' : 'var(--red-dim)'};color:{flash.ok ? '#5abf5a' : 'var(--red-bright)'}">
          {flash.msg}
        </div>
      {/if}

      <div class="cas-form-row">
        <input type="text" placeholder="Data (np. 19 KWI 2026) *"
          bind:value={form.event_date} disabled={loading} style="flex:0 0 180px" />
        <input placeholder="Tytuł wydarzenia *"
          bind:value={form.title} disabled={loading} style="flex:2" />
      </div>
      <div class="cas-form-row">
        <input placeholder="Opis (opcjonalny)"
          bind:value={form.description}
          on:keydown={e => e.key === 'Enter' && !loading && submit()}
          disabled={loading} style="flex:1" />

        <!-- Toggle: zdarzenie przełomowe -->
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="major-toggle {form.is_major ? 'on' : ''} {loading ? 'disabled' : ''}"
          on:click={() => !loading && (form.is_major = !form.is_major)}>
          <div class="toggle-track">
            <div class="toggle-thumb" />
          </div>
          <span class="toggle-label">PRZEŁOMOWE</span>
        </div>

        <button class="btn-calc" on:click={submit}
          disabled={loading || !form.event_date || !form.title.trim()}>
          {loading ? 'DODAWANIE...' : '▶ DODAJ'}
        </button>
      </div>
    </div>
  {/if}

  <div class="timeline">
    {#each events as ev (ev.id)}
      <div class="tl-item{ev.is_major ? ' major' : ''}">
        <div class="tl-dot" />
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div style="flex:1">
            <div class="tl-date">{ev.event_date}</div>
            <div class="tl-title">{ev.title}</div>
            <div class="tl-desc">{ev.description || ''}</div>
          </div>
          {#if $user?.role === 'OPERACYJNY'}
            <div style="display:flex;gap:4px;flex-shrink:0;margin-top:2px">
              <button class="btn-sm" title="Zmień status"
                style="font-size:9px;padding:3px 7px;border-color:{ev.is_major ? 'var(--gold)' : '#444'};color:{ev.is_major ? 'var(--gold)' : '#666'}"
                on:click={() => toggleMajor(ev)}>★</button>
              <button class="btn-sm danger" title="Usuń"
                style="font-size:9px;padding:3px 7px"
                on:click={() => remove(ev.id)}>✕</button>
            </div>
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if !showForm && flash}
    <div style="font-size:10px;padding:6px 10px;margin-top:8px;letter-spacing:.08em;background:{flash.ok ? '#081408' : '#180a0a'};border:1px solid {flash.ok ? '#2a4a2a' : 'var(--red-dim)'};color:{flash.ok ? '#5abf5a' : 'var(--red-bright)'}">
      {flash.msg}
    </div>
  {/if}
</div>

<style>
  /* ── Toggle: zdarzenie przełomowe ── */
  .major-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    flex-shrink: 0;
    user-select: none;
    padding: 4px 10px 4px 6px;
    border: 1px solid #2a2a2a;
    background: #0a0a0a;
    transition: border-color .15s;
  }

  .major-toggle:hover:not(.disabled) {
    border-color: #444;
  }

  .major-toggle.disabled {
    cursor: not-allowed;
    opacity: .45;
  }

  .toggle-track {
    width: 30px;
    height: 16px;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    position: relative;
    transition: background .2s, border-color .2s;
    flex-shrink: 0;
  }

  .toggle-thumb {
    width: 10px;
    height: 10px;
    background: #444;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: left .2s, background .2s;
  }

  .major-toggle.on .toggle-track {
    background: #251800;
    border-color: var(--gold, #c8a84b);
  }

  .major-toggle.on .toggle-thumb {
    background: var(--gold, #c8a84b);
    left: 16px;
  }

  .toggle-label {
    font-size: 9px;
    letter-spacing: .14em;
    color: #555;
    font-family: var(--mono, monospace);
    transition: color .2s;
    white-space: nowrap;
  }

  .major-toggle.on .toggle-label {
    color: var(--gold, #c8a84b);
  }
</style>
