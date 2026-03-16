const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/restaurants  — pubblico
router.get('/', async (req, res) => {
  try {
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

    const rows = await db.all(sql, params);
    rows.forEach(r => { try { r.tags = JSON.parse(r.tags); } catch { r.tags = []; } });
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /api/restaurants/places — lista luoghi unici (pubblico)
router.get('/places', async (req, res) => {
  try {
    const places = await db.all(`SELECT DISTINCT place FROM restaurants WHERE active = 1 ORDER BY place`);
    res.json(places.map(p => p.place));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// GET /api/restaurants/:id — pubblico
router.get('/:id', async (req, res) => {
  try {
    const rest = await db.get(`
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
    `, [req.params.id]);
    if (!rest) return res.status(404).json({ error: 'Ristorante non trovato' });
    try { rest.tags = JSON.parse(rest.tags); } catch { rest.tags = []; }

    const reviews = await db.all(`
      SELECT rv.*, u.name as reviewer_name
      FROM reviews rv
      JOIN users u ON rv.user_id = u.id
      WHERE rv.restaurant_id = ?
      ORDER BY rv.visit_date DESC
    `, [req.params.id]);

    res.json({ ...rest, reviews });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// POST /api/restaurants — reviewer o admin
router.post('/', authMiddleware, requireRole('admin', 'reviewer'), async (req, res) => {
  try {
    const { name, place, address, phone, tags, lat, lng } = req.body;
    if (!name || !place) return res.status(400).json({ error: 'Nome e luogo obbligatori' });

    const result = await db.run(
      `INSERT INTO restaurants (name, place, address, phone, tags, lat, lng, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), place.trim(), address || null, phone || null, JSON.stringify(tags || ['menu fisso']), lat || null, lng || null, req.user.id]
    );

    const rest = await db.get('SELECT * FROM restaurants WHERE id = ?', [result.lastInsertRowid]);
    try { rest.tags = JSON.parse(rest.tags); } catch { rest.tags = []; }
    res.status(201).json(rest);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// PATCH /api/restaurants/:id — aggiorna indirizzo/telefono (reviewer o admin)
router.patch('/:id', authMiddleware, requireRole('admin', 'reviewer'), async (req, res) => {
  try {
    const { address, phone, lat, lng } = req.body;
    const rest = await db.get('SELECT * FROM restaurants WHERE id = ? AND active = 1', [req.params.id]);
    if (!rest) return res.status(404).json({ error: 'Non trovato' });

    await db.run(
      `UPDATE restaurants SET address=?, phone=?, lat=?, lng=? WHERE id=?`,
      [
        address !== undefined ? (address || null) : rest.address,
        phone !== undefined ? (phone || null) : rest.phone,
        lat !== undefined ? (lat || null) : rest.lat,
        lng !== undefined ? (lng || null) : rest.lng,
        req.params.id
      ]
    );
    res.json({ message: 'Aggiornato' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// PUT /api/restaurants/:id — solo admin
router.put('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const { name, place, address, phone, tags, active } = req.body;
    const rest = await db.get('SELECT * FROM restaurants WHERE id = ?', [req.params.id]);
    if (!rest) return res.status(404).json({ error: 'Non trovato' });

    await db.run(
      `UPDATE restaurants SET name=?, place=?, address=?, phone=?, tags=?, active=? WHERE id=?`,
      [
        name || rest.name,
        place || rest.place,
        address !== undefined ? address : rest.address,
        phone !== undefined ? phone : rest.phone,
        JSON.stringify(tags || JSON.parse(rest.tags || '[]')),
        active !== undefined ? (active ? 1 : 0) : rest.active,
        req.params.id
      ]
    );
    res.json({ message: 'Aggiornato' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

// DELETE /api/restaurants/:id — solo admin
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await db.run('UPDATE restaurants SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Ristorante rimosso' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;
