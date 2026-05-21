const db = require('../db');

async function notificarCandidatos(category, city, job) {
  try {
    const result = await db.query(
      `SELECT dt.fcm_token
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

    try {
      const admin = require('firebase-admin');

      if (!admin.apps.length) {
        // Leer desde variable de entorno en Render
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
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
      console.log('⚠️ Firebase error:', firebaseErr.message);
    }

  } catch (err) {
    console.error('Error en notificarCandidatos:', err.message);
  }
}

async function notificarAceptado(candidateId, jobTitle) {
  try {
    const result = await db.query(
      `SELECT dt.fcm_token
       FROM device_tokens dt
       JOIN candidate_profiles cp ON cp.user_id = dt.user_id
       WHERE cp.id = $1
       LIMIT 1`,
      [candidateId]
    );

    const token = result.rows[0]?.fcm_token;
    if (!token) {
      console.log(`⚠️ Sin token FCM para candidato ${candidateId}`);
      return;
    }

    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }

    await admin.messaging().send({
      token,
      notification: {
        title: '🎉 ¡Felicitaciones!',
        body: `Fuiste seleccionado para: ${jobTitle}`,
      },
      data: { type: 'ACEPTADO', job_title: jobTitle },
      android: {
        notification: { sound: 'default', priority: 'high' },
        priority: 'high',
      },
    });

    console.log(`✅ Notificación de aceptación enviada al candidato ${candidateId}`);
  } catch (err) {
    console.log('⚠️ Error notificando aceptado:', err.message);
  }
}

module.exports = { notificarCandidatos, notificarAceptado };
