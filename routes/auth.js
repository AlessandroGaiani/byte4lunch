const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// Rate limit: max 5 tentativi di login ogni 15 minuti per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Troppi tentativi di accesso. Riprova tra 15 minuti.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: {xForwardedForHeader: false},
});

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e password richieste' });

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Credenziali non valide' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenziali non valide' });

  db.prepare('UPDATE users SET last_login = datetime("now") WHERE id = ?').run(user.id);

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// POST /api/auth/register (solo con invite token)
router.post('/register', (req, res) => {
  const { name, email, password, invite_token } = req.body;
  if (!name || !email || !password || !invite_token) {
    return res.status(400).json({ error: 'Tutti i campi sono obbligatori' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Password minimo 8 caratteri' });

  const invite = db.prepare(`
    SELECT * FROM invite_tokens
    WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(invite_token);

  if (!invite) return res.status(400).json({ error: 'Token invito non valido o scaduto' });
  if (invite.email && invite.email !== email.toLowerCase().trim()) {
    return res.status(400).json({ error: 'Questo invito è per un\'altra email' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email già registrata' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)
  `).run(name.trim(), email.toLowerCase().trim(), hash, invite.role);

  db.prepare('UPDATE invite_tokens SET used_at = datetime("now") WHERE id = ?').run(invite.id);

  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  res.status(201).json({ token, user });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, created_at, last_login FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Campi mancanti' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Nuova password minimo 8 caratteri' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Password attuale non corretta' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 12), req.user.id);
  res.json({ message: 'Password aggiornata' });
});

// ── ADMIN: gestione inviti ──────────────────────────────────────────

// POST /api/auth/invites  (solo admin)
router.post('/invites', authMiddleware, requireRole('admin'), (req, res) => {
  const { email, role } = req.body;
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 giorni

  db.prepare(`
    INSERT INTO invite_tokens (token, role, email, created_by, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, role || 'reviewer', email || null, req.user.id, expiresAt);

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  res.json({
    token,
    link: `${baseUrl}/?invite=${token}`,
    expires_at: expiresAt,
    role: role || 'reviewer'
  });
});

// GET /api/auth/invites (solo admin)
router.get('/invites', authMiddleware, requireRole('admin'), (req, res) => {
  const invites = db.prepare(`
    SELECT i.*, u.name as created_by_name
    FROM invite_tokens i
    LEFT JOIN users u ON i.created_by = u.id
    ORDER BY i.created_at DESC
    LIMIT 50
  `).all();
  res.json(invites);
});

module.exports = router;
