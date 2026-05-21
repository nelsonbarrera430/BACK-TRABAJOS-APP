const https = require('https');

async function analizarCandidatos(candidatos, vacante) {
  if (!candidatos || candidatos.length === 0) return candidatos;

  if (!process.env.GEMINI_API_KEY) {
    console.log('⚠️ GEMINI_API_KEY no configurada');
    return candidatos;
  }

  try {
    const prompt = `Eres experto en selección de personal. Analiza estos candidatos para el puesto: ${vacante.title}.
Categoría: ${vacante.category}

CANDIDATOS:
${candidatos.map((c, i) => `${i}. ${c.full_name || 'Sin nombre'} | ${c.years_experience || 0} años exp | rating: ${c.rating || 0}/5 | info: ${c.summary || 'ninguna'}`).join('\n')}

Responde ÚNICAMENTE con este JSON exacto, sin texto adicional ni markdown:
{"candidatos":[{"indice":0,"score":85,"razon":"razón corta en español"}]}

Donde score va de 0 a 100 según su idoneidad para ${vacante.title}.`;

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
