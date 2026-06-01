require('dotenv').config();
const express      = require('express');
const mysql        = require('mysql2');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const axios        = require('axios');
const bcrypt       = require('bcrypt');
const jwt          = require('jsonwebtoken');
const multer       = require('multer');
const fs           = require('fs');
const path         = require('path');
const http         = require('http');
const https        = require('https');
const crypto       = require('crypto');
const sanitizeHtml = require('sanitize-html');
const { fromBuffer: fileTypeFromBuffer } = require('file-type');
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session        = require('express-session');
const { authenticator } = require('otplib');
authenticator.options = { window: 1 };
const QRCode         = require('qrcode');

const app        = express();
const PORT       = parseInt(process.env.PORT  || '3001');
const PORT_HTTP  = parseInt(process.env.PORT_HTTP || '3080');
const IS_PROD    = process.env.NODE_ENV === 'production';
const COOKIE_OPT = { httpOnly: true, sameSite: 'Strict', secure: IS_PROD };
// Token CSRF (double-submit): celowo NIE httpOnly -- frontend musi go odczytać,
// by odesłać w nagłówku X-CSRF-Token. Bezpieczeństwo wynika z tego, że obca domena
// nie odczyta tej wartości (Same-Origin Policy), więc nie podrobi nagłówka.
const CSRF_COOKIE_OPT = { httpOnly: false, sameSite: 'Strict', secure: IS_PROD };

// Walidacja JWT_SECRET -- minimum 32 znaki, brak fallbacku
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET musi miec minimum 32 znaki. Ustaw go w server/.env');
  process.exit(1);
}

// Klucz AES-256-GCM derywowany ze JWT_SECRET przy starcie
const ENC_KEY = crypto.scryptSync(
  process.env.JWT_SECRET,
  'monitor-konfliktu-payload-salt',
  32
);

function encryptPayload(payload) {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc    = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decryptPayload(str) {
  const [ivB64, tagB64, encB64] = str.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64url')), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: niedozwolone ĹşrĂłdĹ‚o'));
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.JWT_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 5 * 60 * 1000 }  // 5 minut â€“ tylko dla OAuth handshake
}));
app.use(passport.initialize());
app.use(passport.session());
passport.serializeUser((u, done) => done(null, u));
passport.deserializeUser((u, done) => done(null, u));

// ─── Anti-CSRF (defense-in-depth): walidacja Origin / Referer ────────────────
// Uzupełnia ochronę SameSite na ciasteczku. Dla metod zmieniających stan
// sprawdza, czy żądanie pochodzi z zaufanego origin (allowlista ALLOWED_ORIGINS).
// Przeglądarki ZAWSZE wysyłają nagłówek Origin przy cross-site POST/PUT/DELETE/PATCH,
// więc sfałszowane żądanie z obcej domeny ma Origin spoza allowlisty i jest odrzucane.
// Brak obu nagłówków = klient nieprzeglądarkowy (testy/CLI) — nie jest wektorem CSRF.
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

// ─── Anti-CSRF: token double-submit ──────────────────────────────────────────
// 1) Wystawienie: każdy klient bez ciasteczka csrf_token dostaje świeży, losowy
//    token (nie-HttpOnly, czytelny dla frontu). Ustawiany już przy pierwszym GET
//    (np. /api/me przy starcie aplikacji), więc istnieje przed pierwszym zapisem.
app.use((req, res, next) => {
  if (!req.cookies?.csrf_token) {
    res.cookie('csrf_token', crypto.randomBytes(32).toString('hex'), CSRF_COOKIE_OPT);
  }
  next();
});

// 2) Weryfikacja: dla przeglądarkowych żądań zmieniających stan od zalogowanego
//    użytkownika nagłówek X-CSRF-Token musi być równy ciasteczku csrf_token.
//    Klienci nieprzeglądarkowi (brak Origin/Referer) nie są wektorem CSRF -> pomijani.
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

// globalne security headers
app.use((_req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;

  res.setHeader('X-Frame-Options',              'DENY');
  res.setHeader('X-Content-Type-Options',       'nosniff');
  res.setHeader('X-XSS-Protection',             '1; mode=block');
  res.setHeader('Referrer-Policy',              'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',           'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security',    'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy',
    `default-src 'self'; ` +
    `script-src 'self' 'nonce-${nonce}'; ` +
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
    `font-src 'self' https://fonts.gstatic.com; ` +
    `img-src 'self' data: blob:; ` +
    `connect-src 'self' http://api.nbp.pl; ` +
    `frame-ancestors 'none';`
  );
  res.removeHeader('X-Powered-By');
  next();
});

// helper sanityzacji â€“ usuwa CAĹY HTML (tagi, atrybuty, encje, javascript:)
const clean = (str, maxLen = 2000) =>
  sanitizeHtml(String(str ?? ''), { allowedTags: [], allowedAttributes: {} }).substring(0, maxLen);

// --- DB ---------------------------------------------------------------------
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
  // WyczyĹ›Ä‡ kolumnÄ™ password (plaintext) â€” dane historyczne
  db.query("UPDATE users SET password = '' WHERE password != ''", e => {
    if (e) console.error('Migracja password clear:', e.message);
    else console.log('Wyczyszczono plaintext passwords');
  });
  // dodaj kolumnÄ™ password_hash jeĹ›li nie istnieje (migracja starej bazy)
  db.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'`,
    (e, rows) => {
      if (!e && rows[0].cnt === 0) {
        db.query("ALTER TABLE users ADD COLUMN password_hash VARCHAR(60) DEFAULT NULL",
          e2 => { if (e2) console.error('Migracja password_hash:', e2.message);
                  else console.log('Dodano kolumnÄ™ password_hash'); });
      }
    }
  );
  db.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'google_id'`,
    (e, rows) => {
      if (!e && rows[0].cnt === 0) {
        db.query("ALTER TABLE users ADD COLUMN google_id VARCHAR(64) DEFAULT NULL", e2 => {
          if (e2) console.error('Migracja google_id:', e2.message);
          else console.log('Dodano kolumnÄ™ google_id');
        });
        db.query("ALTER TABLE users ADD COLUMN email VARCHAR(255) DEFAULT NULL", e2 => {
          if (e2) console.error('Migracja email:', e2.message);
          else console.log('Dodano kolumnÄ™ email');
        });
      }
    }
  );
  db.query(
    `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'totp_secret'`,
    (e, rows) => {
      if (!e && rows[0].cnt === 0) {
        db.query("ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) DEFAULT NULL", e2 => {
          if (e2) console.error('Migracja totp_secret:', e2.message);
          else console.log('Dodano kolumnÄ™ totp_secret');
        });
        db.query("ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE", e2 => {
          if (e2) console.error('Migracja totp_enabled:', e2.message);
          else console.log('Dodano kolumnÄ™ totp_enabled');
        });
      }
    }
  );
});
const dbp = db.promise();

// --- GOOGLE OAUTH STRATEGY ----------------------------------------------------
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

      let [rows] = await dbp.execute('SELECT * FROM users WHERE google_id = ?', [googleId]);
      if (rows[0]) {
        if (isRegister) return done(null, false, { message: 'exists' });
        console.info(`[OAUTH] Login: ${rows[0].agent_id}`);
        return done(null, rows[0]);
      }

      if (email) {
        [rows] = await dbp.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (rows[0]) {
          if (isRegister) return done(null, false, { message: 'exists' });
          await dbp.execute('UPDATE users SET google_id = ? WHERE id = ?', [googleId, rows[0].id]);
          console.info(`[OAUTH] Linked google_id to existing: ${rows[0].agent_id}`);
          return done(null, { ...rows[0], google_id: googleId });
        }
      }

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

// --- JWT helpers -------------------------------------------------------------
// Zwraca dodatniÄ… liczbÄ™ caĹ‚kowitÄ… lub null â€” ochrona przed nieprawidĹ‚owymi ID w URL
function parseId(val) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function getJwtPayload(req) {
  try {
    const { d } = jwt.verify(req.cookies.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    return decryptPayload(d);
  } catch { return null; }
}
function getRole(req) {
  return getJwtPayload(req)?.role || null;
}

// --- CREATE TABLES (jeĹ›li nie istniejÄ…) --------------------------------------
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
        ('28 LUT 2026','Start Operacji â€” pierwsze uderzenia','Bombowce B-2 Spirit i rakiety Tomahawk uderzaja w instalacje nuklearne Fordow i Natanz.',1),
        ('01 MAR 2026','Iran oglasza stan wojenny','Chamenei zawiesza umowy nuklearne. IRGC przejmuje kontrole nad infrastruktura.',0),
        ('02 MAR 2026','Iran zamyka Ciesnine Ormuz','Iranska marynarka blokuje 20% swiatowych dostaw ropy. Cena Brent $118/bbl.',1),
        ('04 MAR 2026','Atak dronami na bazy USA w Iraku','47 dronow Shahed-136 atakuje Al-Asad i Erbil. 3 rannych, 39 zestrzelono.',0),
        ('06 MAR 2026','Kongres zatwierdza $22,3 mld','287 za, 142 przeciw. Srodki na kontynuacje operacji.',1),
        ('09 MAR 2026','Uderzenia na Teheran â€” IRGC','F-35 i Tomahawk niszcza kwatery IRGC. 5004 ofiar wojskowych.',0),
        ('12 MAR 2026','Hezbollah otwiera front polnocny','Rakiety uderzaja w Haife i Tel Awiw. Izrael odpowiada na Bejrut.',0),
        ('15 MAR 2026','Tragedia szkoly w Minab','175 ofiar â€” glownie uczennice. UNESCO potepia. Demonstracje na swiecie.',1),
        ('20 MAR 2026','Negocjacje â€” Katar jako mediator','Pierwsze rozmowy w Doha. Iran zada wycofania sil USA.',0),
        ('28 MAR 2026','Stan na dzis â€” 28 dni konfliktu','Laczny koszt >$33 mld. Brak perspektyw na zawieszenie broni.',1)`);
    }
  });
});

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

db.query(`CREATE TABLE IF NOT EXISTS live_feed (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  type       ENUM('alert','warn','info') NOT NULL DEFAULT 'info',
  message    VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, () => {
  db.query('SELECT COUNT(*) as c FROM live_feed', (e, r) => {
    if (r && r[0].c === 0) {
      db.query(`INSERT INTO live_feed (type, message) VALUES
        ('alert','[CENTCOM] Potwierdzone zniszczenie centrum wzbogacania uranu Fordow â€” glebokosc 90m'),
        ('warn', '[AP] Iran: odwetowe uderzenia dronami na bazy USA w regionie'),
        ('info', '[Reuters] Cena ropy Brent wzrosla do $127/bbl po zamknieciu Ciesniny Ormuz'),
        ('alert','[DoD] Zolnierz USA zginat w ataku rakietowym na baze Al-Asad (Irak)'),
        ('info', '[Al Jazeera] Iran deklaruje kontynuacje programu nuklearnego'),
        ('warn', '[CENTCOM] Zestrzelono 7 dronow Shahed nad Zatoka Perska'),
        ('alert','[Hengaw] Protesty w Teheranie â€” sily bezpieczenstwa uzyly gazu lzawiacego'),
        ('info', '[Reuters] Rosja wzywa do natychmiastowego zawieszenia broni'),
        ('warn', '[DoD] Okret USS Fitzgerald ostrzelany rakietami â€” brak ofiar'),
        ('info', '[AP] Turcja zamknela przestrzen powietrzna dla operacji USA'),
        ('alert','[IAEA] Utracono kontakt z inspektorami w Natanz'),
        ('warn', '[Reuters] Ceny paliw w USA przekraczaja $5/galon â€” rekord od 2022'),
        ('info', '[CNN] Kongres zwoluje nadzwyczajne posiedzenie ws. finansowania'),
        ('alert','[CENTCOM] Uderzenie na rafinerie w Abadanie â€” pozar trwa'),
        ('info', '[Al Jazeera] Jordania zamknela granice z Irakiem â€” obawy eskalacji'),
        ('warn', '[AP] Ciesninea Ormuz: 3 tankowce zatrzymane przez sily IRGC'),
        ('info', '[BBC] Chiny wstrzymuja eksport chipow do USA â€” odpowiedz na sankcje'),
        ('alert','[DoD] Kolejny dron Shahed-136 zestrzelony nad baza Al-Udeid, Katar')`);
    }
  });
});

// --- UPLOAD setup ------------------------------------------------------------
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
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ===============================================================================
// AUTH
// ===============================================================================

const _ipAttempts      = new Map();  // klucz: IP
const _accountAttempts = new Map();  // klucz: username (lowercase)
const _registerAttempts = new Map(); // klucz: IP â€” rejestracje
const _resetAttempts    = new Map(); // klucz: IP â€” reset hasĹ‚a

const LOGIN_WINDOW_MS    = 15 * 60 * 1000;
const MAX_IP_HITS        = 20;
const MAX_ACCOUNT_HITS   = 5;
const ACCOUNT_LOCK_MS    = 30 * 60 * 1000;
const REGISTER_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_REGISTER_HITS  = 10;
const RESET_WINDOW_MS    = 60 * 60 * 1000; // 1h
const MAX_RESET_HITS     = 5;

// Czyszczenie wygasĹ‚ych wpisĂłw co 30 minut (zapobiega wyciekowi pamiÄ™ci)
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

app.post('/api/login', async (req, res) => {
  const ip       = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now      = Date.now();
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  if (!username || !password) return res.status(400).json({ error: 'Brak danych' });

  // -- Blokada po IP ---------------------------------------------------------
  const ipHits = (_ipAttempts.get(ip) || []).filter(t => now - t < LOGIN_WINDOW_MS);
  if (ipHits.length >= MAX_IP_HITS) {
    console.warn(`[AUTH] IP rate-limit: ${ip} (${ipHits.length} prĂłb w 15 min)`);
    return res.status(429).json({ error: 'Zbyt wiele prĂłb logowania. Poczekaj 15 minut.' });
  }
  ipHits.push(now);
  _ipAttempts.set(ip, ipHits);

  // -- Blokada po koncie ----------------------------------------------------
  const key = username.toLowerCase();
  const acc  = _accountAttempts.get(key) || { attempts: [], lockedUntil: 0 };
  if (now < acc.lockedUntil) {
    const remainMin = Math.ceil((acc.lockedUntil - now) / 60000);
    console.warn(`[AUTH] Locked account attempt: ${username} from ${ip}`);
    return res.status(429).json({ error: `Konto zablokowane. SprĂłbuj ponownie za ${remainMin} min.` });
  }
  acc.attempts = acc.attempts.filter(t => now - t < LOGIN_WINDOW_MS);

  // -- Zapytanie SQL â€” prepared statement, brak konkatenacji ----------------
  try {
    const [rows] = await dbp.execute('SELECT * FROM users WHERE agent_id = ?', [username]);
    const u = rows[0];

    // Jednolity komunikat â€” nie ujawnia czy login istnieje (ochrona przed enumeracjÄ…)
    const deny = () => {
      acc.attempts.push(now);
      if (acc.attempts.length >= MAX_ACCOUNT_HITS) {
        acc.lockedUntil = now + ACCOUNT_LOCK_MS;
        console.warn(`[AUTH] Account locked: ${username} from ${ip} (${acc.attempts.length} prĂłb)`);
      } else {
        console.warn(`[AUTH] Failed login: ${username} from ${ip} (prĂłba ${acc.attempts.length}/${MAX_ACCOUNT_HITS})`);
      }
      _accountAttempts.set(key, acc);
      return res.status(401).json({ error: 'NieprawidĹ‚owe dane logowania' });
    };

    if (!u) return deny();

    if (!u.password_hash) return deny();
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return deny();

    // Sukces â€” wyczyĹ›Ä‡ licznik prĂłb dla konta
    _accountAttempts.delete(key);
    console.info(`[AUTH] Login OK: ${username} from ${ip}`);

    if (u.totp_enabled) {
      const preAuthToken = jwt.sign(
        { d: encryptPayload({ id: u.id, preAuth: true }) },
        process.env.JWT_SECRET,
        { expiresIn: '5m', algorithm: 'HS256' }
      );
      return res.json({ requires2FA: true, preAuthToken });
    }

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

app.post('/api/register', async (req, res) => {
  const ip  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const regHits = (_registerAttempts.get(ip) || []).filter(t => now - t < REGISTER_WINDOW_MS);
  if (regHits.length >= MAX_REGISTER_HITS)
    return res.status(429).json({ error: 'Zbyt wiele rejestracji z tego adresu. SprĂłbuj za 24h.' });
  regHits.push(now);
  _registerAttempts.set(ip, regHits);

  const { password, role } = req.body;
  const agent_id = (req.body.agent_id || '').trim();
  if (!agent_id)             return res.status(400).json({ error: 'Podaj ID agenta' });
  if (agent_id.length < 3)   return res.status(400).json({ error: 'ID agenta musi mieÄ‡ co najmniej 3 znaki' });
  if (agent_id.length > 50)  return res.status(400).json({ error: 'ID agenta max 50 znakĂłw' });
  if (!/^[A-Za-z0-9_\-]+$/.test(agent_id))
    return res.status(400).json({ error: 'ID agenta moĹĽe zawieraÄ‡ tylko litery, cyfry, _ i -' });
  if (!password)             return res.status(400).json({ error: 'Podaj hasĹ‚o' });
  if (password.length < 8)   return res.status(400).json({ error: 'HasĹ‚o musi mieÄ‡ co najmniej 8 znakĂłw' });
  const allowedRoles = ['OBSERWATOR', 'ANALITYK'];
  if (!allowedRoles.includes(role))
    return res.status(400).json({ error: 'Wybierz prawidłową rolę: OBSERWATOR lub ANALITYK' });
  try {
    const hash = await bcrypt.hash(password, 12);
    await dbp.execute(
      'INSERT INTO users (agent_id, password, password_hash, role) VALUES (?, ?, ?, ?)',
      [agent_id, '', hash, role]
    );
    res.json({ ok: true, message: 'Konto utworzone' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Agent ID juĹĽ istnieje' });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie('token', COOKIE_OPT);
  res.json({ ok: true });
});

// --- GOOGLE OAUTH ROUTES ------------------------------------------------------
app.get('/api/auth/google', (req, res, next) => {
  const allowed = ['OBSERWATOR', 'ANALITYK'];
  req.session.oauthRole   = allowed.includes(req.query.role) ? req.query.role : null;
  req.session.oauthIntent = req.query.intent === 'register' ? 'register' : 'login';
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

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


// Krok 2 logowania â€” weryfikacja kodu TOTP po podaniu hasĹ‚a
app.post('/api/2fa/login', async (req, res) => {
  const { preAuthToken, code } = req.body;
  if (!preAuthToken || !code) return res.status(400).json({ error: 'Brak danych' });
  try {
    const { d } = jwt.verify(preAuthToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const payload = decryptPayload(d);
    if (!payload.preAuth) return res.status(400).json({ error: 'NieprawidĹ‚owy token' });
    const [rows] = await dbp.execute('SELECT * FROM users WHERE id = ?', [payload.id]);
    const u = rows[0];
    if (!u?.totp_secret) return res.status(400).json({ error: 'BĹ‚Ä…d weryfikacji' });
    if (!authenticator.check(code, u.totp_secret)) return res.status(401).json({ error: 'NieprawidĹ‚owy kod 2FA' });
    const token = jwt.sign(
      { d: encryptPayload({ id: u.id, agent_id: u.agent_id, role: u.role, mfa: true }) },
      process.env.JWT_SECRET,
      { expiresIn: '3m', algorithm: 'HS256' }
    );
    res.cookie('token', token, COOKIE_OPT);
    const decoded = jwt.decode(token);
    res.json({ ok: true, agent_id: u.agent_id, role: u.role, expiresAt: decoded.exp * 1000 });
  } catch { res.status(401).json({ error: 'NieprawidĹ‚owy lub wygasĹ‚y token' }); }
});

// Generowanie sekretu i QR kodu (setup)
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

// Aktywacja â€” weryfikacja pierwszego kodu
app.post('/api/2fa/enable', async (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  const { code } = req.body;
  try {
    const [rows] = await dbp.execute('SELECT totp_secret FROM users WHERE id = ?', [payload.id]);
    const secret = rows[0]?.totp_secret;
    if (!secret) return res.status(400).json({ error: 'Najpierw skonfiguruj 2FA' });
    if (!authenticator.check(code, secret)) return res.status(401).json({ error: 'NieprawidĹ‚owy kod â€” sprĂłbuj ponownie' });
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

// Dezaktywacja
app.post('/api/2fa/disable', async (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  const { code } = req.body;
  try {
    const [rows] = await dbp.execute('SELECT totp_secret FROM users WHERE id = ?', [payload.id]);
    const secret = rows[0]?.totp_secret;
    if (!secret || !authenticator.check(code, secret)) return res.status(401).json({ error: 'NieprawidĹ‚owy kod 2FA' });
    await dbp.execute('UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = ?', [payload.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});


app.get('/api/me', (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  res.json({ ok: true, agent_id: payload.agent_id, role: payload.role, expiresAt: payload.exp * 1000 });
});

app.post('/api/refresh', (req, res) => {
  const payload = getJwtPayload(req);
  if (!payload) return res.status(401).json({ error: 'Niezalogowany' });
  const token = jwt.sign(
    { d: encryptPayload({ id: payload.id, agent_id: payload.agent_id, role: payload.role, mfa: payload.mfa }) },
    process.env.JWT_SECRET,
    { expiresIn: '3m', algorithm: 'HS256' }
  );
  res.cookie('token', token, COOKIE_OPT);
  // czytamy exp z nowo wystawionego tokenu -- jedno miejsce decyduje o czasie
  const newPayload = jwt.decode(token);
  res.json({ ok: true, expiresAt: newPayload.exp * 1000 });
});

// ===============================================================================
// GLOBAL 2FA GUARD
// Blokuje zalogowanych uĹĽytkownikĂłw ktĂłrzy nie ukoĹ„czyli weryfikacji TOTP.
// Zwolnione: trasy auth, 2FA setup, reset hasĹ‚a, GET /api/profile (do konfiguracji 2FA).
// ===============================================================================

const MFA_EXEMPT = [
  '/api/login', '/api/register', '/api/logout', '/api/me', '/api/refresh',
  '/api/auth/', '/api/2fa/', '/api/reset-password/', '/api/usd-rate'
];


// ===============================================================================
// COMMENTS
// ===============================================================================

app.get('/api/comments', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM comments ORDER BY created_at DESC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

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

app.delete('/api/comments/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
  try {
    await dbp.execute('DELETE FROM comments WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});


// ===============================================================================
// PROFILE
// ===============================================================================

app.get('/api/profile', async (req, res) => {
  const userId = getJwtPayload(req)?.id;
  if (!userId) return res.status(401).json({ error: 'Niezalogowany' });
  try {
    const [rows] = await dbp.execute('SELECT id, agent_id, role, bio, income, tax_status, totp_enabled FROM users WHERE id = ?', [userId]);
    res.json(rows[0] || {});
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.put('/api/profile', async (req, res) => {
  const userId = getJwtPayload(req)?.id;
  if (!userId) return res.status(401).json({ error: 'Niezalogowany' });
  if (getRole(req) === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { bio, income } = req.body;

  const safeBio    = clean(bio, 500);
  const safeIncome = Math.max(0, Math.min(10_000_000, parseInt(income) || 0));
  try {
    await dbp.execute('UPDATE users SET bio=?, income=? WHERE id=?', [safeBio, safeIncome, userId]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.put('/api/profile/password', async (req, res) => {
  const userId = getJwtPayload(req)?.id;
  if (!userId) return res.status(401).json({ error: 'Niezalogowany' });
  if (getRole(req) === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });

  const { old_password, new_password } = req.body;
  if (!old_password) return res.status(400).json({ error: 'Podaj obecne hasĹ‚o' });
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: 'Nowe hasĹ‚o musi mieÄ‡ co najmniej 8 znakĂłw' });

  try {
    const [rows] = await dbp.execute(
      'SELECT password_hash FROM users WHERE id = ?', [userId]
    );
    if (!rows[0]?.password_hash) return res.status(400).json({ error: 'BĹ‚Ä…d weryfikacji' });

    const match = await bcrypt.compare(old_password, rows[0].password_hash);
    if (!match) return res.status(403).json({ error: 'Obecne hasĹ‚o jest nieprawidĹ‚owe' });

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

app.post('/api/tax-calculation', async (req, res) => {
  const income = parseFloat(req.body.income);
  const status = req.body.tax_status === 'married' ? 'married' : 'single';
  if (!income || income <= 0 || income > 100_000_000)
    return res.status(400).json({ error: 'NieprawidĹ‚owe zarobki' });
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

// Proxy dla kursu USD/PLN z NBP API â€” klucz IP klienta nigdy nie trafia do zewnÄ™trznego API;
// URL jest hardkodowany po stronie serwera (obrona przed SSRF i podmianÄ… endpointu)
app.get('/api/usd-rate', async (_req, res) => {
  const NBP_URL = 'http://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json';
  try {
    const response = await axios.get(NBP_URL, { timeout: 5000 });
    const mid = response.data?.rates?.[0]?.mid;
    if (!mid) return res.status(502).json({ error: 'NieprawidĹ‚owa odpowiedĹş NBP API' });
    res.json({ mid });
  } catch { res.status(502).json({ error: 'Nie moĹĽna pobraÄ‡ kursu USD' }); }
});

// ===============================================================================
// WAR STATS
// ===============================================================================

app.get('/api/stats', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT stat_key, stat_value FROM war_stats');
    const stats = {};
    rows.forEach(r => { stats[r.stat_key] = r.stat_value; });
    res.json(stats);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.put('/api/stats/:key', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Brak wartoĹ›ci' });
  try {
    await dbp.execute('UPDATE war_stats SET stat_value = ? WHERE stat_key = ?',
      [String(value).substring(0, 255), req.params.key]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// INTEL REPORTS
// ===============================================================================

const CLEARANCE_BY_ROLE = {
  null:       ['JAWNY'],
  OBSERWATOR: ['JAWNY'],
  ANALITYK:   ['JAWNY', 'TAJNY'],
  OPERACYJNY: ['JAWNY', 'TAJNY', 'ĹšCIĹšLE TAJNY'],
};

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

app.get('/api/reports/:id', async (req, res) => {
  const role    = getRole(req);
  const allowed = CLEARANCE_BY_ROLE[role] || CLEARANCE_BY_ROLE[null];
  const ph      = allowed.map(() => '?').join(',');
  try {
    const [rows] = await dbp.execute(
      `SELECT * FROM intel_reports WHERE id = ? AND clearance IN (${ph})`,
      [parseId(req.params.id), ...allowed]);
    if (!rows[0]) return res.status(403).json({ error: 'Brak dostÄ™pu' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.post('/api/reports', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { title, content, source, clearance } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'TytuĹ‚ i treĹ›Ä‡ sÄ… wymagane' });
  const safeTitle   = clean(title, 255);
  const safeContent = clean(content, 5000);
  const safeSource  = clean(source || 'OSINT', 100);
  const valid       = ['JAWNY', 'TAJNY', 'ĹšCIĹšLE TAJNY'];
  const safeCl      = valid.includes(clearance) ? clearance : 'JAWNY';
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

app.get('/api/casualties', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM casualties ORDER BY event_date DESC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.post('/api/casualties', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const { event_date, location, side, category, count, description } = req.body;
  const validSides = ['IRAN','KOALICJA','CYWILE'];
  const validCats  = ['MILITARNE','CYWILNE','INFRASTRUKTURA'];
  if (!validSides.includes(side) || !validCats.includes(category))
    return res.status(400).json({ error: 'NieprawidĹ‚owa strona lub kategoria' });
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

app.get('/api/strikes', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM strike_points ORDER BY created_at DESC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

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

app.delete('/api/strikes/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
  try {
    await dbp.execute('DELETE FROM strike_points WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// PETITION
// ===============================================================================

const _petitionAttempts = new Map();

app.get('/api/petition', async (_req, res) => {
  try {
    const [[countRow]] = await dbp.execute('SELECT COUNT(*) as total FROM petition_signatures');
    const [recent]     = await dbp.execute('SELECT id, name, comment, signed_at FROM petition_signatures ORDER BY id DESC LIMIT 20');
    res.json({ total: countRow.total, recent });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.post('/api/petition/sign', async (req, res) => {
  if (!getRole(req)) return res.status(401).json({ error: 'Wymagane logowanie' });
  const ip  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const hits = (_petitionAttempts.get(ip) || []).filter(t => now - t < 60 * 1000);
  if (hits.length >= 1) return res.status(429).json({ error: 'MoĹĽesz podpisaÄ‡ tylko raz na minutÄ™.' });
  hits.push(now); _petitionAttempts.set(ip, hits);

  const safeName    = clean(req.body.name || 'Anonim', 255);
  const safeComment = clean(req.body.comment, 500);
  if (!safeName.trim()) return res.status(400).json({ error: 'Podaj imiÄ™' });
  try {
    await dbp.execute('INSERT INTO petition_signatures (name, comment, ip) VALUES (?, ?, ?)', [safeName, safeComment, ip]);
    const [[row]] = await dbp.execute('SELECT COUNT(*) as total FROM petition_signatures');
    res.json({ ok: true, total: row.total });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.delete('/api/petition/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
  try {
    await dbp.execute('DELETE FROM petition_signatures WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// FILE UPLOAD
// ===============================================================================

app.post('/api/upload', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyĹĽsza' });

  uploadHandler.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Brak pliku' });

    const ALLOWED_REAL_MIMES = new Set([
      'image/jpeg','image/png','image/gif','image/webp','application/pdf'
    ]);
    const ALLOWED_TEXT_EXTS = new Set(['.txt','.log','.csv','.md']);

    try {
      const buf = fs.readFileSync(req.file.path);
      const detected = await fileTypeFromBuffer(buf);

      if (detected) {
        if (!ALLOWED_REAL_MIMES.has(detected.mime)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: `Niedozwolony typ pliku: ${detected.mime}` });
        }
      } else {
        // brak magic bytes â†’ tylko dozwolone rozszerzenia tekstowe
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!ALLOWED_TEXT_EXTS.has(ext)) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'Niedozwolony typ pliku' });
        }
      }
    } catch {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(500).json({ error: 'BĹ‚Ä…d weryfikacji pliku' });
    }

    // unikalna nazwa â€” zapobiega nadpisywaniu istniejÄ…cych plikĂłw
    const base = req.body.custom_filename
      ? path.basename(req.body.custom_filename).replace(/[^a-zA-Z0-9._-]/g, '_')
      : path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext  = path.extname(base);
    const stem = path.basename(base, ext);
    const unique = `${stem}_${Date.now()}${ext}`;
    const targetPath = path.join(uploadsDir, unique);
    fs.copyFileSync(req.file.path, targetPath);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, filename: unique, url: `/api/uploads/${unique}` });
  });
});

// /uploads chroniony â€“ wymagane logowanie
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

app.get('/api/timeline', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM timeline_events ORDER BY id DESC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.post('/api/timeline', async (req, res) => {
  const role = getRole(req);
  if (!role) return res.status(401).json({ error: 'Wymagane logowanie' });
  if (role === 'OBSERWATOR') return res.status(403).json({ error: 'Wymagana rola: ANALITYK lub wyższa' });
  const { event_date, title, description, is_major } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'TytuĹ‚ jest wymagany' });
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

app.delete('/api/timeline/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
  try {
    await dbp.execute('DELETE FROM timeline_events WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.patch('/api/timeline/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
  const { is_major } = req.body;
  try {
    await dbp.execute('UPDATE timeline_events SET is_major = ? WHERE id = ?', [is_major ? 1 : 0, id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// CONNECTED CONFLICTS
// ===============================================================================

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
  const newId      = Date.now();
  try {
    await dbp.execute(
      'INSERT INTO conflict_stats (conflict_id, conflict_label, stat_key, stat_value, severity, is_active, sort_order) VALUES (?, ?, ?, ?, ?, 1, 0)',
      [String(newId), safeLabel, 'region', safeRegion, safeSev]);
    res.json({ ok: true, conflict_id: newId });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

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

app.delete('/api/conflicts/stats/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
  try {
    await dbp.execute('DELETE FROM conflict_stats WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// USER DIRECTORY
// ===============================================================================

app.get('/api/users', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  try {
    const [rows] = await dbp.execute('SELECT id, agent_id, role, bio FROM users');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// RESET HASĹA
// ===============================================================================

const _resetTokens = new Map();

app.post('/api/reset-password/request', async (req, res) => {
  const ip  = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const resetHits = (_resetAttempts.get(ip) || []).filter(t => now - t < RESET_WINDOW_MS);
  if (resetHits.length >= MAX_RESET_HITS)
    return res.status(429).json({ error: 'Zbyt wiele prĂłb resetowania hasĹ‚a. SprĂłbuj za godzinÄ™.' });
  resetHits.push(now);
  _resetAttempts.set(ip, resetHits);

  const { agent_id } = req.body;
  if (!agent_id) return res.status(400).json({ error: 'Podaj ID agenta' });
  try {
    const [rows] = await dbp.execute('SELECT id FROM users WHERE agent_id = ?', [agent_id]);
    if (!rows[0]) return res.status(404).json({ error: 'Agent nie istnieje' });
    const token   = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 15 * 60 * 1000;
    _resetTokens.set(token, { agent_id, expires });
    res.json({ ok: true, message: 'JeĹ›li agent istnieje, token zostaĹ‚ wysĹ‚any na powiÄ…zany adres e-mail.' });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.post('/api/reset-password/confirm', async (req, res) => {
  const { token, new_password } = req.body;
  const entry = _resetTokens.get(token);
  if (!entry) return res.status(400).json({ error: 'NieprawidĹ‚owy token' });
  if (Date.now() > entry.expires) { _resetTokens.delete(token); return res.status(400).json({ error: 'Token wygasĹ‚' }); }
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'HasĹ‚o musi mieÄ‡ co najmniej 8 znakĂłw' });
  try {
    const hash = await bcrypt.hash(new_password, 12);
    await dbp.execute('UPDATE users SET password_hash = ?, password = ? WHERE agent_id = ?',
      [hash, '', entry.agent_id]);
    _resetTokens.delete(token);
    res.json({ ok: true, message: `HasĹ‚o zmienione dla: ${entry.agent_id}` });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});


// ===============================================================================
// WEAPONS
// ===============================================================================

app.get('/api/weapons', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT * FROM weapons ORDER BY id');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

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

app.put('/api/weapons/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
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

app.delete('/api/weapons/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
  try {
    await dbp.execute('DELETE FROM weapons WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

// ===============================================================================
// LIVE FEED
// ===============================================================================

app.get('/api/livefeed', async (_req, res) => {
  try {
    const [rows] = await dbp.execute('SELECT id, type, message FROM live_feed ORDER BY id ASC');
    res.json(rows);
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.post('/api/livefeed', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const { type, message } = req.body;
  const validTypes = ['alert', 'warn', 'info'];
  if (!validTypes.includes(type) || !message?.trim())
    return res.status(400).json({ error: 'NieprawidĹ‚owe dane' });
  try {
    await dbp.execute('INSERT INTO live_feed (type, message) VALUES (?, ?)',
      [type, clean(message, 500)]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});

app.delete('/api/livefeed/:id', async (req, res) => {
  if (getRole(req) !== 'OPERACYJNY') return res.status(403).json({ error: 'Wymagana rola: OPERACYJNY' });
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'NieprawidĹ‚owe ID' });
  try {
    await dbp.execute('DELETE FROM live_feed WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Internal Server Error' }); }
});


// --- Error handler ------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
});

function startServer() {
  const sslKeyPath  = process.env.SSL_KEY;
  const sslCertPath = process.env.SSL_CERT;

  const hasCerts = sslKeyPath && sslCertPath &&
    fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);

  if (hasCerts) {
    // -- HTTPS + przekierowanie HTTPâ†’HTTPS ---------------------------------
    const httpsOptions = {
      key:  fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath),
    };

    http.createServer((req, res) => {
      const host = (req.headers.host || '').replace(`:${PORT_HTTP}`, '');
      res.writeHead(301, { Location: `https://${host}${req.url}` });
      res.end();
    }).listen(PORT_HTTP, () =>
      console.log(`[HTTP]  Redirect HTTPâ†’HTTPS na porcie ${PORT_HTTP}`)
    );

    https.createServer(httpsOptions, app).listen(PORT, () =>
      console.log(`[HTTPS] Server na porcie ${PORT}`)
    );

  } else {
    // -- Fallback HTTP (brak certyfikatĂłw) ---------------------------------
    if (IS_PROD) {
      console.warn('[WARN] Brak certyfikatĂłw SSL â€” uruchamiam HTTP (niezalecane na produkcji)');
      console.warn('[WARN] Ustaw SSL_KEY i SSL_CERT w .env ĹĽeby wĹ‚Ä…czyÄ‡ HTTPS');
    }
    app.listen(PORT, () =>
      console.log(`[HTTP]  Server na porcie ${PORT}`)
    );
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;

