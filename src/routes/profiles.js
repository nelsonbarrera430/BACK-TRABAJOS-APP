const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET perfil del usuario logueado
router.get('/me', auth, async (req, res) => {
  try {
    if (req.user.role === 'CANDIDATO') {
      const result = await db.query(
        'SELECT * FROM candidate_profiles WHERE user_id = $1', [req.user.id]
      );
      return res.json(result.rows[0] || {});
    } else {
      const result = await db.query(
        'SELECT * FROM company_profiles WHERE user_id = $1', [req.user.id]
      );
      return res.json(result.rows[0] || {});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET trabajadores por ciudad y categoría
router.get('/workers', async (req, res) => {  
  try {    
    const { city, category, title, description } = req.query;    
    // Obtener user_id del token si existe    
    let excludeUserId = null;    
    try {      
      const header = req.headers.authorization;      
      if (header && header.startsWith('Bearer ')) {        
        const jwt = require('jsonwebtoken');        
        const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);        
        excludeUserId = decoded.id;      
      }    
    } catch (_) {}    
    const result = await db.query(      
      `SELECT cp.id, cp.full_name, cp.job_category, cp.city,              
              cp.years_experience, cp.rating, cp.total_reviews, cp.summary       
       FROM candidate_profiles cp       
       JOIN users u ON u.id = cp.user_id       
       WHERE u.role = 'CANDIDATO'         
         AND LOWER(cp.city) = LOWER($1)         
         AND LOWER(cp.job_category) = LOWER($2)         
         AND cp.open_to_work = true         
         AND ($3::uuid IS NULL OR u.id != $3::uuid)       
       ORDER BY cp.rating DESC`,      
      [city, category, excludeUserId]    
    );    
    let candidatos = result.rows;    
    if (candidatos.length > 0) {      
      const { analizarCandidatos } = require('../services/gemini');      
      candidatos = await analizarCandidatos(candidatos, {        
        title: title || `Se busca ${category}`,        
        description: description || `Se busca ${category} en ${city}`,        
        category, city,      
      });    
    }    
    res.json(candidatos);  
  } catch (err) {    
    res.status(500).json({ error: err.message });  
  }
});

// GET perfil público de un candidato
router.get('/candidate/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT cp.*, u.email,
        COALESCE(
          json_agg(r ORDER BY r.created_at DESC) FILTER (WHERE r.id IS NOT NULL),
          '[]'
        ) as reviews
       FROM candidate_profiles cp
       JOIN users u ON u.id = cp.user_id
       LEFT JOIN reviews r ON r.candidate_id = cp.id
       WHERE cp.id = $1
       GROUP BY cp.id, u.email`,
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Perfil no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST/PUT perfil candidato
router.post('/candidate', auth, async (req, res) => {
  try {
    const { full_name, availability, summary, job_category,
            city, years_experience } = req.body;

    const existe = await db.query(
      'SELECT id FROM candidate_profiles WHERE user_id = $1', [req.user.id]
    );

    let result;
    if (existe.rows.length > 0) {
      result = await db.query(
        `UPDATE candidate_profiles
         SET full_name=$1, availability=$2, summary=$3,
             job_category=$4, city=$5, years_experience=$6, updated_at=NOW()
         WHERE user_id=$7 RETURNING *`,
        [full_name, availability, summary, job_category,
         city, years_experience || 0, req.user.id]
      );
    } else {
      result = await db.query(
        `INSERT INTO candidate_profiles
         (user_id, full_name, availability, summary, job_category, city, years_experience)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.id, full_name, availability, summary,
         job_category, city, years_experience || 0]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST/PUT perfil empresa
router.post('/company', auth, async (req, res) => {
  try {
    const { name, business_type, city, description } = req.body;

    const existe = await db.query(
      'SELECT id FROM company_profiles WHERE user_id = $1', [req.user.id]
    );

    let result;
    if (existe.rows.length > 0) {
      result = await db.query(
        `UPDATE company_profiles
         SET name=$1, business_type=$2, city=$3, description=$4, updated_at=NOW()
         WHERE user_id=$5 RETURNING *`,
        [name, business_type, city, description, req.user.id]
      );
    } else {
      result = await db.query(
        `INSERT INTO company_profiles (user_id, name, business_type, city, description)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, name, business_type, city, description]
      );
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST dejar reseña a un candidato
router.post('/review/:candidateId', auth, async (req, res) => {
  try {
    const { rating, comment, job_id } = req.body;
    const { candidateId } = req.params;

    await db.query(
      `INSERT INTO reviews (candidate_id, reviewer_id, job_id, rating, comment)
       VALUES ($1,$2,$3,$4,$5)`,
      [candidateId, req.user.id, job_id, rating, comment]
    );

    const avg = await db.query(
      `SELECT AVG(rating) as avg, COUNT(*) as total
       FROM reviews WHERE candidate_id = $1`,
      [candidateId]
    );

    await db.query(
      `UPDATE candidate_profiles
       SET rating=$1, total_reviews=$2 WHERE id=$3`,
      [parseFloat(avg.rows[0].avg).toFixed(2), avg.rows[0].total, candidateId]
    );

    res.json({ message: 'Reseña guardada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
