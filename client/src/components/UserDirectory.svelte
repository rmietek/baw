<script>
  import axios from 'axios';
  import { user } from '../stores/auth';

  const ROLE_COLOR = { OPERACYJNY: 'var(--red-bright)', ANALITYK: 'var(--gold)', OBSERWATOR: 'var(--blue)' };

  let users   = [];
  let loading = false;
  let fetched = false;
  let search  = '';

  async function load() {
    loading = true;
    try {
      const { data } = await axios.get('/api/users', { withCredentials: true });
      users   = data;
      fetched = true;
    } finally { loading = false; }
  }

  $: filtered = users.filter(u =>
    u.agent_id.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );
</script>

<div class="sec" id="katalog">
  <div class="section-header">Katalog agentów</div>

  {#if !fetched}
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      {#if $user?.role !== 'OPERACYJNY'}
        <div style="font-size:10px;letter-spacing:.08em;padding:8px 12px;border:1px solid #1a3a1a;background:#060a06;color:var(--text-dim)">
          Katalog agentów wymaga roli OPERACYJNY
        </div>
      {:else}
        <button class="btn-calc" on:click={load} disabled={loading}>
          {loading ? 'POBIERANIE...' : '▶ POBIERZ KATALOG'}
        </button>
      {/if}
    </div>
  {:else}
    <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center">
      <input bind:value={search}
        placeholder="Szukaj agenta / roli..."
        style="background:#080808;border:1px solid #2a2a2a;color:#ccc;font-family:var(--mono);font-size:12px;padding:7px 11px;outline:none;flex:1" />
      <span style="font-size:10px;color:var(--text-dim)">{filtered.length} agentów</span>
      <button class="btn-sm" on:click={load}>↺ Odśwież</button>
    </div>

    <table class="cas-table">
      <thead>
        <tr><th>ID</th><th>Agent ID</th><th>Rola</th><th>Bio</th></tr>
      </thead>
      <tbody>
        {#each filtered as u (u.id)}
          <tr>
            <td style="color:#444;font-size:10px">{u.id}</td>
            <td style="color:var(--gold);font-family:var(--mono);letter-spacing:.05em">{u.agent_id}</td>
            <td><span class="role-badge role-{u.role?.toLowerCase()}">{u.role}</span></td>
            <td style="color:var(--text-dim);font-size:10px">{u.bio || '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
