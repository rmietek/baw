<script>
  // Ocena Strat Bojowych (Battle Damage Assessment) — wyświetla tabelę strat i agreguje sumy.
  // Dodawanie wpisów: tylko OPERACYJNY. Walidacja client-side pokrywa się z walidacją serwera
  // (format daty YYYY-MM-DD, max długości pól, count >= 0).
  import { onMount } from 'svelte';
  import axios from 'axios';
  import { user } from '../stores/auth';

  // Mapy CSS klas dla stron konfliktu
  const SIDE_CLASS = { IRAN: 'side-iran', KOALICJA: 'side-koalicja', CYWILE: 'side-cywile' };
  const EMPTY_FORM = { event_date: '', location: '', side: 'IRAN', category: 'MILITARNE', count: '', description: '' };

  let rows    = [];
  let form    = { ...EMPTY_FORM };
  let loading = false;
  let flash   = '';

  const api = 'casualties';

  // Pobiera wszystkie wpisy strat bojowych posortowane od najnowszych.
  async function load() {
    try {
      const { data } = await axios.get(`/api/${api}`);
      rows = data;
    } catch { /* ignoruj */ }
  }

  onMount(() => { load(); });

  // Wyświetla komunikat flash przez 2.5 s.
  function showFlash(msg, ok = true) {
    flash = { msg, ok };
    setTimeout(() => flash = '', 2500);
  }

  // Dodaje nowy wpis strat (POST /api/casualties). Tylko OPERACYJNY.
  // Walidacja: format daty YYYY-MM-DD, niepuste pola, count >= 0, maks. długości.
  // side i category walidowane allowlistą — niezgodne wartości odrzucane przez serwer.
  async function submit() {
    if ($user?.role !== 'OPERACYJNY') { showFlash('Wymagana rola: OPERACYJNY', false); return; }
    if (!form.event_date)         { showFlash('Data jest wymagana', false); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.event_date)) { showFlash('Nieprawidłowy format daty', false); return; }
    if (!form.location?.trim())   { showFlash('Lokalizacja jest wymagana', false); return; }
    if (form.location.length > 100) { showFlash('Lokalizacja max 100 znaków', false); return; }
    if (form.count === '' || form.count === null) { showFlash('Podaj liczbę', false); return; }
    if (Number(form.count) < 0)   { showFlash('Liczba nie może być ujemna', false); return; }
    if (form.description?.length > 255) { showFlash('Opis max 255 znaków', false); return; }
    loading = true;
    try {
      await axios.post(`/api/${api}`, form, { withCredentials: true });
      form = { ...EMPTY_FORM };
      showFlash('Wpis dodany');
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    } finally {
      loading = false;
    }
  }

  // Reaktywna agregacja sum strat per strona — przeliczana przy każdej zmianie rows.
  $: totals = rows.reduce((acc, r) => {
    acc[r.side] = (acc[r.side] || 0) + Number(r.count);
    return acc;
  }, {});
</script>

<div class="sec" id="casualties">
  <div class="section-header">Ocena Strat Bojowych</div>

  <div style="display:flex;gap:10px;margin-bottom:12px">
    {#each ['IRAN','KOALICJA','CYWILE'] as s}
      <div class="rate-card" style="flex:1">
        <div class="rate-card-label">{s}</div>
        <div class="rate-card-value {SIDE_CLASS[s]}">{totals[s] || 0}</div>
      </div>
    {/each}
  </div>

  <div class="cas-scroll">
    <table class="cas-table">
      <thead>
        <tr>
          <th>Data</th><th>Lokalizacja</th><th>Strona</th>
          <th>Kategoria</th><th>Liczba</th><th>Opis</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.id)}
          <tr>
            <td class="cas-date">{r.event_date?.slice(0, 10)}</td>
            <td class="cas-loc">{r.location}</td>
            <td><span class="cas-badge {SIDE_CLASS[r.side]}">{r.side}</span></td>
            <td><span class="cas-cat">{r.category}</span></td>
            <td class="cas-count">{r.count}</td>
            <td class="cas-desc">{r.description}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="cas-form">
    {#if $user?.role !== 'OPERACYJNY'}
      <div style="font-size:10px;color:var(--text-dim);padding:6px 10px;border:1px solid #1a3a1a;background:#060a06;margin-bottom:8px">
        Formularz niedostępny — wymagana rola OPERACYJNY
      </div>
    {/if}

    {#if flash}
      <div style="font-size:10px;letter-spacing:.1em;padding:6px 10px;margin-bottom:8px;background:{flash.ok ? '#0a120a' : '#120808'};border:1px solid {flash.ok ? '#1a3a1a' : 'var(--red-dim)'};color:{flash.ok ? '#3a9a3a' : 'var(--red-bright)'}">
        {flash.msg}
      </div>
    {/if}

    <div class="cas-form-row">
      <input type="date" bind:value={form.event_date} disabled={loading} />
      <input placeholder="Lokalizacja *" bind:value={form.location} disabled={loading} />
      <select bind:value={form.side} disabled={loading}>
        <option>IRAN</option><option>KOALICJA</option><option>CYWILE</option>
      </select>
      <select bind:value={form.category} disabled={loading}>
        <option>MILITARNE</option><option>CYWILNE</option><option>INFRASTRUKTURA</option>
      </select>
    </div>
    <div class="cas-form-row">
      <input type="number" placeholder="Liczba" bind:value={form.count}
        disabled={loading} style="flex:0 0 180px" />
      <input placeholder="Opis zdarzenia" bind:value={form.description}
        on:keydown={e => e.key === 'Enter' && !loading && submit()}
        disabled={loading} />
      <button class="btn-calc" on:click={submit} disabled={loading}>
        {loading ? 'DODAWANIE...' : '▶ DODAJ'}
      </button>
    </div>
  </div>
</div>
