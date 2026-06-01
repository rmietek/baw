<script>
  import axios from 'axios';
  export let totalCost = 0;

  const WAR_COST_PER_SEC = 5480;
  const MIL_BUDGET_RATIO = 0.54;
  const IRAN_RATIO       = 0.023;

  let income = '';
  let status = 'single';
  let result = null;

  function fmt(n) { return '$' + Number(n).toLocaleString('en-US'); }

  async function calculate() {
    const inc = parseFloat(income);
    if (!inc || inc <= 0) return;

    const TAX_BRACKETS = status === 'married'
      ? [[0,23200,.10],[23200,94300,.12],[94300,201050,.22],[201050,383900,.24]]
      : [[0,11600,.10],[11600,47150,.12],[47150,100525,.22],[100525,191950,.24]];

    let tax = 0;
    for (const [low, high, rate] of TAX_BRACKETS) {
      if (inc > low) tax += (Math.min(inc, high) - low) * rate;
    }

    const milShare  = tax * MIL_BUDGET_RATIO;
    const iranShare = milShare * IRAN_RATIO;
    const perHour   = iranShare / 2080;

    try {
      await axios.post('/api/tax-calculation', { income: inc, tax_status: status }, { withCredentials: true });
    } catch { /* ignoruj błąd zapisu */ }

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
