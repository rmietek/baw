<script>
  // Powiązane konflikty (Liban, Jemen, Irak/Syria) — lista rozwijana z statystykami.
  // Każdy konflikt ma wiele wierszy stat_key/stat_value. ANALITYK może dodawać statystyki,
  // OPERACYJNY może je edytować i usuwać. Rozwinięcie/zwinięcie zarządzane przez obiekt `open`.
  import { onMount } from 'svelte';
  import axios from 'axios';
  import { user } from '../stores/auth';

  let conflicts   = [];
  let open        = {};      // { [conflict_id]: boolean } — stan rozwinięcia sekcji
  let editing     = null;    // aktualnie edytowany wiersz statystyki
  let addForm     = null;    // formularz dodawania nowej statystyki do konfliktu
  let newConflict = null;    // formularz tworzenia nowego konfliktu
  let flash       = '';

  const api = 'conflicts';

  // Pobiera wszystkie konflikty z API — wyniki zgrupowane po conflict_id po stronie serwera.
  async function load() {
    try {
      const { data } = await axios.get(`/api/${api}`);
      conflicts = data;
    } catch { /* ignoruj */ }
  }

  onMount(() => { load(); });

  // Wyświetla komunikat sukcesu (zielony) lub błędu (czerwony) przez 2.5 s.
  function showFlash(msg, ok = true) {
    flash = { msg, ok };
    setTimeout(() => flash = '', 2500);
  }

  // Przełącza rozwinięcie/zwinięcie sekcji konfliktu.
  // Tworzy nowy obiekt zamiast mutacji — Svelte wykrywa zmianę i aktualizuje DOM.
  function toggle(id) { open = { ...open, [id]: !open[id] }; }

  // Zapisuje edytowaną statystykę konfliktu (PUT /api/conflicts/:id).
  // Tylko OPERACYJNY. Po sukcesie zeruje stan edycji i odświeża listę.
  async function saveEdit() {
    if (!isAdmin) return;
    try {
      await axios.put(`/api/${api}/${editing.conflictId}`, {
        stat_id:        editing.statId,
        stat_key:       editing.key,
        stat_value:     editing.value,
        conflict_label: editing.label,
        severity:       editing.severity || 'medium',
        is_active:      editing.is_active !== false,
      });
      editing = null;
      showFlash('Zaktualizowano');
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    }
  }

  // Dodaje nowy wiersz statystyki do istniejącego konfliktu (POST /api/conflicts/:id/stats).
  // Wymaga ANALITYK+. Walidacja: oba pola (klucz i wartość) muszą być niepuste.
  async function addStat() {
    if (!$user?.role || $user.role === 'OBSERWATOR') return;
    if (!addForm.key.trim() || !addForm.value.trim()) return;
    try {
      await axios.post(`/api/${api}/${addForm.conflictId}/stats`, {
        stat_key:       addForm.key,
        stat_value:     addForm.value,
        conflict_label: addForm.label,
      });
      addForm = null;
      showFlash('Dodano statystykę');
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    }
  }

  // Usuwa pojedynczą statystykę konfliktu (DELETE /api/conflicts/stats/:id).
  // Tylko OPERACYJNY. Nie usuwa całego konfliktu — tylko jeden wiersz stat.
  async function removeStat(statId) {
    if (!isAdmin) return;
    try {
      await axios.delete(`/api/${api}/stats/${statId}`);
      showFlash('Usunięto');
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    }
  }

  // Tworzy nowy konflikt z pierwszą statystyką (region) (POST /api/conflicts).
  // Wymaga ANALITYK+. Label jest wymagany; region i severity są opcjonalne.
  async function createConflict() {
    if (!$user?.role || $user.role === 'OBSERWATOR') return;
    if (!newConflict?.label?.trim()) return;
    try {
      await axios.post(`/api/${api}`, newConflict);
      newConflict = null;
      showFlash('Konflikt dodany');
      await load();
    } catch (err) {
      showFlash(err.response?.data?.error || err.message, false);
    }
  }

  // Reaktywne uprawnienia — przeliczane automatycznie przy zmianie roli w store
  $: canAdd  = $user?.role === 'ANALITYK' || $user?.role === 'OPERACYJNY';
  $: isAdmin = $user?.role === 'OPERACYJNY';

  const inputStyle = 'flex:1;background:#0d0d0d;border:1px solid #444;color:#e8e8e8;font-family:var(--mono);font-size:11px;padding:4px 8px;outline:none';
  const goldInputStyle = 'flex:1;background:#0d0d0d;border:1px solid #444;color:var(--gold);font-family:var(--mono);font-size:11px;padding:4px 8px;outline:none';
</script>

<div class="sec">
  <div class="section-header">Powiązane konflikty</div>

  {#if flash}
    <div style="font-size:10px;padding:6px 10px;margin-bottom:10px;letter-spacing:.08em;background:{flash.ok ? '#081408' : '#180a0a'};border:1px solid {flash.ok ? '#2a4a2a' : 'var(--red-dim)'};color:{flash.ok ? '#5abf5a' : 'var(--red-bright)'}">
      {flash.msg}
    </div>
  {/if}

  {#each conflicts as c (c.id)}
    <div class="connected">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="connected-header{open[c.id] ? ' open' : ''}" on:click={() => toggle(c.id)}
        style="justify-content:space-between">
        <span style="display:flex;align-items:center;gap:8px">
          <span class="arrow">{open[c.id] ? '▼' : '►'}</span>
          <span>{c.label}</span>
        </span>
        {#if c.severity && c.severity !== 'medium'}
          {@const SEV_PL = { low: 'NISKI', medium: 'ŚREDNI', high: 'WYSOKI', CRITICAL: 'KRYTYCZNY' }}
          <span style="font-size:9px;letter-spacing:.15em;color:{c.severity === 'CRITICAL' ? 'var(--red-bright)' : 'var(--gold)'};border:1px solid currentColor;padding:1px 6px">
            {SEV_PL[c.severity] || c.severity}
          </span>
        {/if}
      </div>

      {#if open[c.id]}
        <div class="connected-body visible">
          {#each c.stats as s (s.id)}
            <div>
              {#if editing?.statId === s.id}
                <div style="display:flex;gap:6px;padding:6px 0;align-items:center">
                  <input value={editing.key} on:input={e => editing = {...editing, key: e.target.value}}
                    style={inputStyle} />
                  <input value={editing.value} on:input={e => editing = {...editing, value: e.target.value}}
                    style={goldInputStyle} />
                  <button class="btn-sm" on:click={saveEdit}>✓</button>
                  <button class="btn-sm" on:click={() => editing = null}>✕</button>
                </div>
              {:else}
                <div class="connected-stat">
                  <span>{s.key}</span>
                  <span style="display:flex;align-items:center;gap:6px">
                    <span class="val">{s.value}</span>
                    {#if isAdmin}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <button class="btn-sm" title="Edytuj" style="font-size:8px;padding:2px 6px"
                      on:click={e => { e.stopPropagation(); editing = { statId: s.id, key: s.key, value: s.value, conflictId: c.id, label: c.label, severity: c.severity }; }}>✎</button>
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <button class="btn-sm danger" title="Usuń" style="font-size:8px;padding:2px 6px"
                      on:click={e => { e.stopPropagation(); removeStat(s.id); }}>✕</button>
                    {/if}
                  </span>
                </div>
              {/if}
            </div>
          {/each}

          {#if addForm?.conflictId === c.id}
            <div style="display:flex;gap:6px;padding-top:8px;border-top:1px solid #2a2a2a;margin-top:4px">
              <input placeholder="Klucz" value={addForm.key}
                on:input={e => addForm = {...addForm, key: e.target.value}}
                style={inputStyle} />
              <input placeholder="Wartość" value={addForm.value}
                on:input={e => addForm = {...addForm, value: e.target.value}}
                on:keydown={e => e.key === 'Enter' && addStat()}
                style={goldInputStyle} />
              <button class="btn-sm" on:click={addStat}>+ DODAJ</button>
              <button class="btn-sm" on:click={() => addForm = null}>✕</button>
            </div>
          {:else if canAdd}
            <div style="padding-top:8px;border-top:1px solid #1e1e1e;margin-top:4px">
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <button class="btn-sm" style="font-size:9px"
                on:click={e => { e.stopPropagation(); addForm = { conflictId: c.id, label: c.label, key: '', value: '' }; }}>
                + DODAJ STATYSTYKĘ
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#if canAdd}
  <div style="margin-top:12px;padding-top:10px;border-top:1px solid #222">
    {#if newConflict}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
        <div class="calc-field" style="flex:2;min-width:140px">
          <label>Nazwa konfliktu *</label>
          <input value={newConflict.label}
            on:input={e => newConflict = {...newConflict, label: e.target.value}}
            placeholder="np. Syria"
            style="background:#0d0d0d;border:1px solid #444;color:#e8e8e8;font-family:var(--mono);font-size:11px;padding:5px 8px;outline:none;width:100%" />
        </div>
        <div class="calc-field" style="flex:1;min-width:100px">
          <label>Region</label>
          <input value={newConflict.region}
            on:input={e => newConflict = {...newConflict, region: e.target.value}}
            placeholder="np. Bliski Wschód"
            style="background:#0d0d0d;border:1px solid #444;color:#e8e8e8;font-family:var(--mono);font-size:11px;padding:5px 8px;outline:none;width:100%" />
        </div>
        <div class="calc-field" style="flex:0 0 110px">
          <label>Stopień zagrożenia</label>
          <select value={newConflict.severity}
            on:change={e => newConflict = {...newConflict, severity: e.target.value}}
            style="background:#0d0d0d;border:1px solid #444;color:#e8e8e8;font-family:var(--mono);font-size:11px;padding:5px 8px;outline:none;width:100%">
            <option value="low">niski</option>
            <option value="medium">średni</option>
            <option value="high">wysoki</option>
            <option value="CRITICAL">KRYTYCZNY</option>
          </select>
        </div>
        <div style="display:flex;gap:6px;padding-bottom:1px">
          <button class="btn-sm" on:click={createConflict}>+ DODAJ</button>
          <button class="btn-sm" on:click={() => newConflict = null}>✕</button>
        </div>
      </div>
    {:else}
      <button class="btn-sm" style="font-size:9px"
        on:click={() => newConflict = { label: '', severity: 'medium', region: '' }}>
        + DODAJ KONFLIKT
      </button>
    {/if}
  </div>
  {/if}
</div>
