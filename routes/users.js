const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users — solo admin
router.get('/', authMiddleware, requireRole('admin'), (req, res) => {
  const users = db.prepare(`
    SELECT id, name, email, role, active, created_at, last_login FROM users ORDER BY created_at DESC
  `).all();
  res.json(users);
});

// PUT /api/users/:id/role — solo admin
router.put('/:id/role', authMiddleware, requireRole('admin'), (req, res) => {
  const { role } = req.body;
  if (!['admin','reviewer','user'].includes(role)) return res.status(400).json({ error: 'Ruolo non valido' });
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Non puoi cambiare il tuo ruolo' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'Ruolo aggiornato' });
});

// PUT /api/users/:id/active — solo admin (attiva/disattiva)
router.put('/:id/active', authMiddleware, requireRole('admin'), (req, res) => {
  const { active } = req.body;
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Non puoi disattivare te stesso' });
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json({ message: active ? 'Utente attivato' : 'Utente disattivato' });
});

// POST /api/users — solo admin (crea utente direttamente)
router.post('/', authMiddleware, requireRole('admin'), (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Campi mancanti' });
  if (password.length < 8) return res.status(400).json({ error: 'Password minimo 8 caratteri' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email già registrata' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)
  `).run(name.trim(), email.toLowerCase().trim(), hash, role || 'user');

  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(user);
});

module.exports = router;
