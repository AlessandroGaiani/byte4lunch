const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/reviews?restaurant_id=X — pubblico
router.get('/', (req, res) => {
  const { restaurant_id, user_id, limit } = req.query;
  let sql = `
    SELECT rv.*, u.name as reviewer_name, r.name as restaurant_name, r.place
    FROM reviews rv
    JOIN users u ON rv.user_id = u.id
    JOIN restaurants r ON rv.restaurant_id = r.id
    WHERE r.active = 1
  `;
  const params = [];
  if (restaurant_id) { sql += ` AND rv.restaurant_id = ?`; params.push(restaurant_id); }
  if (user_id) { sql += ` AND rv.user_id = ?`; params.push(user_id); }
  sql += ` ORDER BY rv.visit_date DESC`;
  if (limit) { sql += ` LIMIT ?`; params.push(parseInt(limit)); }

  res.json(db.prepare(sql).all(...params));
});

// POST /api/reviews — reviewer o admin
router.post('/', authMiddleware, requireRole('admin', 'reviewer'), (req, res) => {
  const { restaurant_id, visit_date, qualita, velocita, prezzo, bonus_simpatia, bonus_caffe, note } = req.body;

  if (!restaurant_id || !visit_date || !qualita || !velocita || !prezzo) {
    return res.status(400).json({ error: 'Campi obbligatori mancanti' });
  }
  const vals = [qualita, velocita, prezzo];
  if (vals.some(v => v < 1 || v > 5)) return res.status(400).json({ error: 'I voti devono essere tra 1 e 5' });

  const rest = db.prepare('SELECT id FROM restaurants WHERE id = ? AND active = 1').get(restaurant_id);
  if (!rest) return res.status(404).json({ error: 'Ristorante non trovato' });

  const result = db.prepare(`
    INSERT INTO reviews (restaurant_id, user_id, visit_date, qualita, velocita, prezzo, bonus_simpatia, bonus_caffe, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    restaurant_id, req.user.id, visit_date,
    qualita, velocita, prezzo,
    bonus_simpatia ? 1 : 0, bonus_caffe ? 1 : 0,
    note || null
  );

  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(review);
});

// DELETE /api/reviews/:id — admin o autore
router.delete('/:id', authMiddleware, (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!review) return res.status(404).json({ error: 'Recensione non trovata' });
  if (req.user.role !== 'admin' && review.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Non puoi eliminare questa recensione' });
  }
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ message: 'Recensione eliminata' });
});

module.exports = router;
