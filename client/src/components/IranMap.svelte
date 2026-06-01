<script>
  import { onMount } from 'svelte';
  import axios from 'axios';
  import { user } from '../stores/auth';

  const STATIC_STRIKES = [
    { cx:295, cy:158, r:7,  pr:20, color:'#c0392b', glow:'#e74c3c', delay:'0s',   label:'TEHERAN',  lx:295, ly:150, anchor:'middle', name:'Teheran',      type:'Centrum Dowodzenia IRGC | 3 uderzenia | B-2 Spirit' },
    { cx:275, cy:215, r:6,  pr:17, color:'#d4a017', glow:'#d4a017', delay:'.6s',  label:'FORDOW',   lx:310, ly:212, anchor:'start',  name:'Fordow',       type:'Podziemny zaklad nuklearny | 12 uderzen | GBU-57' },
    { cx:260, cy:228, r:6,  pr:16, color:'#d4a017', glow:'#d4a017', delay:'1.2s', label:'NATANZ',   lx:222, ly:228, anchor:'end',    name:'Natanz',       type:'Zaklad wzbogacania uranu | 8 uderzen | GBU-57 MOP' },
    { cx:252, cy:250, r:5,  pr:14, color:'#c0392b', glow:'#e74c3c', delay:'1.8s', label:'ISFAHAN',  lx:222, ly:252, anchor:'end',    name:'Isfahan',      type:'Baza lotnicza IRIAF | 5 uderzen | Tomahawk' },
    { cx:237, cy:203, r:5,  pr:13, color:'#d4a017', glow:'#d4a017', delay:'2.4s', label:'ARAK',     lx:220, ly:198, anchor:'end',    name:'Arak',         type:'Reaktor ciezkiej wody | 2 uderzenia | Tomahawk' },
    { cx:305, cy:375, r:5,  pr:14, color:'#4a9eca', glow:'#4a9eca', delay:'.9s',  label:'B.ABBAS',  lx:322, ly:380, anchor:'start',  name:'Bandar Abbas', type:'Baza morska IRGC | 4 uderzenia | F/A-18 Super Hornet' },
    { cx:172, cy:336, r:5,  pr:13, color:'#27ae60', glow:'#27ae60', delay:'1.5s', label:'KHARG',    lx:155, ly:330, anchor:'end',    name:'Wyspa Kharg',  type:'Terminal naftowy | 1 uderzenie | F-35A' },
    { cx:198, cy:310, r:5,  pr:12, color:'#c0392b', glow:'#666',    delay:'2s',   label:'BUSHEHR',  lx:180, ly:306, anchor:'end',    name:'Bushehr',      type:'Elektrownia jadrowa | zablokowana | Brak ataku (konwencja)', locked:true },
  ];

  const COLOR_MAP = {
    military: { stroke: '#c0392b', glow: '#e74c3c', label: 'Cel wojskowy' },
    nuclear:  { stroke: '#d4a017', glow: '#d4a017', label: 'Obiekt nuklearny' },
    naval:    { stroke: '#4a9eca', glow: '#4a9eca', label: 'Baza morska' },
    infra:    { stroke: '#27ae60', glow: '#27ae60', label: 'Infrastruktura' },
  };

  let tooltip  = null;
  let dynamic  = [];
  let utcTime  = '';

  function updateClock() {
    const d = new Date();
    const p = n => String(n).padStart(2,'0');
    utcTime = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
  }
  let pending  = null;
  let form     = { name: '', type_desc: '', color_type: 'military', added_by: '' };
  let loading  = false;
  let flash    = '';
  let showForm = false;
  let mapEl, wrapEl;

  $: api = 'strikes';
  $: canDelete = $user?.role === 'OPERACYJNY';
  $: canAdd    = $user?.role === 'ANALITYK' || $user?.role === 'OPERACYJNY';

  async function loadStrikes() {
    try {
      const { data } = await axios.get(`/api/${api}`);
      dynamic = data;
    } catch { /* ignoruj */ }
  }

  onMount(() => {
    loadStrikes();
    updateClock();
    const iv = setInterval(updateClock, 1000);
    return () => clearInterval(iv);
  });

  function showTooltip(e, name, desc, reporter) {
    const mr = mapEl.getBoundingClientRect();
    const wr = wrapEl.getBoundingClientRect();
    const x = e.clientX - wr.left + 14;
    const y = e.clientY - wr.top  - 24;
    tooltip = { name, desc, reporter, left: x > wr.width - 220 ? x - 230 : x, top: y };
  }

  function handleMapClick(e) {
    if (e.target.classList.contains('sdot')) return;
    if (!canAdd) return;
    const mr  = mapEl.getBoundingClientRect();
    const sx  = 620 / mr.width;
    const sy  = 490 / mr.height;
    const cx  = ((e.clientX - mr.left) * sx).toFixed(1);
    const cy  = ((e.clientY - mr.top)  * sy).toFixed(1);
    pending = { cx: parseFloat(cx), cy: parseFloat(cy) };
    showForm = true;
    flash = '';
  }

  async function submitStrike() {
    if (!canAdd) { flash = 'Brak uprawnień'; return; }
    if (!form.name.trim()) { flash = 'Wpisz nazwę celu'; return; }
    loading = true;
    try {
      await axios.post(`/api/${api}`, { ...form, cx: pending?.cx ?? 300, cy: pending?.cy ?? 200 });
      form = { name: '', type_desc: '', color_type: 'military', added_by: '' };
      pending = null;
      showForm = false;
      flash = 'Punkt dodany';
      setTimeout(() => flash = '', 2500);
      await loadStrikes();
    } catch (err) {
      flash = err.response?.data?.error || err.message;
    } finally { loading = false; }
  }

  async function deleteStrike(id, e) {
    e.stopPropagation();
    await axios.delete(`/api/${api}/${id}`);
    await loadStrikes();
  }
</script>

<div class="sec" id="mapa">
  <div class="section-header">Mapa uderzeń — Iran</div>

  <div class="ops-frame">

    <!-- TOP STATUS BAR -->
    <div class="ops-topbar">
      <div class="ops-topbar-left">
        <span class="ops-status-dot"></span>
        <span class="ops-status-text">SYSTEM AKTYWNY</span>
        <span class="ops-sep">|</span>
        <span class="ops-label">MISJA:</span>
        <span class="ops-val">EPIC FURY</span>
        <span class="ops-sep">|</span>
        <span class="ops-label">STREFA:</span>
        <span class="ops-val">32.4°N 53.7°E</span>
      </div>
      <div class="ops-topbar-right">
        <span class="ops-label">KLIKNIJ MAPĘ ABY DODAĆ CEL</span>
        <span class="ops-sep">|</span>
        <span class="ops-clock">{utcTime}</span>
      </div>
    </div>

  <div class="map-wrap" bind:this={wrapEl}>
    <div class="map-scanline"></div>

    <!-- tooltip -->
    <div class="strike-tooltip" style="left:{tooltip?.left}px;top:{tooltip?.top}px;opacity:{tooltip ? 1 : 0};pointer-events:none">
      {#if tooltip}
        <div class="tt-header">◉ CEL ZIDENTYFIKOWANY</div>
        <div class="tt-divider"></div>
        <div class="tt-row"><span class="tt-lbl">NAZWA CELU</span><span class="tt-name">{tooltip.name || ''}</span></div>
        {#if tooltip.desc}
          <div class="tt-row"><span class="tt-lbl">OPIS</span><span class="tt-val">{tooltip.desc}</span></div>
        {/if}
        {#if tooltip.reporter}
          <div class="tt-row"><span class="tt-lbl">ZGŁASZAJĄCY</span><span class="tt-val">{tooltip.reporter}</span></div>
        {/if}
      {/if}
    </div>

    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <svg viewBox="0 0 620 490" xmlns="http://www.w3.org/2000/svg"
      bind:this={mapEl}
      on:click={handleMapClick}
      style="width:100%;height:auto;display:block;cursor:crosshair">
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="2.5" result="cb"/>
          <feMerge><feMergeNode in="cb"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id="bg-grad" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#0d150d"/>
          <stop offset="100%" stop-color="#0a0d0a"/>
        </radialGradient>
      </defs>
      <rect width="620" height="490" fill="url(#bg-grad)"/>
      <line x1="0"   y1="163" x2="620" y2="163" stroke="#0d180d" stroke-width=".5"/>
      <line x1="0"   y1="290" x2="620" y2="290" stroke="#0d180d" stroke-width=".5"/>
      <line x1="207" y1="0"   x2="207" y2="490" stroke="#0d180d" stroke-width=".5"/>
      <line x1="393" y1="0"   x2="393" y2="490" stroke="#0d180d" stroke-width=".5"/>
      <text x="28"  y="75"  fill="#15251a" font-size="9" font-family="monospace">AZERBEJDZAN</text>
      <text x="18"  y="210" fill="#15251a" font-size="9" font-family="monospace">IRAK</text>
      <text x="500" y="115" fill="#15251a" font-size="9" font-family="monospace">TURKMENISTAN</text>
      <text x="500" y="305" fill="#15251a" font-size="9" font-family="monospace">AFGANISTAN</text>
      <text x="355" y="460" fill="#15251a" font-size="9" font-family="monospace">PAKISTAN</text>
      <text x="78"  y="430" fill="#15251a" font-size="9" font-family="monospace">ZATOKA PERSKA</text>
      <path d="M145,62 L175,42 L228,36 L278,31 L338,41 L398,52 L448,72 L478,103 L498,143 L508,183 L498,224 L488,264 L468,294 L456,326 L436,356 L406,376 L376,396 L346,408 L316,418 L286,422 L256,418 L224,406 L200,384 L178,362 L158,338 L136,308 L120,276 L108,244 L100,212 L102,178 L108,148 L118,118 L130,92 Z"
        fill="#0f1c0f" stroke="#1e3e1e" stroke-width="1.5"/>
      <path d="M145,62 L168,57 L210,50 L255,46 L295,50 L338,41" fill="none" stroke="#14303e" stroke-width="1"/>

      <rect x="400" y="28" width="200" height="108" rx="1" fill="#080808" stroke="#162416" stroke-width="1"/>
      <text x="412" y="47" fill="#1e3e1e" font-size="9" font-family="monospace" letter-spacing="1">STATYSTYKI UDERZEN</text>
      <circle cx="412" cy="64"  r="4" fill="#e74c3c"/><text x="422" y="68"  fill="#e74c3c" font-size="11" font-family="monospace">Wojskowe: {STATIC_STRIKES.filter(s=>!s.locked).length + dynamic.filter(d=>d.color_type==='military').length}</text>
      <circle cx="412" cy="80"  r="4" fill="#d4a017"/><text x="422" y="84"  fill="#d4a017" font-size="11" font-family="monospace">Nuklearne: 12</text>
      <circle cx="412" cy="96"  r="4" fill="#4a9eca"/><text x="422" y="100" fill="#4a9eca" font-size="11" font-family="monospace">Morskie: 4</text>
      <circle cx="412" cy="112" r="4" fill="#27ae60"/><text x="422" y="116" fill="#27ae60" font-size="11" font-family="monospace">Zgloszone: {dynamic.length}</text>

      <line x1="96" y1="452" x2="200" y2="452" stroke="#1e3e1e" stroke-width="1"/>
      <line x1="96" y1="447" x2="96"  y2="457" stroke="#1e3e1e" stroke-width="1"/>
      <line x1="200" y1="447" x2="200" y2="457" stroke="#1e3e1e" stroke-width="1"/>
      <text x="148" y="466" fill="#1e3e1e" font-size="9" font-family="monospace" text-anchor="middle">~400 km</text>

      {#each STATIC_STRIKES as s (s.name)}
        <g>
          <circle cx={s.cx} cy={s.cy} r={s.pr} fill="none" stroke="{s.color}30" stroke-width="1.5"
            style="animation:ping 2s ease-out infinite;animation-delay:{s.delay};transform-origin:{s.cx}px {s.cy}px"/>
          <!-- svelte-ignore a11y-mouse-events-have-key-events -->
          <circle cx={s.cx} cy={s.cy} r={s.r} fill="{s.color}30" stroke={s.color}
            stroke-width="1.5" class="sdot" style="cursor:pointer"
            on:mouseenter={e => showTooltip(e, s.name, s.type, null)}
            on:mouseleave={() => tooltip = null}/>
          <circle cx={s.cx} cy={s.cy} r={s.r - 3.5}
            fill={s.locked ? '#666' : s.glow} filter="url(#glow)"/>
          <text x={s.lx} y={s.ly} fill={s.locked ? '#666' : s.glow}
            font-size="9" font-family="monospace" text-anchor={s.anchor}>{s.label}</text>
        </g>
      {/each}

      {#each dynamic as s (`d-${s.id}`)}
        {@const c = COLOR_MAP[s.color_type] || COLOR_MAP.military}
        <!-- svelte-ignore a11y-mouse-events-have-key-events -->
        <g style="cursor:pointer"
          on:mouseenter={e => showTooltip(e, s.name, s.type_desc || 'Zgłoszone przez użytkownika', s.added_by || null)}
          on:mouseleave={() => tooltip = null}>
          <circle cx={s.cx} cy={s.cy} r={18} fill="none" stroke="{c.stroke}25"
            stroke-width="1" style="animation:ping 2s ease-out infinite;transform-origin:{s.cx}px {s.cy}px"/>
          <circle cx={s.cx} cy={s.cy} r={6} fill="{c.stroke}25"
            stroke={c.stroke} stroke-width="1.5" stroke-dasharray="3,2" class="sdot"/>
          <circle cx={s.cx} cy={s.cy} r={2.5} fill={c.glow} filter="url(#glow)"/>
          <text x={s.cx} y={s.cy - 10} fill={c.glow} font-size="7"
            font-family="monospace" text-anchor="middle">▲USER</text>
        </g>
      {/each}

      {#if pending}
        <g>
          <circle cx={pending.cx} cy={pending.cy} r={12} fill="none"
            stroke="#fff" stroke-width="1" stroke-dasharray="4,3" opacity=".6"
            style="animation:ping 1s ease-out infinite;transform-origin:{pending.cx}px {pending.cy}px"/>
          <circle cx={pending.cx} cy={pending.cy} r={4}
            fill="rgba(255,255,255,0.3)" stroke="#fff" stroke-width="1.5"/>
          <text x={pending.cx} y={pending.cy - 14} fill="#fff" font-size="8"
            font-family="monospace" text-anchor="middle">NOWY CEL</text>
        </g>
      {/if}
    </svg>

    <!-- BOTTOM LEGEND BAR -->
    <div class="ops-bottombar">
      {#each [
        { color:'#e74c3c', label:'Wojskowy' },
        { color:'#d4a017', label:'Nuklearny' },
        { color:'#4a9eca', label:'Morski' },
        { color:'#27ae60', label:'Infra' },
        { color:'#555',    label:'Zablokowany' },
      ] as item}
        <div class="ops-legend-item">
          <div class="ops-legend-dot" style="background:{item.color};box-shadow:0 0 4px {item.color}"/>
          {item.label}
        </div>
      {/each}
      <div style="margin-left:auto;color:#2a2a2a;font-size:8px;letter-spacing:.1em">
        ▲ USER · CELE: {STATIC_STRIKES.length + dynamic.length} · ZGŁOSZONE: {dynamic.length}
      </div>
    </div>
  </div>
  </div>

  {#if showForm}
    <div class="strike-form">
      <div class="strike-form-topbar">
        <span class="strike-form-dot"></span>
        <span class="strike-form-title">AKWIZYCJA CELU — ZGŁOŚ NOWE UDERZENIE</span>
        {#if pending}
          <span class="strike-coord-badge">◎ CX:{pending.cx} · CY:{pending.cy}</span>
        {/if}
        <button class="strike-close-btn" on:click={() => { showForm = false; pending = null; }}>✕ ESC</button>
      </div>

      <div class="strike-form-body">
        <div class="strike-form-row">
          <div class="calc-field">
            <label>◉ Nazwa celu *</label>
            <input bind:value={form.name} placeholder="np. Baza Isfahan" disabled={loading} />
          </div>
          <div class="calc-field" style="flex:0 0 160px">
            <label>▸ Typ celu</label>
            <select bind:value={form.color_type} disabled={loading}>
              <option value="military">Wojskowy</option>
              <option value="nuclear">Nuklearny</option>
              <option value="naval">Morski</option>
              <option value="infra">Infrastruktura</option>
            </select>
          </div>
        </div>

        <div class="strike-form-row">
          <div class="calc-field" style="flex:2">
            <label>▸ Opis / szczegóły</label>
            <input bind:value={form.type_desc} placeholder="np. 3 uderzenia | Tomahawk" disabled={loading} />
          </div>
          <div class="calc-field">
            <label>▸ Zgłaszający</label>
            <input bind:value={form.added_by} placeholder="AGENT-ID" disabled={loading} />
          </div>
          <button class="btn-calc strike-submit-btn" on:click={submitStrike} disabled={loading || !form.name.trim()}>
            {loading ? '▶ ŁADOWANIE...' : '▶ ZATWIERDŹ CEL'}
          </button>
        </div>

        {#if flash}
          <div class="strike-flash" class:err={flash.startsWith('Błąd') || flash === 'Wpisz nazwę celu'}>
            {#if flash.startsWith('Błąd') || flash === 'Wpisz nazwę celu'}
              ✕ {flash}
            {:else}
              ✓ {flash}
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if dynamic.length > 0}
    <div style="margin-top:14px">
      <div style="font-size:9px;letter-spacing:.2em;color:var(--text-dim);text-transform:uppercase;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <span>Zgłoszone przez użytkowników</span>
        <span style="color:var(--gold);font-size:11px">{dynamic.length}</span>
      </div>
      <div class="border-feed">
        {#each dynamic as s (s.id)}
          {@const c = COLOR_MAP[s.color_type] || COLOR_MAP.military}
          <div class="border-entry">
            <span style="color:#555;font-size:10px;flex-shrink:0">#{s.id}</span>
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:{c.glow};box-shadow:0 0 4px {c.glow};flex-shrink:0"></span>
            <span style="color:#ddd;flex:1">{s.name}</span>
            {#if s.type_desc}<span style="color:var(--text-dim);font-size:10px">{s.type_desc}</span>{/if}
            <span style="color:#444;font-size:9px;flex-shrink:0">{s.added_by}</span>
            {#if canDelete}
              <button class="del-btn" style="flex-shrink:0" on:click={e => deleteStrike(s.id, e)} title="Usuń">✕</button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
