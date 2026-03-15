const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/restaurants  — pubblico
router.get('/', (req, res) => {
  const { q, place } = req.query;
  let sql = `
    SELECT r.*,
      ROUND(AVG(rv.score), 1) as avg_score,
      COUNT(rv.id) as review_count
    FROM restaurants r
    LEFT JOIN reviews rv ON rv.restaurant_id = r.id
    WHERE r.active = 1
  `;
  const params = [];
  if (q) { sql += ` AND (r.name LIKE ? OR r.place LIKE ?)`; params.push(`%${q}%`, `%${q}%`); }
  if (place) { sql += ` AND r.place = ?`; params.push(place); }
  sql += ` GROUP BY r.id ORDER BY avg_score DESC, r.name ASC`;

  const rows = db.prepare(sql).all(...params);
  rows.forEach(r => { try { r.tags = JSON.parse(r.tags); } catch { r.tags = []; } });
  res.json(rows);
});

// GET /api/restaurants/places — lista luoghi unici (pubblico)
router.get('/places', (req, res) => {
  const places = db.prepare(`SELECT DISTINCT place FROM restaurants WHERE active = 1 ORDER BY place`).all();
  res.json(places.map(p => p.place));
});

// GET /api/restaurants/:id — pubblico
router.get('/:id', (req, res) => {
  const rest = db.prepare(`
    SELECT r.*,
      ROUND(AVG(rv.score), 1) as avg_score,
      COUNT(rv.id) as review_count,
      ROUND(AVG(rv.qualita), 1) as avg_qualita,
      ROUND(AVG(rv.velocita), 1) as avg_velocita,
      ROUND(AVG(rv.prezzo), 1) as avg_prezzo,
      SUM(rv.bonus_simpatia) as tot_simpatia,
      SUM(rv.bonus_caffe) as tot_caffe
    FROM restaurants r
    LEFT JOIN reviews rv ON rv.restaurant_id = r.id
    WHERE r.id = ? AND r.active = 1
    GROUP BY r.id
  `).get(req.params.id);
  if (!rest) return res.status(404).json({ error: 'Ristorante non trovato' });
  try { rest.tags = JSON.parse(rest.tags); } catch { rest.tags = []; }

  const reviews = db.prepare(`
    SELECT rv.*, u.name as reviewer_name
    FROM reviews rv
    JOIN users u ON rv.user_id = u.id
    WHERE rv.restaurant_id = ?
    ORDER BY rv.visit_date DESC
  `).all(req.params.id);

  res.json({ ...rest, reviews });
});

// POST /api/restaurants — reviewer o admin
router.post('/', authMiddleware, requireRole('admin', 'reviewer'), (req, res) => {
  const { name, place, address, tags } = req.body;
  if (!name || !place) return res.status(400).json({ error: 'Nome e luogo obbligatori' });

  const result = db.prepare(`
    INSERT INTO restaurants (name, place, address, tags, added_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), place.trim(), address || null, JSON.stringify(tags || ['menu fisso']), req.user.id);

  const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(result.lastInsertRowid);
  try { rest.tags = JSON.parse(rest.tags); } catch { rest.tags = []; }
  res.status(201).json(rest);
});

// PUT /api/restaurants/:id — solo admin
router.put('/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const { name, place, address, tags, active } = req.body;
  const rest = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(req.params.id);
  if (!rest) return res.status(404).json({ error: 'Non trovato' });

  db.prepare(`
    UPDATE restaurants SET name=?, place=?, address=?, tags=?, active=? WHERE id=?
  `).run(
    name || rest.name,
    place || rest.place,
    address !== undefined ? address : rest.address,
    JSON.stringify(tags || JSON.parse(rest.tags || '[]')),
    active !== undefined ? (active ? 1 : 0) : rest.active,
    req.params.id
  );
  res.json({ message: 'Aggiornato' });
});

// DELETE /api/restaurants/:id — solo admin
router.delete('/:id', authMiddleware, requireRole('admin'), (req, res) => {
  db.prepare('UPDATE restaurants SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Ristorante rimosso' });
});

module.exports = router;
