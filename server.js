import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";

// Carga de variables de entorno
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Inicialización de OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

//////////////////////////////////////////////////////////
// 1. CONFIGURACIÓN ESTRATÉGICA Y BENCHMARKS (ARS)
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
// 2. UTILIDADES MATEMÁTICAS Y DIVISAS
//////////////////////////////////////////////////////////

const n = (v) => Number(v) || 0;

async function obtenerTipoCambio(currency) {
    if (currency === "ARS") return 1;

    const now = Date.now();
    if (exchangeCache.currency === currency && now - exchangeCache.timestamp < 3600000) {
        return exchangeCache.rate;
    }

    try {
        const res = await fetch(`https://api.exchangerate.host/latest?base=${currency}&symbols=ARS`);
        const data = await res.json();
        const rate = data?.rates?.ARS || 1;

        exchangeCache = { rate, currency, timestamp: now };
        return rate;
    } catch (e) {
        console.log("⚠️ Error en exchange rate, usando paridad 1:1");
        return 1;
    }
}

//////////////////////////////////////////////////////////
// 3. DETECCIÓN DE OBJETIVOS (ANTI-BLOQUEOS DE META)
//////////////////////////////////////////////////////////

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

    if (objective.includes("LEAD") || optGoal.includes("LEAD") || campName.includes("LEAD"))
        return "lead";

    if (convEvent.includes("PURCHASE") || optGoal.includes("PURCHASE") || campName.includes("COMPRA"))
        return "purchase";

    if (convEvent.includes("ADD_TO_CART") || optGoal.includes("ADD_TO_CART") || campName.includes("CARRITO"))
        return "cart";

    if (objective.includes("TRAFFIC") && perfGoal.includes("PROFILE"))
        return "profile_visit";

    if (objective.includes("TRAFFIC") || objective.includes("OUTCOME_TRAFFIC") || campName.includes("TRAFICO"))
        return "lpv";

    return "unknown";
}

function evaluarNivelCosto(objetivo, costoARS) {
    const ref = BENCHMARK_ARS[objetivo];
    if (!ref || costoARS === null) return "neutral";

    if (costoARS <= ref.acceptable) return "success";
    if (costoARS > ref.high) return "danger";
    return "warning";
}

//////////////////////////////////////////////////////////
// 4. ANÁLISIS DEMOGRÁFICO Y GEOGRÁFICO (BREAKDOWNS)
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
                if (!ciudadesPorPais[b.country]) ciudadesPorPais[b.country] = {};
                if (b.city) {
                    ciudadesPorPais[b.country][b.city] = (ciudadesPorPais[b.country][b.city] || 0) + resultados;
                }
            }
        });

        const topPaises = Object.entries(paises).sort((a,b)=>b[1]-a[1]).slice(0,3).map(p=>p[0]);
        const topCiudadesPorPais = {};

        topPaises.forEach(pais => {
            const ciudades = ciudadesPorPais[pais] || {};
            topCiudadesPorPais[pais] = Object.entries(ciudades).sort((a,b)=>b[1]-a[1]).slice(0,3).map(ci=>ci[0]);
        });

        return {
            id: c.id,
            mejor_segmento_edad: Object.entries(edades).sort((a,b)=>b[1]-a[1])[0]?.[0] || null,
            mejor_genero: Object.entries(generos).sort((a,b)=>b[1]-a[1])[0]?.[0] || null,
            top_3_paises: topPaises,
            top_3_ciudades_por_pais: topCiudadesPorPais
        };
    });
}

//////////////////////////////////////////////////////////
// 5. MOTOR DE SCORE MATEMÁTICO (LÓGICA SENIOR)
//////////////////////////////////////////////////////////

async function calcularScoreMatematico(data, currency) {
    const rate = await obtenerTipoCambio(currency);
    let score = 5.5; 

    for (const c of data.campañas_detalle || []) {
        const spend = n(c.spend);
        const objetivo = detectarObjetivo(c);
        let resultados = 0;

        if (objetivo === "message") resultados = n(c.msg);
        else if (objetivo === "lead") resultados = n(c.leads);
        else if (objetivo === "purchase") resultados = n(c.pur);
        else if (objetivo === "cart") resultados = n(c.cart);
        else if (objetivo === "lpv") resultados = n(c.lpv);
        else resultados = n(c.clicks);

        const costoARS = resultados > 0 ? (spend / resultados) * rate : null;
        const nivel = evaluarNivelCosto(objetivo, costoARS);

        if (nivel === "success") score += 0.8;
        if (nivel === "warning") score -= 0.4;
        if (nivel === "danger") score -= 1.2;

        if (spend > 0 && resultados === 0) score -= 1.8;

        const freq = n(c.freq);
        if (freq > 2.0 && freq <= 2.5) score -= 0.3; 
        if (freq > 2.5 && freq <= 3.0) score -= 0.8; 
        if (freq > 3.0) score -= 1.5; 

        if (objetivo === "purchase" && spend > 0) {
            const roas = n(c.val) / spend;
            if (roas >= 2.5) score += 1.0;
            if (roas < 1.0) score -= 1.5;
        }
    }

    return Number(Math.min(10, Math.max(0, score)).toFixed(1));
}

//////////////////////////////////////////////////////////
// 6. MOTOR IA: DIAGNÓSTICO ESTRATÉGICO PARA CLIENTES
//////////////////////////////////////////////////////////

async function analizarConIA(data, currency) {
    const scoreBase = await calcularScoreMatematico(data, currency);
    const publicoData = analizarPublicoPorCampaña(data);

    const campañasSimplificadas = (data.campañas_detalle || []).map(c => ({
        id: c.id,
        name: c.name,
        objetivo_detectado: detectarObjetivo(c),
        inversion: n(c.spend),
        frecuencia: n(c.freq),
        ctr: n(c.ctr_meta),
        clics: n(c.clicks),
        mensajes: n(c.msg),
        leads: n(c.leads),
        compras: n(c.pur),
        lpv: n(c.lpv),
        status: c.effective_status,
        roas: n(c.roas)
    }));

    const prompt = `
Actúa como Luciano Federico Juarez, Director de Estrategia y experto en Performance Marketing.
Tu misión es entregar un Diagnóstico Estratégico de ALTO NIVEL para el dueño del negocio.

PUNTAJE GLOBAL DE LA CUENTA: ${scoreBase}

REGLAS DE URGENCIA:
- 0.0 a 1.0: "ALERTA MÁXIMA" | 1.1 a 2.0: "CUIDADO" | 2.1 a 3.0: "CRÍTICO" | 3.1 a 4.0: "NECESITA MEJORAR" | 4.1 a 5.0: "OPTIMIZAR"
- 5.1 a 6.0: "MEJORAR RENDIMIENTO" | 6.1 a 7.0: "ESTABLE" | 7.1 a 8.0: "VAS POR BUEN CAMINO" | 8.1 a 9.0: "ARRIBA DEL PROMEDIO" | 9.1 a 10.0: "CASI PERFECTO (Sos un crack)"

INSTRUCCIONES PARA EL DIAGNÓSTICO GLOBAL:
1. ARQUITECTURA DE CUENTA: Explica el ecosistema. Cómo las campañas se ayudan entre sí (ej. "La campaña de mensajes está diseñada para captar la demanda inmediata mientras que la de tráfico alimenta el reconocimiento").
2. FOCO EN OBJETIVOS: No mezcles conceptos. Si no hay campañas de e-commerce, NO hables de ROAS. Habla de "Flujo de prospectos", "Volumen de conversaciones" y "Costo por adquisición de contacto".
3. LENGUAJE EJECUTIVO: El cliente debe entender que hay un Plan Maestro para proteger su capital y aumentar su rentabilidad.

INSTRUCCIONES PARA EL ANÁLISIS DE CADA CAMPAÑA:
1. PRIORIDAD ABSOLUTA AL OBJETIVO: Empieza cada párrafo nombrando el objetivo (ej: "Esta campaña de Mensajes está logrando..."). 
2. REGLA ANTI-ERROR: PROHIBIDO hablar de ROAS si el objetivo es 'MESSAGE', 'LEAD' o 'TRAFFIC'. El ROAS solo existe para 'PURCHASE'.
3. ANÁLISIS TÁCTICO: Usa la frecuencia (rango 1.0-2.0 es ideal, no digas que satura) y el CTR para explicar si el anuncio está gustando o si hay que cambiar la pieza creativa.

Devuelve UNICAMENTE JSON válido:
{
  "score": ${scoreBase},
  "urgencia": "string (según la escala)",
  "diagnostico_general": "Narrativa detallada sobre la arquitectura estratégica global de la cuenta enfocada en sus objetivos reales.",
  "analisis_campañas": [
    { "id": "string", "feedback_ia": "Análisis enfocado PRIMERO en el objetivo (Mensajes/Leads/etc) y luego en métricas de apoyo. Sin mencionar ROAS en campañas de mensajes.", "status_ia": "success/warning/danger" }
  ],
  "plan_accion": ["Acción estratégica 1", "Acción estratégica 2"],
  "insight_publico": "Análisis ejecutivo de la audiencia ganadora"
}

Datos de las campañas:
${JSON.stringify(campañasSimplificadas, null, 2)}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.3, 
            messages: [
                { role: "system", content: "Eres Luciano Federico Juarez. Tu diagnóstico es estratégico, nunca técnico-confuso. Priorizas el objetivo de negocio por sobre todo." },
                { role: "user", content: prompt }
            ]
        });

        const aiResponse = JSON.parse(response.choices[0].message.content.replace(/```json|```/g, ""));

        return {
            ...aiResponse,
            analisis_publico_por_campaña: publicoData
        };

    } catch (error) {
        console.error("❌ Error IA:", error);
        return {
            score: scoreBase,
            urgencia: "ESTABLE",
            diagnostico_general: "Análisis estratégico disponible basado en objetivos de conversión.",
            analisis_campañas: [],
            plan_accion: ["Revisar cumplimiento de objetivos de campaña"],
            analisis_publico_por_campaña: publicoData
        };
    }
}

//////////////////////////////////////////////////////////
// 7. ENDPOINT Y SERVIDOR
//////////////////////////////////////////////////////////

app.post("/analizar", async (req, res) => {
    try {
        const currency = req.body.currency || "ARS";
        const resultado = await analizarConIA(req.body, currency);
        res.json(resultado);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Fallo en el motor estratégico" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 ReportAds Auditor Senior activo en puerto ${PORT}`);
});
