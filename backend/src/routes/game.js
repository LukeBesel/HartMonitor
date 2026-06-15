const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// GET /api/game/leaderboard — top 20 all-time scores (public)
router.get('/leaderboard', (req, res) => {
  const scores = db.prepare(`
    SELECT id, player_name, company, score, created_at
    FROM game_scores
    ORDER BY score DESC, created_at ASC
    LIMIT 20
  `).all();
  res.json(scores);
});

// POST /api/game/scores — submit a score after completing a game (public)
router.post('/scores', (req, res) => {
  const { player_name, company, score } = req.body;
  if (!player_name || !player_name.trim()) {
    return res.status(400).json({ error: 'player_name is required' });
  }
  const s = Number(score);
  if (!Number.isInteger(s) || s < 0 || s > 10000) {
    return res.status(400).json({ error: 'score must be an integer between 0 and 10000' });
  }
  const id = uuidv4();
  const name = player_name.trim().slice(0, 80);
  const co   = (company || '').trim().slice(0, 80);
  db.prepare(`INSERT INTO game_scores (id, player_name, company, score) VALUES (?, ?, ?, ?)`)
    .run(id, name, co, s);

  const { c } = db.prepare(`SELECT COUNT(*) as c FROM game_scores WHERE score > ?`).get(s);
  res.status(201).json({ id, rank: c + 1 });
});

module.exports = router;
