const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// Sistema premi recensori
const BADGES = [
  { min: 30, name: 'Platino', icon: '💎', color: '#b0c4de' },
  { min: 20, name: 'Oro',     icon: '🥇', color: '#ffd700' },
  { min: 15, name: 'Argento', icon: '🥈', color: '#c0c0c0' },
  { min: 10, name: 'Bronzo',  icon: '🥉', color: '#cd7f32' },
  { min: 5,  name: 'Rame',    icon: '🏅', color: '#b87333' },
];
function getBadge(reviewCount) {
  for (const b of BADGES) {
    if (reviewCount >= b.min) return { ...b, count: reviewCount };
  }
  return null;
}
function getNextBadge(reviewCount) {
  for (let i = BADGES.length - 1; i >= 0; i--) {
    if (reviewCount < BADGES[i].min) return { ...BADGES[i], remaining: BADGES[i].min - reviewCount };
  }
  return null;
}

// GET /api/users/me/badge — badge dell'utente corrente
router.get('/me/badge', authMiddleware, async (req, res) => {
  try {
    const result = await db.get('SELECT COUNT(*) as cnt FROM reviews WHERE user_id = ?', [req.user.id]);
    const count = result ? Number(result.cnt) : 0;
    res.json({ count, badge: getBadge(count), next: getNextBadge(count) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /api/users/leaderboard — classifica recensori con badge
router.get('/leaderboard', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT u.id, u.name, COUNT(rv.id) as review_count
      FROM users u
      JOIN reviews rv ON rv.user_id = u.id
      WHERE u.active = 1
      GROUP BY u.id
      ORDER BY review_count DESC
      LIMIT 20
    `);
    res.json(rows.map(r => ({ ...r, review_count: Number(r.review_count), badge: getBadge(Number(r.review_count)) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /api/users — solo admin
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const users = await db.all(
      `SELECT id, name, email, role, role_request, active, created_at, last_login FROM users ORDER BY created_at DESC`
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

    // Se stiamo togliendo il ruolo admin a qualcuno, verifica che resti almeno un altro admin attivo
    const target = await db.get('SELECT role FROM users WHERE id = ?', [req.params.id]);
    if (target && target.role === 'admin' && role !== 'admin') {
      const adminCount = await db.get('SELECT COUNT(*) as cnt FROM users WHERE role = ? AND active = 1', ['admin']);
      if (adminCount.cnt <= 1) return res.status(400).json({ error: 'Deve esserci almeno un amministratore attivo' });
    }

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

    // Se stiamo disattivando un admin, verifica che resti almeno un altro admin attivo
    if (!active) {
      const target = await db.get('SELECT role FROM users WHERE id = ?', [req.params.id]);
      if (target && target.role === 'admin') {
        const adminCount = await db.get('SELECT COUNT(*) as cnt FROM users WHERE role = ? AND active = 1', ['admin']);
        if (adminCount.cnt <= 1) return res.status(400).json({ error: 'Deve esserci almeno un amministratore attivo' });
      }
    }

    await db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, req.params.id]);
    res.json({ message: active ? 'Utente attivato' : 'Utente disattivato' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// POST /api/users/request-reviewer — utente chiede di diventare reviewer
router.post('/request-reviewer', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'reviewer' || req.user.role === 'admin') {
      return res.status(400).json({ error: 'Sei già reviewer o admin' });
    }
    const user = await db.get('SELECT role_request FROM users WHERE id = ?', [req.user.id]);
    if (user && user.role_request === 'pending') {
      return res.status(400).json({ error: 'Hai già una richiesta in attesa' });
    }
    await db.run('UPDATE users SET role_request = ? WHERE id = ?', ['pending', req.user.id]);
    res.json({ message: 'Richiesta inviata! L\'amministratore la esaminerà.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// PUT /api/users/:id/approve-reviewer — admin approva richiesta
router.put('/:id/approve-reviewer', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await db.run('UPDATE users SET role = ?, role_request = NULL WHERE id = ?', ['reviewer', req.params.id]);
    res.json({ message: 'Utente promosso a reviewer' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// PUT /api/users/:id/deny-reviewer — admin rifiuta richiesta
router.put('/:id/deny-reviewer', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await db.run('UPDATE users SET role_request = NULL WHERE id = ?', [req.params.id]);
    res.json({ message: 'Richiesta rifiutata' });
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
    if (!/[A-Z]/.test(password)) return res.status(400).json({ error: 'La password deve contenere almeno una maiuscola' });
    if (!/[a-z]/.test(password)) return res.status(400).json({ error: 'La password deve contenere almeno una minuscola' });
    if (!/[0-9]/.test(password)) return res.status(400).json({ error: 'La password deve contenere almeno un numero' });
    if (!/[^A-Za-z0-9]/.test(password)) return res.status(400).json({ error: 'La password deve contenere almeno un carattere speciale' });

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
