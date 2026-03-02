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
// CONFIGURACIÓN GLOBAL (más flexible que ClariAds)
//////////////////////////////////////////////////////////

const BENCHMARK_ARS = {
  message: { acceptable: 1200, high: 2500 },
  lead: { acceptable: 18000, high: 35000 },
  purchase: { acceptable: 25000, high: 50000 },
  cart: { acceptable: 10000, high: 18000 },
  profile_visit: { acceptable: 700, high: 1500 },
  lpv: { acceptable: 700, high: 1500 }
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
// DETECTAR OBJETIVO REAL (IGUAL A CLARIADS)
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

  if (convEvent.includes("ADD_TO_CART"))
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
// SCORE MATEMÁTICO (SUAVIZADO PARA DUEÑO)
//////////////////////////////////////////////////////////

async function calcularScore(data, currency) {
  const rate = await obtenerTipoCambio(currency);
  let score = 6;

  for (const c of data.campañas_detalle || []) {
    const spend = n(c.spend);
    const objetivo = detectarObjetivo(c);

    let resultados = 0;

    if (objetivo === "message") resultados = n(c.msg);
    if (objetivo === "lead") resultados = n(c.leads);
    if (objetivo === "purchase") resultados = n(c.pur);
    if (objetivo === "cart") resultados = n(c.cart);
    if (objetivo === "lpv") resultados = n(c.lpv);

    const costoResultado = costo(resultados, spend);
    const costoARS = costoResultado ? costoResultado * rate : null;
    const nivel = evaluarCosto(objetivo, costoARS);

    if (nivel === "success") score += 0.6;
    if (nivel === "warning") score -= 0.4;
    if (nivel === "danger") score -= 1;

    if (spend > 0 && resultados === 0) score -= 1;

    const freq = n(c.freq);
    if (freq > 4.5) score -= 0.7;

    if (objetivo === "purchase" && spend > 0) {
      const roas = n(c.val) / spend;
      if (roas < 1) score -= 1;
      if (roas >= 2) score += 0.6;
    }
  }

  score = Math.min(10, Math.max(1, score));
  return Number(score.toFixed(1));
}

//////////////////////////////////////////////////////////
// MÉTRICAS GLOBALES
//////////////////////////////////////////////////////////

function calcularResumenGlobal(data) {
  let totalSpend = 0;
  let totalCompras = 0;
  let totalLeads = 0;
  let totalValor = 0;

  (data.campañas_detalle || []).forEach(c => {
    totalSpend += n(c.spend);
    totalCompras += n(c.pur);
    totalLeads += n(c.leads);
    totalValor += n(c.val);
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
// MOTOR IA – ENFOQUE EJECUTIVO
//////////////////////////////////////////////////////////

async function analizarConIA(data, currency) {

  const scoreBase = await calcularScore(data, currency);
  const resumenGlobal = calcularResumenGlobal(data);

  const campañasProcesadas = (data.campañas_detalle || []).map(c => {
    const objetivo = detectarObjetivo(c);

    return {
      id: c.id,
      name: c.name,
      objetivo_detectado: objetivo,
      inversion: n(c.spend),
      compras: n(c.pur),
      leads: n(c.leads),
      roas: n(c.spend) > 0 ? n(c.val) / n(c.spend) : 0
    };
  });

  const prompt = `
Actúa como consultor senior de marketing digital.

Este reporte es para un dueño de negocio.

Datos globales:
- Inversión total: ${resumenGlobal.totalSpend}
- Compras totales: ${resumenGlobal.totalCompras}
- Leads totales: ${resumenGlobal.totalLeads}
- ROAS global: ${resumenGlobal.roasGlobal}
- Score del sistema: ${scoreBase}

Devuelve SOLO JSON válido:

{
  "score": number,
  "resumen_ejecutivo": "diagnóstico estratégico global claro",
  "analisis_campañas": [
    {
      "id": "string",
      "comentario": "explicación clara, sin tecnicismos"
    }
  ]
}

Reglas:
- Si ROAS < 1, indicar que la cuenta pierde dinero.
- Si ROAS entre 1 y 2, indicar que está en punto de equilibrio.
- Si ROAS > 2, indicar que es saludable.
- Explicar cada campaña según su objetivo detectado.
- Lenguaje simple y estratégico.

Campañas:
${JSON.stringify(campañasProcesadas, null, 2)}
`;

  try {

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
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

    return parsed;

  } catch (error) {

    return {
      score: scoreBase,
      resumen_ejecutivo: "La cuenta fue procesada correctamente.",
      analisis_campañas: campañasProcesadas.map(c => ({
        id: c.id,
        comentario: "Campaña evaluada correctamente."
      }))
    };
  }
}

//////////////////////////////////////////////////////////
// ENDPOINT REPORTADS
//////////////////////////////////////////////////////////

app.post("/reporte", async (req, res) => {
  try {
    const currency = req.body.currency || "ARS";
    const resultado = await analizarConIA(req.body, currency);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: "Error interno" });
  }
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () =>
  console.log("🚀 ReportAds Executive activo en puerto " + PORT)
);
