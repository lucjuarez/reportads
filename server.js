import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
// Aumentamos el límite para procesar los desgloses de audiencia sin errores
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// BENCHMARKS ARS ACTUALIZADOS (Tu configuración original)
const BENCHMARK_ARS = {
  message: { acceptable: 1000, high: 2000 },
  lead: { acceptable: 3000, high: 6000 },
  purchase: { acceptable: 15000, high: 30000 },
  cart: { acceptable: 1000, high: 2000 },
  profile_visit: { acceptable: 1000, high: 2000 },
  lpv: { acceptable: 1000, high: 2000 }
};

let exchangeCache = { rate: 1, currency: "ARS", timestamp: 0 };
const n = (v) => Number(v) || 0;

async function obtenerTipoCambio(currency) {
  if (currency === "ARS") return 1;
  const now = Date.now();
  if (exchangeCache.currency === currency && now - exchangeCache.timestamp < 1000 * 60 * 60) return exchangeCache.rate;
  try {
    const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${currency}`);
    const data = await res.json();
    const rate = data?.rates?.ARS || 1;
    exchangeCache = { rate, currency, timestamp: now };
    return rate;
  } catch (e) { return 1; }
}

function detectarObjetivo(c) {
  const objective = (c.objective || "").toUpperCase();
  const optGoal = (c.optimization_goal || "").toUpperCase();
  const convLocation = (c.conversion_location || "").toUpperCase();
  const campName = (c.name || "").toUpperCase(); 
  if (convLocation.includes("MESSAGE") || convLocation.includes("WHATSAPP") || objective.includes("MESSAGE") || campName.includes("WSP")) return "message";
  if (objective.includes("LEAD") || campName.includes("LEAD")) return "lead";
  if (objective.includes("PURCHASE") || campName.includes("COMPRA")) return "purchase";
  return "message";
}

function calcularScoreIndividual(c, rate) {
  let s = 6.5; 
  const obj = detectarObjetivo(c);
  const costoARS = n(c.cpr_meta) * rate;
  const ref = BENCHMARK_ARS[obj];

  if (costoARS > 0 && ref) {
    if (costoARS <= ref.acceptable) s += 1.5;
    else if (costoARS > ref.high) s -= 0.8;
    else s -= 0.3;
  }
  if (n(c.spend) > 500 * rate && n(c.resultados_obj) === 0) s -= 2.0;
  if (n(c.freq) > 3.5) s -= 0.5;
  if (obj === "purchase" && n(c.roas_meta) >= 2) s += 1.0;

  return Number(Math.min(10, Math.max(1, s)).toFixed(1));
}

function obtenerEtiqueta(score) {
  if (score >= 8.5) return "EXCELENTE";
  if (score >= 7.0) return "SÓLIDO";
  if (score >= 5.5) return "ESTABLE";
  if (score >= 4.0) return "A OPTIMIZAR";
  return "REVISIÓN";
}

async function analizarConIA(data, currency) {
  const rate = await obtenerTipoCambio(currency);
  
  const campañasProcesadas = (data.campañas_detalle || []).map(c => {
    const individualScore = calcularScoreIndividual(c, rate);
    return {
      id: c.id,
      name: c.name,
      objetivo: detectarObjetivo(c),
      spend: n(c.spend),
      resultados: n(c.resultados_obj),
      cpr: n(c.cpr_meta),
      ctr: n(c.ctr_meta),
      freq: n(c.freq),
      cpc: n(c.cpc_meta),
      score_individual: individualScore,
      etiqueta_individual: obtenerEtiqueta(individualScore),
      // Mantenemos los breakdowns para que la IA los analice
      breakdowns: c.breakdowns || [] 
    };
  });

  const scoreGeneral = Number((campañasProcesadas.reduce((acc, curr) => acc + curr.score_individual, 0) / campañasProcesadas.length).toFixed(1));
  const etiquetaGeneral = obtenerEtiqueta(scoreGeneral);

  const prompt = `Actúa como Luciano Juárez, estratega senior de Paid Media. Presenta un reporte profesional y diplomático.
  
  Score General de la cuenta: ${scoreGeneral} (${etiquetaGeneral}).
  
  REGLAS DE ANÁLISIS POR CAMPAÑA:
  1. No uses frases genéricas.
  2. Justifica el score individual de cada campaña.
  3. Analiza las métricas secundarias (CTR, Frecuencia, CPC).
  4. IMPORTANTE: Analiza los datos en 'breakdowns' (Edad, Género, Ubicación) para dar recomendaciones de segmentación.
  5. PROHIBIDO mencionar ROAS en campañas de mensajes o leads.

  Formato de salida JSON estricto:
  {
    "diagnostico_general": "Análisis profundo...",
    "urgencia": "${etiquetaGeneral}",
    "analisis_campañas": [
      {
        "id": "ID_DE_CAMPAÑA",
        "feedback_ia": "Análisis de 2-3 párrafos incluyendo insights de audiencia (edad/género/ubicación)...",
        "status_ia": "success | warning | danger"
      }
    ],
    "analisis_publico_por_campaña": [
      {
        "id": "ID_DE_CAMPAÑA",
        "mejor_segmento_edad": "rango",
        "mejor_genero": "genero",
        "top_3_paises": [],
        "top_3_ciudades_por_pais": {}
      }
    ]
  }

  DATOS: ${JSON.stringify(campañasProcesadas)}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "Eres Luciano Juárez, un analista de Meta Ads experto y diplomático." },
        { role: "user", content: prompt }
      ]
    });

    const parsed = JSON.parse(response.choices[0].message.content.replace(/```json/g, "").replace(/```/g, ""));
    return { ...parsed, score: scoreGeneral, campañas_con_score: campañasProcesadas };
  } catch (e) {
    return { score: scoreGeneral, urgencia: etiquetaGeneral, diagnostico_general: "Error en análisis.", analisis_campañas: [] };
  }
}

app.post("/analizar", async (req, res) => {
  try {
    const resIA = await analizarConIA(req.body, req.body.currency);
    res.json(resIA);
  } catch (error) {
    res.status(500).json({ error: "Error interno" });
  }
});

app.listen(process.env.PORT || 3000);
