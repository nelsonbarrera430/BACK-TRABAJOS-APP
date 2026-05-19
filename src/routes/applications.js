const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

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

    // Notificar al publicador que alguien se postuló
    const jobInfo = await db.query(
      `SELECT j.title, j.company_id, cp2.user_id, u2.email   
       FROM jobs j   
       JOIN company_profiles cp2 ON j.company_id = cp2.id   
       JOIN users u2 ON cp2.user_id = u2.id   
       WHERE j.id = $1`,
      [jobId]
    );
    if (jobInfo.rows.length > 0) {  
      const publisherUserId = jobInfo.rows[0].user_id;  
      const tokens = await db.query(    
        'SELECT fcm_token FROM device_tokens WHERE user_id = $1',    
        [publisherUserId]  
      );  
      const fcmTokens = tokens.rows.map(r => r.fcm_token).filter(Boolean);  
      if (fcmTokens.length > 0) {    
        try {      
          const admin = require('firebase-admin');      
          if (!admin.apps.length) {        
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);        
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });      
          }      
          await admin.messaging().sendEachForMulticast({        
            tokens: fcmTokens,        
            notification: {          
              title: '👤 Nuevo postulante!',          
              body: `Alguien se postuló a: ${jobInfo.rows[0].title}`,        
            },        
            data: { job_id: jobId, type: 'NEW_APPLICANT' },        
            android: { notification: { sound: 'default', priority: 'high' }, priority: 'high' },      
          });    
        } catch (firebaseErr) {      
          console.log('Firebase error:', firebaseErr.message);    
        }  
      }
    }

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
      `SELECT a.*, cp.full_name, cp.years_experience, cp.rating,
              cp.total_reviews, cp.summary, cp.job_category, cp.city,
              cp.cv_url as profile_cv, u.email
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

// PUT — aceptar o rechazar postulante (estilo Didi)
router.put('/:applicationId/respond', auth, async (req, res) => {
  try {
    const { status, message } = req.body; // ACEPTADO o RECHAZADO
    const { applicationId } = req.params;

    const result = await db.query(
      `UPDATE applications
       SET status=$1, response_message=$2
       WHERE id=$3 RETURNING *`,
      [status, message || '', applicationId]
    );

    // Si acepta — marcar la vacante con el candidato aceptado
    if (status === 'ACEPTADO') {
      const app = result.rows[0];
      await db.query(
        'UPDATE jobs SET accepted_candidate_id=$1 WHERE id=$2',
        [app.candidate_id, app.job_id]
      );
    }

    res.json({ message: `Candidato ${status.toLowerCase()}`, application: result.rows[0] });
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
              COALESCE(cp.name, 'Particular') as company_name
       FROM applications a
       JOIN jobs j ON a.job_id = j.id
       LEFT JOIN company_profiles cp ON j.company_id = cp.id
       WHERE a.candidate_id=$1
       ORDER BY a.created_at DESC`,
      [profile.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — analizar candidatos con Gemini
router.post('/analyze', auth, async (req, res) => {  
  try {    
    const { candidates, job_title } = req.body;    
    const { analizarCandidatos } = require('../services/gemini');        
    const analizados = await analizarCandidatos(candidates, {      
      title: job_title,      
      description: `Se busca ${job_title}`,      
      category: job_title,      
      city: '',    
    });    
    res.json(analizados);  
  } catch (err) {    
    res.status(500).json({ error: err.message });  
  }
});

// GET postulantes de una búsqueda urgente por job_id
router.get('/urgent/:jobId', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.id, a.status, a.created_at,
              cp.id as candidate_id, cp.full_name, cp.years_experience,
              cp.rating, cp.total_reviews, cp.summary, cp.job_category,
              cp.cv_url, u.email
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

module.exports = router;
