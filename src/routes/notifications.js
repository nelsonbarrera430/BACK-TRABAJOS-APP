const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// Guardar token FCM del dispositivo
router.post('/register-token', auth, async (req, res) => {
  try {
    const { fcm_token, platform } = req.body;

    await db.query(
      `INSERT INTO device_tokens (user_id, fcm_token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, fcm_token) DO UPDATE SET updated_at = NOW()`,
      [req.user.id, fcm_token, platform]
    );

    res.json({ message: 'Token registrado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;