<script>
  // Kalkulator podatku — oblicza hipotetyczny wkład użytkownika w koszty konfliktu.
  // Algorytm: podatek federalny USA wg progów podatkowych (single/married),
  // następnie 54% (udział wydatków wojskowych w budżecie) * 2.3% (udział operacji Iran).
  // Wynik zapisywany do bazy przez /api/tax-calculation.
  import axios from 'axios';
  export let totalCost = 0;  // całkowity koszt konfliktu przekazywany z Dashboard

  // Stałe proporcji budżetowych (źródło: Pentagon / SIPRI)
  const WAR_COST_PER_SEC = 5480;
  const MIL_BUDGET_RATIO = 0.54;  // 54% podatków trafia do budżetu wojskowego
  const IRAN_RATIO       = 0.023; // 2.3% wydatków wojskowych to operacje Iran

  let income = '';
  let status = 'single';
  let result = null;

  function fmt(n) { return '$' + Number(n).toLocaleString('en-US'); }

  // Oblicza podatek federalny USA metodą progów podatkowych (marginal tax rate),
  // następnie wylicza hipotetyczny wkład w koszty konfliktu.
  // Wynik zapisywany do bazy przez serwer (błąd zapisu ignorowany — nie blokuje UI).
  // 2080 = liczba godzin pracy rocznie (52 tygodnie × 40 h).
  async function calculate() {
    const inc = parseFloat(income);
    if (!inc || inc <= 0) return;

    const TAX_BRACKETS = status === 'married'
      ? [[0,23200,.10],[23200,94300,.12],[94300,201050,.22],[201050,383900,.24]]
      : [[0,11600,.10],[11600,47150,.12],[47150,100525,.22],[100525,191950,.24]];

    let tax = 0;
    for (const [low, high, rate] of TAX_BRACKETS) {
      // Dla każdego progu: oblicz podatek tylko od dochodu powyżej dolnej granicy
      if (inc > low) tax += (Math.min(inc, high) - low) * rate;
    }

    const milShare  = tax * MIL_BUDGET_RATIO;  // część podatku trafiająca do wojska
    const iranShare = milShare * IRAN_RATIO;    // część wydatków wojskowych na Iran
    const perHour   = iranShare / 2080;         // wkład na godzinę pracy

    try {
      await axios.post('/api/tax-calculation', { income: inc, tax_status: status }, { withCredentials: true });
    } catch { /* ignoruj błąd zapisu — wynik i tak pokazany użytkownikowi */ }

    result = { tax: Math.round(tax), mil: Math.round(milShare), iran: iranShare, ps: perHour.toFixed(4) };
  }
</script>

<div class="sec" id="kalkulator">
  <div class="section-header">Twój osobisty wkład w wojnę</div>
  <div class="calc-card">
    <div class="calc-row">
      <div class="calc-field">
        <label>Roczne zarobki (USD)</label>
        <input type="number" bind:value={income} placeholder="np. 60000" min="1" />
      </div>
      <div class="calc-field">
        <label>Status podatkowy</label>
        <select bind:value={status}>
          <option value="single">Singiel</option>
          <option value="married">Małżeństwo</option>
        </select>
      </div>
      <button class="btn-calc" on:click={calculate}>▶ OBLICZ</button>
    </div>

    {#if result}
      <div class="calc-result">
        <div class="calc-result-row">
          <span class="lbl">Twój federalny podatek (est.)</span>
          <span class="val">{fmt(result.tax)}</span>
        </div>
        <div class="calc-result-row">
          <span class="lbl">Twój roczny wkład w wydatki wojskowe</span>
          <span class="val">{fmt(result.mil)}</span>
        </div>
        <div class="calc-result-row">
          <span class="lbl">Twój wkład w operację Iran (od startu)</span>
          <span class="val">{'$' + result.iran.toFixed(2)}</span>
        </div>
        <div class="calc-result-row total">
          <span class="lbl">Twój wkład w operację Iran na godzinę pracy</span>
          <span class="val">${result.ps}</span>
        </div>
      </div>
    {/if}
  </div>
</div>
