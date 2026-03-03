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

// SCORE PONDERADO Y EXTREMADAMENTE PRECISO
function calcularScoreIndividual(c, rate) {
  if (n(c.spend) === 0) return 0; 

  const obj = detectarObjetivo(c);
  const costoARS = n(c.cpr_meta) * rate;
  const ref = BENCHMARK_ARS[obj];

  // 1. RENTABILIDAD (CPR) - 40% del peso
  let scoreRentabilidad = 5; 
  if (n(c.spend) > 500 * rate && n(c.resultados_obj) === 0) {
    scoreRentabilidad = 1; 
  } else if (costoARS > 0 && ref) {
    const minOptimo = ref.acceptable * 0.1; 
    
    if (costoARS <= minOptimo) {
      scoreRentabilidad = 10; 
    } else if (costoARS <= ref.acceptable) {
      scoreRentabilidad = 10 - (4 * ((costoARS - minOptimo) / (ref.acceptable - minOptimo)));
    } else if (costoARS <= ref.high) {
      scoreRentabilidad = 6 - (4 * ((costoARS - ref.acceptable) / (ref.high - ref.acceptable)));
    } else {
      scoreRentabilidad = 1; 
    }
  }
  if (obj === "purchase" && n(c.roas_meta) >= 3) scoreRentabilidad = Math.min(10, scoreRentabilidad + 2);

  // 2. CREATIVOS (CTR) - 20% del peso
  let scoreCreativo = 1;
  const ctr = n(c.ctr_meta);
  if (ctr < 1.0) {
    scoreCreativo = Math.max(1, ctr * 4); 
  } else if (ctr <= 2.0) {
    scoreCreativo = 5 + ((ctr - 1.0) * 2); 
  } else {
    scoreCreativo = Math.min(10, 7 + ((ctr - 2.0) * 1.5)); 
  }

  // 3. SATURACIÓN (Frecuencia) - 15% del peso (ESCALA ESTRICTA LUCIANO)
  let scoreSaturacion = 10;
  const freq = n(c.freq);
  if (freq <= 1.5) {
    scoreSaturacion = 10 - ((freq - 1.0) * 4); // 1 a 1.5 (Muy bien)
  } else if (freq < 2.0) {
    scoreSaturacion = 8 - ((freq - 1.5) * 4); // 1.5 a 1.99 (Aceptable)
  } else {
    scoreSaturacion = Math.max(1, 4 - ((freq - 2.0) * 4)); // > 2.0 (Alerta)
  }

  // 4. SUBASTA (CPC) - 10% del peso
  let scoreCPC = 5;
  const cpcARS = n(c.cpc_meta) * rate;
  const cpcIdeal = ref ? ref.acceptable * 0.05 : 50 * rate; 
  if (cpcARS > 0) {
    if (cpcARS <= cpcIdeal) scoreCPC = 10;
    else if (cpcARS <= cpcIdeal * 2) scoreCPC = 10 - (3 * ((cpcARS - cpcIdeal) / cpcIdeal)); 
    else if (cpcARS <= cpcIdeal * 4) scoreCPC = 7 - (4 * ((cpcARS - (cpcIdeal*2)) / (cpcIdeal*2))); 
    else scoreCPC = Math.max(1, 3 - ((cpcARS - (cpcIdeal*4)) / (cpcIdeal*2))); 
  }

  // 5. CALIDAD DE TRÁFICO (CVR) - 15% del peso
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

  // CÁLCULO FINAL PONDERADO
  const scoreFinal = 
    (scoreRentabilidad * 0.40) + 
    (scoreCreativo * 0.20) + 
    (scoreSaturacion * 0.15) + 
    (scoreTrafico * 0.15) +
    (scoreCPC * 0.10);

  return Number(Math.min(10, Math.max(1, scoreFinal)).toFixed(1));
}

function obtenerEtiqueta(score) {
  if (score >= 8.5) return "EXCELENTE";
  if (score >= 7.0) return "SÓLIDO";
  if (score >= 5.5) return "ESTABLE";
  if (score >= 4.0) return "A OPTIMIZAR";
  return "REVISIÓN URGENTE";
}

// FUNCIÓN OPTIMIZADA DE PÚBLICO (Ahorro de tokens)
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

// MOTOR DE INTELIGENCIA ARTIFICIAL (Prompt Blindado)
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

  const publicoProcesado = analizarPublicoPorCampaña(data);

  const prompt = `Actúa como Luciano Juárez, estratega senior de Paid Media. Reporte profesional.
  
  Score General de la cuenta: ${scoreGeneral} (${etiquetaGeneral}).
  
  REGLAS DE ANÁLISIS:
  1. No uses frases genéricas.
  2. Justifica cada score individual considerando: Rentabilidad, CTR, Frecuencia, Conversión y CPC.
  3. REGLA ESTRICTA DE FRECUENCIA: 
     - De 1.0 a 1.5 es "Normal / Ideal".
     - De 1.51 a 1.99 es "Aceptable".
     - De 2.0 en adelante es "ALERTA / SATURACIÓN" (fatiga de anuncios). 
     NUNCA digas que una frecuencia de 2.0 o superior es "adecuada". Debes marcarla como crítica o elevada.
  4. CTR: < 1% es Alarma. 1% a 2% es Normal. > 2% es Excelente.
  5. Revisa "AUDIENCIAS_PRECALCULADAS" para dar consejos de segmentación basados en la demografía ganadora.
  6. REGLA ESTRICTA DE OBJETIVOS: Si la campaña es de "Mensajes" (message), está ESTRICTAMENTE PROHIBIDO mencionar, exigir o criticar la falta de "leads", "compras", "conversiones directas" o "ROAS". Evalúa su éxito ÚNICAMENTE en base a su capacidad de generar Mensajes a buen costo, su CTR y su Frecuencia.

  Formato de salida JSON estricto:
  {
    "diagnostico_general": "Resumen estratégico profundo del mix de campañas...",
    "urgencia": "${etiquetaGeneral}",
    "analisis_campañas": [
      {
        "id": "ID",
        "feedback_ia": "Análisis táctico profundo justificando nota. Aplica las reglas estrictas de frecuencia, CTR y congruencia de objetivos...",
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
      messages: [{ role: "system", content: "Eres Luciano Juárez, analista experto en Meta Ads. Eres estricto con la lectura de métricas y objetivos." }, { role: "user", content: prompt }],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    
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
