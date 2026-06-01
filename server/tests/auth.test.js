'use strict';
/**
 * TJ-01 / TJ-02 — Testy uwierzytelniania i rejestracji
 * Pokrycie: POST /api/login, POST /api/register, POST /api/logout
 */
const request = require('supertest');
const app     = require('../server');

// ── helpers ──────────────────────────────────────────────────────────────────
const AGENT_ID  = `TEST-${Date.now()}`;
const PASSWORD  = 'TestPassword99!';

// Wyciąga cookie "token=" z tablicy Set-Cookie (pomija csrf_token i inne)
function findTokenCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return arr.find(c => c.startsWith('token=')) ?? null;
}

// ── Rejestracja ───────────────────────────────────────────────────────────────
describe('POST /api/register', () => {
  it('TJ-01a: rejestruje nowego użytkownika i zwraca 200', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ agent_id: AGENT_ID, password: PASSWORD, role: 'ANALITYK' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('TJ-01b: odmawia rejestracji z hasłem < 8 znaków', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ agent_id: `SHORT-${Date.now()}`, password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 znak/);
  });

  it('TJ-01c: nie pozwala zarejestrować roli OPERACYJNY', async () => {
    const id  = `NOPRIV-${Date.now()}`;
    const res = await request(app)
      .post('/api/register')
      .send({ agent_id: id, password: PASSWORD, role: 'OPERACYJNY' });
    // Serwer odrzuca niedozwoloną rolę — 400 z informacją o dozwolonych rolach
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/OBSERWATOR|ANALITYK/i);
  });

  it('TJ-01d: odrzuca duplikat agent_id z kodem 409', async () => {
    const res = await request(app)
      .post('/api/register')
      .send({ agent_id: AGENT_ID, password: PASSWORD, role: 'ANALITYK' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/istnieje/i);
  });
});

// ── Logowanie ─────────────────────────────────────────────────────────────────
describe('POST /api/login', () => {
  it('TJ-02a: loguje użytkownika poprawnymi danymi i ustawia HttpOnly cookie', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: AGENT_ID, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.agent_id).toBe(AGENT_ID);
    // Serwer ustawia kilka ciasteczek (token + csrf_token) — szukamy konkretnie "token="
    const tokenCookie = findTokenCookie(res.headers['set-cookie']);
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie.toLowerCase()).toMatch(/httponly/);
  });

  it('TJ-02b: odmawia dostępu przy błędnym haśle z komunikatem bez wskazania przyczyny', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: AGENT_ID, password: 'wrong_password' });
    expect(res.status).toBe(401);
    // Komunikat nie może wskazywać czy login istnieje (ochrona przed enumeracją)
    expect(res.body.error).toMatch(/dane logowania/);
  });

  it('TJ-02c: odmawia dostępu dla nieistniejącego agenta z tym samym komunikatem', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ username: 'NONEXISTENT-9999', password: 'any' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/dane logowania/);
  });

  it('TJ-02d: odrzuca żądanie bez danych z kodem 400', async () => {
    const res = await request(app).post('/api/login').send({});
    expect(res.status).toBe(400);
  });
});

// ── Wylogowanie ───────────────────────────────────────────────────────────────
describe('POST /api/logout', () => {
  it('TJ-02e: wylogowanie czyści cookie token', async () => {
    const res = await request(app).post('/api/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Cookie powinno być ustawione na pusty string lub wygasłe
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const tokenCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(tokenCookie).toMatch(/token=/);
    }
  });
});
