const db = require('../db');

async function notificarCandidatos(category, city, job) {
  try {
    // Buscar candidatos con tokens que coincidan y tengan notificaciones activas
    const result = await db.query(
      `SELECT dt.fcm_token, u.email
       FROM device_tokens dt
       JOIN users u ON u.id = dt.user_id
       JOIN candidate_profiles cp ON cp.user_id = u.id
       WHERE u.role = 'CANDIDATO'
         AND LOWER(cp.job_category) = LOWER($1)
         AND LOWER(cp.city)         = LOWER($2)
         AND cp.receive_notifications = true
         AND cp.open_to_work = true`,
      [category, city]
    );

    const tokens = result.rows.map(r => r.fcm_token).filter(Boolean);
    console.log(`🔔 Notificando a ${tokens.length} candidatos de ${category} en ${city}`);

    if (tokens.length === 0) return;

    // Enviar con Firebase Admin
    try {
      const admin = require('firebase-admin');

      // Inicializar solo una vez
      if (!admin.apps.length) {
        const serviceAccount = require('../../serviceAccountKey.json');
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }

      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: job.job_type === 'URGENTE'
            ? `🚨 Urgente: ${job.title}`
            : `💼 Nueva vacante: ${job.title}`,
          body: `En ${city} — ¡Postúlate ahora!`,
        },
        data: { job_id: job.id, job_type: job.job_type || 'EMPLEO' },
        android: {
          notification: { sound: 'default', priority: 'high' },
          priority: 'high',
        },
      });

      console.log(`✅ Notificaciones enviadas a ${tokens.length} dispositivos`);
    } catch (firebaseErr) {
      console.log('⚠️ Firebase no configurado aún:', firebaseErr.message);
    }

  } catch (err) {
    console.error('Error en notificarCandidatos:', err.message);
  }
}

module.exports = { notificarCandidatos };