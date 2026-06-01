<script>
  import { onMount } from 'svelte';
  import axios from 'axios';
  import { user } from '../stores/auth';

  let comments = [];
  let author   = '';
  let content  = '';
  let loading  = false;
  let flash    = '';
  let showAll  = false;
  let filter   = '';
  const LIMIT  = 8;

  $: filtered = filter.trim()
    ? comments.filter(c => c.author?.toLowerCase().includes(filter.toLowerCase()) || c.content?.toLowerCase().includes(filter.toLowerCase()))
    : comments;
  $: visible = showAll ? filtered : filtered.slice(0, LIMIT);

  const api = 'comments';
  $: canPost = $user?.role === 'ANALITYK' || $user?.role === 'OPERACYJNY';

  async function load() {
    try {
      const { data } = await axios.get(`/api/${api}`);
      comments = data;
    } catch { /* ignoruj */ }
  }

  onMount(() => { load(); });

  async function post() {
    if (!canPost) { flash = 'Brak uprawnień'; return; }
    if (!content.trim()) { flash = 'Treść meldunku jest wymagana'; return; }
    if (content.length > 2000) { flash = 'Treść max 2000 znaków'; return; }
    if (author.length > 100)   { flash = 'Identyfikator max 100 znaków'; return; }
    loading = true;
    try {
      await axios.post(`/api/${api}`, { author: author || 'ANONIM', content });
      content = '';
      flash = 'Meldunek wysłany';
      setTimeout(() => flash = '', 2000);
      await load();
    } catch (err) {
      flash = 'Błąd: ' + (err.response?.data?.error || err.message);
    } finally {
      loading = false;
    }
  }

  async function del(id) {
    try {
      await axios.delete(`/api/${api}/${id}`);
      await load();
    } catch (err) {
      flash = 'Błąd: ' + (err.response?.data?.error || err.message);
    }
  }
</script>

<div class="sec" id="komentarze">
  <div class="section-header">Tablica Meldunków Operacyjnych</div>

  {#if canPost}
  <div class="calc-card" style="margin-bottom:12px">
    <div class="calc-row">
      <div class="calc-field">
        <label>Identyfikator / Kryptonim</label>
        <input bind:value={author} placeholder="np. AGENT-112" disabled={loading} />
      </div>
      <div class="calc-field" style="flex:2">
        <label>Treść meldunku</label>
        <input bind:value={content}
          on:keydown={e => e.key === 'Enter' && !loading && post()}
          placeholder="Wprowadź treść..." disabled={loading} />
      </div>
      <button class="btn-calc" on:click={post} disabled={loading || !content.trim()}>
        {loading ? 'WYSYŁANIE...' : '▶ WYŚLIJ'}
      </button>
    </div>
    {#if flash}
      <div style="font-size:10px;letter-spacing:.1em;padding:6px 10px;margin-top:6px;background:{flash.startsWith('Błąd') ? '#120808' : '#0a120a'};border:1px solid {flash.startsWith('Błąd') ? 'var(--red-dim)' : '#1a3a1a'};color:{flash.startsWith('Błąd') ? 'var(--red-bright)' : '#3a9a3a'}">
        {flash}
      </div>
    {/if}
  </div>
  {/if}

  <div class="terminal-box" style="border:none;background:transparent">
    <div class="terminal-topbar">
      <span class="terminal-title">TABLICA_OPERACYJNA — BEZPIECZNY KANAŁ</span>
      <span class="terminal-status">● NA ŻYWO</span>
    </div>

    <div class="tx-feed tx-scrollable">
      {#if filtered.length === 0}
        <div style="font-size:11px;color:var(--text-dim);letter-spacing:.1em;padding:10px 12px">
          {filter ? `— brak wyników dla "${filter}" —` : 'BRAK TRANSMISJI'}
        </div>
      {/if}
      {#each filtered as c (c.id)}
        <div class="tx-card">
          <div class="tx-topbar">
            <span class="tx-received">◉ ODEBRANO</span>
            <span class="tx-bars"><span/><span/><span/><span/></span>
            <span class="tx-callsign">{c.author}</span>
            <span class="tx-time">
              {#if c.created_at}
                {new Date(c.created_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} UTC
              {/if}
            </span>
            {#if $user?.role === 'OPERACYJNY'}
              <button class="del-btn" style="margin-left:auto" on:click={() => del(c.id)}>✕</button>
            {/if}
          </div>
          <div class="tx-body">{c.content}</div>
          <div class="tx-footer">
            <span class="tx-end">— KONIEC TRANSMISJI —</span>
          </div>
        </div>
      {/each}
    </div>

    <div class="terminal-footer">
      <span></span>
      <span style="color:#333;font-size:9px">{filtered.length} meldunków</span>
    </div>
  </div>
</div>
