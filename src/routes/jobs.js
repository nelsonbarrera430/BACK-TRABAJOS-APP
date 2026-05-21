const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET — empleos filtrados por ciudad del perfil
router.get('/', async (req, res) => {
  try {
    const { city, job_type, search } = req.query;
    let query = `
      SELECT j.*, COALESCE(cp.name, 'Particular') as company_name
      FROM jobs j
      LEFT JOIN company_profiles cp ON j.company_id = cp.id
      WHERE j.is_active = true
        AND j.is_cancelled = false
        AND j.job_type != 'URGENTE'
    `;
    const params = [];

    if (city) {
      params.push(city);
      query += ` AND LOWER(j.city) = LOWER($${params.length})`;
    }
    if (job_type) {
      params.push(job_type);
      query += ` AND j.job_type = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND j.title ILIKE $${params.length}`;
    }
    query += ' ORDER BY j.created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — urgentes filtradas por ciudad
router.get('/urgent', async (req, res) => {
  try {
    const { city } = req.query;
    let query = `
      SELECT j.*, COALESCE(cp.name, 'Particular') as company_name
      FROM jobs j
      LEFT JOIN company_profiles cp ON j.company_id = cp.id
      WHERE j.is_active = true
        AND j.is_cancelled = false
        AND j.job_type = 'URGENTE'
    `;
    const params = [];
    if (city) {
      params.push(city);
      query += ` AND LOWER(j.city) = LOWER($${params.length})`;
    }
    query += ' ORDER BY j.created_at DESC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — mis vacantes
router.get('/mine', auth, async (req, res) => {
  try {
    const company = await db.query(
      'SELECT id FROM company_profiles WHERE user_id = $1', [req.user.id]
    );
    if (company.rows.length === 0) return res.json([]);
    const result = await db.query(
      'SELECT * FROM jobs WHERE company_id = $1 ORDER BY created_at DESC',
      [company.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — estadísticas del publicador (ANTES de /:id)
router.get('/stats', auth, async (req, res) => {
  try {
    const comp = await db.query(
      'SELECT id FROM company_profiles WHERE user_id=$1', [req.user.id]
    );
    if (comp.rows.length === 0)
      return res.json({
        total_posts: 0, active_posts: 0, total_applicants: 0,
        accepted: 0, by_type: { URGENTE: 0, EMPLEO: 0, PRACTICA: 0 },
        top_job: null,
      });

    const companyId = comp.rows[0].id;

    const [totals, apps, topJob] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int                                           as total_posts,
                COALESCE(SUM(CASE WHEN is_active    THEN 1 END),0)::int as active_posts,
                COALESCE(SUM(CASE WHEN job_type='URGENTE'  THEN 1 END),0)::int as urgente,
                COALESCE(SUM(CASE WHEN job_type='EMPLEO'   THEN 1 END),0)::int as empleo,
                COALESCE(SUM(CASE WHEN job_type='PRACTICA' THEN 1 END),0)::int as practica
         FROM jobs WHERE company_id=$1`,
        [companyId]
      ),
      db.query(
        `SELECT COUNT(a.id)::int as total,
                COALESCE(SUM(CASE WHEN a.status='ACEPTADO' THEN 1 END),0)::int as accepted
         FROM applications a
         JOIN jobs j ON a.job_id = j.id
         WHERE j.company_id=$1`,
        [companyId]
      ),
      db.query(
        `SELECT j.title, COUNT(a.id)::int as cnt
         FROM jobs j
         LEFT JOIN applications a ON a.job_id = j.id
         WHERE j.company_id=$1
         GROUP BY j.id, j.title
         ORDER BY cnt DESC LIMIT 1`,
        [companyId]
      ),
    ]);

    const t = totals.rows[0];
    const a = apps.rows[0];
    res.json({
      total_posts:      t.total_posts,
      active_posts:     t.active_posts,
      total_applicants: a.total,
      accepted:         a.accepted,
      by_type: {
        URGENTE:  t.urgente,
        EMPLEO:   t.empleo,
        PRACTICA: t.practica,
      },
      top_job: topJob.rows[0]?.title ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — detalle vacante
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT j.*, COALESCE(cp.name, 'Particular') as company_name
       FROM jobs j
       LEFT JOIN company_profiles cp ON j.company_id = cp.id
       WHERE j.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Vacante no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — crear vacante
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, job_type, category,
            city, requires_cv, min_experience } = req.body;

    let comp = await db.query(
      'SELECT id FROM company_profiles WHERE user_id = $1', [req.user.id]
    );
    if (comp.rows.length === 0) {
      const u = await db.query('SELECT email FROM users WHERE id=$1', [req.user.id]);
      const nombre = u.rows[0]?.email?.split('@')[0] || 'Usuario';
      comp = await db.query(
        `INSERT INTO company_profiles (user_id, name, business_type, city)
         VALUES ($1,$2,'Particular',$3) RETURNING *`,
        [req.user.id, nombre, city || 'Pasto']
      );
    }

    const result = await db.query(
      `INSERT INTO jobs
       (company_id, title, description, job_type, category, city, requires_cv, min_experience)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [comp.rows[0].id, title, description, job_type, category,
       city, requires_cv || false, min_experience || 0]
    );

    const { notificarCandidatos } = require('../services/fcm');
    await notificarCandidatos(category, city, result.rows[0]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — cancelar urgente
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    await db.query(
      'UPDATE jobs SET is_cancelled=true, cancelled_at=NOW(), is_active=false WHERE id=$1',
      [req.params.id]
    );
    res.json({ message: 'Búsqueda cancelada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT — editar vacante
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, description, job_type, category, city } = req.body;
    const result = await db.query(
      `UPDATE jobs SET title=$1, description=$2, job_type=$3,
       category=$4, city=$5 WHERE id=$6 RETURNING *`,
      [title, description, job_type, category, city, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — eliminar
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM jobs WHERE id=$1', [req.params.id]);
    res.json({ message: 'Vacante eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
