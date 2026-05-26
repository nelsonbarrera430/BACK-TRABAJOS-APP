const https = require('https');

async function analizarCandidatos(candidatos, vacante) {
  if (!candidatos || candidatos.length === 0) return candidatos;

  if (!process.env.GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY no configurada');
    return candidatos;
  }

  try {
    const prompt = `Eres un experto en selección de personal. Tu tarea es puntuar del 0 al 100 a cada candidato para el puesto de: ${vacante.title}.

Para calcular el puntaje sumá estos 3 factores:

FACTOR 1 — Calificación promedio de empleadores anteriores (hasta 50 puntos):
  • Sin ninguna calificación real → 0 puntos en este factor (es un desconocido)
  • Con calificaciones reales: (promedio / 5) × 50 puntos
  • Ejemplo: 3/5 estrellas reales → (3/5)×50 = 30 pts. Eso ya supera a cualquiera sin calificación.

FACTOR 2 — Años de experiencia (hasta 30 puntos):
  • 0 años → 0 pts
  • 1 año → 10 pts
  • 2 años → 17 pts
  • 3 años → 22 pts
  • 5+ años → 30 pts
  • Interpolá para valores intermedios.

FACTOR 3 — Análisis de la descripción personal (hasta 20 puntos):
  • Sin descripción → 0 pts
  • Descripción vaga o muy corta → 5 pts
  • Descripción que menciona experiencia concreta relevante para "${vacante.title}" → 10-15 pts
  • Descripción detallada, profesional y muy relevante para el puesto → 20 pts
  • Leé el texto y evaluá su calidad y relevancia real.

Bonus: tener CV adjunto suma +5 puntos al total final (puede superar 100, recortá a 100).

CANDIDATOS A EVALUAR:
${candidatos.map((c, i) => {
  const rating  = parseFloat(c.rating) || 0;
  const reviews = c.total_reviews || 0;
  const ratingLabel = reviews > 0
    ? `Promedio ${rating.toFixed(1)}/5 estrellas con ${reviews} calificación${reviews !== 1 ? 'es' : ''} reales`
    : 'Sin calificaciones de empleadores';
  const cvLabel = c.has_cv ? 'Tiene CV adjunto' : 'Sin CV';
  const desc = (c.summary || '').trim();
  const descLabel = desc.length > 0 ? `"${desc}"` : '(sin descripción)';
  return `[${i}] ${c.full_name || 'Sin nombre'}\n    Experiencia: ${c.years_experience || 0} años\n    Calificación: ${ratingLabel}\n    CV: ${cvLabel}\n    Descripción: ${descLabel}`;
}).join('\n\n')}

Responde ÚNICAMENTE con este JSON exacto, sin texto adicional ni markdown:
{"candidatos":[{"indice":0,"score":85,"razon":"razón en español máximo 12 palabras"}]}

Calculá el score de cada candidato sumando los 3 factores. El score final refleja quién es más confiable y apto para el puesto.`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      }
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const data = await new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          console.log('GEMINI STATUS:', res.statusCode);
          if (res.statusCode !== 200) {
            console.log('GEMINI ERROR BODY:', raw.substring(0, 400));
            reject(new Error(`Gemini HTTP ${res.statusCode}`));
            return;
          }
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('Parse error: ' + raw.substring(0, 200))); }
        });
      });
      req.on('error', reject);
      req.setTimeout(20000, () => {
        req.destroy();
        reject(new Error('Gemini timeout'));
      });
      req.write(body);
      req.end();
    });

    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('GEMINI TEXTO:', texto.substring(0, 400));

    // Extraer JSON aunque Gemini agregue texto extra
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini no devolvió JSON válido');
    const resultado = JSON.parse(match[0]);

    if (!resultado.candidatos || !Array.isArray(resultado.candidatos))
      throw new Error('Estructura JSON inesperada de Gemini');

    const ordenados = resultado.candidatos
      .sort((a, b) => b.score - a.score)
      .map(r => ({
        ...candidatos[r.indice],
        ai_score: r.score,
        ai_razon: r.razon,
      }));

    console.log(`✅ Gemini analizó ${ordenados.length} candidatos`);
    return ordenados;

  } catch (err) {
    console.log('⚠️ Gemini falló, devolviendo orden original:', err.message);
    return candidatos;
  }
}

module.exports = { analizarCandidatos };
