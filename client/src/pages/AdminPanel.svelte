<script>
  import { onMount } from 'svelte';
  import axios from 'axios';

  export let onClose = () => {};

  let stats       = {};
  let comments    = [];
  let edits       = {};
  let saving      = {};
  let feedEntries = [];
  let feedForm    = { type: 'info', message: '' };
  let feedFlash   = '';

  const STAT_LABELS = {
    total_cost_usd:      'Koszt całkowity (USD)',
    days_active:         'Dni konfliktu',
    strikes_conducted:   'Uderzeń przeprowadzono',
    drones_intercepted:  'Dronów przechwycono',
    military_casualties: 'Straty militarne',
    civilian_casualties: 'Ofiary cywilne',
  };

  onMount(async () => {
    try {
      const r1 = await axios.get('/api/stats', { withCredentials: true });
      stats = r1.data;
    } catch {}
    try {
      const r2 = await axios.get('/api/comments');
      comments = r2.data;
    } catch {}
    try {
      const r3 = await axios.get('/api/livefeed');
      feedEntries = r3.data;
    } catch {}
  });

  async function saveStat(key) {
    saving = { ...saving, [key]: true };
    try {
      await axios.put(`/api/stats/${key}`, { value: edits[key] ?? stats[key] }, { withCredentials: true });
      const r = await axios.get('/api/stats', { withCredentials: true });
      stats = r.data;
    } catch {}
    saving = { ...saving, [key]: false };
  }

  async function delComment(id) {
    await axios.delete(`/api/comments/${id}`, { withCredentials: true });
    comments = comments.filter(c => c.id !== id);
  }

  async function addFeed() {
    if (!feedForm.message.trim()) return;
    try {
      await axios.post('/api/livefeed', feedForm, { withCredentials: true });
      feedForm = { type: 'info', message: '' };
      feedFlash = '✓ Dodano';
      const r = await axios.get('/api/livefeed');
      feedEntries = r.data;
    } catch (e) {
      feedFlash = e.response?.data?.error || 'Błąd';
    }
    setTimeout(() => feedFlash = '', 2500);
  }

  async function delFeed(id) {
    await axios.delete(`/api/livefeed/${id}`, { withCredentials: true });
    feedEntries = feedEntries.filter(f => f.id !== id);
  }

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKey(e) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window on:keydown={handleKey} />

<!-- Backdrop -->
<div class="admin-backdrop" on:click={handleBackdrop} role="dialog" aria-modal="true">

  <!-- Dialog -->
  <div class="admin-dialog">

    <!-- Header -->
    <div class="admin-header">
      <div>
        <div class="admin-title">⚠ PANEL OPERACYJNY</div>
        <div class="admin-subtitle">DOSTĘP: OPERACYJNY · KLASYFIKACJA: ŚCIŚLE TAJNY</div>
      </div>
      <button class="admin-close" on:click={onClose} aria-label="Zamknij">✕</button>
    </div>

    <!-- Body -->
    <div class="admin-body">

      <!-- Stats -->
      <div class="admin-section">
        <div class="admin-section-title">Globalne statystyki operacji</div>
        {#each Object.entries(STAT_LABELS) as [key, label]}
          <div class="stat-edit-row">
            <span class="stat-label">{label}</span>
            <input
              class="stat-input"
              value={edits[key] ?? stats[key] ?? ''}
              on:input={e => edits = { ...edits, [key]: e.target.value }}
              placeholder="—"
            />
            <button
              class="btn-sm {saving[key] ? 'saving' : ''}"
              on:click={() => saveStat(key)}
              disabled={saving[key]}
            >
              {saving[key] ? '...' : 'ZAPISZ'}
            </button>
          </div>
        {/each}
      </div>

      <!-- Comments -->
      <div class="admin-section">
        <div class="admin-section-title">
          Zarządzanie meldunkami
          <span class="comment-count">{comments.length}</span>
        </div>
        {#if comments.length === 0}
          <div class="empty-state">Brak meldunków</div>
        {/if}
        {#each comments as c (c.id)}
          <div class="comment-row">
            <div class="comment-content">
              <strong class="comment-author">{c.author}</strong>
              <span class="comment-text">{c.content}</span>
            </div>
            <button class="btn-sm danger" on:click={() => delComment(c.id)}>✕ USUŃ</button>
          </div>
        {/each}
      </div>

      <!-- Live Feed -->
      <div class="admin-section">
        <div class="admin-section-title">
          Wywiad na Żywo — kanał informacyjny
          <span class="comment-count">{feedEntries.length}</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">
          <select bind:value={feedForm.type}
            style="background:#111;border:1px solid #222;color:#e0e0e0;font-family:inherit;font-size:11px;padding:5px 8px;outline:none;width:72px">
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="alert">alert</option>
          </select>
          <input bind:value={feedForm.message} placeholder="Treść komunikatu..."
            on:keydown={e => e.key === 'Enter' && addFeed()}
            style="flex:1;background:#111;border:1px solid #222;color:#e0e0e0;font-family:inherit;font-size:11px;padding:5px 8px;outline:none" />
          <button class="btn-sm" on:click={addFeed}>+ DODAJ</button>
        </div>
        {#if feedFlash}
          <div style="font-size:10px;letter-spacing:.08em;margin-bottom:8px;color:{feedFlash.startsWith('✓') ? '#3a9a3a' : '#c0392b'}">{feedFlash}</div>
        {/if}
        {#if feedEntries.length === 0}
          <div class="empty-state">Brak wpisów w kanale</div>
        {/if}
        {#each feedEntries as f (f.id)}
          <div class="comment-row">
            <div class="comment-content">
              <strong class="comment-author"
                style="color:{f.type === 'alert' ? '#c0392b' : f.type === 'warn' ? '#c8a84b' : '#888'}">
                [{f.type.toUpperCase()}]
              </strong>
              <span class="comment-text">{f.message}</span>
            </div>
            <button class="btn-sm danger" on:click={() => delFeed(f.id)}>✕ USUŃ</button>
          </div>
        {/each}
      </div>

    </div>

  </div>
</div>

<style>
  .admin-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.82);
    backdrop-filter: blur(3px);
    z-index: 9000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .admin-dialog {
    background: #0d0d0d;
    border: 1px solid #c0392b;
    box-shadow: 0 0 40px rgba(192, 57, 43, 0.25), 0 24px 64px rgba(0,0,0,.9);
    width: 100%;
    max-width: 760px;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    font-family: var(--mono, 'Courier New', monospace);
    animation: dialog-in .15s ease-out;
  }

  @keyframes dialog-in {
    from { opacity: 0; transform: translateY(-12px) scale(.97); }
    to   { opacity: 1; transform: none; }
  }

  /* ── Header ── */
  .admin-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 18px 22px 16px;
    border-bottom: 1px solid #1e1e1e;
    background: #0a0a0a;
    flex-shrink: 0;
  }

  .admin-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: .12em;
    color: #c0392b;
  }

  .admin-subtitle {
    font-size: 9px;
    letter-spacing: .18em;
    color: #555;
    margin-top: 4px;
  }

  .admin-close {
    background: none;
    border: 1px solid #2a2a2a;
    color: #666;
    font-size: 13px;
    width: 28px;
    height: 28px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all .15s;
    flex-shrink: 0;
  }
  .admin-close:hover {
    border-color: #c0392b;
    color: #c0392b;
  }

  /* ── Body ── */
  .admin-body {
    overflow-y: auto;
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    scrollbar-width: thin;
    scrollbar-color: #c0392b44 #111;
  }

  .admin-body::-webkit-scrollbar {
    width: 5px;
  }
  .admin-body::-webkit-scrollbar-track {
    background: #111;
  }
  .admin-body::-webkit-scrollbar-thumb {
    background: #c0392b55;
    border-radius: 3px;
  }
  .admin-body::-webkit-scrollbar-thumb:hover {
    background: #c0392b99;
  }

  /* ── Sections ── */
  .admin-section {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .admin-section-title {
    font-size: 9px;
    letter-spacing: .2em;
    color: #888;
    text-transform: uppercase;
    padding-bottom: 10px;
    border-bottom: 1px solid #1a1a1a;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .comment-count {
    background: #1e1e1e;
    color: #666;
    font-size: 9px;
    padding: 1px 6px;
    border-radius: 2px;
  }

  /* ── Stat rows ── */
  .stat-edit-row {
    display: grid;
    grid-template-columns: 1fr 140px auto;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid #151515;
  }

  .stat-label {
    font-size: 11px;
    color: #bbb;
    letter-spacing: .04em;
  }

  .stat-input {
    background: #111;
    border: 1px solid #222;
    color: #e0e0e0;
    font-family: inherit;
    font-size: 11px;
    padding: 5px 8px;
    width: 100%;
    outline: none;
    transition: border-color .15s;
  }
  .stat-input:focus {
    border-color: #c0392b44;
  }

  /* ── Comment rows ── */
  .comment-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid #151515;
  }

  .comment-content {
    display: flex;
    gap: 6px;
    font-size: 11px;
    min-width: 0;
  }

  .comment-author {
    color: #c8a84b;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .comment-text {
    color: #999;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    font-size: 10px;
    color: #444;
    letter-spacing: .1em;
    padding: 12px 0;
  }

  /* ── Buttons ── */
  :global(.btn-sm) {
    background: #111;
    border: 1px solid #333;
    color: #aaa;
    font-family: inherit;
    font-size: 9px;
    letter-spacing: .1em;
    padding: 5px 10px;
    cursor: pointer;
    white-space: nowrap;
    transition: all .15s;
  }
  :global(.btn-sm:hover) {
    border-color: #aaa;
    color: #fff;
  }
  :global(.btn-sm.danger) {
    border-color: #3a1a1a;
    color: #c0392b;
  }
  :global(.btn-sm.danger:hover) {
    background: #c0392b;
    color: #fff;
    border-color: #c0392b;
  }
  :global(.btn-sm.saving) {
    opacity: .5;
    cursor: not-allowed;
  }
</style>
