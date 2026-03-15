const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// Validazione password complessa
function validatePassword(pwd) {
  if (pwd.length < 8) return 'Minimo 8 caratteri';
  if (!/[A-Z]/.test(pwd)) return 'Deve contenere almeno una lettera maiuscola';
  if (!/[a-z]/.test(pwd)) return 'Deve contenere almeno una lettera minuscola';
  if (!/[0-9]/.test(pwd)) return 'Deve contenere almeno un numero';
  if (!/[^A-Za-z0-9]/.test(pwd)) return 'Deve contenere almeno un carattere speciale (!@#$%...)';
  return null;
}

// Rate limit: max 5 tentativi di login ogni 15 minuti per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Troppi tentativi di accesso. Riprova tra 15 minuti.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e password richieste' });

    const user = await db.get('SELECT * FROM users WHERE email = ? AND active = 1', [email.toLowerCase().trim()]);
    if (!user) return res.status(401).json({ error: 'Credenziali non valide' });

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenziali non valide' });

    await db.run(`UPDATE users SET last_login = datetime('now') WHERE id = ?`, [user.id]);

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// POST /api/auth/register (registrazione libera, ruolo 'user' di default)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e password sono obbligatori' });
    }
    const pwdErr = validatePassword(password);
    if (pwdErr) return res.status(400).json({ error: pwdErr });

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) return res.status(409).json({ error: 'Email già registrata' });

    const hash = bcrypt.hashSync(password, 12);
    const result = await db.run(
      `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'user')`,
      [name.trim(), email.toLowerCase().trim(), hash]
    );

    const user = await db.get('SELECT id, name, email, role FROM users WHERE id = ?', [result.lastInsertRowid]);
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, name, email, role, created_at, last_login FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json(user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Campi mancanti' });
    const pwdErr = validatePassword(new_password);
    if (pwdErr) return res.status(400).json({ error: pwdErr });

    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Password attuale non corretta' });
    }

    await db.run(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [bcrypt.hashSync(new_password, 12), req.user.id]
    );
    res.json({ message: 'Password aggiornata' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── ADMIN: gestione inviti ──────────────────────────────────────────

// POST /api/auth/invites  (solo admin)
router.post('/invites', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { email, role } = req.body;
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.run(
      `INSERT INTO invite_tokens (token, role, email, created_by, expires_at) VALUES (?, ?, ?, ?, ?)`,
      [token, role || 'reviewer', email || null, req.user.id, expiresAt]
    );

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const inviteLink = `${baseUrl}/?invite=${token}`;

    res.json({
      token,
      link: inviteLink,
      expires_at: expiresAt,
      role: role || 'reviewer'
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /api/auth/invites (solo admin)
router.get('/invites', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const invites = await db.all(`
      SELECT i.*, u.name as created_by_name
      FROM invite_tokens i
      LEFT JOIN users u ON i.created_by = u.id
      ORDER BY i.created_at DESC
      LIMIT 50
    `);
    res.json(invites);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;
