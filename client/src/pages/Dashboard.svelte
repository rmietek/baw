<script>
  import { onMount } from 'svelte';
  import axios from 'axios';
  import { user } from '../stores/auth';
  import Navbar             from '../components/Navbar.svelte';
  import Comments           from '../components/Comments.svelte';
  import Calculator         from '../components/Calculator.svelte';
  import IntelReports       from '../components/IntelReports.svelte';
  import Casualties         from '../components/Casualties.svelte';
  import LiveFeed           from '../components/LiveFeed.svelte';
  import IranMap            from '../components/IranMap.svelte';
  import Timeline           from '../components/Timeline.svelte';
  import ConnectedConflicts from '../components/ConnectedConflicts.svelte';
  import Petition           from '../components/Petition.svelte';
  import FileUpload         from '../components/FileUpload.svelte';
  import UserDirectory      from '../components/UserDirectory.svelte';
  import PasswordReset      from '../components/PasswordReset.svelte';

  const WAR_START = new Date('2026-02-28T00:00:00Z');
  const FIRST6    = 11_300_000_000;
  const DAILY     = 1_000_000_000;

  const TICKER_ITEMS = [
    'BIEŻĄCY SZACUNEK · OPERACJA EPICKA FURIA · UDERZENIA ROZPOCZĘTE 28 LUT 2026',
    '★ SZACOWANY KOSZT: $1 MLD / DZIEN · ZRODLO: PENTAGON / CENTCOM',
    '⚠ OSTRZEZENIE: DANE CZESCIOWO UTAJNIONE · RZECZYWISTE KOSZTY MOGA BYC WYZSZE',
  ];

  const WEAPONS_STATIC = [
    { name: 'GBU-57 MOP (bomba bunkrowa)',     cost: 3_500_000,  count: 18,  pct: 90  },
    { name: 'Tomahawk BGM-109 (rakieta)',       cost: 2_000_000,  count: 120, pct: 100 },
    { name: 'F-35A / F-35B (sortie)',           cost: 36_000,     count: 340, pct: 60  },
    { name: 'B-2 Spirit (przelot)',             cost: 130_000,    count: 42,  pct: 100 },
    { name: 'AGM-158 JASSM-ER',                 cost: 1_300_000,  count: 65,  pct: 80  },
    { name: 'MQ-9 Reaper (zestrzelone)',        cost: 32_000_000, count: 3,   pct: 20  },
    { name: 'GBU-28 (bomba bunkrowa mala)',     cost: 145_000,    count: 280, pct: 70  },
  ];

  function calcCost(now) {
    const ms = now - WAR_START.getTime();
    if (ms <= 0) return 0;
    const d = ms / 86_400_000;
    return d <= 6 ? (FIRST6 / 6) * d : FIRST6 + (d - 6) * DAILY;
  }

  function pad(n)  { return String(n).padStart(2, '0'); }
  function fmt(n)  { return '$' + Math.floor(n).toLocaleString('en-US'); }
  function fmtBig(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' mld';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + ' mln';
    if (n >= 1e3) return Math.floor(n / 1000) + ' tys.';
    return String(Math.floor(n));
  }

  let now = Date.now();
  $: cost = calcCost(now);
  $: secs = Math.floor(Math.max(0, now - WAR_START.getTime()) / 1000);
  $: days = Math.floor(secs / 86400);
  $: hrs  = Math.floor((secs % 86400) / 3600);
  $: min  = Math.floor((secs % 3600) / 60);
  $: sec  = secs % 60;

  onMount(() => {
    const id = setInterval(() => { now = Date.now(); }, 1000);
    return () => clearInterval(id);
  });

  // Weapons
  let weapons    = WEAPONS_STATIC;
  let weaponForm = { name: '', cost: '', count_used: '', pct: '', category: 'air' };
  let weaponMsg  = '';
  let editingId  = null;
  let editForm   = {};

  onMount(async () => {
    await refreshWeapons();
    await getUsdRate();
  });

  async function refreshWeapons() {
    try {
      const r = await axios.get('/api/weapons');
      if (r.data?.length) weapons = r.data;
    } catch {}
  }

  async function addWeapon() {
    try {
      await axios.post('/api/weapons', weaponForm);
      await refreshWeapons();
      weaponForm = { name: '', cost: '', count_used: '', pct: '', category: 'air' };
      weaponMsg = 'Dodano.';
    } catch (e) { weaponMsg = 'Blad: ' + (e.response?.data || e.message); }
  }

  async function deleteWeapon(id) {
    try {
      await axios.delete(`/api/weapons/${id}`);
      weapons = weapons.filter(x => x.id !== id);
      if (editingId === id) editingId = null;
    } catch { weaponMsg = 'Blad usuwania.'; }
  }

  function startEdit(w) {
    editingId = w.id;
    editForm = { name: w.name, cost: w.cost, count_used: w.count_used ?? w.count, pct: w.pct, category: w.category ?? 'air' };
  }

  async function saveEdit(id) {
    try {
      await axios.put(`/api/weapons/${id}`, editForm);
      await refreshWeapons();
      editingId = null;
      weaponMsg = 'Zaktualizowano.';
    } catch (e) { weaponMsg = 'Blad edycji: ' + (e.response?.data || e.message); }
  }

  $: wTotal = weapons.reduce((s, w) => s + (w.cost * (w.count_used ?? w.count)), 0);

  let usdRate = null;

  async function getUsdRate() {
    try {
      const { data } = await axios.get('/api/usd-rate', { withCredentials: true });
      usdRate = data.mid;
    } catch {
      /* rate stays null — UI shows fallback */
    }
  }
</script>

<div>
  <Navbar />

  <!-- TICKER -->
  <div class="top-banner">
    <div class="banner-track">
      {#each [...TICKER_ITEMS, ...TICKER_ITEMS] as t}
        <span><span class="pd" /> {t}</span>
      {/each}
    </div>
  </div>

  <div class="container">

    <div class="vpanel-offset">

    <header class="site-header">
      <div class="site-title">Monitor Konfliktu w Iranie</div>
      <div class="site-subtitle">Monitoring konfliktu · Dane wywiadowcze w czasie rzeczywistym</div>
    </header>

    {#if $user?.loggedIn}
      <div class="welcome-banner">
        ▸ WITAJ, <strong>{$user.agent_id}</strong> · ROLA:
        <strong style="color:var(--gold)">{$user.role}</strong>
      </div>
    {/if}

    <div class="source-note">
      NA PODSTAWIE <a href="#">BRIEFINGU PENTAGONU DO KONGRESU</a>: $11,3 MLD ZA PIERWSZE 6 DNI, NASTEPNIE $1 MLD/DZIEN CIAGLE WYDATKI
    </div>

    <!-- COST CARD -->
    <div class="sec">
      <div class="cost-card">
        <div class="cost-label">Szacunkowy koszt USA od poczatku uderzen</div>
        <div class="cost-total">{fmt(cost)}</div>
        <div class="cost-breakdown">$11,3 mld za pierwsze 6 dni (<a href="#">Pentagon + Kongres</a>) + $1 mld/dzien ciagle</div>
        <div class="timer">
          <div class="timer-block"><div class="timer-num">{pad(days)}</div><div class="timer-label">Dni</div></div>
          <div class="timer-sep">:</div>
          <div class="timer-block"><div class="timer-num">{pad(hrs)}</div><div class="timer-label">Godz</div></div>
          <div class="timer-sep">:</div>
          <div class="timer-block"><div class="timer-num">{pad(min)}</div><div class="timer-label">Min</div></div>
          <div class="timer-sep">:</div>
          <div class="timer-block"><div class="timer-num">{pad(sec)}</div><div class="timer-label">Sek</div></div>
        </div>
      </div>
    </div>

    <!-- RATE ROW -->
    <div class="sec">
      <div class="rate-row">
        <div class="rate-card">
          <div class="rate-card-label">Na sekunde</div>
          <div class="rate-card-value">$11 574</div>
        </div>
        <div class="rate-card">
          <div class="rate-card-label">Na godzine</div>
          <div class="rate-card-value">$41 666 667</div>
        </div>
        <div class="rate-card">
          <div class="rate-card-label">Kurs USD/PLN</div>
          {#if usdRate}
            <div class="rate-card-value">{usdRate.toFixed(4)} zł</div>
            <span style="color:var(--text-dim);font-size:9px;font-family:var(--mono)">NBP API · 1 USD</span>
          {:else}
            <span style="color:var(--text-dim);font-size:9px;font-family:var(--mono)">ładowanie...</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="action-row">
      <a class="btn" href="#">✕ Udostepnij na X</a>
      <a class="btn" href="#">↑ Podziel sie</a>
      <a class="btn" href="#">✿ Kopiuj link</a>
      <a class="btn btn-support" href="#">★ Wesprzyj</a>
    </div>

    </div><!-- /vpanel-offset -->

    <!-- PETITION -->
    <Petition />

    <div class="vpanel-offset">
    <!-- HUMAN COST -->
    <div class="sec">
      <div class="section-header">Ludzki koszt</div>
      <div class="human-grid">
        <div class="human-card us">
          <div class="human-label" style="color:var(--blue)">Zolnierze USA</div>
          <div class="human-num" style="color:var(--blue)">13</div>
          <div class="human-desc">zabitych</div>
          <div class="human-num" style="color:#6ab4e8;font-size:17px">200</div>
          <div class="human-desc">rannych</div>
        </div>
        <div class="human-card iran-mil">
          <div class="human-label" style="color:var(--gold)">Armia Iranu</div>
          <div class="human-num" style="color:var(--gold)">5004+</div>
          <div class="human-desc">zabitych</div>
          <div style="font-size:10px;color:#aaa;letter-spacing:.07em;margin-top:4px">w tym wyzsze dowodztwo</div>
        </div>
        <div class="human-card iran-civ">
          <div class="human-label" style="color:var(--red-bright)">Cywile iranscy</div>
          <div class="human-num" style="color:var(--red-bright)">1500+</div>
          <div class="human-desc">zabitych</div>
          <div class="human-num" style="color:#d97878;font-size:17px">20 984+</div>
          <div class="human-desc">rannych</div>
        </div>
      </div>
      <div class="alert-note">
        <strong>Atak na infrastrukture cywilna w rejonie Bandar Abbas</strong> – zniszczenia obiektow uzytkowych, przerwy w dostawie pradu i wody. Potepione przez organizacje humanitarne.
      </div>
      <div class="sources">Zrodla: DoD/CENTCOM, Hengaw, Iranski Czerwony Polksiezyc, AP, Reuters, Al Jazeera</div>
    </div>
    </div><!-- /vpanel-offset -->

    <!-- MAP -->
    <IranMap />

    <div class="vpanel-offset">
    <!-- COMPARISON -->
    <div class="sec" id="koszty">
      <div class="section-header">Za te pieniadze mozna by...</div>
      <div class="compare-grid">
        <div class="compare-card">
          <div class="compare-icon">🏥</div>
          <div>
            <div class="compare-num">{fmtBig(cost / 50_000_000)}</div>
            <div class="compare-desc">pelnych szpitali wyposazonych<br/>i gotowych do pracy przez rok</div>
          </div>
        </div>
        <div class="compare-card">
          <div class="compare-icon">🏫</div>
          <div>
            <div class="compare-num">{fmtBig(cost / 5_000_000)}</div>
            <div class="compare-desc">nowych szkol publicznych<br/>zbudowanych od podstaw</div>
          </div>
        </div>
        <div class="compare-card">
          <div class="compare-icon">💉</div>
          <div>
            <div class="compare-num">{fmtBig(cost / 2)}</div>
            <div class="compare-desc">dawek szczepionek dla dzieci<br/>w krajach rozwijajacych sie</div>
          </div>
        </div>
        <div class="compare-card">
          <div class="compare-icon">☀️</div>
          <div>
            <div class="compare-num">{fmtBig(cost / 15_000)}</div>
            <div class="compare-desc">domowych instalacji<br/>fotowoltaicznych (5 kW)</div>
          </div>
        </div>
      </div>
    </div>
    </div><!-- /vpanel-offset -->

    <!-- WEAPONS TABLE -->
    <div class="sec" id="bron">
      <div class="section-header">Uzbrojenie i koszty jednostkowe</div>
      <table class="weapons-table">
        <thead>
          <tr>
            <th>System / bron</th><th>Koszt / szt.</th><th>Uzyto</th><th>Koszt laczny</th><th style="width:100px">Udzial</th>
            {#if $user?.role === 'OPERACYJNY'}<th style="width:60px"></th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each weapons as w (w.id ?? w.name)}
            {#if editingId === w.id}
              <tr style="background:#0d1a0d">
                <td><input class="admin-input w-edit-input" bind:value={editForm.name} /></td>
                <td><input class="admin-input w-edit-input" type="number" bind:value={editForm.cost} /></td>
                <td><input class="admin-input w-edit-input" type="number" bind:value={editForm.count_used} /></td>
                <td><input class="admin-input w-edit-input" type="number" placeholder="%" bind:value={editForm.pct} /></td>
                <td>
                  <select class="admin-input w-edit-input" bind:value={editForm.category}>
                    <option value="air">air</option>
                    <option value="naval">naval</option>
                    <option value="drone">drone</option>
                    <option value="ground">ground</option>
                  </select>
                </td>
                <td style="white-space:nowrap">
                  <button class="admin-btn" style="font-size:10px;padding:3px 8px;margin-right:4px" on:click={() => saveEdit(w.id)}>✓</button>
                  <button class="del-btn" on:click={() => editingId = null}>✕</button>
                </td>
              </tr>
            {:else}
              <tr>
                <td class="w-name">{w.name}</td>
                <td class="w-cost">{fmt(w.cost)}</td>
                <td class="w-count">{w.count_used ?? w.count}</td>
                <td class="w-total">{fmt(w.cost * (w.count_used ?? w.count))}</td>
                <td><div class="w-bar-wrap"><div class="w-bar" style="width:{w.pct}%" /></div></td>
                {#if $user?.role === 'OPERACYJNY'}
                  <td style="white-space:nowrap">
                    <button class="del-btn" style="margin-right:4px" on:click={() => startEdit(w)} title="Edytuj">✎</button>
                    <button class="del-btn" on:click={() => deleteWeapon(w.id)} title="Usun">✕</button>
                  </td>
                {/if}
              </tr>
            {/if}
          {/each}
          <tr class="weapons-total-row">
            <td colspan="3">LACZNY SZACOWANY KOSZT AMUNICJI</td>
            <td class="w-total">{fmt(wTotal)}</td>
            <td></td>
            {#if $user?.role === 'OPERACYJNY'}<td></td>{/if}
          </tr>
        </tbody>
      </table>

      {#if $user?.role === 'OPERACYJNY'}
        <div class="admin-form" style="margin-top:12px">
          <div class="admin-form-title">DODAJ UZBROJENIE</div>
          <div class="admin-form-row">
            <input class="admin-input" placeholder="Nazwa systemu" bind:value={weaponForm.name} />
            <input class="admin-input" placeholder="Koszt / szt. (USD)" type="number" bind:value={weaponForm.cost} />
            <input class="admin-input" placeholder="Uzyto (szt.)" type="number" bind:value={weaponForm.count_used} />
            <input class="admin-input" placeholder="Udzial %" type="number" bind:value={weaponForm.pct} />
            <select class="admin-input" bind:value={weaponForm.category}>
              <option value="air">air</option>
              <option value="naval">naval</option>
              <option value="drone">drone</option>
              <option value="ground">ground</option>
            </select>
            <button class="admin-btn" on:click={addWeapon}>DODAJ</button>
          </div>
          {#if weaponMsg}<div class="admin-msg">{weaponMsg}</div>{/if}
        </div>
      {/if}
    </div>

    <!-- INTEL REPORTS -->
    <IntelReports />

    <!-- CASUALTIES -->
    <Casualties />

    <!-- COMMENTS -->
    <Comments />

    <!-- CALCULATOR -->
    <Calculator totalCost={cost} />

    <!-- LIVE FEED -->
    <LiveFeed />

    <!-- TIMELINE -->
    <Timeline />

    <!-- CONNECTED CONFLICTS -->
    <ConnectedConflicts />

    <!-- FILE UPLOAD -->
    <FileUpload />

    <!-- USER DIRECTORY -->
    <UserDirectory />

    <!-- PASSWORD RESET -->
    <PasswordReset />


    <div class="vpanel-offset">
      <div class="disclaimer">
        Szacunki oparte na danych z briefingow Pentagonu i Kongresu. Rzeczywiste koszty moga byc wyzsze z uwagi na operacje niejawne.<br />
        Dane o ofiarach: DoD, AP, Reuters, Al Jazeera, Iranski Czerwony Polksiezyc. Aktualizacja w czasie rzeczywistym.<br /><br />
        Ta strona ma charakter informacyjny i edukacyjny. Nie reprezentuje zadnej partii politycznej.
      </div>
    </div>

  </div>
</div>
