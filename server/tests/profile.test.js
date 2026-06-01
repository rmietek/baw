'use strict';
/**
 * TJ-07 — Testy endpointów profilu użytkownika
 * Pokrycie: GET /api/profile, PUT /api/profile, PUT /api/profile/password
 */
const request = require('supertest');
const app     = require('../server');

const ID  = `PROF-${Date.now()}`;
const PWD = 'ProfilePass99!';
let cookie = null;

// Wyciąga cookie "token=" z tablicy Set-Cookie
function findTokenCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const entry = arr.find(c => c.startsWith('token='));
  return entry ? entry.split(';')[0] : null;
}

beforeAll(async () => {
  await request(app).post('/api/register')
    .send({ agent_id: ID, password: PWD, role: 'ANALITYK' });
  const res = await request(app).post('/api/login')
    .send({ username: ID, password: PWD });
  cookie = findTokenCookie(res.headers['set-cookie']);
});

describe('GET /api/profile', () => {
  it('TJ-07a: zwraca profil dla zalogowanego użytkownika bez password_hash', async () => {
    if (!cookie) return;
    const res = await request(app).get('/api/profile').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.agent_id).toBe(ID);
    // NIGDY nie zwraca password_hash
    expect(res.body.password_hash).toBeUndefined();
    expect(res.body.totp_secret).toBeUndefined();
  });

  it('TJ-07b: GET /api/profile bez tokenu zwraca 401', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/profile', () => {
  it('TJ-07c: aktualizuje bio i income', async () => {
    if (!cookie) return;
    const res = await request(app)
      .put('/api/profile')
      .set('Cookie', cookie)
      .send({ bio: 'Testowy opis agenta', income: 50000 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('TJ-07d: ignoruje pole role (mass assignment protection)', async () => {
    if (!cookie) return;
    await request(app)
      .put('/api/profile')
      .set('Cookie', cookie)
      .send({ bio: 'ok', role: 'OPERACYJNY' });
    const me = await request(app).get('/api/me').set('Cookie', cookie);
    expect(me.body.role).not.toBe('OPERACYJNY');
  });

  it('TJ-07e: income powyżej 10M jest ograniczany do 10M', async () => {
    if (!cookie) return;
    const res = await request(app)
      .put('/api/profile')
      .set('Cookie', cookie)
      .send({ income: 999_999_999 });
    expect(res.status).toBe(200);
    const profile = await request(app).get('/api/profile').set('Cookie', cookie);
    expect(profile.body.income).toBeLessThanOrEqual(10_000_000);
  });
});

describe('PUT /api/profile/password', () => {
  const NEW_PWD = 'NewPass99!!';

  it('TJ-07f: zmienia hasło po podaniu poprawnego obecnego hasła', async () => {
    if (!cookie) return;
    const res = await request(app)
      .put('/api/profile/password')
      .set('Cookie', cookie)
      .send({ old_password: PWD, new_password: NEW_PWD });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('TJ-07g: odmawia zmiany hasła przy błędnym obecnym haśle', async () => {
    if (!cookie) return;
    const res = await request(app)
      .put('/api/profile/password')
      .set('Cookie', cookie)
      .send({ old_password: 'wrong_password', new_password: 'AnyNew99!' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/niepraw/i);
  });

  it('TJ-07h: odrzuca nowe hasło krótsze niż 8 znaków', async () => {
    if (!cookie) return;
    const res = await request(app)
      .put('/api/profile/password')
      .set('Cookie', cookie)
      .send({ old_password: NEW_PWD, new_password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/8 znak/i);
  });
});
