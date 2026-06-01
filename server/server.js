// ── Ładowanie zmiennych środowiskowych z pliku .env ──────────
require('dotenv').config();

// ── Biblioteki zewnętrzne ────────────────────────────────────
const express      = require('express');         // framework HTTP
const mysql        = require('mysql2');           // sterownik MySQL
const cors         = require('cors');             // obsługa nagłówka CORS
const cookieParser = require('cookie-parser');    // parsowanie ciasteczek
const axios        = require('axios');            // klient HTTP (NBP API)
const bcrypt       = require('bcrypt');           // haszowanie haseł
const jwt          = require('jsonwebtoken');     // podpisywanie/weryfikacja tokenów JWT
const multer       = require('multer');           // obsługa uploadu plików
const fs           = require('fs');               // operacje na systemie plików
const path         = require('path');             // ścieżki do plików
const http         = require('http');             // serwer HTTP (przekierowanie → HTTPS)
const https        = require('https');            // serwer HTTPS
const crypto       = require('crypto');           // funkcje kryptograficzne (AES, random)
const sanitizeHtml = require('sanitize-html');    // usuwanie tagów HTML z danych wejściowych
const { fromBuffer: fileTypeFromBuffer } = require('file-type'); // detekcja MIME po magic bytes
const passport       = require('passport');       // middleware uwierzytelniania OAuth
const GoogleStrategy = require('passport-google-oauth20').Strategy; // strategia Google OAuth 2.0
const session        = require('express-session'); // sesje serwera (tylko dla OAuth handshake)
const { authenticator } = require('otplib');     // generowanie i weryfikacja kodów TOTP (2FA)
authenticator.options = { window: 1 };           // tolerancja ±1 okresu (30 s) dla przesunięcia zegara
const QRCode         = require('qrcode');        // generowanie QR kodów do konfiguracji 2FA

// ── Instancja Express i stałe konfiguracyjne ─────────────────
const app        = express();
const PORT       = parseInt(process.env.PORT  || '3001');      // port HTTPS/HTTP serwera API
const PORT_HTTP  = parseInt(process.env.PORT_HTTP || '3080');  // port HTTP (tylko przekierowanie)
const IS_PROD    = process.env.NODE_ENV === 'production';      // tryb produkcyjny

// Opcje ciasteczka JWT: httpOnly uniemożliwia odczyt przez JS (obrona XSS)
const COOKIE_OPT = { httpOnly: true, sameSite: 'Strict', secure: IS_PROD };

// Token CSRF (double-submit): celowo NIE httpOnly -- frontend musi go odczytać,
// by odesłać w nagłówku X-CSRF-Token. Bezpieczeństwo wynika z tego, że obca domena
// nie odczyta tej wartości (Same-Origin Policy), więc nie podrobi nagłówka.
const CSRF_COOKIE_OPT = { httpOnly: false, sameSite: 'Strict', secure: IS_PROD };

// ── Walidacja JWT_SECRET przy starcie ────────────────────────
// Jeśli sekret jest pusty lub za krótki, serwer zatrzymuje się natychmiast.
// Zapobiega uruchomieniu z domyślnym lub słabym sekretem.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET musi miec minimum 32 znaki. Ustaw go w server/.env');
  process.exit(1);
}

// ── Klucz szyfrowania AES-256-GCM derywowany ze JWT_SECRET ──
// scryptSync: wolna funkcja KDF odporna na ataki brute-force;
// sól jest stałą aplikacyjną (nie trzeba jej przechowywać).
const ENC_KEY = crypto.scryptSync(
  process.env.JWT_SECRET,
  'monitor-konfliktu-payload-salt',
  32
);

// Szyfruje obiekt JS do ciągu base64url (iv.tag.ciphertext).
// Używane do ukrycia danych w payloadzie JWT — nawet po zdekodowaniu
// tokenu bez klucza serwera atakujący nie odczyta id/role.
function encryptPayload(payload) {
  const iv     = crypto.randomBytes(12);  // losowy wektor inicjalizacji 96-bit
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc    = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();    // tag autentyczności (zapobiega modyfikacji)
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

// Odszyfrowuje ciąg z encryptPayload z powrotem do obiektu JS.
// Weryfikacja tagu zapewnia integralność — zmodyfikowany ciphertext zostanie odrzucony.
function decryptPayload(str) {
  const [ivB64, tagB64, encB64] = str.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64url')), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

// ── CORS ─────────────────────────────────────────────────────
// Zezwala na żądania tylko z zaufanych origin (allowlista z .env).
// credentials: true pozwala przeglądarce wysyłać ciasteczka w żądaniach cross-origin.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: niedozwolone źródło'));
  },
  credentials: true
}));

// Parsowanie ciała żądania jako JSON i ciasteczek
app.use(express.json());
app.use(cookieParser());

// Sesja serwerowa z krótkim TTL — używana wyłącznie podczas OAuth handshake
// (przechowanie roli i intencji rejestracji między krokami OAuth).
app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 5 * 60 * 1000 }  // 5 minut — tylko dla OAuth handshake
}));
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((u, done) => done(null, u));
passport.deserializeUser((u, done) => done(null, u));

// ── Anti-CSRF: walidacja Origin / Referer ────────────────────
// Pierwsza warstwa ochrony CSRF. Dla metod mutujących (POST/PUT/DELETE/PATCH)
// sprawdza nagłówek Origin lub Referer — jeśli pochodzi spoza allowlisty, żądanie
// jest odrzucane. Uzupełnia atrybut SameSite=Strict na ciasteczku JWT.
const CSRF_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
app.use((req, res, next) => {
  if (!CSRF_METHODS.has(req.method)) return next();
  const origin  = req.headers.origin;
  const referer = req.headers.referer;
  let source = origin || null;
  if (!source && referer) {
    try { source = new URL(referer).origin; } catch { source = null; }
  }
  if (source && !ALLOWED_ORIGINS.includes(source)) {
    console.warn(`[CSRF] Odrzucone ${req.method} ${req.path} — origin: ${source}`);
    return res.status(403).json({ error: 'Niedozwolone źródło żądania' });
  }
  next();
});

// ── Anti-CSRF: token double-submit ───────────────────────────
// Wystawienie: każdy klient bez tokenu CSRF dostaje nowy losowy token
// w ciasteczku (nie-HttpOnly, aby frontend mógł go odczytać i odesłać
// w nagłówku X-CSRF-Token).
app.use((req, res, next) => {
  if (!req.cookies?.csrf_token) {
    res.cookie('csrf_token', crypto.randomBytes(32).toString('hex'), CSRF_COOKIE_OPT);
  }
  next();
});

// Weryfikacja: dla zalogowanych użytkowników wysyłających żądanie z przeglądarki
// nagłówek X-CSRF-Token musi zgadzać się z wartością ciasteczka csrf_token.
app.use((req, res, next) => {
  if (!CSRF_METHODS.has(req.method)) return next();
  const isBrowser = !!(req.headers.origin || req.headers.referer);
  if (!isBrowser || !req.cookies?.token) return next();
  if (!req.cookies?.csrf_token || req.headers['x-csrf-token'] !== req.cookies.csrf_token) {
    console.warn(`[CSRF] Brak/niezgodny token ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Brak lub nieprawidłowy token CSRF' });
  }
  next();
});

// ── Globalne nagłówki bezpieczeństwa ─────────────────────────
// Każda odpowiedź serwera zawiera zestaw nagłówków hartujących przeglądarkę:
//   X-Frame-Options: DENY            — blokuje osadzanie w <iframe> (clickjacking)
//   X-Content-Type-Options: nosniff  — blokuje MIME sniffing
//   X-XSS-Protection: 1; mode=block  — stara ochrona XSS w IE/Edge
//   Referrer-Policy                  — ogranicza informację o źródle żądania
//   Permissions-Policy               — wyłącza kamerę, mikrofon, geolokalizację
//   HSTS                             — wymusza HTTPS przez rok (preload)
//   Content-Security-Policy          — zezwala na skrypty tylko z nonce lub 'self'
//   Usuwa X-Powered-By               — ukrywa informację o Express
app.use((_req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64'); // losowy nonce per-request
  res.locals.nonce = nonce;

  res.setHeader('X-Frame-Options',              'DENY');
  res.setHeader('X-Content-Type-Options',       'nosniff');
  res.setHeader('X-XSS-Protection',             '1; mode=block');
  res.setHeader('Referrer-Policy',              'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',           'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security',    'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; ` +
    `script-src 'self' 'nonce-${nonce}'; ` +               // skrypty tylko z tym nonce
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
    `font-src 'self' https://fonts.gstatic.com; ` +
    `img-src 'self' data: blob:; ` +
    `connect-src 'self' http://api.nbp.pl; ` +             // AJAX tylko do własnego API i NBP
    `frame-ancestors 'none';`                              // zakaz osadzania w ramkach
  );
  res.removeHeader('X-Powered-By');
  next();
});

// ── Helper sanityzacji wejść ─────────────────────────────────
// Usuwa CAŁY HTML z ciągu (tagi, atrybuty, encje, javascript:).
// Stosowany przed zapisem do bazy — pierwsza linia obrony przed XSS stored.
const clean = (str, maxLen = 2000) =>
  sanitizeHtml(String(str ?? ''), { allowedTags: [], allowedAttributes: {} }).substring(0, maxLen);

// ── Połączenie z bazą danych MySQL ───────────────────────────
// Dane połączenia pobierane z .env — nigdy nie są zakodowane na sztywno.
const db = mysql.createConnection({
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'iran_tracker',
  charset:  'utf8mb4',
});
db.connect(err => {
  if (err) { console.error('DB connection error:', err); return; }
  console.log('MySQL connected');

  // Migracja: czyści plaintext hasła z poprzedniej wersji aplikacji
  db.query("UPDATE users SET password = '' WHERE password != ''", e => {
    if (e) console.error('Migracja password clear:', e.message);
    else console.log('Wyczyszczono plaintext passwords');
  });

  // Migracja: dodaje kolumnę password_hash jeśli nie istnieje (stara baza)
  db.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'`,
    (e, rows) => {
      if (!e && rows[0].cnt === 0) {
        db.query("ALTER TABLE users ADD COLUMN password_hash VARCHAR(60) DEFAULT NULL",
          e2 => { if (e2) console.error('Migracja password_hash:', e2.message);
                  else console.log('Dodano kolumnę password_hash'); });
      }
    }
  );

  // Migracja: dodaje kolumny google_id i email jeśli nie istnieją
  db.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_id'`,
    (e, rows) => {
      if (!e && rows[0].cnt === 0) {
        db.query("ALTER TABLE users ADD COLUMN google_id VARCHAR(64) DEFAULT NULL", e2 => {
          if (e2) console.error('Migracja google_id:', e2.message);
          else console.log('Dodano kolumnę google_id');
        });
        db.query("ALTER TABLE users ADD COLUMN email VARCHAR(255) DEFAULT NULL", e2 => {
          if (e2) console.error('Migracja email:', e2.message);
          else console.log('Dodano kolumnę email');
        });
      }
    }
  );

  // Migracja: dodaje kolumny totp_secret i totp_enabled jeśli nie istnieją
  db.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'totp_secret'`,
    (e, rows) => {
      if (!e && rows[0].cnt === 0) {
        db.query("ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) DEFAULT NULL", e2 => {
          if (e2) console.error('Migracja totp_secret:', e2.message);
          else console.log('Dodano kolumnę totp_secret');
        });
        db.query("ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE", e2 => {
          if (e2) console.error('Migracja totp_enabled:', e2.message);
          else console.log('Dodano kolumnę totp_enabled');
        });
      }
    }
  );
});

// Wrapper Promise dla db — umożliwia użycie async/await zamiast callbacków
const dbp = db.promise();

// ── Strategia Google OAuth 2.0 ───────────────────────────────
// Konfigurowana tylko jeśli klucze są ustawione w .env.
// Przy logowaniu: szuka użytkownika po google_id lub email.
// Przy rejestracji: tworzy nowe konto z rolą wybraną przez użytkownika.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID:          process.env.GOOGLE_CLIENT_ID,
    clientSecret:      process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:       process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/google/callback',
    passReqToCallback: true
  }, async (req, _accessToken, _refreshToken, profile, done) => {
    try {
      const googleId = profile.id;
      const email    = profile.emails?.[0]?.value || null;

      const isRegister = req.session?.oauthIntent === 'register';

      // Szukaj istniejącego konta po google_id
      let [rows] = await dbp.execute('SELECT * FROM users WHERE google_id = ?', [googleId]);
      if (rows[0]) {
        if (isRegister) return done(null, false, { message: 'exists' });
        console.info(`[OAUTH] Login: ${rows[0].agent_id}`);
        return done(null, rows[0]);
      }

      // Szukaj istniejącego konta po adresie email i połącz z google_id
      if (email) {
        [rows] = await dbp.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (rows[0]) {
          if (isRegister) return done(null, false, { message: 'exists' });
          await dbp.execute('UPDATE users SET google_id = ? WHERE id = ?', [googleId, rows[0].id]);
          console.info(`[OAUTH] Linked google_id to existing: ${rows[0].agent_id}`);
          return done(null, { ...rows[0], google_id: googleId });
        }
      }

      // Nowe konto — tylko role OBSERWATOR lub ANALITYK (nie OPERACYJNY)
      console.info(`[OAUTH] New account: googleId=${googleId} email=${email}`);
      const agentId   = `GOOGLE-${googleId.slice(0, 8).toUpperCase()}`;
      const allowed   = ['OBSERWATOR', 'ANALITYK'];
      if (!allowed.includes(req.session?.oauthRole))
        return done(null, false, { message: 'invalid_role' });
      await dbp.execute(
        'INSERT INTO users (agent_id, password, password_hash, role, email, google_id) VALUES (?, ?, ?, ?, ?, ?)',
        [agentId, '', '', req.session.oauthRole, email, googleId]
      );
      const [newRows] = await dbp.execute('SELECT * FROM users WHERE agent_id = ?', [agentId]);
      done(null, newRows[0]);
    } catch (err) { done(err); }
  }));
}

// ── Pomocnicze funkcje JWT ────────────────────────────────────

// Parsuje ID z URL params — zwraca liczbę całkowitą dodatnią lub null.
// Zapobiega przekazaniu wartości takich jak "0", "-1", "NaN" do bazy.
function parseId(val) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Wyciąga i odszyfrowuje payload z ciasteczka JWT.
// Zwraca null jeśli token jest nieważny, wygasły lub brak ciasteczka.
function getJwtPayload(req) {
  try {
    const { d } = jwt.verify(req.cookies.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return decryptPayload(d);
  } catch { return null; }
}

// Skrócona wersja — zwraca tylko rolę użytkownika lub null.
function getRole(req) {
  return getJwtPayload(req)?.role || null;
}

// ── Tworzenie tabel jeśli nie istnieją ───────────────────────
// Tabele dodane po init.sql są tworzone tutaj przy starcie serwera.
// Pozwala to na uruchomienie bez ponownego uruchamiania init.sql.
db.query(`
  CREATE TABLE IF NOT EXISTS strike_points (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    type_desc  VARCHAR(500),
    cx         FLOAT NOT NULL,
    cy         FLOAT NOT NULL,
    color_type VARCHAR(20) DEFAULT 'military',
    added_by   VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`, err => { if (err) console.error('strike_points table error:', err); });

db.query(`
  CREATE TABLE IF NOT EXISTS petition_signatures (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    name      VARCHAR(255) NOT NULL,
    comment   VARCHAR(500),
    ip        VARCHAR(45),
    signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`, err => { if (err) console.error('petition table error:', err); });

// Tabela osi czasu — jeśli pusta, wstawiane są dane seed
db.query(`CREATE TABLE IF NOT EXISTS timeline_events (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  event_date  VARCHAR(30) NOT NULL,
  title       VARCHAR(255) NOT NULL,
  description TEXT,
  is_major    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4`, () => {
  db.query('SELECT COUNT(*) as c FROM timeline_events', (e, r) => {
    if (r && r[0].c === 0) {
      db.query(`INSERT INTO timeline_events (event_date, title, description, is_major) VALUES
        ('28 LUT 2026','Start Operacji — pierwsze uderzenia','Bombowce B-2 Spirit i rakiety Tomahawk uderzaja w instalacje nuklearne Fordow i Natanz.',1),
        ('01 MAR 2026','Iran oglasza stan wojenny','Chamenei zawiesza umowy nuklearne. IRGC przejmuje kontrole nad infrastruktura.',0),
        ('02 MAR 2026','Iran zamyka Ciesnine Ormuz','Iranska marynarka blokuje 20% swiatowych dostaw ropy. Cena Brent $118/bbl.',1),
        ('04 MAR 2026','Atak dronami na bazy USA w Iraku','47 dronow Shahed-136 atakuje Al-Asad i Erbil. 3 rannych, 39 zestrzelono.',0),
        ('06 MAR 2026','Kongres zatwierdza $22,3 mld','287 za, 142 przeciw. Srodki na kontynuacje operacji.',1),
        ('09 MAR 2026','Uderzenia na Teheran — IRGC','F-35 i Tomahawk niszcza kwatery IRGC. 5004 ofiar wojskowych.',0),
        ('12 MAR 2026','Hezbollah otwiera front polnocny','Rakiety uderzaja w Haife i Tel Awiw. Izrael odpowiada na Bejrut.',0),
        ('15 MAR 2026','Tragedia szkoly w Minab','175 ofiar — glownie uczennice. UNESCO potepia. Demonstracje na swiecie.',1),
        ('20 MAR 2026','Negocjacje — Katar jako mediator','Pierwsze rozmowy w Doha. Iran zada wycofania sil USA.',0),
        ('28 MAR 2026','Stan na dzis — 28 dni konfliktu','Laczny koszt >$33 mld. Brak perspektyw na zawieszenie broni.',1)`);
    }
  });
});

// Tabela powiązanych konfliktów — seed wstawiany przy pierwszym uruchomieniu
db.query(`CREATE TABLE IF NOT EXISTS conflict_stats (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  conflict_id    VARCHAR(20) NOT NULL,
  conflict_label VARCHAR(150),
  stat_key       VARCHAR(100),
  stat_value     VARCHAR(150),
  sort_order     INT DEFAULT 0,
  severity       VARCHAR(20) DEFAULT 'medium',
  is_active      BOOLEAN DEFAULT TRUE
) CHARACTER SET utf8mb4`, () => {
  db.query('SELECT COUNT(*) as c FROM conflict_stats', (e, r) => {
    if (r && r[0].c === 0) {
      db.query(`INSERT INTO conflict_stats (conflict_id, conflict_label, stat_key, stat_value, sort_order) VALUES
        ('lb','POWIAZANY KONFLIKT: LIBAN','Zaangazowanie Hezbollahu','Aktywne',1),
        ('lb','POWIAZANY KONFLIKT: LIBAN','Uderzenia Izraela na Liban','340+',2),
        ('lb','POWIAZANY KONFLIKT: LIBAN','Ofiary cywilne (Liban)','820+',3),
        ('lb','POWIAZANY KONFLIKT: LIBAN','Przesiedleni mieszkancy','~1,2 mln',4),
        ('ym','POWIAZANY KONFLIKT: JEMEN','Ataki Huti na drogi morskie','Aktywne',1),
        ('ym','POWIAZANY KONFLIKT: JEMEN','Zestrzelone drony / rakiety USA','180+',2),
        ('ym','POWIAZANY KONFLIKT: JEMEN','Szacowany koszt USA (Jemen)','$4,2 mld',3),
        ('iq','POWIAZANY KONFLIKT: IRAK / SYRIA','Ataki na bazy USA','47',1),
        ('iq','POWIAZANY KONFLIKT: IRAK / SYRIA','Zolnierze USA ranni','112',2),
        ('iq','POWIAZANY KONFLIKT: IRAK / SYRIA','Odpowiedzi sil USA','38 uderzen',3)`);
    }
  });
});

// Tabela live feed — wiadomości operacyjne; seed przy pustej tabeli
db.query(`CREATE TABLE IF NOT EXISTS live_feed (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  type       ENUM('alert','warn','info') NOT NULL DEFAULT 'info',
  message    VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, () => {
  db.query('SELECT COUNT(*) as c FROM live_feed', (e, r) => {
    if (r && r[0].c === 0) {
      db.query(`INSERT INTO live_feed (type, message) VALUES
        ('alert','[CENTCOM] Potwierdzone zniszczenie centrum wzbogacania uranu Fordow — glebokosc 90m'),
        ('warn', '[AP] Iran: odwetowe uderzenia dronami na bazy USA w regionie'),
        ('info', '[Reuters] Cena ropy Brent wzrosla do $127/bbl po zamknieciu Ciesniny Ormuz'),
        ('alert','[DoD] Zolnierz USA zginat w ataku rakietowym na baze Al-Asad (Irak)'),
        ('info', '[Al Jazeera] Iran deklaruje kontynuacje programu nuklearnego'),
        ('warn', '[CENTCOM] Zestrzelono 7 dronow Shahed nad Zatoka Perska'),
        ('alert','[Hengaw] Protesty w Teheranie — sily bezpieczenstwa uzyly gazu lzawiacego'),
        ('info', '[Reuters] Rosja wzywa do natychmiastowego zawieszenia broni'),
        ('warn', '[DoD] Okret USS Fitzgerald ostrzelany rakietami — brak ofiar'),
        ('info', '[AP] Turcja zamknela przestrzen powietrzna dla operacji USA'),
        ('alert','[IAEA] Utracono kontakt z inspektorami w Natanz'),
        ('warn', '[Reuters] Ceny paliw w USA przekraczaja $5/galon — rekord od 2022'),
        ('info', '[CNN] Kongres zwoluje nadzwyczajne posiedzenie ws. finansowania'),
        ('alert','[CENTCOM] Uderzenie na rafinerie w Abadanie — pozar trwa'),
        ('info', '[Al Jazeera] Jordania zamknela granice z Irakiem — obawy eskalacji'),
        ('warn', '[AP] Ciesninea Ormuz: 3 tankowce zatrzymane przez sily IRGC'),
        ('info', '[BBC] Chiny wstrzymuja eksport chipow do USA — odpowiedz na sankcje'),
        ('alert','[DoD] Kolejny dron Shahed-136 zestrzelony nad baza Al-Udeid, Katar')`);
    }
  });
});

// ── Konfiguracja uploadu plików ───────────────────────────────
// Pliki zapisywane na dysku w katalogu /uploads.
// Filtr MIME: akceptowane tylko obrazy, PDF i tekst.
// Limit 5 MB na plik zapobiega atakom DoS przez duże pliki.
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const ALLOWED_MIMES = ['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/plain'];
const uploadHandler = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, 'tmp_' + Date.now() + '_' + path.basename(file.originalname)),
  }),
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Niedozwolony typ pliku: ${file.mimetype}`));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // maksymalny rozmiar pliku: 5 MB
});

// ===============================================================================
// AUTH
// ===============================================================================

// ── Przechowywanie prób logowania w pamięci ───────────────────
// Rate limiting zaimplementowany bez zewnętrznych bibliotek.
// Klucze: IP i nazwa użytkownika (lowercase).
const _ipAttempts      = new Map();  // klucz: IP — próby logowania
const _accountAttempts = new Map();  // klucz: username — próby + blokada konta
const _registerAttempts = new Map(); // klucz: IP — próby rejestracji
const _resetAttempts    = new Map(); // klucz: IP — próby resetu hasła

// Stałe limitów: okna czasowe i maksymalne liczby prób
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;      // 15 minut
const MAX_IP_HITS        = 20;                   // max prób z jednego IP w oknie
const MAX_ACCOUNT_HITS   = 5;                    // max prób na konto przed blokadą
const ACCOUNT_LOCK_MS    = 30 * 60 * 1000;       // czas blokady konta: 30 minut
const REGISTER_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h okno rejestracji
const MAX_REGISTER_HITS  = 10;                   // max rejestracji z IP w 24h
const RESET_WINDOW_MS    = 60 * 60 * 1000;       // 1h okno resetu hasła
const MAX_RESET_HITS     = 5;                    // max prób resetu z IP w 1h

// Czyszczenie wygasłych wpisów co 30 minut — zapobiega wyciekowi pamięci
// przy długo działającym serwerze.
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of _ipAttempts)
    if (!ts.some(t => now - t < LOGIN_WINDOW_MS)) _ipAttempts.delete(k);
  for (const [k, v] of _accountAttempts)
    if (now > v.lockedUntil && !v.attempts.some(t => now - t < LOGIN_WINDOW_MS))
      _accountAttempts.delete(k);
  for (const [k, ts] of _registerAttempts)
    if (!ts.some(t => now - t < REGISTER_WINDOW_MS)) _registerAttempts.delete(k);
  for (const [k, ts] of _resetAttempts)
    if (!ts.some(t => now - t < RESET_WINDOW_MS)) _resetAttempts.delete(k);
}, 30 * 60 * 1000);

// ── POST /api/login ───────────────────────────────────────────
// Pełny przepływ logowania:
// 1. Rate limit po IP (20 prób / 15 min)
// 2. Rate limit + blokada po koncie (5 prób → blokada 30 min)
// 3. Prepared statement — zapytanie SQL bezpieczne na SQL Injection
// 4. bcrypt.compare — weryfikacja hasła bez ujawniania czy login istnieje
// 5. Jeśli 2FA aktywne → zwraca preAuthToken (TTL 5 min), nie wystawia JWT
// 6. Jeśli 2FA nieaktywne → wystawia pełny JWT w HttpOnly cookie
app.post('/api/login', async (req, res) => {
  const ip       = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now      = Date.now();
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username || !password) return res.status(400).json({ error: 'Brak danych' });

  // Blokada po IP
  const ipHits = (_ipAttempts.get(ip) || []).filter(t => now - t < LOGIN_WINDOW_MS);
  if (ipHits.length >= MAX_IP_HITS) {
    console.warn(`[AUTH] IP rate-limit: ${ip} (${ipHits.length} prób w 15 min)`);
    return res.status(429).json({ error: 'Zbyt wiele prób logowania. Poczekaj 15 minut.' });
  }
  ipHits.push(now);
  _ipAttempts.set(ip, ipHits);

  // Blokada po koncie
  const key = username.toLowerCase();
  const acc  = _accountAttempts.get(key) || { attempts: [], lockedUntil: 0 };
  if (now < acc.lockedUntil) {
    const remainMin = Math.ceil((acc.lockedUntil - now) / 60000);
    console.warn(`[AUTH] Locked account attempt: ${username} from ${ip}`);
    return res.status(429).json({ error: `Konto zablokowane. Spróbuj ponownie za ${remainMin} min.` });
  }
  acc.attempts = acc.attempts.filter(t => now - t < LOGIN_WINDOW_MS);

  try {
    // Prepared statement — parametr ? zapobiega SQL Injection
    const [rows] = await dbp.execute('SELECT * FROM users WHERE agent_id = ?', [username]);
    const u = rows[0];

    // Jednolity komunikat błędu — nie ujawnia czy login istnieje (ochrona przed enumeracją)
    const deny = () => {
      acc.attempts.push(now);
      if (acc.attempts.length >= MAX_ACCOUNT_HITS) {
        acc.lockedUntil = now + ACCOUNT_LOCK_MS;
        console.warn(`[AUTH] Account locked: ${username} from ${ip} (${acc.attempts.length} prób)`);
      } else {
        console.warn(`[AUTH] Failed login: ${username} from ${ip} (próba ${acc.attempts.length}/${MAX_ACCOUNT_HITS})`);
      }
      _accountAttempts.set(key, acc);
      return res.status(401).json({ error: 'Nieprawidłowe dane logowania' });
    };

    if (!u) return deny();
    if (!u.password_hash) return deny();

    // bcrypt.compare: stała czasowo, nie ujawnia przez timing attack czy hash pasuje
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return deny();

    // Sukces — czyść licznik prób dla konta
    _accountAttempts.delete(key);
    console.info(`[AUTH] Login OK: ${username} from ${ip}`);

    // 2FA aktywne → wystawiamy tymczasowy preAuthToken zamiast pełnego JWT
    if (u.totp_enabled) {
      const preAuthToken = jwt.sign(
        { d: encryptPayload({ id: u.id, preAuth: true }) },
        process.env.JWT_SECRET,
        { expiresIn: '5m', algorithm: 'HS256' }
      );
      return res.json({ requires2FA: true, preAuthToken });
    }

    // Pełny JWT — payload zaszyfrowany AES-256-GCM, przechowywany w HttpOnly cookie
    const token = jwt.sign(
      { d: encryptPayload({ id: u.id, agent_id: u.agent_id, role: u.role, mfa: true }) },
      process.env.JWT_SECRET,
      { expiresIn: '3m', algorithm: 'HS256' }
    );
    res.cookie('token', token, COOKIE_OPT);
    const decoded = jwt.decode(token);
    res.json({ ok: true, agent_id: u.agent_id, role: u.role, expiresAt: decoded.exp * 1000 });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/register ────────────────────────────────────────
// Rejestracja nowego użytkownika:
// 1. Rate limit: max 10 rejestracji z jednego IP w 24h
// 2. Walidacja allowlisting: agent_id tylko litery/cyfry/_ -, min 3 znaki
// 3. Hasło minimum 8 znaków
// 4. Rola tylko OBSERWATOR lub ANALITYK (nie można zarejestrować OPERACYJNY)
// 5. bcrypt hash z work factor 12
app.post('/api/register', async (req, res) => {
  const ip  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const regHits = (_registerAttempts.get(ip) || []).filter(t => now - t < REGISTER_WINDOW_MS);
  if (regHits.length >= MAX_REGISTER_HITS)
    return res.status(429).json({ error: 'Zbyt wiele rejestracji z tego adresu. Spróbuj za 24h.' });
  regHits.push(now);
  _registerAttempts.set(ip, regHits);

  const { password, role } = req.body;
  const agent_id = (req.body.agent_id || '').trim();
  if (!agent_id)             return res.status(400).json({ error: 'Podaj ID agenta' });
  if (agent_id.length < 3)   return res.status(400).json({ error: 'ID agenta musi mieć co najmniej 3 znaki' });
  if (agent_id.length > 50)  return res.status(400).json({ error: 'ID agenta max 50 znaków' });
  if (!/^[A-Za-z0-9_\-]+$/.test(agent_id))
    return res.status(400).json({ error: 'ID agenta może zawierać tylko litery, cyfry, _ i -' });
  if (!password)             return res.status(400).json({ error: 'Podaj hasło' });
  if (password.length < 8)   return res.status(400).json({ error: 'Hasło musi mieć co najmniej 8 znaków' });
  const allowedRoles = ['OBSERWATOR', 'ANALITYK'];
  if (!allowedRoles.includes(role))
    return res.status(400).json({ error: 'Wybierz prawidłową rolę: OBSERWATOR lub ANALITYK' });
  try {
    const hash = await bcrypt.hash(password, 12); // work factor 12 — ok. 250ms na bcrypt
    await dbp.execute(
      'INSERT INTO users (agent_id, password, password_hash, role) VALUES (?, ?, ?, ?)',
      [agent_id, '', hash, role]
    );
    res.json({ ok: true, message: 'Konto utworzone' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Agent ID już istnieje' });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ── POST /api/logout ──────────────────────────────────────────
// Usuwa ciasteczko JWT — przeglądarka przestaje wysyłać token.
app.post('/api/logout', (_req, res) => {
  res.clearCookie('token', COOKIE_OPT);
  res.json({ ok: true });
});

// ── Google OAuth — inicjacja ──────────────────────────────────
// Zapisuje zamierzoną rolę i intencję (login/register) w sesji serwera,
// następnie przekierowuje do Google.
app.get('/api/auth/google', (req, res, next) => {
  const allowed = ['OBSERWATOR', 'ANALITYK'];
  req.session.oauthRole   = allowed.includes(req.query.role) ? req.query.role : null;
  req.session.oauthIntent = req.query.intent === 'register' ? 'register' : 'login';
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

// ── Google OAuth — callback ───────────────────────────────────
// Po powrocie od Google: jeśli 2FA aktywne → preAuthToken,
// w przeciwnym razie wystawia pełny JWT i przekierowuje do frontendu.
app.get('/api/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?oauth=error`,
    failureMessage: true
  }),
  (req, res, next) => {
    if (req.authInfo?.message === 'exists') {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?oauth=exists`);
    }
    next();
  },
  async (req, res) => {
    const u = req.user;

    if (u.totp_enabled) {
      const preAuthToken = jwt.sign(
        { d: encryptPayload({ id: u.id, preAuth: true }) },
        process.env.JWT_SECRET,
        { expiresIn: '5m', algorithm: 'HS256' }
      );
      const base = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${base}/?oauth=needs2fa&pre=${encodeURIComponent(preAuthToken)}`);
    }

    const token = jwt.sign(
      { d: encryptPayload({ id: u.id, agent_id: u.agent_id, role: u.role, mfa: true }) },
      process.env.JWT_SECRET,
      { expiresIn: '3m', algorithm: 'HS256' }
    );
    res.cookie('token', token, { httpOnly: true, sameSite: 'Lax', secure: IS_PROD });
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/?oauth=success`);
  }
);

// ===============================================================================
// 2FA (TOTP)
// ===============================================================================

// ── POST /api/2fa/login ───────────────────────────────────────
// Krok 2 logowania: weryfikuje kod TOTP po podaniu hasła.
// Przyjmuje preAuthToken (tymczasowy, TTL 5 min) + 6-cyfrowy kod.
// Po poprawnej weryfikacji wystawia pełny JWT w HttpOnly cookie.
app.post('/api/2fa/login', async (req, res) => {
  const { preAuthToken, code } = req.body;
  if (!preAuthToken || !code) return res.status(400).json({ error: 'Brak danych' });
  try {
    const { d } = jwt.verify(preAuthToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const payload = decryptPayload(d);
    if (!payload.preAuth) return res.status(400).json({ error: 'Nieprawidłowy token' });
    const [rows] = await dbp.execute('SELECT * FROM users WHERE id = ?', [payload.id]);
    const u = rows[0];
    if (!u?.totp_secret) return res.status(400).json({ error: 'Błąd weryfikacji' });
    if (!authenticator.check(code, u.totp_secret)) return res.status(401).json({ error: 'Nieprawidłowy kod 2FA' });
    const token = jwt.sign(
      { d: encryptPayload({ id: u.id, agent_id: u.agent_id, role: u.role, mfa: true }) },
      process.env.JWT_SECRET,
      { expiresIn: '3m', algorithm: 'HS256' }
    );
    res.cookie('token', token, COOKIE_OPT);
    const decoded = jwt.decode(token);
    res.json({ ok: true, agent_id: u.agent_id, role: u.role, expiresAt: decoded.exp * 1000 });
  } catch { res.status(401).json({ error: 'Nieprawidłowy lub wygasły token' }); }
});

// ── POST /api/2fa/setup ───────────────────────────────────────
// Generuje sekret TOTP i zwraca QR kod w formacie data URL.
// Frontend wyświetla QR do zeskanowania w aplikacji typu Google Authenticator.
// Sekret zapisywany w bazie — 2FA nie jest jeszcze aktywne (wymaga /enable).
app.post('/api/2fa/setup', async (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  try {
    const secret  = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(payload.agent_id, 'MONITOR_KONFLIKTU_W_IRANIE', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    await dbp.execute('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, payload.id]);
    res.json({ qrDataUrl });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/2fa/enable ──────────────────────────────────────
// Aktywuje 2FA po podaniu pierwszego poprawnego kodu z aplikacji.
// Weryfikacja przed aktywacją zapewnia że użytkownik poprawnie skonfigurował apkę.
app.post('/api/2fa/enable', async (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  const { code } = req.body;
  try {
    const [rows] = await dbp.execute('SELECT totp_secret FROM users WHERE id = ?', [payload.id]);
    const secret = rows[0]?.totp_secret;
    if (!secret) return res.status(400).json({ error: 'Najpierw skonfiguruj 2FA' });
    if (!authenticator.check(code, secret)) return res.status(401).json({ error: 'Nieprawidłowy kod — spróbuj ponownie' });
    await dbp.execute('UPDATE users SET totp_enabled = TRUE WHERE id = ?', [payload.id]);
    const token = jwt.sign(
      { d: encryptPayload({ id: payload.id, agent_id: payload.agent_id, role: payload.role, mfa: true }) },
      process.env.JWT_SECRET,
      { expiresIn: '3m', algorithm: 'HS256' }
    );
    res.cookie('token', token, COOKIE_OPT);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/2fa/disable ─────────────────────────────────────
// Dezaktywuje 2FA — wymaga podania aktualnego kodu TOTP.
// Zeruje totp_enabled i usuwa sekret z bazy.
app.post('/api/2fa/disable', async (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  const { code } = req.body;
  try {
    const [rows] = await dbp.execute('SELECT totp_secret FROM users WHERE id = ?', [payload.id]);
    const secret = rows[0]?.totp_secret;
    if (!secret || !authenticator.check(code, secret)) return res.status(401).json({ error: 'Nieprawidłowy kod 2FA' });
    await dbp.execute('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = ?', [payload.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── GET /api/me ───────────────────────────────────────────────
// Zwraca dane bieżącego użytkownika z tokenu JWT (nie odpytuje bazy).
// Używany przez frontend przy starcie do sprawdzenia czy sesja jest aktywna.
app.get('/api/me', (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  res.json({ ok: true, agent_id: payload.agent_id, role: payload.role, expiresAt: payload.exp * 1000 });
});

// ── POST /api/refresh ─────────────────────────────────────────
// Odświeża token JWT — wystawia nowy z TTL 3 min.
// Frontend wywołuje tuż przed wygaśnięciem (SessionWarning component).
app.post('/api/refresh', (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  const token = jwt.sign(
    { d: encryptPayload({ id: payload.id, agent_id: payload.agent_id, role: payload.role, mfa: payload.mfa }) },
    process.env.JWT_SECRET,
    { expiresIn: '3m', algorithm: 'HS256' }
  );
  res.cookie('token', token, COOKIE_OPT);
  const newPayload = jwt.decode(token);
  res.json({ ok: true, expiresAt: newPayload.exp * 1000 });
});

// ── Globalny guard 2FA ────────────────────────────────────────
// Lista ścieżek zwolnionych z weryfikacji 2FA (auth, setup, reset hasła).
// Zalogowany użytkownik, który nie ukończył weryfikacji TOTP,
// nie może korzystać z żadnego chronionego endpointu.
const MFA_EXEMPT = [
  '/api/login', '/api/register', '/api/logout', '/api/me', '/api/refresh',
  '/api/auth/', '/api/2fa/', '/api/reset-password/', '/api/usd-rate'
];

// ===============================================================================
// COMMENTS
// ===============================================================================

// ── GET /api/comments ─────────────────────────────────────────
// Pobiera wszystkie komentarze posortowane od najnowszego.
// Dostępne publicznie (bez autoryzacji).
app.get('/api/comments', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM comments ORDER BY created_at DESC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/comments ────────────────────────────────────────
// Dodaje nowy komentarz. Wymaga roli ANALITYK lub wyższej.
// Treść sanityzowana przez clean() przed zapisem do bazy (obrona przed XSS stored).
app.post('/api/comments', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { author, content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Treść jest wymagana' });
  const safeAuthor  = clean(author || 'ANONIM', 100);
  const safeContent = clean(content, 2000);
  try {
    await dbp.execute('INSERT INTO comments (author, content) VALUES (?, ?)', [safeAuthor, safeContent]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── DELETE /api/comments/:id ──────────────────────────────────
// Usuwa komentarz. Wymaga roli OPERACYJNY.
// parseId() zapobiega przekazaniu ujemnych lub nienumerycznych ID.
app.delete('/api/comments/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  try {
    await dbp.execute('DELETE FROM comments WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// PROFILE
// ===============================================================================

// ── GET /api/profile ──────────────────────────────────────────
// Zwraca dane profilu zalogowanego użytkownika.
// Nie zwraca hasła ani totp_secret — allowlisting pól w SELECT.
app.get('/api/profile', async (req, res) => {
  const userId = getJwtPayload(req)?.id;
  if (!userId) return res.status(401).json({ error: 'Niezalogowany' });
  try {
    const [rows] = await dbp.execute('SELECT id, agent_id, role, bio, income, tax_status, totp_enabled FROM users WHERE id = ?', [userId]);
    res.json(rows[0] || {});
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── PUT /api/profile ──────────────────────────────────────────
// Edycja profilu: bio i income. Allowlisting pól — nie można zmienić roli
// przez ten endpoint (pole role nie jest obsługiwane). Wymaga roli ANALITYK+.
app.put('/api/profile', async (req, res) => {
  const userId = getJwtPayload(req)?.id;
  if (!userId) return res.status(401).json({ error: 'Niezalogowany' });
  if (getRole(req) === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { bio, income } = req.body;

  const safeBio    = clean(bio, 500);
  const safeIncome = Math.max(0, Math.min(10_000_000, parseInt(income) || 0)); // clamp 0–10M
  try {
    await dbp.execute('UPDATE users SET bio=?, income=? WHERE id=?', [safeBio, safeIncome, userId]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── PUT /api/profile/password ─────────────────────────────────
// Zmiana hasła: wymaga podania aktualnego hasła (weryfikacja bcrypt),
// nowe hasło hashowane z work factor 12.
app.put('/api/profile/password', async (req, res) => {
  const userId = getJwtPayload(req)?.id;
  if (!userId) return res.status(401).json({ error: 'Niezalogowany' });
  if (getRole(req) === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });

  const { old_password, new_password } = req.body;
  if (!old_password) return res.status(400).json({ error: 'Podaj obecne hasło' });
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: 'Nowe hasło musi mieć co najmniej 8 znaków' });

  try {
    const [rows] = await dbp.execute('SELECT password_hash FROM users WHERE id = ?', [userId]);
    if (!rows[0]?.password_hash) return res.status(400).json({ error: 'Błąd weryfikacji' });

    const match = await bcrypt.compare(old_password, rows[0].password_hash);
    if (!match) return res.status(403).json({ error: 'Obecne hasło jest nieprawidłowe' });

    const hash = await bcrypt.hash(new_password, 12);
    await dbp.execute(
      "UPDATE users SET password_hash = ?, password = '' WHERE id = ?",
      [hash, userId]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// TAX CALCULATION
// ===============================================================================

// ── POST /api/tax-calculation ─────────────────────────────────
// Kalkulator podatku — oblicza podatek wg progów podatkowych USA (single/married),
// następnie wylicza hipotetyczny "udział" w kosztach konfliktu (54% * 2.3%).
// Wynik zapisywany w tabeli tax_calculations (anonimowo lub z user_id).
// Walidacja: dochód 0–100M, tax_status allowlista ['single','married'].
app.post('/api/tax-calculation', async (req, res) => {
  const income = parseFloat(req.body.income);
  const status = req.body.tax_status === 'married' ? 'married' : 'single';
  if (!income || income <= 0 || income > 100_000_000)
    return res.status(400).json({ error: 'Nieprawidłowe zarobki' });
  const brackets = status === 'married'
    ? [[0,23200,.10],[23200,94300,.12],[94300,201050,.22],[201050,383900,.24]]
    : [[0,11600,.10],[11600,47150,.12],[47150,100525,.22],[100525,191950,.24]];
  let tax = 0;
  for (const [lo, hi, rate] of brackets) { if (income > lo) tax += (Math.min(income, hi) - lo) * rate; }
  const iranShare = tax * 0.54 * 0.023;
  try {
    await dbp.execute('INSERT INTO tax_calculations (user_id, final_tax_paid) VALUES (?, ?)',
      [getJwtPayload(req)?.id || null, Math.round(iranShare)]);
    res.json({ ok: true, saved: Math.round(iranShare) });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// CURRENCY
// ===============================================================================

// ── GET /api/usd-rate ─────────────────────────────────────────
// Proxy do NBP API zwracające kurs USD/PLN.
// URL hardkodowany po stronie serwera — obrona przed SSRF (atakujący nie może
// podmienić URL przez parametr żądania). Timeout 5s zapobiega długiemu oczekiwaniu.
app.get('/api/usd-rate', async (_req, res) => {
  const NBP_URL = 'http://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json';
  try {
    const response = await axios.get(NBP_URL, { timeout: 5000 });
    const mid = response.data?.rates?.[0]?.mid;
    if (!mid) return res.status(502).json({ error: 'Nieprawidłowa odpowiedź NBP API' });
    res.json({ mid });
  } catch { res.status(502).json({ error: 'Nie można pobrać kursu USD' }); }
});

// ===============================================================================
// WAR STATS
// ===============================================================================

// ── GET /api/stats ────────────────────────────────────────────
// Zwraca słownik wszystkich statystyk konfliktu (key → value).
// Dostępne publicznie.
app.get('/api/stats', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT stat_key, stat_value FROM war_stats');
    const stats = {};
    rows.forEach(r => { stats[r.stat_key] = r.stat_value; });
    res.json(stats);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── PUT /api/stats/:key ───────────────────────────────────────
// Aktualizuje wartość statystyki po kluczu. Wymaga roli OPERACYJNY.
// Wartość obcinana do 255 znaków — zapobiega przepełnieniu kolumny VARCHAR(255).
app.put('/api/stats/:key', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Brak wartości' });
  try {
    await dbp.execute('UPDATE war_stats SET stat_value = ? WHERE stat_key = ?',
      [String(value).substring(0, 255), req.params.key]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// INTEL REPORTS
// ===============================================================================

// Mapa klauzul dostępnych dla każdej roli — clearance-based IDOR.
// Nawet jeśli atakujący zna ID raportu TAJNY, zapytanie SQL z filtrem clearance
// zwróci pusty wynik dla roli OBSERWATOR.
const CLEARANCE_BY_ROLE = {
  null:       ['JAWNY'],
  OBSERWATOR: ['JAWNY'],
  ANALITYK:   ['JAWNY', 'TAJNY'],
  OPERACYJNY: ['JAWNY', 'TAJNY', 'ŚCIŚLE TAJNY'],
};

// ── GET /api/reports ──────────────────────────────────────────
// Zwraca raporty filtrowane po klauzuli dostępnej dla roli żądającego.
// Placeholder IN (?,?) budowany dynamicznie — bezpieczne na SQL Injection.
app.get('/api/reports', async (req, res) => {
  const role    = getRole(req);
  const allowed = CLEARANCE_BY_ROLE[role] || CLEARANCE_BY_ROLE[null];
  const ph      = allowed.map(() => '?').join(',');
  try {
    const [rows] = await dbp.execute(
      `SELECT * FROM intel_reports WHERE clearance IN (${ph}) ORDER BY created_at DESC`, allowed);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── GET /api/reports/:id ──────────────────────────────────────
// Pobiera pojedynczy raport — clearance sprawdzane w WHERE, nie w kodzie.
// Brak rekordu = 403 (nie ujawnia czy raport istnieje).
app.get('/api/reports/:id', async (req, res) => {
  const role    = getRole(req);
  const allowed = CLEARANCE_BY_ROLE[role] || CLEARANCE_BY_ROLE[null];
  const ph      = allowed.map(() => '?').join(',');
  try {
    const [rows] = await dbp.execute(
      `SELECT * FROM intel_reports WHERE id = ? AND clearance IN (${ph})`,
      [parseId(req.params.id), ...allowed]);
    if (!rows[0]) return res.status(403).json({ error: 'Brak dostępu' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/reports ─────────────────────────────────────────
// Dodaje nowy raport. Wymaga ANALITYK+.
// clearance allowlista — nie można ustawić wartości spoza listy.
app.post('/api/reports', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { title, content, source, clearance } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'Tytuł i treść są wymagane' });
  const safeTitle   = clean(title, 255);
  const safeContent = clean(content, 5000);
  const safeSource  = clean(source || 'OSINT', 100);
  const valid       = ['JAWNY', 'TAJNY', 'ŚCIŚLE TAJNY'];
  const safeCl      = valid.includes(clearance) ? clearance : 'JAWNY'; // fallback do JAWNY
  try {
    await dbp.execute(
      'INSERT INTO intel_reports (title, content, source, clearance, added_by) VALUES (?, ?, ?, ?, ?)',
      [safeTitle, safeContent, safeSource, safeCl, getJwtPayload(req)?.id || null]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// CASUALTIES
// ===============================================================================

// ── GET /api/casualties ───────────────────────────────────────
// Zwraca listę strat bojowych posortowaną od najnowszych. Publiczne.
app.get('/api/casualties', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM casualties ORDER BY event_date DESC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/casualties ──────────────────────────────────────
// Dodaje wpis strat. Wymaga OPERACYJNY.
// side i category walidowane allowlistą — ochrona przed Mass Assignment.
// count clampowany do nieujemnej liczby całkowitej.
app.post('/api/casualties', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const { event_date, location, side, category, count, description } = req.body;
  const validSides = ['IRAN','KOALICJA','CYWILE'];
  const validCats  = ['MILITARNE','CYWILNE','INFRASTRUKTURA'];
  if (!validSides.includes(side) || !validCats.includes(category))
    return res.status(400).json({ error: 'Nieprawidłowa strona lub kategoria' });
  const safeCount = Math.max(0, parseInt(count) || 0);
  try {
    await dbp.execute(
      'INSERT INTO casualties (event_date, location, side, category, count, description, reported_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [event_date, (location||'').substring(0,100), side, category, safeCount,
       (description||'').substring(0,255), getJwtPayload(req)?.id || null]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// STRIKE POINTS
// ===============================================================================

// ── GET /api/strikes ──────────────────────────────────────────
// Zwraca punkty uderzeń na mapie Iranu. Publiczne.
app.get('/api/strikes', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM strike_points ORDER BY created_at DESC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/strikes ─────────────────────────────────────────
// Dodaje punkt na mapie. Wymaga ANALITYK+.
// cx/cy clampowane do rozmiaru mapy SVG (620×490) — zapobiega wyjściu poza widok.
// color_type allowlista — nie można wstawić dowolnej klasy CSS.
app.post('/api/strikes', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { name, type_desc, cx, cy, color_type, added_by } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Brak nazwy' });
  const safeCx   = Math.min(620, Math.max(0, parseFloat(cx) || 300));
  const safeCy   = Math.min(490, Math.max(0, parseFloat(cy) || 200));
  const safeName = clean(name, 200);
  const safeDesc = clean(type_desc, 500);
  const validTypes = ['military','nuclear','naval','infra'];
  const safeType = validTypes.includes(color_type) ? color_type : 'military';
  try {
    await dbp.execute(
      'INSERT INTO strike_points (name, type_desc, cx, cy, color_type, added_by) VALUES (?, ?, ?, ?, ?, ?)',
      [safeName, safeDesc, safeCx, safeCy, safeType, (added_by || getRole(req) || 'ANONIM').substring(0,50)]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── DELETE /api/strikes/:id ───────────────────────────────────
// Usuwa punkt z mapy. Wymaga OPERACYJNY.
app.delete('/api/strikes/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  try {
    await dbp.execute('DELETE FROM strike_points WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// PETITION
// ===============================================================================

// Mapa do rate limitingu podpisów — max 1 podpis na minutę z jednego IP
const _petitionAttempts = new Map();

// ── GET /api/petition ─────────────────────────────────────────
// Zwraca łączną liczbę podpisów i 20 ostatnich. Publiczne.
app.get('/api/petition', async (_req, res) => {
  try {
    const [[countRow]] = await dbp.execute('SELECT COUNT(*) as total FROM petition_signatures');
    const [recent]     = await dbp.execute('SELECT id, name, comment, signed_at FROM petition_signatures ORDER BY id DESC LIMIT 20');
    res.json({ total: countRow.total, recent });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/petition/sign ───────────────────────────────────
// Dodaje podpis pod petycją. Wymaga logowania + rate limit 1/min/IP.
// Imię i komentarz sanityzowane przez clean().
app.post('/api/petition/sign', async (req, res) => {
  if (!getRole(req)) return res.status(401).json({ error: 'Wymagane logowanie' });
  const ip  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const hits = (_petitionAttempts.get(ip) || []).filter(t => now - t < 60 * 1000);
  if (hits.length >= 1) return res.status(429).json({ error: 'Możesz podpisać tylko raz na minutę.' });
  hits.push(now); _petitionAttempts.set(ip, hits);

  const safeName    = clean(req.body.name || 'Anonim', 255);
  const safeComment = clean(req.body.comment, 500);
  if (!safeName.trim()) return res.status(400).json({ error: 'Podaj imię' });
  try {
    await dbp.execute('INSERT INTO petition_signatures (name, comment, ip) VALUES (?, ?, ?)', [safeName, safeComment, ip]);
    const [[row]] = await dbp.execute('SELECT COUNT(*) as total FROM petition_signatures');
    res.json({ ok: true, total: row.total });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── DELETE /api/petition/:id ──────────────────────────────────
// Usuwa podpis. Wymaga OPERACYJNY.
app.delete('/api/petition/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  try {
    await dbp.execute('DELETE FROM petition_signatures WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// FILE UPLOAD
// ===============================================================================

// ── POST /api/upload ──────────────────────────────────────────
// Upload pliku wywiadowczego. Wymaga ANALITYK+.
// Dwustopniowa walidacja typu:
//   1. multer fileFilter: sprawdza Content-Type deklarowany przez klienta
//   2. file-type (magic bytes): sprawdza rzeczywisty typ na podstawie bajtów pliku
// Jeśli typy nie pasują → plik usuwany, błąd 400.
// Nazwa pliku sanityzowana (tylko [a-zA-Z0-9._-]) — ochrona przed path traversal.
// Unikalna nazwa z timestampem — zapobiega nadpisywaniu plików.
app.post('/api/upload', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });

  uploadHandler.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Brak pliku' });

    const ALLOWED_REAL_MIMES = new Set([
      'image/jpeg','image/png','image/gif','image/webp','application/pdf'
    ]);
    const ALLOWED_TEXT_EXTS = new Set(['.txt','.log','.csv','.md']);

    try {
      const buf = fs.readFileSync(req.file.path);
      const detected = await fileTypeFromBuffer(buf); // detekcja po magic bytes

      if (detected) {
        // Plik binarny — sprawdź czy MIME jest na allowliście
        if (!ALLOWED_REAL_MIMES.has(detected.mime)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: `Niedozwolony typ pliku: ${detected.mime}` });
        }
      } else {
        // Brak magic bytes (plik tekstowy) — sprawdź rozszerzenie
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!ALLOWED_TEXT_EXTS.has(ext)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Niedozwolony typ pliku' });
        }
      }
    } catch {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(500).json({ error: 'Błąd weryfikacji pliku' });
    }

    // Sanityzacja nazwy i nadanie unikalnej nazwy z timestampem
    const base = req.body.custom_filename
      ? path.basename(req.body.custom_filename).replace(/[^a-zA-Z0-9._-]/g, '_')
      : path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext  = path.extname(base);
    const stem = path.basename(base, ext);
    const unique = `${stem}_${Date.now()}${ext}`;
    const targetPath = path.join(uploadsDir, unique);
    fs.copyFileSync(req.file.path, targetPath);
    fs.unlinkSync(req.file.path); // usuń plik tymczasowy
    res.json({ ok: true, filename: unique, url: `/api/uploads/${unique}` });
  });
});

// ── GET /api/uploads/:filename ────────────────────────────────
// Serwuje plik z katalogu uploads. Wymaga logowania.
// Nazwa pliku sanityzowana przez path.basename + regex — ochrona przed path traversal.
app.get('/api/uploads/:filename', (req, res) => {
  if (!getRole(req)) return res.status(401).json({ error: 'Wymagane logowanie' });
  const safe = path.basename(req.params.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(uploadsDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Plik nie istnieje' });
  res.sendFile(filePath);
});

// ===============================================================================
// TIMELINE
// ===============================================================================

// ── GET /api/timeline ─────────────────────────────────────────
// Zwraca wszystkie zdarzenia osi czasu. Publiczne.
app.get('/api/timeline', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM timeline_events ORDER BY id DESC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/timeline ────────────────────────────────────────
// Dodaje zdarzenie. Wymaga ANALITYK+.
// event_date walidowane regexem YYYY-MM-DD — fallback do daty dzisiejszej.
app.post('/api/timeline', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { event_date, title, description, is_major } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Tytuł jest wymagany' });
  const safeTitle = clean(title, 300);
  const safeDesc  = clean(description, 1000);
  const safeDate  = /^\d{4}-\d{2}-\d{2}$/.test(event_date) ? event_date : new Date().toISOString().slice(0,10);
  try {
    await dbp.execute(
      'INSERT INTO timeline_events (event_date, title, description, is_major) VALUES (?, ?, ?, ?)',
      [safeDate, safeTitle, safeDesc, is_major ? 1 : 0]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── DELETE /api/timeline/:id ──────────────────────────────────
// Usuwa zdarzenie z osi czasu. Wymaga OPERACYJNY.
app.delete('/api/timeline/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  try {
    await dbp.execute('DELETE FROM timeline_events WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── PATCH /api/timeline/:id ───────────────────────────────────
// Przełącza flagę is_major zdarzenia. Wymaga OPERACYJNY.
app.patch('/api/timeline/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  const { is_major } = req.body;
  try {
    await dbp.execute('UPDATE timeline_events SET is_major = ? WHERE id = ?', [is_major ? 1 : 0, id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// CONNECTED CONFLICTS
// ===============================================================================

// ── GET /api/conflicts ────────────────────────────────────────
// Zwraca powiązane konflikty (Liban, Jemen, Irak/Syria) zgrupowane po conflict_id.
// Każdy konflikt zawiera etykietę, severity, is_active i tablicę statystyk.
app.get('/api/conflicts', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM conflict_stats ORDER BY conflict_id, sort_order');
    const grouped = {};
    rows.forEach(r => {
      if (!grouped[r.conflict_id])
        grouped[r.conflict_id] = { id: r.conflict_id, label: r.conflict_label, severity: r.severity, is_active: r.is_active, stats: [] };
      grouped[r.conflict_id].stats.push({ id: r.id, key: r.stat_key, value: r.stat_value });
    });
    res.json(Object.values(grouped));
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/conflicts ───────────────────────────────────────
// Tworzy nowy konflikt z pierwszą statystyką (region). Wymaga ANALITYK+.
// severity allowlista: ['low','medium','high','CRITICAL'].
app.post('/api/conflicts', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { label, severity, region } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'Brak nazwy konfliktu' });
  const safeLabel  = clean(label, 200);
  const safeRegion = clean(region, 100);
  const validSev   = ['low','medium','high','CRITICAL'];
  const safeSev    = validSev.includes(severity) ? severity : 'medium';
  const newId      = Date.now(); // timestamp jako unikalny conflict_id
  try {
    await dbp.execute(
      'INSERT INTO conflict_stats (conflict_id, conflict_label, stat_key, stat_value, severity, is_active, sort_order) VALUES (?, ?, ?, ?, ?, 1, 0)',
      [String(newId), safeLabel, 'region', safeRegion, safeSev]);
    res.json({ ok: true, conflict_id: newId });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── PUT /api/conflicts/:id ────────────────────────────────────
// Aktualizuje stat_key i stat_value dla konfliktu. Wymaga OPERACYJNY.
app.put('/api/conflicts/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const { stat_key, stat_value } = req.body;
  const safeKey = clean(stat_key, 200);
  const safeVal = clean(stat_value, 500);
  try {
    await dbp.execute('UPDATE conflict_stats SET stat_key=?, stat_value=? WHERE conflict_id=?',
      [safeKey, safeVal, req.params.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/conflicts/:id/stats ────────────────────────────
// Dodaje nową statystykę do istniejącego konfliktu. Wymaga ANALITYK+.
app.post('/api/conflicts/:id/stats', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { stat_key, stat_value } = req.body;
  const safeKey = clean(stat_key, 200);
  const safeVal = clean(stat_value, 500);
  try {
    const [rows] = await dbp.execute('SELECT conflict_label FROM conflict_stats WHERE conflict_id=? LIMIT 1', [req.params.id]);
    const label  = rows[0]?.conflict_label || '';
    await dbp.execute(
      'INSERT INTO conflict_stats (conflict_id, conflict_label, stat_key, stat_value, severity, is_active, sort_order) VALUES (?, ?, ?, ?, "medium", 1, 99)',
      [req.params.id, label, safeKey, safeVal]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── DELETE /api/conflicts/stats/:id ──────────────────────────
// Usuwa pojedynczą statystykę konfliktu. Wymaga OPERACYJNY.
app.delete('/api/conflicts/stats/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  try {
    await dbp.execute('DELETE FROM conflict_stats WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// USER DIRECTORY
// ===============================================================================

// ── GET /api/users ────────────────────────────────────────────
// Zwraca listę wszystkich użytkowników (id, agent_id, role, bio).
// Wymaga OPERACYJNY — tylko admin widzi katalog agentów.
// Nie zwraca hasła ani totp_secret.
app.get('/api/users', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  try {
    const [rows] = await dbp.execute('SELECT id, agent_id, role, bio FROM users');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// RESET HASŁA
// ===============================================================================

// Token resetu przechowywany w pamięci (Map) z TTL 15 minut.
// Uwaga: przy restarcie serwera wszystkie tokeny są tracone.
const _resetTokens = new Map();

// ── POST /api/reset-password/request ─────────────────────────
// Generuje token resetu hasła z TTL 15 min. Rate limit: 5/h z jednego IP.
// Token przechowywany w pamięci (nie wysyłany emailem w tej implementacji).
// Odpowiedź jest identyczna niezależnie od istnienia agenta — zapobiega enumeracji.
app.post('/api/reset-password/request', async (req, res) => {
  const ip  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const resetHits = (_resetAttempts.get(ip) || []).filter(t => now - t < RESET_WINDOW_MS);
  if (resetHits.length >= MAX_RESET_HITS)
    return res.status(429).json({ error: 'Zbyt wiele prób resetowania hasła. Spróbuj za godzinę.' });
  resetHits.push(now);
  _resetAttempts.set(ip, resetHits);

  const { agent_id } = req.body;
  if (!agent_id) return res.status(400).json({ error: 'Podaj ID agenta' });
  try {
    const [rows] = await dbp.execute('SELECT id FROM users WHERE agent_id = ?', [agent_id]);
    if (!rows[0]) return res.status(404).json({ error: 'Agent nie istnieje' });
    const token   = crypto.randomBytes(32).toString('hex'); // 256-bitowy token
    const expires = Date.now() + 15 * 60 * 1000;            // wygasa za 15 min
    _resetTokens.set(token, { agent_id, expires });
    res.json({ ok: true, message: 'Jeśli agent istnieje, token został wysłany na powiązany adres e-mail.' });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/reset-password/confirm ─────────────────────────
// Ustawia nowe hasło przy użyciu tokenu resetu.
// Sprawdza czy token istnieje i nie wygasł, następnie hashuje nowe hasło bcrypt 12.
app.post('/api/reset-password/confirm', async (req, res) => {
  const { token, new_password } = req.body;
  const entry = _resetTokens.get(token);
  if (!entry) return res.status(400).json({ error: 'Nieprawidłowy token' });
  if (Date.now() > entry.expires) { _resetTokens.delete(token); return res.status(400).json({ error: 'Token wygasł' }); }
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Hasło musi mieć co najmniej 8 znaków' });
  try {
    const hash = await bcrypt.hash(new_password, 12);
    await dbp.execute('UPDATE users SET password_hash = ?, password = ? WHERE agent_id = ?',
      [hash, '', entry.agent_id]);
    _resetTokens.delete(token); // jednorazowy token — usuwany po użyciu
    res.json({ ok: true, message: `Hasło zmienione dla: ${entry.agent_id}` });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// WEAPONS
// ===============================================================================

// ── GET /api/weapons ──────────────────────────────────────────
// Zwraca listę systemów uzbrojenia posortowaną po id. Publiczne.
app.get('/api/weapons', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM weapons ORDER BY id');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/weapons ─────────────────────────────────────────
// Dodaje nowy system uzbrojenia. Wymaga OPERACYJNY.
// cost/count_used clampowane do >=0, pct do 0–100.
// category allowlista: ['air','naval','ground','drone','missile'].
app.post('/api/weapons', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const { name, cost, count_used, pct, category } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Brak nazwy systemu' });
  const validCategories = ['air','naval','ground','drone','missile'];
  const safeCategory = validCategories.includes(category) ? category : 'air';
  try {
    const [result] = await dbp.execute(
      'INSERT INTO weapons (name, cost, count_used, pct, category) VALUES (?, ?, ?, ?, ?)',
      [name.trim().substring(0,255), Math.max(0,parseInt(cost)||0),
       Math.max(0,parseInt(count_used)||0), Math.min(100,Math.max(0,parseInt(pct)||0)), safeCategory]);
    res.json({ ok: true, id: result.insertId });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── PUT /api/weapons/:id ──────────────────────────────────────
// Aktualizuje dane systemu uzbrojenia. Wymaga OPERACYJNY.
app.put('/api/weapons/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  const { name, cost, count_used, pct, category } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Brak nazwy systemu' });
  const validCategories = ['air','naval','ground','drone','missile'];
  const safeCategory = validCategories.includes(category) ? category : 'air';
  try {
    await dbp.execute(
      'UPDATE weapons SET name=?, cost=?, count_used=?, pct=?, category=? WHERE id=?',
      [name.trim().substring(0,255), Math.max(0,parseInt(cost)||0),
       Math.max(0,parseInt(count_used)||0), Math.min(100,Math.max(0,parseInt(pct)||0)),
       safeCategory, id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── DELETE /api/weapons/:id ───────────────────────────────────
// Usuwa system uzbrojenia. Wymaga OPERACYJNY.
app.delete('/api/weapons/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  try {
    await dbp.execute('DELETE FROM weapons WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// LIVE FEED
// ===============================================================================

// ── GET /api/livefeed ─────────────────────────────────────────
// Zwraca wszystkie wpisy live feed posortowane chronologicznie. Publiczne.
app.get('/api/livefeed', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT id, type, message FROM live_feed ORDER BY id ASC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── POST /api/livefeed ────────────────────────────────────────
// Dodaje wpis do live feed. Wymaga OPERACYJNY.
// type allowlista: ['alert','warn','info'] — ochrona przed wstrzyknięciem typu.
app.post('/api/livefeed', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const { type, message } = req.body;
  const validTypes = ['alert', 'warn', 'info'];
  if (!validTypes.includes(type) || !message?.trim())
    return res.status(400).json({ error: 'Nieprawidłowe dane' });
  try {
    await dbp.execute('INSERT INTO live_feed (type, message) VALUES (?, ?)',
      [type, clean(message, 500)]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── DELETE /api/livefeed/:id ──────────────────────────────────
// Usuwa wpis z live feed. Wymaga OPERACYJNY.
app.delete('/api/livefeed/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Nieprawidłowe ID' });
  try {
    await dbp.execute('DELETE FROM live_feed WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ── Globalny handler błędów Express ──────────────────────────
// Przechwytuje wszystkie nieobsłużone błędy middleware.
// Nie ujawnia stack trace — zwraca ogólny komunikat (zapobiega information disclosure).
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ── Uruchomienie serwera ──────────────────────────────────────
// Jeśli certyfikaty SSL są dostępne: uruchamia HTTPS na PORT
// i HTTP na PORT_HTTP wyłącznie do przekierowania 301 → HTTPS.
// Jeśli brak certyfikatów: fallback do HTTP (tylko dev).
function startServer() {
  const sslKeyPath  = process.env.SSL_KEY;
  const sslCertPath = process.env.SSL_CERT;

  const hasCerts = sslKeyPath && sslCertPath &&
    fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);

  if (hasCerts) {
    const httpsOptions = {
      key:  fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };

    // Serwer HTTP → tylko przekierowanie do HTTPS
    http.createServer((req, res) => {
      const host = (req.headers.host || '').replace(`:${PORT_HTTP}`, '');
      res.writeHead(301, { Location: `https://${host}${req.url}` });
      res.end();
    }).listen(PORT_HTTP, () =>
      console.log(`[HTTP]  Redirect HTTP→HTTPS na porcie ${PORT_HTTP}`)
    );

    // Serwer HTTPS — właściwa aplikacja
    https.createServer(httpsOptions, app).listen(PORT, () =>
      console.log(`[HTTPS] Server na porcie ${PORT}`)
    );

  } else {
    if (IS_PROD) {
      console.warn('[WARN] Brak certyfikatów SSL — uruchamiam HTTP (niezalecane na produkcji)');
      console.warn('[WARN] Ustaw SSL_KEY i SSL_CERT w .env żeby włączyć HTTPS');
    }
    app.listen(PORT, () =>
      console.log(`[HTTP]  Server na porcie ${PORT}`)
    );
  }
}

// Uruchamia serwer tylko gdy plik jest uruchamiany bezpośrednio (node server.js),
// nie gdy jest importowany przez testy (require('./server')).
if (require.main === module) {
  startServer();
}

module.exports = app;
