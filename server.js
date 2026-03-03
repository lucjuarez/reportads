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

// BENCHMARKS ARS FIJOS BASADOS EN TU EXPERIENCIA
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

// SCORE PONDERADO Y EXIGENTE (50% Rentabilidad, 20% CVR, 20% CTR, 10% Freq)
function calcularScoreIndividual(c, rate) {
  if (n(c.spend) === 0) return 0; 

  const obj = detectarObjetivo(c);
  const costoARS = n(c.cpr_meta) * rate;
  const ref = BENCHMARK_ARS[obj];

  let scoreRentabilidad = 5; 
  if (n(c.spend) > 500 * rate && n(c.resultados_obj) === 0) {
    scoreRentabilidad = 1; 
  } else if (costoARS > 0 && ref) {
    if (costoARS <= ref.acceptable) scoreRentabilidad = 10;
    else if (costoARS <= ref.high) scoreRentabilidad = 10 - (((costoARS - ref.acceptable) / (ref.high - ref.acceptable)) * 5);
    else scoreRentabilidad = Math.max(1, 5 - (((costoARS - ref.high) / ref.high) * 5));
  }
  if (obj === "purchase" && n(c.roas_meta) >= 3) scoreRentabilidad = Math.min(10, scoreRentabilidad + 2);

  let scoreTrafico = 5;
  const clics = n(c.clicks);
  const resultados = n(c.resultados_obj);
  if (clics > 0) {
    const cvr = (resultados / clics) * 100; 
    if (cvr >= 10) scoreTrafico = 10;
    else if (cvr >= 5) scoreTrafico = 8;
    else if (cvr >= 2) scoreTrafico = 5;
    else scoreTrafico = 2; 
  }

  let scoreCreativo = 5;
  const ctr = n(c.ctr_meta);
  if (ctr >= 2.0) scoreCreativo = 10;
  else if (ctr >= 1.0) scoreCreativo = 7;
  else if (ctr >= 0.5) scoreCreativo = 4;
  else scoreCreativo = 2; 

  let scoreSaturacion = 5;
  const freq = n(c.freq);
  if (freq <= 2.0) scoreSaturacion = 10;
  else if (freq <= 3.0) scoreSaturacion = 8;
  else if (freq <= 4.0) scoreSaturacion = 5;
  else scoreSaturacion = 2; 

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

// NUEVA FUNCIÓN OPTIMIZADA (Extraída del clon)
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
        if (!ciudadesPorPais[b.country]) ciudadesPorPais[b.country] = {};
        if (b.city) ciudadesPorPais[b.country][b.city] = (ciudadesPorPais[b.country][b.city] || 0) + resultados;
      }
    });

    return {
      id: c.id,
      mejor_segmento_edad: Object.entries(edades).sort((a,b)=>b[1]-a[1])[0]?.[0] || null,
      mejor_genero: Object.entries(generos).sort((a,b)=>b[1]-a[1])[0]?.[0] || null,
      top_3_paises: Object.entries(paises).sort((a,b)=>b[1]-a[1]).slice(0,3).map(p=>p[0]),
      top_3_ciudades_por_pais: Object.keys(ciudadesPorPais).reduce((acc, pais) => {
        acc[pais] = Object.entries(ciudadesPorPais[pais]).sort((a,b)=>b[1]-a[1]).slice(0,3).map(c=>c[0]);
        return acc;
      }, {})
    };
  });
}

async function analizarConIA(data, currency) {
  const rate = await obtenerTipoCambio(currency);
  
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

  // Procesamos la audiencia matemáticamente en el servidor, sin gastar IA
  const publicoProcesado = analizarPublicoPorCampaña(data);

  // Le pasamos la audiencia ya digerida al prompt para que solo la interprete
  const prompt = `Actúa como Luciano Juárez, estratega senior de Paid Media. Reporte profesional.
  
  Score General de la cuenta: ${scoreGeneral} (${etiquetaGeneral}).
  
  REGLAS DE ANÁLISIS:
  1. Justifica cada score individual basado en los 4 pilares: Rentabilidad (CPR), Calidad de Clics (Conversión), Creativos (CTR) y Saturación (Frecuencia).
  2. Revisa el objeto "AUDIENCIAS_PRECALCULADAS" para dar consejos de segmentación en el feedback de cada campaña.
  3. Sugiere optimizaciones concretas sin ser alarmista.
  4. PROHIBIDO mencionar ROAS en campañas de mensajes o leads.

  Formato de salida JSON estricto (NO incluyas el análisis de público aquí, solo devuelve lo siguiente):
  {
    "diagnostico_general": "Resumen estratégico de la cuenta...",
    "urgencia": "${etiquetaGeneral}",
    "analisis_campañas": [
      {
        "id": "ID",
        "feedback_ia": "Análisis táctico profundo justificando nota e integrando los insights de su público ganador...",
        "status_ia": "success | warning | danger"
      }
    ]
  }

  DATOS MÉTRICAS: ${JSON.stringify(campañasProcesadas)}
  AUDIENCIAS_PRECALCULADAS: ${JSON.stringify(publicoProcesado)}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [{ role: "system", content: "Eres Luciano Juárez, analista experto en Meta Ads." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    
    // Inyectamos el público calculado localmente en la respuesta que va al Frontend
    return { 
      ...parsed, 
      score: scoreGeneral, 
      campañas_con_score: campañasProcesadas,
      analisis_publico_por_campaña: publicoProcesado 
    };
  } catch (e) {
    return { score: scoreGeneral, urgencia: etiquetaGeneral, diagnostico_general: "Error en el análisis de IA.", analisis_campañas: [], analisis_publico_por_campaña: publicoProcesado };
  }
}

app.post("/analizar", async (req, res) => {
  const resIA = await analizarConIA(req.body, req.body.currency);
  res.json(resIA);
});

app.listen(process.env.PORT || 3000, () => console.log("Backend ReportAds OK"));
