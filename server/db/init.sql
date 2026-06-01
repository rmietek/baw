CREATE DATABASE IF NOT EXISTS iran_tracker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE iran_tracker;

SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: users
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  agent_id      VARCHAR(50)  UNIQUE NOT NULL,
  password      VARCHAR(255) NOT NULL DEFAULT '',
  password_hash VARCHAR(60)  DEFAULT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'ANALITYK',
  bio           TEXT,
  income        INT          NOT NULL DEFAULT 0,
  tax_status    VARCHAR(20)  NOT NULL DEFAULT 'single',
  totp_secret   VARCHAR(64)  DEFAULT NULL,
  totp_enabled  BOOLEAN      NOT NULL DEFAULT FALSE,
  google_id     VARCHAR(64)  DEFAULT NULL,
  email         VARCHAR(255) DEFAULT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- CHECK: rola tylko ze zdefiniowanej listy
  CONSTRAINT chk_users_role
    CHECK (role IN ('OBSERWATOR','ANALITYK','OPERACYJNY')),

  -- CHECK: dochód nieujemny i nie przekracza 10 mln
  CONSTRAINT chk_users_income
    CHECK (income >= 0 AND income <= 10000000),

  -- CHECK: tax_status z dozwolonych wartości
  CONSTRAINT chk_users_tax_status
    CHECK (tax_status IN ('single','married')),

  -- CHECK: agent_id min 3 znaki, tylko bezpieczne znaki
  CONSTRAINT chk_users_agent_id_length
    CHECK (CHAR_LENGTH(agent_id) >= 3),

  -- INDEX: przyspieszenie wyszukiwania po emailu i google_id
  INDEX idx_users_email    (email),
  INDEX idx_users_google_id(google_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO users (agent_id, password, password_hash, role) VALUES
  ('admin',      '', '$2b$12$.BmOn8CtbZI1woCe0cax2.SkpKEXm5NOUDhxrFXxepIkqnA/ewUea', 'OPERACYJNY'),
  ('AGENT-7741', '', '$2b$12$dORfOSmiSXoHzyK0GZbn9uipuo4FSB4/5/BkL4YrZMOV3o.OdqgUS', 'ANALITYK'),
  ('AGENT-0042', '', '$2b$12$bngI82tPMmhppOgmBQaN0umJ4id6b6yf4H.3sgIGbD8AXJNsjsTRC', 'OBSERWATOR');

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: comments
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  author_id  INT          DEFAULT NULL,
  author     VARCHAR(255) NOT NULL DEFAULT 'ANONIM',
  content    TEXT         NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- CHECK: autor nie może być pusty
  CONSTRAINT chk_comments_author
    CHECK (CHAR_LENGTH(TRIM(author)) > 0),

  -- CHECK: treść nie może być pusta
  CONSTRAINT chk_comments_content
    CHECK (CHAR_LENGTH(TRIM(content)) > 0),

  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_comments_author_id (author_id),
  INDEX idx_comments_created_at(created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO comments (author, content) VALUES
  ('AGENT-7741', 'Sektor północny czysty. Brak aktywności wrogich jednostek.'),
  ('ADMIN-001',  'Potwierdzono ruch kolumny pancernej w okolicach Ahwazu.'),
  ('AGENT-0042', 'Odebrano sygnał z sektora Delta. Trwa weryfikacja.');

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: war_stats
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE war_stats (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  stat_key   VARCHAR(100) UNIQUE NOT NULL,
  stat_value VARCHAR(255) NOT NULL,
  updated_by INT          DEFAULT NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- CHECK: klucz statystyki nie może być pusty
  CONSTRAINT chk_war_stats_key
    CHECK (CHAR_LENGTH(TRIM(stat_key)) > 0),

  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_war_stats_key(stat_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO war_stats (stat_key, stat_value) VALUES
  ('total_cost_usd',      '47200000000'),
  ('days_active',         '18'),
  ('strikes_conducted',   '142'),
  ('drones_intercepted',  '89'),
  ('military_casualties', '23'),
  ('civilian_casualties', '47');

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: tax_calculations
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE tax_calculations (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT             DEFAULT NULL,
  final_tax_paid DECIMAL(15,2)   NOT NULL,
  calculated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- CHECK: podatek nieujemny (eliminuje Insecure Design: ujemny podatek)
  CONSTRAINT chk_tax_nonnegative
    CHECK (final_tax_paid >= 0),

  -- CHECK: podatek nie przekracza rozsądnego maksimum (100 mln USD)
  CONSTRAINT chk_tax_maximum
    CHECK (final_tax_paid <= 100000000),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tax_user_id(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: intel_reports
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE intel_reports (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(255)  NOT NULL,
  content    TEXT          NOT NULL,
  source     VARCHAR(100)  NOT NULL DEFAULT 'UNKNOWN',
  clearance  ENUM('JAWNY','TAJNY','SCISLE TAJNY') NOT NULL DEFAULT 'JAWNY',
  added_by   INT           DEFAULT NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- CHECK: tytuł nie może być pusty
  CONSTRAINT chk_intel_title
    CHECK (CHAR_LENGTH(TRIM(title)) > 0),

  -- CHECK: treść nie może być pusta
  CONSTRAINT chk_intel_content
    CHECK (CHAR_LENGTH(TRIM(content)) > 0),

  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_intel_clearance  (clearance),
  INDEX idx_intel_created_at (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO intel_reports (title, content, source, clearance, added_by) VALUES
  ('Iranskie drony Shahed wykryte nad Morzem Czerwonym',
   'Radar koalicji zidentyfikowal 14 dronow kamikadze klasy Shahed-136 lecacych w kierunku ciesniny. Podjeto dzialania przechwytujace.',
   'OSINT-Feed', 'JAWNY', NULL),
  ('Szacunki strat infrastruktury energetycznej Q2',
   'Wedlug niepotwierdzonych zrodel zniszczeniu uleglo ok. 23% przepustowosci rafinerii w regionie. Weryfikacja w toku.',
   'CIA-Relay', 'TAJNY', 1),
  ('Ruch wojsk przy granicy z Irakiem',
   'Satelita KH-13 zarejestrowal kolumny 80+ pojazdow opancerzonych w sektorze polnocno-zachodnim. Analiza trwa.',
   'NSA-Feed', 'SCISLE TAJNY', 1);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: casualties
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE casualties (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  event_date  DATE         NOT NULL,
  location    VARCHAR(100) NOT NULL,
  side        ENUM('IRAN','KOALICJA','CYWILE') NOT NULL,
  category    ENUM('MILITARNE','CYWILNE','INFRASTRUKTURA') NOT NULL,
  count       INT          NOT NULL DEFAULT 0,
  description VARCHAR(255) DEFAULT NULL,
  reported_by INT          DEFAULT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- CHECK: liczba strat nieujemna 
  CONSTRAINT chk_casualties_count
    CHECK (count >= 0),

  -- CHECK: lokalizacja nie pusta
  CONSTRAINT chk_casualties_location
    CHECK (CHAR_LENGTH(TRIM(location)) > 0),

  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_casualties_side      (side),
  INDEX idx_casualties_event_date(event_date DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO casualties (event_date, location, side, category, count, description, reported_by) VALUES
  ('2025-04-01', 'Baza Al-Asad, Irak',   'KOALICJA', 'MILITARNE',      3,  'Atak rakietowy na baze lotnicza',         1),
  ('2025-04-03', 'Teheran',              'IRAN',     'INFRASTRUKTURA', 1,  'Zniszczona stacja transformatorowa',      1),
  ('2025-04-07', 'Morze Czerwone',       'IRAN',     'MILITARNE',      0,  'Zestrzelone 8 dronow Shahed',             1),
  ('2025-04-10', 'Bandar Abbas',         'CYWILE',   'CYWILNE',        12, 'Ofiary cywilne - zbadac wiarygodnosc',    1),
  ('2025-04-14', 'Baza Ain al-Asad',     'KOALICJA', 'MILITARNE',      1,  'Zolnierz ranny w ostrzale mozdzierzowym', 1);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: live_feed
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE live_feed (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  type       ENUM('alert','warn','info') NOT NULL DEFAULT 'info',
  message    VARCHAR(500) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- CHECK: wiadomość nie pusta
  CONSTRAINT chk_live_feed_message
    CHECK (CHAR_LENGTH(TRIM(message)) > 0),

  INDEX idx_live_feed_type      (type),
  INDEX idx_live_feed_created_at(created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO live_feed (type, message) VALUES
  ('alert', '[CENTCOM] Potwierdzone zniszczenie centrum wzbogacania uranu Fordow'),
  ('warn',  '[AP] Iran: odwetowe uderzenia dronami na bazy USA w regionie'),
  ('info',  '[Reuters] Cena ropy Brent wzrosla do $127/bbl'),
  ('alert', '[DoD] Zolnierz USA zginat w ataku rakietowym na baze Al-Asad'),
  ('info',  '[Al Jazeera] Iran deklaruje kontynuacje programu nuklearnego'),
  ('warn',  '[CENTCOM] Zestrzelono 7 dronow Shahed nad Zatoka Perska');

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: weapons
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE weapons (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  cost        BIGINT       NOT NULL DEFAULT 0,
  count_used  INT          NOT NULL DEFAULT 0,
  pct         INT          NOT NULL DEFAULT 0,
  category    VARCHAR(50)  NOT NULL DEFAULT 'air',
  added_by    INT          DEFAULT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- CHECK: koszt i liczba nieujemne
  CONSTRAINT chk_weapons_cost       CHECK (cost >= 0),
  CONSTRAINT chk_weapons_count      CHECK (count_used >= 0),
  -- CHECK: udział procentowy 0-100
  CONSTRAINT chk_weapons_pct        CHECK (pct >= 0 AND pct <= 100),
  -- CHECK: kategoria ze zdefiniowanej listy
  CONSTRAINT chk_weapons_category
    CHECK (category IN ('air','naval','ground','drone','missile')),
  -- CHECK: nazwa nie pusta
  CONSTRAINT chk_weapons_name
    CHECK (CHAR_LENGTH(TRIM(name)) > 0),

  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_weapons_category(category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO weapons (name, cost, count_used, pct, category, added_by) VALUES
  ('GBU-57 MOP (bomba bunkrowa)',   3500000,  18,  90,  'air',   1),
  ('Tomahawk BGM-109 (rakieta)',    2000000,  120, 100, 'naval', 1),
  ('F-35A / F-35B (sortie)',        36000,    340, 60,  'air',   1),
  ('B-2 Spirit (przelot)',          130000,   42,  100, 'air',   1),
  ('AGM-158 JASSM-ER',              1300000,  65,  80,  'air',   1),
  ('MQ-9 Reaper (zestrzelone)',     32000000, 3,   20,  'drone', 1),
  ('GBU-28 (bomba bunkrowa mala)',  145000,   280, 70,  'air',   1);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRIGGERY
-- ═══════════════════════════════════════════════════════════════════════════════

DELIMITER $$

-- TRIGGER 1: automatyczna aktualizacja updated_at przy każdej zmianie profilu użytkownika
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  SET NEW.updated_at = CURRENT_TIMESTAMP;
END$$

-- TRIGGER 2: blokada ujemnej liczby strat przy dodawaniu wpisu
CREATE TRIGGER trg_casualties_nonnegative
BEFORE INSERT ON casualties
FOR EACH ROW
BEGIN
  IF NEW.count < 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Liczba strat nie moze byc ujemna';
  END IF;
END$$

-- TRIGGER 3: blokada usunięcia ostatniego administratora (lockout prevention)
CREATE TRIGGER trg_users_no_delete_last_admin
BEFORE DELETE ON users
FOR EACH ROW
BEGIN
  DECLARE admin_count INT;
  IF OLD.role = 'OPERACYJNY' THEN
    SELECT COUNT(*) INTO admin_count
      FROM users WHERE role = 'OPERACYJNY' AND id != OLD.id;
    IF admin_count = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Nie mozna usunac ostatniego administratora OPERACYJNY';
    END IF;
  END IF;
END$$

-- TRIGGER 4: odrzucenie komentarza zawierającego znacznik skryptowy (obrona przed XSS)
CREATE TRIGGER trg_comments_no_script
BEFORE INSERT ON comments
FOR EACH ROW
BEGIN
  IF LOWER(NEW.content) REGEXP '<script|javascript:' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Tresc zawiera niedozwolony znacznik skryptowy';
  END IF;
END$$

DELIMITER ;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: strike_points
-- Endpointy: GET /api/strikes  POST /api/strikes  DELETE /api/strikes/:id
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE strike_points (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  type_desc  VARCHAR(500) DEFAULT NULL,
  cx         FLOAT        NOT NULL,
  cy         FLOAT        NOT NULL,
  color_type VARCHAR(20)  NOT NULL DEFAULT 'military',
  added_by   VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_strike_name  CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT chk_strike_cx    CHECK (cx >= 0 AND cx <= 620),
  CONSTRAINT chk_strike_cy    CHECK (cy >= 0 AND cy <= 490),
  CONSTRAINT chk_strike_color CHECK (color_type IN ('military','nuclear','naval','infra')),
  INDEX idx_strike_points_type(color_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: petition_signatures
-- Endpointy: GET /api/petition  POST /api/petition/sign  DELETE /api/petition/:id
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE petition_signatures (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(255) NOT NULL,
  comment   VARCHAR(500) DEFAULT NULL,
  ip        VARCHAR(45)  DEFAULT NULL,
  signed_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_petition_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  INDEX idx_petition_signed_at(signed_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: timeline_events
-- Endpointy: GET /api/timeline  POST /api/timeline  PATCH /api/timeline/:id  DELETE /api/timeline/:id
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE timeline_events (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  event_date  VARCHAR(30)  NOT NULL,
  title       VARCHAR(255) NOT NULL,
  description TEXT         DEFAULT NULL,
  is_major    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_timeline_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  INDEX idx_timeline_created_at(created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO timeline_events (event_date, title, description, is_major) VALUES
  ('28 LUT 2026', 'Start Operacji -- pierwsze uderzenia',
   'Bombowce B-2 Spirit i rakiety Tomahawk uderzaja w instalacje nuklearne Fordow i Natanz.', 1),
  ('01 MAR 2026', 'Iran oglasza stan wojenny',
   'Chamenei zawiesza umowy nuklearne. IRGC przejmuje kontrole nad infrastruktura.', 0),
  ('02 MAR 2026', 'Iran zamyka Ciesnine Ormuz',
   'Iranska marynarka blokuje 20% swiatowych dostaw ropy. Cena Brent $118/bbl.', 1),
  ('04 MAR 2026', 'Atak dronami na bazy USA w Iraku',
   '47 dronow Shahed-136 atakuje Al-Asad i Erbil. 3 rannych, 39 zestrzelono.', 0),
  ('06 MAR 2026', 'Kongres zatwierdza $22,3 mld',
   '287 za, 142 przeciw. Srodki na kontynuacje operacji.', 1),
  ('09 MAR 2026', 'Uderzenia na Teheran -- IRGC',
   'F-35 i Tomahawk niszcza kwatery IRGC. 5004 ofiar wojskowych.', 0),
  ('12 MAR 2026', 'Hezbollah otwiera front polnocny',
   'Rakiety uderzaja w Haife i Tel Awiw. Izrael odpowiada na Bejrut.', 0),
  ('15 MAR 2026', 'Tragedia szkoly w Minab',
   '175 ofiar -- glownie uczennice. UNESCO potepia. Demonstracje na swiecie.', 1),
  ('20 MAR 2026', 'Negocjacje -- Katar jako mediator',
   'Pierwsze rozmowy w Doha. Iran zada wycofania sil USA.', 0),
  ('28 MAR 2026', 'Stan na dzis -- 28 dni konfliktu',
   'Laczny koszt >$33 mld. Brak perspektyw na zawieszenie broni.', 1);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABELA: conflict_stats
-- Endpointy: GET /api/conflicts  POST /api/conflicts  PUT /api/conflicts/:id
--            POST /api/conflicts/:id/stats  DELETE /api/conflicts/stats/:id
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE conflict_stats (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  conflict_id    VARCHAR(20)  NOT NULL,
  conflict_label VARCHAR(150) DEFAULT NULL,
  stat_key       VARCHAR(100) DEFAULT NULL,
  stat_value     VARCHAR(150) DEFAULT NULL,
  sort_order     INT          NOT NULL DEFAULT 0,
  severity       VARCHAR(20)  NOT NULL DEFAULT 'medium',
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,

  CONSTRAINT chk_conflict_id       CHECK (CHAR_LENGTH(TRIM(conflict_id)) > 0),
  CONSTRAINT chk_conflict_severity CHECK (severity IN ('low','medium','high','CRITICAL')),
  INDEX idx_conflict_stats_id  (conflict_id),
  INDEX idx_conflict_stats_sort(conflict_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO conflict_stats (conflict_id, conflict_label, stat_key, stat_value, sort_order) VALUES
  ('lb', 'POWIAZANY KONFLIKT: LIBAN', 'Zaangazowanie Hezbollahu',    'Aktywne',  1),
  ('lb', 'POWIAZANY KONFLIKT: LIBAN', 'Uderzenia Izraela na Liban',  '340+',     2),
  ('lb', 'POWIAZANY KONFLIKT: LIBAN', 'Ofiary cywilne (Liban)',      '820+',     3),
  ('lb', 'POWIAZANY KONFLIKT: LIBAN', 'Przesiedleni mieszkancy',     '~1,2 mln', 4),
  ('ym', 'POWIAZANY KONFLIKT: JEMEN', 'Ataki Huti na drogi morskie', 'Aktywne',  1),
  ('ym', 'POWIAZANY KONFLIKT: JEMEN', 'Zestrzelone drony / rakiety USA', '180+', 2),
  ('ym', 'POWIAZANY KONFLIKT: JEMEN', 'Szacowany koszt USA (Jemen)', '$4,2 mld', 3),
  ('iq', 'POWIAZANY KONFLIKT: IRAK / SYRIA', 'Ataki na bazy USA',        '47',        1),
  ('iq', 'POWIAZANY KONFLIKT: IRAK / SYRIA', 'Zolnierze USA ranni',      '112',       2),
  ('iq', 'POWIAZANY KONFLIKT: IRAK / SYRIA', 'Odpowiedzi sil USA',       '38 uderzen',3);

