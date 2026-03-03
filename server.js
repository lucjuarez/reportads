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
// CONFIGURACIÓN GLOBAL DE REFERENCIAS (BENCHMARK)
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

function detectarObjetivo(c) {
  const objective = (c.objective || "").toUpperCase();
  const optGoal = (c.optimization_goal || "").toUpperCase();
  const convLocation = (c.conversion_location || "").toUpperCase();
  const perfGoal = (c.performance_goal || "").toUpperCase();
  const convEvent = (c.conversion_event || "").toUpperCase();
  const campName = (c.name || "").toUpperCase(); 

  if (
    convLocation.includes("MESSAGE") ||
    convLocation.includes("WHATSAPP") ||
    convLocation.includes("INSTAGRAM") ||
    optGoal.includes("MESSAGE") ||
    optGoal.includes("CONVERSATION") ||
    objective.includes("MESSAGE") ||
    objective.includes("OUTCOME_ENGAGEMENT") ||
    campName.includes("MENSAJE") ||
    campName.includes("WSP") ||
    campName.includes("WHATSAPP")
  ) return "message";

  if (objective.includes("LEAD") || optGoal.includes("LEAD") || campName.includes("LEAD")) return "lead";
  if (convEvent.includes("PURCHASE") || optGoal.includes("PURCHASE") || campName.includes("COMPRA")) return "purchase";
  if (convEvent.includes("ADD_TO_CART") || optGoal.includes("ADD_TO_CART") || campName.includes("CARRITO")) return "cart";
  if (objective.includes("TRAFFIC") && perfGoal.includes("PROFILE")) return "profile_visit";
  if (objective.includes("TRAFFIC") || objective.includes("OUTCOME_TRAFFIC") || campName.includes("TRAFICO")) return "lpv";

  return "unknown";
}

function evaluarCosto(objetivo, costoARS) {
  const ref = BENCHMARK_ARS[objetivo];
  if (!ref || costoARS === null || costoARS === 0) return "neutral";

  if (costoARS <= ref.acceptable) return "success";
  if (costoARS > ref.high) return "danger";
  return "warning";
}

//////////////////////////////////////////////////////////
// SCORE MATEMÁTICO BASADO EN VALORES DE META DIRECTOS
//////////////////////////////////////////////////////////

async function calcularScore(data, currency) {
  const rate = await obtenerTipoCambio(currency);
  let score = 5;

  for (const c of data.campañas_detalle || []) {
    const spend = n(c.spend);
    const objetivo = detectarObjetivo(c);
    const resultados = n(c.resultados_obj);
    
    const costoMeta = n(c.cpr_meta);
    const costoARS = costoMeta > 0 ? costoMeta * rate : null;
    
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
      const roas = n(c.roas_meta); 
      if (roas > 0 && roas < 1) score -= 1;
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

    const topEdad = Object.entries(edades).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
    const topGenero = Object.entries(generos).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;
    const topPaises = Object.entries(paises).sort((a,b)=>b[1]-a[1]).slice(0,3).map(p=>p[0]);

    const topCiudadesPorPais = {};
    topPaises.forEach(pais => {
      const ciudades = ciudadesPorPais[pais] || {};
      topCiudadesPorPais[pais] = Object.entries(ciudades).sort((a,b)=>b[1]-a[1]).slice(0,3).map(c=>c[0]);
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
// MOTOR IA: MODO "ANALISTA ESTRATÉGICO"
//////////////////////////////////////////////////////////

async function analizarConIA(data, currency) {
  const scoreBase = await calcularScore(data, currency);
  const publicoPorCampaña = analizarPublicoPorCampaña(data);

  const campañasProcesadas = (data.campañas_detalle || []).map(c => {
    return {
      id: c.id,
      nombre_campaña: c.name,
      objetivo_detectado: detectarObjetivo(c),
      inversion_total: n(c.spend),
      resultados_principales: n(c.resultados_obj),
      costo_por_resultado_meta: n(c.cpr_meta),
      roas_meta: n(c.roas_meta),
      ctr_meta: n(c.ctr_meta),
      frecuencia: n(c.freq)
    };
  });

  const prompt = `
Actúa como Luciano Juárez, un estratega experto en Paid Media (Meta Ads).

Te entregaré los KPIs oficiales de una cuenta de Meta Ads.

REGLAS ESTRICTAS PARA TU RESPUESTA:
1. "diagnostico_general": Debes explicar de forma clara qué TIPO de campañas se están implementando en la cuenta (ej. "Veo que estamos corriendo campañas de tráfico combinadas con mensajes...") y qué es lo que se busca lograr a nivel general con esta estrategia.
2. "feedback_ia" (Por campaña): El análisis debe ir EN FUNCIÓN DEL OBJETIVO de cada campaña.
   - Si el objetivo es "message" o "lead", HABLA EXCLUSIVAMENTE del volumen y costo por mensaje/lead. PROHIBIDO mencionar "ROAS" o "compras" en estas campañas.
   - Si el objetivo es "purchase", ahí sí analiza el ROAS y CPA.
   - En el mismo párrafo, explica brevemente qué nos dicen las métricas secundarias (como el CTR, la frecuencia o el CPC) en el contexto particular de esta campaña (Ej: "El CTR de 1.5% indica que el anuncio llama la atención, aunque la frecuencia de 4 sugiere que el público ya lo vio varias veces").

Devuelve SOLO un JSON válido con esta estructura:
{
  "score": number,
  "diagnostico_general": "string",
  "urgencia": "ESCALAR | ESTABLE | OPTIMIZAR | ALERTA",
  "analisis_campañas": [
    {
      "id": "string",
      "feedback_ia": "string",
      "status_ia": "success | warning | danger"
    }
  ]
}

Score de la cuenta: ${scoreBase} / 10

KPIs Oficiales extraídos de Meta:
${JSON.stringify(campañasProcesadas, null, 2)}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: "Eres experto en análisis de performance de Meta Ads. Respetas estrictamente el JSON solicitado y analizas en función del objetivo real de cada campaña." },
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
      diagnostico_general: "Error al generar diagnóstico. Verifica las métricas en Meta.",
      urgencia: "ESTABLE",
      analisis_campañas: [],
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
