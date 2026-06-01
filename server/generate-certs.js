const selfsigned = require('selfsigned');
const fs   = require('fs');
const path = require('path');

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems  = selfsigned.generate(attrs, {
  keySize: 2048,
  days: 365,
  algorithm: 'sha256',
  extensions: [{
    name: 'subjectAltName',
    altNames: [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
    ]
  }]
});

const certsDir = path.join(__dirname, 'certs');
if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir);

fs.writeFileSync(path.join(certsDir, 'key.pem'),  pems.private);
fs.writeFileSync(path.join(certsDir, 'cert.pem'), pems.cert);

console.log('Certyfikaty wygenerowane w ./certs/');
console.log('  key.pem  — klucz prywatny');
console.log('  cert.pem — certyfikat (self-signed, ważny 365 dni)');
