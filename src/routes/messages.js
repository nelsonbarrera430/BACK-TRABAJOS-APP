const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET — mensajes de una vacante (solo los del usuario actual)
router.get('/:jobId', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.id, m.job_id, m.sender_id, m.receiver_id,
              m.content, m.is_read, m.created_at
       FROM messages m
       WHERE m.job_id = $1
         AND (m.sender_id = $2 OR m.receiver_id = $2)
       ORDER BY m.created_at ASC`,
      [req.params.jobId, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — enviar mensaje
router.post('/', auth, async (req, res) => {
  try {
    const { job_id, receiver_id, content } = req.body;

    if (!job_id || !receiver_id || !content?.trim())
      return res.status(400).json({ error: 'Faltan campos requeridos' });

    const result = await db.query(
      `INSERT INTO messages (job_id, sender_id, receiver_id, content)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [job_id, req.user.id, receiver_id, content.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — marcar mensajes recibidos como leídos
router.put('/:jobId/read', auth, async (req, res) => {
  try {
    await db.query(
      `UPDATE messages
       SET is_read = true
       WHERE job_id = $1 AND receiver_id = $2 AND is_read = false`,
      [req.params.jobId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
