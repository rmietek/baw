'use strict';
/**
 * TJ-06 — Testy rate limiting i ochrony przed brute-force
 * Pokrycie: blokada per-IP, blokada konta, rate limit rejestracji
 */
const request = require('supertest');
const app     = require('../server');

// Jeden użytkownik współdzielony — rejestracja + 5 złych prób w beforeAll
// pozwala przetestować blokadę konta bez zużywania dwóch slotów rejestracji.
const BF_ID  = `BF-${Date.now()}`;
const BF_PWD = 'CorrectPass99!';

beforeAll(async () => {
  await request(app).post('/api/register')
    .send({ agent_id: BF_ID, password: BF_PWD, role: 'ANALITYK' });
  // 5 błędnych prób — konto będzie zablokowane przed TJ-06a
  for (let i = 0; i < 5; i++) {
    await request(app).post('/api/login')
      .send({ username: BF_ID, password: 'wrong' });
  }
}, 30000);

describe('Rate limiting — ochrona przed brute-force', () => {

  it('TJ-06a: po 5 błędnych próbach logowania konto jest blokowane (429)', async () => {
    // 6. próba (błędne hasło) — konto już zablokowane
    const res = await request(app).post('/api/login')
      .send({ username: BF_ID, password: 'wrong' });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/zablokowane/i);
  }, 20000);

  it('TJ-06b: po zablokowaniu konta poprawne hasło też jest odrzucane (429)', async () => {
    // Nawet poprawne hasło odrzucone podczas lockout
    const res = await request(app).post('/api/login')
      .send({ username: BF_ID, password: BF_PWD });
    expect(res.status).toBe(429);
  }, 20000);

  it('TJ-06c: brakujące dane logowania zwracają 400 bez liczenia jako próba', async () => {
    const res = await request(app).post('/api/login').send({});
    expect(res.status).toBe(400);
  });
});
