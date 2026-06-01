<script>
  import { onMount } from 'svelte';
  import axios from 'axios';

  function nowStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
  }

  let msgs    = [];   // pobrane z bazy
  let entries = [];
  let idxRef  = 0;
  let wrapEl;

  function add() {
    if (!msgs.length) return;
    const msg = msgs[idxRef % msgs.length];
    idxRef++;
    entries = [...entries, { time: nowStr(), t: msg.type, m: msg.message }];
    if (entries.length > 60) entries = entries.slice(1);
  }

  onMount(async () => {
    try {
      const { data } = await axios.get('/api/livefeed');
      msgs = data;
    } catch { /* fallback – brak danych */ }

    for (let i = 0; i < 8; i++) add();
    const id = setInterval(add, 4500);
    return () => clearInterval(id);
  });

  $: if (wrapEl && entries.length) {
    setTimeout(() => { if (wrapEl) wrapEl.scrollTop = wrapEl.scrollHeight; }, 0);
  }
</script>

<div class="sec" id="feed">
  <div class="section-header">Wywiad na Żywo</div>

  <div class="terminal-box">
    <div class="terminal-topbar">
      <span class="terminal-dot" style="background:#c0392b"/>
      <span class="terminal-dot" style="background:#d4a017"/>
      <span class="terminal-dot" style="background:#27ae60"/>
      <span class="terminal-title">KANAŁ_WYWIADU — BEZPIECZNY KANAŁ · AES-256</span>
      <span class="terminal-status">● NA ŻYWO</span>
    </div>

    <div class="feed-wrap" bind:this={wrapEl}>
      {#each entries as e, i (i)}
        <div class="feed-entry">
          <span class="feed-time">[{e.time}]</span>
          <span class="feed-badge {e.t}">{e.t.toUpperCase()}</span>
          <span class="feed-text {e.t}">{e.m}</span>
        </div>
      {/each}
    </div>

    <div class="terminal-footer">
      <span class="terminal-cursor-line">&gt; _<span class="terminal-blink">▌</span></span>
      <span style="color:#333;font-size:9px">odświeżanie co 4,5s · {entries.length} wpisów</span>
    </div>
  </div>
</div>
