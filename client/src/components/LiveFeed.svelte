<script>
  // Live Feed — symulacja transmisji na żywo z danych pobranych z bazy.
  // Wiadomości pobierane raz z /api/livefeed, następnie wyświetlane cyklicznie co 4.5 s
  // tworząc iluzję strumienia na żywo. Bufor ograniczony do 60 wpisów (stare usuwane).
  import { onMount } from 'svelte';
  import axios from 'axios';

  // Generuje aktualny czas UTC w formacie HH:MM:SS UTC
  function nowStr() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
  }

  let msgs    = [];   // wiadomości pobrane z bazy (źródło)
  let entries = [];   // aktualnie wyświetlane wpisy (bufor 60 pozycji)
  let idxRef  = 0;    // indeks cykliczny — po dojściu do końca wraca na początek
  let wrapEl;         // referencja do elementu DOM — do auto-scrollowania na dół

  // Dodaje kolejny wpis do bufora entries. Cyklicznie przechodzi przez msgs (modulo).
  // Gdy bufor przekroczy 60 pozycji, usuwa najstarszy wpis (FIFO).
  function add() {
    if (!msgs.length) return;
    const msg = msgs[idxRef % msgs.length];
    idxRef++;
    entries = [...entries, { time: nowStr(), t: msg.type, m: msg.message }];
    if (entries.length > 60) entries = entries.slice(1);
  }

  onMount(async () => {
    // Pobiera wiadomości z bazy raz przy montowaniu komponentu
    try {
      const { data } = await axios.get('/api/livefeed');
      msgs = data;
    } catch { /* brak danych — feed pozostaje pusty */ }

    // Wypełnia bufor 8 wpisami od razu, potem dodaje nowy co 4.5 s
    for (let i = 0; i < 8; i++) add();
    const id = setInterval(add, 4500);
    return () => clearInterval(id); // cleanup przy odmontowaniu
  });

  // Reaktywny auto-scroll — przewija feed na dół za każdym razem gdy pojawi się nowy wpis.
  // setTimeout(0) zapewnia że DOM jest już zaktualizowany przed pomiarem scrollHeight.
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
