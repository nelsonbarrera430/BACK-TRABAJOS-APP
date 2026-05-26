const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// POST — analizar candidatos con Gemini (DEBE ir antes de /:jobId)
router.post('/analyze', auth, async (req, res) => {
  try {
    const { candidates, job_title, job_id } = req.body;
    if (!candidates || candidates.length === 0)
      return res.status(400).json({ error: 'No hay candidatos para analizar' });

    const { analizarCandidatos } = require('../services/gemini');
    const analizados = await analizarCandidatos(candidates, {
      title: job_title,
      description: `Se busca ${job_title}`,
      category: job_title,
      city: '',
    });

    // Persistir ai_score y ai_feedback en la tabla applications
    if (job_id) {
      for (const a of analizados) {
        if (a.ai_score != null) {
          await db.query(
            `UPDATE applications
             SET ai_score=$1, ai_feedback=$2
             WHERE job_id=$3 AND candidate_id=$4`,
            [a.ai_score, a.ai_razon || '', job_id, a.id]
          );
        }
      }
    }

    res.json(analizados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — postularse a una vacante
router.post('/:jobId', auth, async (req, res) => {
  try {
    const { jobId } = req.params;
    const { cv_link } = req.body; // link opcional a Drive

    const profile = await db.query(
      'SELECT id, cv_url FROM candidate_profiles WHERE user_id=$1', [req.user.id]
    );
    if (profile.rows.length === 0)
      return res.status(400).json({ error: 'Primero completa tu perfil' });

    const candidateId = profile.rows[0].id;
    const cvUrl = cv_link || profile.rows[0].cv_url;

    // Verificar si ya se postuló
    const yaPostulado = await db.query(
      'SELECT id FROM applications WHERE job_id=$1 AND candidate_id=$2',
      [jobId, candidateId]
    );
    if (yaPostulado.rows.length > 0)
      return res.status(400).json({ error: 'Ya te postulaste a esta vacante' });

    const result = await db.query(
      `INSERT INTO applications (job_id, candidate_id, cv_url)
       VALUES ($1,$2,$3) RETURNING *`,
      [jobId, candidateId, cvUrl]
    );

    res.status(201).json({
      message: '¡Postulación enviada!',
      application: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — postulantes de una vacante (para el que publicó)
router.get('/company/:jobId', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.id, a.job_id, a.candidate_id, a.cv_url, a.status,
              a.response_message, a.created_at,
              a.ai_score, a.ai_feedback, a.ai_feedback as ai_razon,
              cp.full_name, cp.years_experience, cp.rating,
              cp.total_reviews, cp.summary, cp.job_category, cp.city,
              cp.cv_url as profile_cv, u.id as user_id, u.email
       FROM applications a
       LEFT JOIN candidate_profiles cp ON a.candidate_id = cp.id
       LEFT JOIN users u ON cp.user_id = u.id
       WHERE a.job_id = $1
       ORDER BY
         CASE WHEN a.ai_score IS NOT NULL THEN a.ai_score ELSE -1 END DESC,
         a.created_at DESC`,
      [req.params.jobId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — aceptar o rechazar postulante
router.put('/:applicationId/respond', auth, async (req, res) => {
  try {
    const { status, message } = req.body;
    const { applicationId } = req.params;

    const result = await db.query(
      `UPDATE applications
       SET status=$1, response_message=$2
       WHERE id=$3 RETURNING *`,
      [status, message || '', applicationId]
    );

    const app = result.rows[0];

    if (status === 'ACEPTADO') {
      // Marcar vacante como cerrada y guardar candidato aceptado
      await db.query(
        `UPDATE jobs
         SET accepted_candidate_id=$1, is_active=false
         WHERE id=$2`,
        [app.candidate_id, app.job_id]
      );

      // Obtener título del job para la notificación
      const jobRes = await db.query(
        'SELECT title FROM jobs WHERE id=$1', [app.job_id]
      );
      const jobTitle = jobRes.rows[0]?.title || 'la vacante';

      // Enviar push al candidato aceptado (no bloqueante)
      const { notificarAceptado } = require('../services/fcm');
      notificarAceptado(app.candidate_id, jobTitle).catch(() => {});
    }

    res.json({ message: `Candidato ${status.toLowerCase()}`, application: app });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — mis postulaciones (candidato)
router.get('/my', auth, async (req, res) => {
  try {
    const profile = await db.query(
      'SELECT id FROM candidate_profiles WHERE user_id=$1', [req.user.id]
    );
    if (profile.rows.length === 0) return res.json([]);

    const result = await db.query(
      `SELECT a.*, j.title, j.city, j.job_type, j.category,
              COALESCE(cp.name, 'Particular') as company_name,
              cu.id as company_user_id
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       LEFT JOIN company_profiles cp ON j.company_id = cp.id
       LEFT JOIN users cu ON cp.user_id = cu.id
       WHERE a.candidate_id=$1
       ORDER BY a.created_at DESC`,
      [profile.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
