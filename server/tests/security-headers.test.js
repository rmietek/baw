'use strict';
/**
 * TJ-05 — Testy nagłówków bezpieczeństwa HTTP
 * Pokrycie: CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
 *           Referrer-Policy, Permissions-Policy, brak X-Powered-By
 */
const request = require('supertest');
const app     = require('../server');

describe('Nagłówki bezpieczeństwa HTTP', () => {

  let res;
  beforeAll(async () => {
    res = await request(app).get('/api/comments');
  });

  it('TJ-05a: X-Frame-Options = DENY (ochrona przed Clickjacking)', () => {
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('TJ-05b: X-Content-Type-Options = nosniff (ochrona przed MIME sniffing)', () => {
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('TJ-05c: Content-Security-Policy zawiera default-src \'self\'', () => {
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toMatch(/default-src 'self'/);
  });

  it('TJ-05d: Content-Security-Policy zawiera frame-ancestors \'none\'', () => {
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toMatch(/frame-ancestors 'none'/);
  });

  it('TJ-05e: Strict-Transport-Security obecny z max-age >= 1 roku', () => {
    const hsts = res.headers['strict-transport-security'] || '';
    expect(hsts).toMatch(/max-age=/);
    const match = hsts.match(/max-age=(\d+)/);
    if (match) {
      expect(parseInt(match[1])).toBeGreaterThanOrEqual(31536000);
    }
  });

  it('TJ-05f: Referrer-Policy ustawiony', () => {
    expect(res.headers['referrer-policy']).toBeDefined();
  });

  it('TJ-05g: Permissions-Policy wyłącza kamerę i mikrofon', () => {
    const pp = res.headers['permissions-policy'] || '';
    expect(pp).toMatch(/camera=\(\)/);
    expect(pp).toMatch(/microphone=\(\)/);
  });

  it('TJ-05h: brak nagłówka X-Powered-By (ukrycie fingerprintingu)', () => {
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
