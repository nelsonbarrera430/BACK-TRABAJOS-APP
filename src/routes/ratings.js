const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// POST — calificar (crea o actualiza)
router.post('/', auth, async (req, res) => {
  try {
    const { job_id, rated_user_id, score, comment } = req.body;

    if (!job_id || !rated_user_id || !score)
      return res.status(400).json({ error: 'Faltan campos' });
    if (score < 1 || score > 5)
      return res.status(400).json({ error: 'Score debe ser entre 1 y 5' });

    await db.query(
      `INSERT INTO ratings (job_id, rater_id, rated_user_id, score, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id, rater_id)
       DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment`,
      [job_id, req.user.id, rated_user_id, score, comment || '']
    );

    // Recalcular rating promedio en candidate_profiles
    await db.query(
      `UPDATE candidate_profiles
       SET rating       = (SELECT ROUND(AVG(r.score)::numeric, 2)
                           FROM ratings r WHERE r.rated_user_id = $1),
           total_reviews = (SELECT COUNT(*)::int
                            FROM ratings r WHERE r.rated_user_id = $1)
       WHERE user_id = $1`,
      [rated_user_id]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — verificar si ya calificó en este job
router.get('/check', auth, async (req, res) => {
  try {
    const { job_id, rated_user_id } = req.query;
    const result = await db.query(
      `SELECT score FROM ratings
       WHERE job_id=$1 AND rater_id=$2 AND rated_user_id=$3`,
      [job_id, req.user.id, rated_user_id]
    );
    res.json(result.rows[0] ?? null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
