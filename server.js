import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

//////////////////////////////////////////////////////////
// CONFIGURACIÓN GLOBAL
//////////////////////////////////////////////////////////

const BENCHMARK_ARS = {
  message: { acceptable: 1000, high: 2000 },
  lead: { acceptable: 15000, high: 30000 },
  purchase: { acceptable: 20000, high: 40000 },
  cart: { acceptable: 8000, high: 15000 },
  profile_visit: { acceptable: 500, high: 1200 },
  lpv: { acceptable: 500, high: 1200 }
};

let exchangeCache = {
  rate: 1,
  currency: "ARS",
  timestamp: 0
};

//////////////////////////////////////////////////////////
// UTILIDADES
//////////////////////////////////////////////////////////

const n = (v) => Number(v) || 0;

function costo(resultado, gasto) {
  if (!resultado || resultado === 0) return null;
  return gasto / resultado;
}

async function obtenerTipoCambio(currency) {
  if (currency === "ARS") return 1;

  const now = Date.now();
  if (
    exchangeCache.currency === currency &&
    now - exchangeCache.timestamp < 1000 * 60 * 60
  ) {
    return exchangeCache.rate;
  }

  try {
    const res = await fetch(
      `https://api.exchangerate.host/latest?base=${currency}&symbols=ARS`
    );
    const data = await res.json();
    const rate = data?.rates?.ARS || 1;

    exchangeCache = { rate, currency, timestamp: now };
    return rate;
  } catch (e) {
    console.log("Error tipo de cambio, usando 1");
    return 1;
  }
}

//////////////////////////////////////////////////////////
// DETECTAR OBJETIVO REAL
//////////////////////////////////////////////////////////

function detectarObjetivo(c) {
  const objective = (c.objective || "").toUpperCase();
  const optGoal = (c.optimization_goal || "").toUpperCase();
  const convLocation = (c.conversion_location || "").toUpperCase();
  const perfGoal = (c.performance_goal || "").toUpperCase();
  const convEvent = (c.conversion_event || "").toUpperCase();

  if (
    convLocation.includes("MESSAGE") ||
    convLocation.includes("WHATSAPP") ||
    convLocation.includes("INSTAGRAM") ||
    optGoal.includes("MESSAGE") ||
    optGoal.includes("CONVERSATION") ||
    objective.includes("MESSAGE")
  ) return "message";

  if (objective.includes("LEAD") || optGoal.includes("LEAD"))
    return "lead";

  if (convEvent.includes("PURCHASE") || optGoal.includes("PURCHASE"))
    return "purchase";

  if (convEvent.includes("ADD_TO_CART") || optGoal.includes("ADD_TO_CART"))
    return "cart";

  if (objective.includes("TRAFFIC") && perfGoal.includes("PROFILE"))
    return "profile_visit";

  if (objective.includes("TRAFFIC"))
    return "lpv";

  return "unknown";
}

//////////////////////////////////////////////////////////
// EVALUACIÓN COSTO
//////////////////////////////////////////////////////////

function evaluarCosto(objetivo, costoARS) {
  const ref = BENCHMARK_ARS[objetivo];
  if (!ref || costoARS === null) return "neutral";

  if (costoARS <= ref.acceptable) return "success";
  if (costoARS > ref.high) return "danger";
  return "warning";
}

//////////////////////////////////////////////////////////
// SCORE MATEMÁTICO
//////////////////////////////////////////////////////////

async function calcularScore(data, currency) {
  const rate = await obtenerTipoCambio(currency);
  let score = 5;

  for (const c of data.campañas_detalle || []) {
    const spend = n(c.spend);
    const objetivo = detectarObjetivo(c);

    let resultados = 0;

    if (objetivo === "message") resultados = n(c.msg);
    if (objetivo === "lead") resultados = n(c.leads);
    if (objetivo === "purchase") resultados = n(c.pur);
    if (objetivo === "cart") resultados = n(c.cart);
    if (objetivo === "profile_visit") resultados = n(c.clicks);
    if (objetivo === "lpv") resultados = n(c.lpv);

    const costoResultado = costo(resultados, spend);
    const costoARS = costoResultado ? costoResultado * rate : null;
    const nivel = evaluarCosto(objetivo, costoARS);

    if (nivel === "success") score += 0.8;
    if (nivel === "warning") score -= 0.5;
    if (nivel === "danger") score -= 1.2;

    if (spend > 0 && resultados === 0) score -= 1.5;

    const freq = n(c.freq);
    if (freq > 2 && freq <= 3) score -= 0.3;
    if (freq > 3 && freq <= 4.5) score -= 0.7;
    if (freq > 4.5) score -= 1.2;

    if (objetivo === "purchase" && spend > 0) {
      const roas = n(c.val) / spend;
      if (roas < 1) score -= 1;
      if (roas >= 2) score += 0.5;
    }
  }

  score = Math.min(10, Math.max(1, score));
  return Number(score.toFixed(1));
}

//////////////////////////////////////////////////////////
// ANALISIS DE PUBLICO POR CAMPAÑA
//////////////////////////////////////////////////////////

function analizarPublicoPorCampaña(data) {
  const campañas = data.campañas_detalle || [];

  return campañas.map(c => {
    const edades = {};
    const generos = {};
    const paises = {};
    const ciudadesPorPais = {};

    (c.breakdowns || []).forEach(b => {
      const resultados = n(b.resultados);

      if (b.age) edades[b.age] = (edades[b.age] || 0) + resultados;
      if (b.gender) generos[b.gender] = (generos[b.gender] || 0) + resultados;

      if (b.country) {
        paises[b.country] = (paises[b.country] || 0) + resultados;

        if (!ciudadesPorPais[b.country]) {
          ciudadesPorPais[b.country] = {};
        }

        if (b.city) {
          ciudadesPorPais[b.country][b.city] =
            (ciudadesPorPais[b.country][b.city] || 0) + resultados;
        }
      }
    });

    const topEdad =
      Object.entries(edades).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

    const topGenero =
      Object.entries(generos).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

    const topPaises = Object.entries(paises)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,3)
      .map(p=>p[0]);

    const topCiudadesPorPais = {};

    topPaises.forEach(pais => {
      const ciudades = ciudadesPorPais[pais] || {};
      topCiudadesPorPais[pais] = Object.entries(ciudades)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,3)
        .map(c=>c[0]);
    });

    return {
      id: c.id,
      mejor_segmento_edad: topEdad,
      mejor_genero: topGenero,
      top_3_paises: topPaises,
      top_3_ciudades_por_pais: topCiudadesPorPais
    };
  });
}

//////////////////////////////////////////////////////////
// MOTOR IA
//////////////////////////////////////////////////////////

async function analizarConIA(data, currency) {
  const scoreBase = await calcularScore(data, currency);
  const publicoPorCampaña = analizarPublicoPorCampaña(data);

  const campañasProcesadas = (data.campañas_detalle || []).map(c => {
    const objetivo = detectarObjetivo(c);
    let resultados = 0;

    if (objetivo === "message") resultados = n(c.msg);
    if (objetivo === "lead") resultados = n(c.leads);
    if (objetivo === "purchase") resultados = n(c.pur);
    if (objetivo === "cart") resultados = n(c.cart);
    if (objetivo === "lpv") resultados = n(c.lpv);

    const costoResultado = costo(resultados, n(c.spend));

    return {
      id: c.id,
      name: c.name,
      objetivo_detectado: objetivo,
      resultados,
      costo_por_resultado: costoResultado,
      frecuencia: n(c.freq)
    };
  });

  const prompt = `
Actúa como Luciano Juárez.

Score base: ${scoreBase}

Devuelve SOLO JSON válido con:

{
  "score": number,
  "diagnostico_general": "string",
  "urgencia": "ESCALAR | ESTABLE | OPTIMIZAR | ALERTA",
  "plan_accion": ["string"],
  "recomendacion_final": "string",
  "analisis_campañas": [
    {
      "id": "string",
      "feedback_ia": "string",
      "status_ia": "success | warning | danger"
    }
  ],
  "insight_publico": "string"
}

Datos campañas:
${JSON.stringify(campañasProcesadas, null, 2)}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "Eres experto en performance marketing." },
        { role: "user", content: prompt }
      ]
    });

    const text = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(text);

    return {
      ...parsed,
      analisis_publico_por_campaña: publicoPorCampaña
    };

  } catch (error) {
    return {
      score: scoreBase,
      diagnostico_general: "Diagnóstico automático.",
      urgencia: "ESTABLE",
      plan_accion: [],
      recomendacion_final: "",
      analisis_campañas: [],
      insight_publico: "",
      analisis_publico_por_campaña: publicoPorCampaña
    };
  }
}

//////////////////////////////////////////////////////////
// ENDPOINT
//////////////////////////////////////////////////////////

app.post("/analizar", async (req, res) => {
  try {
    const currency = req.body.currency || "ARS";
    const resultado = await analizarConIA(req.body, currency);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("🚀 ReportAds activo en puerto " + PORT)
);
