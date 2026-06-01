import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import fs   from 'fs';
import path from 'path';

const certKey  = path.resolve('../server/certs/key.pem');
const certCert = path.resolve('../server/certs/cert.pem');
const hasCerts = fs.existsSync(certKey) && fs.existsSync(certCert);

export default defineConfig(({ mode }) => {
  const isProd   = mode === 'production';
  const useHttps = hasCerts && !isProd;
  const wsProto  = useHttps ? 'wss' : 'ws';
  const scriptSrc = isProd ? `'self'` : `'self' 'unsafe-inline'`;

  return {
    plugins: [svelte()],
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/tests/**/*.test.js'],
    },
    server: {
      port: 3000,
      https: useHttps ? { key: fs.readFileSync(certKey), cert: fs.readFileSync(certCert) } : false,
      proxy: {
        '/api': {
          target: hasCerts ? 'https://localhost:3001' : 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
      },
      headers: {
        'X-Frame-Options':        'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy':        'strict-origin-when-cross-origin',
        'Permissions-Policy':     'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy':
          `default-src 'self'; ` +
          `script-src ${scriptSrc}; ` +
          `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
          `font-src 'self' https://fonts.gstatic.com; ` +
          `img-src 'self' data: blob:; ` +
          `connect-src 'self' ${wsProto}://localhost:3000 http://api.nbp.pl; ` +
          `frame-ancestors 'none';`,
      },
    },
  };
});
