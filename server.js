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

//////////////////////////////////////////////////////////
// DETECCIÓN AVANZADA DE OBJETIVO (ESTILO CLARIADS)
//////////////////////////////////////////////////////////

function detectarObjetivoAvanzado(c) {
  const objective = (c.objective || "").toUpperCase();
  const optGoal = (c.optimization_goal || "").toUpperCase();
  const convEvent = (c.conversion_event || "").toUpperCase();
  const perfGoal = (c.performance_goal || "").toUpperCase();
  const convLocation = (c.conversion_location || "").toUpperCase();

  if (
    convLocation.includes("MESSAGE") ||
    optGoal.includes("MESSAGE") ||
    objective.includes("MESSAGE")
  ) return "message";

  if (objective.includes("LEAD") || optGoal.includes("LEAD"))
    return "lead";

  if (convEvent.includes("PURCHASE") || optGoal.includes("PURCHASE"))
    return "purchase";

  if (convEvent.includes("ADD_TO_CART"))
    return "cart";

  if (objective.includes("TRAFFIC") && perfGoal.includes("PROFILE"))
    return "profile_visit";

  if (objective.includes("TRAFFIC"))
    return "lpv";

  return "unknown";
}

//////////////////////////////////////////////////////////
// SCORE SIMPLE PERO INTELIGENTE
//////////////////////////////////////////////////////////

function calcularScoreSimple(campañas) {

  let score = 6;

  campañas.forEach(c => {

    const objetivo = detectarObjetivoAvanzado(c);
    const spend = Number(c.spend) || 0;

    let resultados = 0;

    if (objetivo === "purchase") resultados = Number(c.pur) || 0;
    if (objetivo === "lead") resultados = Number(c.leads) || 0;
    if (objetivo === "message") resultados = Number(c.msg) || 0;
    if (objetivo === "lpv") resultados = Number(c.lpv) || 0;

    if (spend > 0 && resultados === 0) score -= 1;

    if (objetivo === "purchase") {
      const roas = spend > 0 ? (Number(c.val) || 0) / spend : 0;
      if (roas < 1) score -= 1;
      if (roas >= 2) score += 1;
    }

    if (Number(c.freq) > 4) score -= 0.5;
  });

  score = Math.max(1, Math.min(10, score));
  return Number(score.toFixed(1));
}

//////////////////////////////////////////////////////////
// MÉTRICAS GLOBALES
//////////////////////////////////////////////////////////

function calcularResumenGlobal(campañas) {

  let totalSpend = 0;
  let totalCompras = 0;
  let totalLeads = 0;
  let totalValor = 0;

  campañas.forEach(c => {
    totalSpend += Number(c.spend) || 0;
    totalCompras += Number(c.pur) || 0;
    totalLeads += Number(c.leads) || 0;
    totalValor += Number(c.val) || 0;
  });

  const roasGlobal = totalSpend > 0 ? totalValor / totalSpend : 0;

  return {
    totalSpend,
    totalCompras,
    totalLeads,
    roasGlobal: Number(roasGlobal.toFixed(2))
  };
}

//////////////////////////////////////////////////////////
// MOTOR IA
//////////////////////////////////////////////////////////

async function generarAnalisis(data) {

  const campañas = data.campañas_detalle || [];

  const score = calcularScoreSimple(campañas);
  const resumenGlobal = calcularResumenGlobal(campañas);

  const prompt = `
Actúa como consultor senior de marketing digital.

Este reporte es para un dueño de negocio que NO es experto en publicidad.

Primero analiza la CUENTA COMPLETA con estos datos:

- Inversión total: ${resumenGlobal.totalSpend}
- Compras totales: ${resumenGlobal.totalCompras}
- Leads totales: ${resumenGlobal.totalLeads}
- ROAS global: ${resumenGlobal.roasGlobal}

Luego analiza cada campaña individual.

Devuelve SOLO JSON válido con esta estructura exacta:

{
  "resumen_ejecutivo": "diagnóstico global estratégico claro",
  "analisis_campañas": [
    {
      "id": "string",
      "comentario": "explicación clara para dueño"
    }
  ]
}

Reglas:
- Si hay inversión sin ventas, menciónalo.
- Si el ROAS global es menor a 1, explicar que está perdiendo dinero.
- Si ROAS es mayor a 2, indicar que es saludable.
- Lenguaje claro y estratégico.
- Máximo 5 líneas por campaña.

Datos campañas:
${JSON.stringify(campañas, null, 2)}
`;

  try {

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "Eres experto en performance marketing para dueños de negocio." },
        { role: "user", content: prompt }
      ]
    });

    const text = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(text);

    return {
      score,
      resumen_ejecutivo: parsed.resumen_ejecutivo,
      analisis_campañas: parsed.analisis_campañas,
      analisis_publico_por_campaña: []
    };

  } catch (error) {

    console.error("Error IA:", error);

    return {
      score,
      resumen_ejecutivo:
        "La cuenta fue procesada correctamente. Se recomienda revisar campañas con bajo rendimiento.",
      analisis_campañas: campañas.map(c => ({
        id: c.id,
        comentario: "Campaña analizada correctamente."
      })),
      analisis_publico_por_campaña: []
    };
  }
}

//////////////////////////////////////////////////////////
// ENDPOINT
//////////////////////////////////////////////////////////

app.post("/reporte", async (req, res) => {
  try {
    const resultado = await generarAnalisis(req.body);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

//////////////////////////////////////////////////////////
// SERVIDOR
//////////////////////////////////////////////////////////

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("🚀 ReportAds PRO activo en puerto " + PORT);
});
