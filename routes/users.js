const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users — solo admin
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const users = await db.all(
      `SELECT id, name, email, role, active, created_at, last_login FROM users ORDER BY created_at DESC`
    );
    res.json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// PUT /api/users/:id/role — solo admin
router.put('/:id/role', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin','reviewer','user'].includes(role)) return res.status(400).json({ error: 'Ruolo non valido' });
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Non puoi cambiare il tuo ruolo' });
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ message: 'Ruolo aggiornato' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// PUT /api/users/:id/active — solo admin (attiva/disattiva)
router.put('/:id/active', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { active } = req.body;
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Non puoi disattivare te stesso' });
    await db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, req.params.id]);
    res.json({ message: active ? 'Utente attivato' : 'Utente disattivato' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// POST /api/users — solo admin (crea utente direttamente)
router.post('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Campi mancanti' });
    if (password.length < 8) return res.status(400).json({ error: 'Password minimo 8 caratteri' });

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) return res.status(409).json({ error: 'Email già registrata' });

    const hash = bcrypt.hashSync(password, 12);
    const result = await db.run(
      `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`,
      [name.trim(), email.toLowerCase().trim(), hash, role || 'user']
    );

    const user = await db.get('SELECT id, name, email, role FROM users WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(user);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;
