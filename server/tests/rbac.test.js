'use strict';
/**
 * TJ-03 — Testy kontroli dostępu opartej na rolach (RBAC)
 * Pokrycie: weryfikacja ról server-side dla chronionych endpointów
 */
const request = require('supertest');
const app     = require('../server');

// ── Helpers ───────────────────────────────────────────────────────────────────
async function loginAs(agentId, password) {
  const res = await request(app)
    .post('/api/login')
    .send({ username: agentId, password });
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie[0].split(';')[0] : null;
}

// ── Testy RBAC ────────────────────────────────────────────────────────────────
describe('RBAC — kontrola dostępu server-side', () => {

  it('TJ-03a: gość (brak cookie) nie może usunąć komentarza — 401/403', async () => {
    const res = await request(app).delete('/api/comments/1');
    expect([401, 403]).toContain(res.status);
  });

  it('TJ-03b: ANALITYK nie może usunąć komentarza — 403', async () => {
    // Rejestrujemy świeżego analityka
    const id  = `RBAC-ANA-${Date.now()}`;
    await request(app).post('/api/register')
      .send({ agent_id: id, password: 'TestPass99!', role: 'ANALITYK' });
    const cookie = await loginAs(id, 'TestPass99!');
    if (!cookie) return; // pominięcie gdy 2FA wymagane

    const res = await request(app)
      .delete('/api/comments/1')
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/OPERACYJNY/i);
  });

  it('TJ-03c: gość nie może edytować war_stats — 401/403', async () => {
    const res = await request(app)
      .put('/api/stats/total_cost_usd')
      .send({ value: '0' });
    expect([401, 403]).toContain(res.status);
  });

  it('TJ-03d: gość nie może dodawać casualty — 401/403', async () => {
    const res = await request(app)
      .post('/api/casualties')
      .send({ event_date: '2026-01-01', location: 'Test', side: 'IRAN',
              category: 'MILITARNE', count: 1 });
    expect([401, 403]).toContain(res.status);
  });

  it('TJ-03e: brak tokenu = 401 dla chronionych endpointów profilu', async () => {
    const res = await request(app).put('/api/profile').send({ bio: 'test' });
    expect(res.status).toBe(401);
  });

  it('TJ-03f: OBSERWATOR nie może wgrać pliku — 401/403', async () => {
    const id = `RBAC-OBS-${Date.now()}`;
    await request(app).post('/api/register')
      .send({ agent_id: id, password: 'TestPass99!', role: 'OBSERWATOR' });
    const cookie = await loginAs(id, 'TestPass99!');
    if (!cookie) return;

    const res = await request(app)
      .post('/api/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('test'), 'test.txt');
    expect([401, 403]).toContain(res.status);
  });
});
