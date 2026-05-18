const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// POST — postularse a una vacante
router.post('/:jobId', auth, async (req, res) => {
  try {
    const { jobId } = req.params;

    // Obtener perfil candidato
    const profile = await db.query(
      'SELECT id, cv_url FROM candidate_profiles WHERE user_id = $1', [req.user.id]
    );
    if (profile.rows.length === 0) {
      return res.status(400).json({ error: 'Primero completa tu perfil' });
    }

    const candidateId = profile.rows[0].id;
    const cvUrl       = profile.rows[0].cv_url;

    // Verificar si ya se postuló
    const yaPostulado = await db.query(
      'SELECT id FROM applications WHERE job_id=$1 AND candidate_id=$2',
      [jobId, candidateId]
    );
    if (yaPostulado.rows.length > 0) {
      return res.status(400).json({ error: 'Ya te postulaste a esta vacante' });
    }

    // Guardar postulación
    const result = await db.query(
      `INSERT INTO applications (job_id, candidate_id, cv_url)
       VALUES ($1, $2, $3) RETURNING *`,
      [jobId, candidateId, cvUrl]
    );

    res.status(201).json({
      message: '¡Postulación enviada exitosamente!',
      application: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — postulaciones de la empresa (panel empresa)
router.get('/company/:jobId', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, cp.full_name, cp.cv_url, u.email
       FROM applications a
       JOIN candidate_profiles cp ON a.candidate_id = cp.id
       JOIN users u ON cp.user_id = u.id
       WHERE a.job_id = $1
       ORDER BY a.created_at DESC`,
      [req.params.jobId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — mis postulaciones (candidato)
router.get('/my', auth, async (req, res) => {
  try {
    const profile = await db.query(
      'SELECT id FROM candidate_profiles WHERE user_id = $1', [req.user.id]
    );
    if (profile.rows.length === 0) return res.json([]);

    const result = await db.query(
      `SELECT a.*, j.title, j.city, j.job_type, cp.name as company_name
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       JOIN company_profiles cp ON j.company_id = cp.id
       WHERE a.candidate_id = $1
       ORDER BY a.created_at DESC`,
      [profile.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;