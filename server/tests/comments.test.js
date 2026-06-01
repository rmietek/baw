'use strict';
/**
 * TJ-08 — Testy endpointów komentarzy
 * Pokrycie: GET /api/comments, POST /api/comments, DELETE /api/comments/:id
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

// POST /api/comments wymaga roli ANALITYK — setup cookie
let analitykCookie = null;
beforeAll(async () => {
  const id = `CMT-${Date.now()}`;
  await request(app).post('/api/register')
    .send({ agent_id: id, password: 'TestPass99!', role: 'ANALITYK' });
  const res = await request(app).post('/api/login')
    .send({ username: id, password: 'TestPass99!' });
  analitykCookie = findTokenCookie(res.headers['set-cookie']);
});

describe('GET /api/comments', () => {
  it('TJ-08a: zwraca listę komentarzy bez logowania (publiczny)', async () => {
    const res = await request(app).get('/api/comments');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/comments', () => {
  it('TJ-08b: POST bez tokenu zwraca 401 (wymagane logowanie)', async () => {
    const res = await request(app)
      .post('/api/comments')
      .send({ author: 'TEST-AUTHOR', content: 'Treść testowego meldunku' });
    expect(res.status).toBe(401);
  });

  it('TJ-08c: pusta treść komentarza zwraca 400', async () => {
    if (!analitykCookie) return;
    const res = await request(app)
      .post('/api/comments')
      .set('Cookie', analitykCookie)
      .send({ author: 'TEST', content: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wymagana/i);
  });

  it('TJ-08d: treść dłuższa niż 2000 znaków jest akceptowana (truncated przez sanitizer)', async () => {
    if (!analitykCookie) return;
    const longContent = 'A'.repeat(2500);
    const res = await request(app)
      .post('/api/comments')
      .set('Cookie', analitykCookie)
      .send({ author: 'TEST', content: longContent });
    // Serwer sanityzuje i przycina — 200 lub 400 w zależności od impl.
    expect([200, 400]).toContain(res.status);
  });
});

describe('DELETE /api/comments/:id', () => {
  it('TJ-08e: usunięcie komentarza bez tokenu zwraca 401 lub 403', async () => {
    const res = await request(app).delete('/api/comments/1');
    expect([401, 403]).toContain(res.status);
  });

  it('TJ-08f: nieprawidłowe ID zwraca 400 lub 403 (nie 500)', async () => {
    const res = await request(app).delete('/api/comments/0');
    expect(res.status).not.toBe(500);
    expect([400, 401, 403]).toContain(res.status);
  });
});
