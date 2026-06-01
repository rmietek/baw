<script>
  import { onMount } from 'svelte';
  import axios from 'axios';
  import { user } from '../stores/auth';

  let total        = null;
  let recent       = [];
  let name         = '';
  let comment      = '';
  let loading      = false;
  let flash        = '';
  let showAll      = false;
  let displayTotal = null;
  let prevTotal    = null;

  const api    = 'petition';
  let filter   = '';
  let newIds   = new Set();
  let prevIds  = new Set();

  async function load() {
    try {
      const { data } = await axios.get(`/api/${api}`);
      total  = data.total;
      const incoming = data.recent;
      newIds = new Set(incoming.filter(s => !prevIds.has(s.id)).map(s => s.id));
      if (newIds.size > 0) setTimeout(() => { newIds = new Set(); }, 2000);
      prevIds = new Set(incoming.map(s => s.id));
      recent  = incoming;
    } catch { /* ignoruj */ }
  }

  onMount(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  });

  $: filtered = filter.trim()
    ? recent.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
    : recent;
  $: visible = showAll ? filtered : filtered.slice(0, 10);

  $: today = recent.filter(s => {
    const d = new Date(s.signed_at);
    const n = new Date();
    return d.getDate() === n.getDate() && d.getMonth() === n.getMonth();
  }).length;

  $: lastHour = recent.filter(s =>
    Date.now() - new Date(s.signed_at).getTime() < 3600000
  ).length;

  $: pct = total ? Math.min(100, (total / 10000) * 100) : 0;

  $: topComments = recent.filter(s => s.comment?.trim()).slice(0, 3);

  // animate counter
  $: {
    if (total !== null) {
      if (prevTotal === null) {
        displayTotal = total;
        prevTotal = total;
      } else {
        const diff = total - prevTotal;
        if (diff <= 0) {
          displayTotal = total;
          prevTotal = total;
        } else {
          let cur = prevTotal;
          const step = Math.max(1, Math.floor(diff / 20));
          const id = setInterval(() => {
            cur = Math.min(cur + step, total);
            displayTotal = cur;
            if (cur >= total) { clearInterval(id); prevTotal = total; }
          }, 40);
        }
      }
    }
  }

  function showFlash(msg, ok = true) {
    flash = { msg, ok };
    setTimeout(() => flash = '', 3000);
  }

  async function sign() {
    if (!$user?.role) { showFlash('Wymagane logowanie — rola co najmniej OBSERWATOR', false); return; }
    if (!name.trim())         { showFlash('Podaj imię lub pseudonim', false); return; }
    if (name.length > 255)    { showFlash('Imię max 255 znaków', false); return; }
    if (comment.length > 500) { showFlash('Komentarz max 500 znaków', false); return; }
    loading = true;
    try {
      const { data } = await axios.post('/api/petition/sign', { name: name.trim(), comment: comment.trim() });
      total = data.total;
      showFlash(`Podpis #${data.total} dodany! Dziękujemy.`, true);
      name = ''; comment = '';
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    } finally {
      loading = false;
    }
  }

  async function del(id) {
    if ($user?.role !== 'OPERACYJNY') return;
    await axios.delete(`/api/${api}/${id}`, { withCredentials: true });
    await load();
  }

</script>

<div class="sec" id="petycja">
  <div class="section-header">Petycja obywatelska</div>

  <div class="petition-banner">
    <div class="petition-banner-left">
      <div class="petition-icon-lg" />
      <div>
        <div class="petition-title-lg">Zablokuj finansowanie operacji w Iranie</div>
        <div class="petition-desc">
          Żądamy, by Kongres USA wstrzymał dodatkowe fundusze na niezatwierdzoną
          operację wojskową. Każdy podpis ma znaczenie.
        </div>
      </div>
    </div>
    <div class="petition-counter-wrap">
      <div class="petition-counter-num">
        {displayTotal !== null ? displayTotal.toLocaleString('pl') : '—'}
      </div>
      <div class="petition-counter-label">PODPISÓW</div>
      <div class="petition-counter-bar">
        <div class="petition-counter-fill"
          style="width:{Math.min(100, ((displayTotal || 0) / 10000) * 100)}%" />
      </div>
      <div class="petition-counter-goal">Cel: 10 000</div>
    </div>
  </div>

  <div class="petition-form">
    {#if !$user?.role}
      <div style="font-size:10px;color:var(--red-bright);padding:6px 10px;border:1px solid var(--red-dim);background:#120808;margin-bottom:8px">
        Formularz niedostępny &mdash; wymagana rola co najmniej OBSERWATOR
      </div>
    {/if}

    <div class="cas-form-row" style="margin-bottom:8px">
      <div class="calc-field" style="flex:1">
        <label style="font-size:9px;letter-spacing:.2em;color:var(--text-dim);text-transform:uppercase;display:block;margin-bottom:5px">
          Imię / pseudonim *
        </label>
        <input bind:value={name}
          on:keydown={e => e.key === 'Enter' && !loading && sign()}
          placeholder="np. Jan Kowalski"
          disabled={loading}
          style="width:100%;background:#080808;border:1px solid #2a2a2a;color:#ccc;font-family:var(--mono);font-size:12px;padding:8px 10px;outline:none" />
      </div>
      <div class="calc-field" style="flex:2">
        <label style="font-size:9px;letter-spacing:.2em;color:var(--text-dim);text-transform:uppercase;display:block;margin-bottom:5px">
          Komentarz (opcjonalny)
        </label>
        <input bind:value={comment}
          on:keydown={e => e.key === 'Enter' && !loading && sign()}
          placeholder="Twój komentarz..."
          disabled={loading}
          style="width:100%;background:#080808;border:1px solid #2a2a2a;color:#ccc;font-family:var(--mono);font-size:12px;padding:8px 10px;outline:none" />
      </div>
      <button class="btn-calc" on:click={sign} disabled={loading || !name.trim()} style="align-self:flex-end">
        {loading ? 'PODPISYWANIE...' : '★ PODPISZ'}
      </button>
    </div>

    {#if flash}
      <div style="font-size:10px;letter-spacing:.08em;padding:7px 11px;margin-bottom:8px;background:{flash.ok ? '#0a120a' : '#120808'};border:1px solid {flash.ok ? '#1a3a1a' : 'var(--red-dim)'};color:{flash.ok ? '#3a9a3a' : 'var(--red-bright)'}">
        {flash.msg}
      </div>
    {/if}

    <div style="font-size:9px;letter-spacing:.07em;color:var(--text-dim)">
      Rate limiting aktywny — max 1 podpis / minutę z jednego IP
    </div>
  </div>

  {#if recent.length > 0}
    <div style="margin-top:16px">
      <div style="font-size:9px;letter-spacing:.25em;color:var(--text-dim);text-transform:uppercase;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <span>Dziennik podpisów</span>
        <span style="color:var(--gold);letter-spacing:.1em">{total} / 10 000</span>
      </div>

      <div class="terminal-box">
        <div class="terminal-topbar">
          <span class="terminal-dot" style="background:#c0392b"/>
          <span class="terminal-dot" style="background:#d4a017"/>
          <span class="terminal-dot" style="background:#27ae60"/>
          <span class="terminal-title">DZIENNIK_PETYCJI — KANAŁ NA ŻYWO</span>
          <span class="terminal-status">● NA ŻYWO</span>
        </div>

        <div class="petition-dual">

          <!-- LEWA: log -->
          <div class="petition-panel-log">
            <div class="terminal-filter">
              <span class="terminal-prompt">&gt;</span>
              <input class="terminal-input" bind:value={filter}
                placeholder="szukaj agenta..." spellcheck="false" />
              {#if filter}<span class="terminal-clear" on:click={() => filter=''}>✕</span>{/if}
            </div>

            <div class="dispatch-feed dispatch-scrollable">
              {#each filtered as s (s.id)}
                <div class="dispatch-entry {newIds.has(s.id) ? 'dispatch-new' : ''}">
                  <span class="dispatch-date">[{new Date(s.signed_at).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                  <span class="dispatch-num">SIG-{String(s.id).padStart(4,'0')}</span>
                  <span class="dispatch-name">{s.name}</span>
                  {#if s.comment}<span class="dispatch-comment">· "{s.comment}"</span>{/if}
                  {#if $user?.role === 'OPERACYJNY'}
                    <button class="del-btn" style="margin-left:auto;flex-shrink:0" on:click={() => del(s.id)} title="Usuń">✕</button>
                  {/if}
                </div>
              {/each}
              {#if filtered.length === 0}
                <div style="color:#333;font-size:10px;padding:6px 0">— brak wyników dla "{filter}" —</div>
              {/if}
            </div>
          </div>

          <!-- PRAWA: statystyki -->
          <div class="petition-panel-stats">
            <div class="pstat-label">ŁĄCZNIE PODPISÓW</div>
            <div class="pstat-big">{total?.toLocaleString('pl') || '—'}</div>
            <div class="pstat-bar-wrap">
              <div class="pstat-bar-fill" style="width:{pct}%"/>
            </div>
            <div class="pstat-goal">{pct.toFixed(1)}% celu · 10 000</div>

            <div class="pstat-divider"/>

            <div class="pstat-row">
              <span class="pstat-row-label">Dziś</span>
              <span class="pstat-row-val" style="color:var(--green)">{today}</span>
            </div>
            <div class="pstat-row">
              <span class="pstat-row-label">Ostatnia godz.</span>
              <span class="pstat-row-val" style="color:var(--gold)">{lastHour}</span>
            </div>
            <div class="pstat-row">
              <span class="pstat-row-label">Widoczne</span>
              <span class="pstat-row-val">{filtered.length}</span>
            </div>

            {#if topComments.length > 0}
              <div class="pstat-divider"/>
              <div class="pstat-label">OSTATNIE KOMENTARZE</div>
              {#each topComments as s}
                <div class="pstat-comment">"{s.comment}"</div>
              {/each}
            {/if}
          </div>

        </div>

        <div class="terminal-footer">
          <span class="terminal-cursor-line">&gt; _<span class="terminal-blink">▌</span></span>
          <span style="color:#333;font-size:9px">odświeżanie co 15s</span>
        </div>
      </div>

    </div>
  {/if}
</div>
