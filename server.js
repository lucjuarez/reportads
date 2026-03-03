import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// BENCHMARKS ARS 
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

// NUEVO SISTEMA DE SCORE PONDERADO Y EXIGENTE
function calcularScoreIndividual(c, rate) {
  if (n(c.spend) === 0) return 0; // Si no gastó, no se evalúa

  const obj = detectarObjetivo(c);
  const costoARS = n(c.cpr_meta) * rate;
  const ref = BENCHMARK_ARS[obj];

  // PILAR 1: Rentabilidad (50% del peso)
  let scoreRentabilidad = 5; 
  if (n(c.spend) > 500 * rate && n(c.resultados_obj) === 0) {
    scoreRentabilidad = 1; // Gastó y no trajo nada
  } else if (costoARS > 0 && ref) {
    if (costoARS <= ref.acceptable) {
      scoreRentabilidad = 10;
    } else if (costoARS <= ref.high) {
      // Escala proporcional entre 5 y 10 si está en el rango aceptable
      const rango = ref.high - ref.acceptable;
      const excedente = costoARS - ref.acceptable;
      scoreRentabilidad = 10 - ((excedente / rango) * 5);
    } else {
      // Castigo si superó el límite alto
      scoreRentabilidad = Math.max(1, 5 - (((costoARS - ref.high) / ref.high) * 5));
    }
  }
  // Bono por ROAS alto en compras
  if (obj === "purchase" && n(c.roas_meta) >= 3) scoreRentabilidad = Math.min(10, scoreRentabilidad + 2);

  // PILAR 2: Calidad de Tráfico / Conversión (20% del peso)
  let scoreTrafico = 5;
  const clics = n(c.clicks);
  const resultados = n(c.resultados_obj);
  if (clics > 0) {
    const cvr = (resultados / clics) * 100; // Tasa de conversión real
    if (cvr >= 10) scoreTrafico = 10;
    else if (cvr >= 5) scoreTrafico = 8;
    else if (cvr >= 2) scoreTrafico = 5;
    else scoreTrafico = 2; // Mucho clic, poca conversión
  }

  // PILAR 3: Salud del Creativo / CTR (20% del peso)
  let scoreCreativo = 5;
  const ctr = n(c.ctr_meta);
  if (ctr >= 2.0) scoreCreativo = 10;
  else if (ctr >= 1.0) scoreCreativo = 7;
  else if (ctr >= 0.5) scoreCreativo = 4;
  else scoreCreativo = 2; // Anuncios que no frenan el scroll

  // PILAR 4: Entrega y Saturación / Frecuencia (10% del peso)
  let scoreSaturacion = 5;
  const freq = n(c.freq);
  if (freq <= 2.0) scoreSaturacion = 10;
  else if (freq <= 3.0) scoreSaturacion = 8;
  else if (freq <= 4.0) scoreSaturacion = 5;
  else scoreSaturacion = 2; // Audiencia quemada

  // CÁLCULO FINAL PONDERADO
  const scoreFinal = (scoreRentabilidad * 0.50) + (scoreTrafico * 0.20) + (scoreCreativo * 0.20) + (scoreSaturacion * 0.10);

  return Number(Math.min(10, Math.max(1, scoreFinal)).toFixed(1));
}

function obtenerEtiqueta(score) {
  if (score >= 8.5) return "EXCELENTE";
  if (score >= 7.0) return "SÓLIDO";
  if (score >= 5.5) return "ESTABLE";
  if (score >= 4.0) return "A OPTIMIZAR";
  return "REVISIÓN URGENTE";
}

async function analizarConIA(data, currency) {
  const rate = await obtenerTipoCambio(currency);
  
  // Filtramos las que no gastaron para no arruinar el promedio
  const campañasProcesadas = (data.campañas_detalle || []).map(c => {
    const individualScore = calcularScoreIndividual(c, rate);
    return {
      ...c,
      score_individual: individualScore,
      etiqueta_individual: individualScore > 0 ? obtenerEtiqueta(individualScore) : "SIN GASTO"
    };
  }).filter(c => c.spend > 0);

  const scoreGeneral = campañasProcesadas.length > 0 
    ? Number((campañasProcesadas.reduce((acc, curr) => acc + curr.score_individual, 0) / campañasProcesadas.length).toFixed(1))
    : 0;
  const etiquetaGeneral = obtenerEtiqueta(scoreGeneral);

  const prompt = `Actúa como Luciano Juárez, estratega senior de Paid Media. Reporte profesional.
  
  Score General de la cuenta: ${scoreGeneral} (${etiquetaGeneral}).
  
  REGLAS DE ANÁLISIS:
  1. Justifica cada score individual basado en los 4 pilares: Rentabilidad (CPR), Calidad de Clics (Conversión), Creativos (CTR) y Saturación (Frecuencia).
  2. IMPORTANTE: Analiza los datos de 'breakdowns' (Edad, Género, Región) para identificar el público ganador.
  3. Sugiere optimizaciones concretas sin ser alarmista.
  4. PROHIBIDO mencionar ROAS en campañas de mensajes o leads.

  Formato de salida JSON estricto:
  {
    "diagnostico_general": "Resumen estratégico de la cuenta...",
    "urgencia": "${etiquetaGeneral}",
    "analisis_campañas": [
      {
        "id": "ID",
        "feedback_ia": "Análisis táctico profundo justificando nota y métricas...",
        "status_ia": "success | warning | danger"
      }
    ],
    "analisis_publico_por_campaña": [
      {
        "id": "ID",
        "mejor_segmento_edad": "ej: 25-34",
        "mejor_genero": "female/male/unknown",
        "top_3_paises": ["Argentina"],
        "top_3_ciudades_por_pais": { "Argentina": ["Ciudad 1", "Ciudad 2"] }
      }
    ]
  }

  DATOS: ${JSON.stringify(campañasProcesadas)}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [{ role: "system", content: "Eres Luciano Juárez, analista experto en Meta Ads." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return { ...parsed, score: scoreGeneral, campañas_con_score: campañasProcesadas };
  } catch (e) {
    return { score: scoreGeneral, urgencia: etiquetaGeneral, diagnostico_general: "Error en el análisis de IA.", analisis_campañas: [] };
  }
}

app.post("/analizar", async (req, res) => {
  const resIA = await analizarConIA(req.body, req.body.currency);
  res.json(resIA);
});

app.listen(process.env.PORT || 3000, () => console.log("Backend ReportAds OK"));
