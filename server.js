require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { initDatabase, run, all } = require('./database');
const { authMiddleware, requireRole } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Sicurezza ────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization']
}));

// Rate limit globale: 200 req/15min per IP
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Troppe richieste. Riprova tra qualche minuto.' }
}));

app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

// ── Health check (usato dal cron keep-alive) ─────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ── Routes API ───────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/restaurants', require('./routes/restaurants'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/users', require('./routes/users'));

// ── Tracciamento visite anonime ───────────────────────────
// POST /api/anon-ping — chiamato dal frontend quando l'utente non è loggato
app.post('/api/anon-ping', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await run(
      `INSERT INTO anon_visits (date, count) VALUES (?, 1)
       ON CONFLICT(date) DO UPDATE SET count = count + 1`,
      [today]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('anon-ping error:', e);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// GET /api/anon-visits — solo admin, restituisce conteggi per data
app.get('/api/anon-visits', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const rows = await all('SELECT date, count FROM anon_visits ORDER BY date DESC');
    res.json(rows);
  } catch (e) {
    console.error('anon-visits error:', e);
    res.status(500).json({ error: 'Errore interno' });
  }
});

// ── Frontend statico ─────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler ────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Errore interno del server' });
});

// ── Avvio: inizializza DB poi ascolta ────────────────────
initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🍝 byte4lunch in esecuzione su http://localhost:${PORT}`);
      console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Database: Turso (${process.env.TURSO_DATABASE_URL})\n`);
    });
  })
  .catch(err => {
    console.error('❌ Errore inizializzazione database:', err);
    process.exit(1);
  });
