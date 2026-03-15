const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Assicura che la cartella data esista
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'byte4lunch.db'));

// Abilita WAL per performance migliori
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','reviewer','user')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS invite_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'reviewer',
      email TEXT,
      created_by INTEGER REFERENCES users(id),
      used_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      place TEXT NOT NULL,
      address TEXT,
      tags TEXT DEFAULT '[]',
      added_by INTEGER REFERENCES users(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      visit_date TEXT NOT NULL,
      qualita INTEGER NOT NULL CHECK(qualita BETWEEN 1 AND 5),
      velocita INTEGER NOT NULL CHECK(velocita BETWEEN 1 AND 5),
      prezzo INTEGER NOT NULL CHECK(prezzo BETWEEN 1 AND 5),
      bonus_simpatia INTEGER NOT NULL DEFAULT 0,
      bonus_caffe INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      score REAL GENERATED ALWAYS AS (
        ROUND(
          (qualita + velocita + prezzo) / 3.0
          + (bonus_simpatia * 0.3)
          + (bonus_caffe * 0.2)
        , 1)
      ) STORED,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_restaurant ON reviews(restaurant_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
    CREATE INDEX IF NOT EXISTS idx_restaurants_place ON restaurants(place);
  `);

  // Crea admin iniziale se non esiste
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@omega.it';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'CambiaSubito2024!', 12);
    db.prepare(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES (?, ?, ?, 'admin')
    `).run(process.env.ADMIN_NAME || 'Amministratore', adminEmail, hash);
    console.log(`✅ Admin creato: ${adminEmail}`);
  }

  // Dati demo iniziali
  const restCount = db.prepare('SELECT COUNT(*) as c FROM restaurants').get().c;
  if (restCount === 0) {
    const adminId = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('admin').id;
    const insertRest = db.prepare(`
      INSERT INTO restaurants (name, place, address, tags, added_by)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertRest.run('Osteria Al Sole', "Quarto d'Altino", 'Via Roma 12', JSON.stringify(['menu fisso','pesce']), adminId);
    insertRest.run('Trattoria Da Mario', 'Mestre', 'Corso del Popolo 44', JSON.stringify(['menu fisso','carne']), adminId);
    insertRest.run('Il Boccone Felice', "Quarto d'Altino", 'Via Venezia 7', JSON.stringify(['menu fisso','vegan option']), adminId);
    console.log('✅ Dati demo inseriti');
  }
}

initDatabase();
module.exports = db;
