import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const n = (v) => Number(v) || 0;

//////////////////////////////////////////////////////
// SCORE SIMPLE Y ENTENDIBLE
//////////////////////////////////////////////////////

function calcularScoreSimple(campañas) {
  let score = 7;

  campañas.forEach(c => {
    const spend = n(c.spend);
    const purchases = n(c.pur);
    const roas = spend > 0 ? n(c.val) / spend : 0;
    const ctr = n(c.ctr_meta);
    const freq = n(c.freq);

    if (spend > 0 && purchases === 0) score -= 2;
    if (roas < 1 && spend > 0) score -= 2;
    if (roas >= 1 && roas < 2) score -= 1;
    if (roas >= 2 && roas < 3) score += 1;
    if (roas >= 3) score += 2;

    if (ctr < 0.8) score -= 1;
    if (freq > 4) score -= 1;
  });

  score = Math.max(1, Math.min(10, score));
  return Number(score.toFixed(1));
}

//////////////////////////////////////////////////////
// MOTOR IA
//////////////////////////////////////////////////////

async function generarReporteIA(data) {

  const campañas = data.campañas_detalle || [];
  const score = calcularScoreSimple(campañas);

  const campañasProcesadas = campañas.map(c => {
    const spend = n(c.spend);
    const roas = spend > 0 ? n(c.val) / spend : 0;
    const resultados = n(c.pur) + n(c.leads) + n(c.msg);

    return {
      id: c.id,
      name: c.name,
      inversion: spend,
      resultados,
      roas,
      ctr: n(c.ctr_meta),
      frecuencia: n(c.freq)
    };
  });

  const prompt = `
Actúa como consultor de marketing.
Debes explicar resultados a un dueño de negocio que no entiende métricas técnicas.

Score general: ${score}

Devuelve SOLO JSON válido:

{
  "score": number,
  "diagnostico_general": "string claro y profesional",
  "analisis_campañas": [
    {
      "id": "string",
      "comentario": "explicación simple y estratégica"
    }
  ]
}

Datos:
${JSON.stringify(campañasProcesadas, null, 2)}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "Eres experto en marketing y comunicación para empresarios." },
        { role: "user", content: prompt }
      ]
    });

    const text = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(text);

  } catch (e) {
    return {
      score,
      diagnostico_general: "Reporte generado automáticamente.",
      analisis_campañas: []
    };
  }
}

//////////////////////////////////////////////////////
// ENDPOINT
//////////////////////////////////////////////////////

app.post("/reporte", async (req, res) => {
  try {
    const resultado = await generarReporteIA(req.body);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("🚀 REPORTADS PRO activo en puerto " + PORT)
);
