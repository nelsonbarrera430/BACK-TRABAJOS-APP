const https = require('https');

async function analizarCandidatos(candidatos, vacante) {
  if (!candidatos || candidatos.length === 0) return candidatos;

  try {
    const prompt = `Eres experto en selección de personal. Analiza estos candidatos para: ${vacante.title}.
Descripción: ${vacante.description}
Categoría: ${vacante.category}

CANDIDATOS:
${candidatos.map((c, i) => `${i}. ${c.full_name || 'Sin nombre'}, ${c.years_experience || 0} años exp, rating: ${c.rating || 0}, info: ${c.summary || 'ninguna'}`).join('\n')}

Responde ÚNICAMENTE con este JSON sin markdown ni texto extra:
{"candidatos":[{"indice":0,"score":85,"razon":"razón corta"},{"indice":1,"score":70,"razon":"razón corta"}]}`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 300,
      }
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const data = await new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          console.log('GEMINI STATUS:', res.statusCode);
          console.log('GEMINI RESPUESTA COMPLETA:', raw);
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('Parse error: ' + raw.substring(0, 200))); }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => reject(new Error('Timeout')));
      req.write(body);
      req.end();
    });

    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('GEMINI TEXTO:', texto.substring(0, 300));

    const limpio = texto
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const resultado = JSON.parse(limpio);

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
    console.log('⚠️ Gemini falló, orden normal:', err.message);
    return candidatos;
  }
}

module.exports = { analizarCandidatos };