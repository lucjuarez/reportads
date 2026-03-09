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

// Inicialización de OpenAI con la API Key del entorno
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

//////////////////////////////////////////////////////////
// 1. CONFIGURACIÓN ESTRATÉGICA Y BENCHMARKS (ARS)
//////////////////////////////////////////////////////////

/**
 * Benchmarks de Luciano Federico Juarez para el mercado argentino.
 * Estos valores permiten al motor matemático evaluar el costo de adquisición.
 */
const BENCHMARK_ARS = {
    message: { acceptable: 1000, high: 2000 },
    lead: { acceptable: 15000, high: 30000 },
    purchase: { acceptable: 20000, high: 40000 },
    cart: { acceptable: 8000, high: 15000 },
    profile_visit: { acceptable: 500, high: 1200 },
    lpv: { acceptable: 500, high: 1200 }
};

// Caché global para el tipo de cambio
let exchangeCache = {
    rate: 1,
    currency: "ARS",
    timestamp: 0
};

//////////////////////////////////////////////////////////
// 2. UTILIDADES MATEMÁTICAS Y DIVISAS (NORMALIZACIÓN)
//////////////////////////////////////////////////////////

const n = (v) => Number(v) || 0;

/**
 * Normaliza cualquier moneda a Pesos Argentinos (ARS) para auditorías comparables.
 * Cache de 1 hora para evitar latencia innecesaria.
 */
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
        console.log("⚠️ Error en API de divisas, usando 1:1");
        return 1;
    }
}

//////////////////////////////////////////////////////////
// 3. DETECCIÓN TÉCNICA DE OBJETIVOS (JERARQUÍA BLINDADA)
//////////////////////////////////////////////////////////

/**
 * Determina el objetivo real de la campaña cruzando múltiples campos técnicos.
 * Ignora etiquetas genéricas de Meta y prioriza el propósito de negocio.
 */
function detectarObjetivo(c) {
    const objective = (c.objective || "").toUpperCase();
    const optGoal = (c.optimization_goal || "").toUpperCase();
    const convLocation = (c.conversion_location || "").toUpperCase();
    const perfGoal = (c.performance_goal || "").toUpperCase();
    const convEvent = (c.conversion_event || "").toUpperCase();
    const campName = (c.name || "").toUpperCase(); 

    // A. PRIORIDAD 1: EVENTOS TÉCNICOS ESPECÍFICOS (Píxel/API)
    if (convEvent === "PURCHASE" || convEvent === "COMPRA") return "purchase";
    if (convEvent === "LEAD" || convEvent === "CONTACTO") return "lead";
    if (convEvent === "VIEW_CONTENT" || convEvent === "CONTENT_VIEW") return "lpv";
    if (convEvent === "ADD_TO_CART") return "cart";

    // B. PRIORIDAD 2: METAS DE RENDIMIENTO (Performance Goals)
    if (perfGoal.includes("INSTAGRAM_PROFILE_VISIT") || perfGoal.includes("PROFILE_VISIT")) return "profile_visit";
    if (perfGoal.includes("LANDING_PAGE_VIEWS")) return "lpv";

    // C. PRIORIDAD 3: UBICACIÓN Y APP DE MENSAJERÍA (Directo)
    if (
        convLocation.includes("WHATSAPP") || 
        convLocation.includes("MESSAGING_APP") || 
        convLocation.includes("INSTAGRAM_DIRECT") ||
        optGoal.includes("CONVERSATIONS")
    ) return "message";

    // D. PLAN B: LÓGICA POR NOMBRE DE CAMPAÑA (Último recurso)
    if (campName.includes("MENSAJE") || campName.includes("WSP") || campName.includes("WHA")) return "message";
    if (campName.includes("LEAD") || campName.includes("POTENCIAL")) return "lead";
    if (campName.includes("COMPRA") || campName.includes("PURCHASE") || campName.includes("VENTA")) return "purchase";
    if (campName.includes("PERFIL") || campName.includes("IG PROFILE")) return "profile_visit";
    if (campName.includes("LPV") || campName.includes("WEB") || campName.includes("CONTENT")) return "lpv";

    // E. FALLBACK POR OBJETIVO GENERAL
    if (objective.includes("MESSAGES") || objective.includes("ENGAGEMENT")) return "message";
    if (objective.includes("LEADS")) return "lead";
    if (objective.includes("CONVERSIONS")) return "purchase";
    if (objective.includes("TRAFFIC")) return "lpv";

    return "unknown";
}

function evaluarCalidadCosto(objetivo, costoARS) {
    const ref = BENCHMARK_ARS[objetivo];
    if (!ref || costoARS === null) return "neutral";
    if (costoARS <= ref.acceptable) return "success";
    if (costoARS > ref.high) return "danger";
    return "warning";
}

//////////////////////////////////////////////////////////
// 4. ANÁLISIS DE PÚBLICOS (DETERMINACIÓN DE GANADORES)
//////////////////////////////////////////////////////////

/**
 * Procesa breakdowns para extraer insights demográficos reales.
 */
function analizarPublicoPorCampaña(data) {
    const campañas = data.campañas_detalle || [];
    return campañas.map(c => {
        const edades = {}, generos = {}, paises = {}, ciudadesPorPais = {};
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

        const topPaises = Object.entries(paises).sort((a,b)=>b[1]-a[1]).slice(0,3).map(p=>p[0]);
        const topCiudadesPorPais = {};
        topPaises.forEach(pais => {
            topCiudadesPorPais[pais] = Object.entries(ciudadesPorPais[pais] || {}).sort((a,b)=>b[1]-a[1]).slice(0,3).map(ci=>ci[0]);
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
// 5. MOTOR DE SCORE MATEMÁTICO (EFICIENCIA DE CAPITAL)
//////////////////////////////////////////////////////////

async function calcularScoreMatematico(data, currency) {
    const rate = await obtenerTipoCambio(currency);
    let score = 5.5; 

    for (const c of data.campañas_detalle || []) {
        const spend = n(c.spend);
        const objetivo = detectarObjetivo(c);
        let resultados = 0;

        // Selección de métrica según el objetivo técnico real detectado
        if (objetivo === "message") resultados = n(c.msg);
        else if (objetivo === "lead") resultados = n(c.leads);
        else if (objetivo === "purchase") resultados = n(c.pur);
        else if (objetivo === "lpv") resultados = n(c.lpv) || n(c.view_content) || n(c.clicks);
        else if (objetivo === "profile_visit") resultados = n(c.clicks);
        else resultados = n(c.clicks);

        const costoARS = resultados > 0 ? (spend / resultados) * rate : null;
        const nivel = evaluarCalidadCosto(objetivo, costoARS);

        // Ajustes de Score
        if (nivel === "success") score += 0.8;
        if (nivel === "warning") score -= 0.4;
        if (nivel === "danger") score -= 1.2;
        if (spend > 0 && resultados === 0) score -= 1.8;

        // Frecuencia (Saturación)
        const freq = n(c.freq);
        if (freq > 2.0 && freq <= 2.5) score -= 0.5; 
        if (freq > 2.5 && freq <= 3.0) score -= 1.2; 
        if (freq > 3.0) score -= 2.0; 

        // Bonificación por ROAS en e-commerce
        if (objetivo === "purchase" && spend > 0) {
            const roas = n(c.val) / spend;
            if (roas >= 2.5) score += 1.0;
            if (roas < 1.0) score -= 1.5;
        }
    }
    return Number(Math.min(10, Math.max(0, score)).toFixed(1));
}

//////////////////////////////////////////////////////////
// 6. MOTOR IA: ESTRATEGIA Y ARQUITECTURA (CONSULTORÍA)
//////////////////////////////////////////////////////////

async function analizarConIA(data, currency) {
    const scoreBase = await calcularScoreMatematico(data, currency);
    const publicoData = analizarPublicoPorCampaña(data);

    // Filtrado de datos para evitar que la IA mezcle objetivos
    const campañasFiltradas = (data.campañas_detalle || []).map(c => {
        const obj = detectarObjetivo(c);
        let resultado_principal = 0;
        
        if (obj === "message") resultado_principal = n(c.msg);
        else if (obj === "lead") resultado_principal = n(c.leads);
        else if (obj === "purchase") resultado_principal = n(c.pur);
        else if (obj === "lpv") resultado_principal = n(c.lpv) || n(c.view_content) || n(c.clicks);
        else if (obj === "profile_visit") resultado_principal = n(c.clicks);

        return {
            id: c.id,
            name: c.name,
            objetivo_detectado: obj,
            inversion: n(c.spend),
            frecuencia: n(c.freq),
            ctr: n(c.ctr_meta),
            resultado_principal: resultado_principal,
            status: c.effective_status
        };
    });

    const prompt = `
Actúa como Luciano Federico Juarez, Director de Estrategia Senior. 
Tu misión es EXPLICAR la lógica estratégica y el propósito de la cuenta al dueño del negocio.

PUNTAJE GLOBAL: ${scoreBase}

ESCALA DE SCORE (MANDATORIA):
- 0.0-1.0: ALERTA MÁXIMA | 1.1-2.0: CUIDADO | 2.1-3.0: CRÍTICO | 3.1-4.0: NECESITA MEJORAR
- 4.1-5.0: OPTIMIZAR | 5.1-6.0: MEJORAR RENDIMIENTO | 6.1-7.0: ESTABLE
- 7.1-8.0: VAS POR BUEN CAMINO | 8.1-9.0: ARRIBA DEL PROMEDIO | 9.1-10.0: CASI PERFECTO

REGLAS ESTRATÉGICAS INNEGOCIABLES:
1. FOCO EN EL PROPÓSITO: Si es 'message', explica que buscamos CONSEGUIR MENSAJES directos para ventas. Ignora si Meta dice 'interacción'.
2. SIN MEZCLAS: Si es mensajes, NO menciones compras ni leads. Céntrate en su 'resultado_principal'.
3. LPV / VIEW CONTENT: Si es 'lpv', explica que se busca tráfico de calidad para alimentar el ecosistema y el píxel.
4. PERFIL INSTAGRAM: Si es 'profile_visit', explica que el fin es ganar autoridad y posicionamiento de marca.
5. NO OPTIMIZACIÓN: Solo explica QUÉ se está haciendo y PARA QUÉ (estrategia y propósito).

REGLAS DE FRECUENCIA:
- 1.0 a 2.0: "Aceptable" (Ideal).
- 2.0 a 2.5: "Mostrando síntomas de ir al camino de la saturación".
- 2.5 a 3.0: "ALERTA". (Frecuencias como 2.75 son alerta roja).
- > 3.0: "Alta saturación".

Devuelve JSON:
{
  "score": ${scoreBase},
  "urgencia": "string (de la escala de 10 niveles arriba)",
  "diagnostico_general": "Narrativa profunda sobre la arquitectura estratégica global de la cuenta y salud de la inversión.",
  "analisis_campañas": [
    { 
      "id": "string", 
      "feedback_ia": "Explica el propósito estratégico de esta campaña y su logro respecto a su fin real. Sin mezclar métricas de otros objetivos.", 
      "status_ia": "success/warning/danger" 
    }
  ],
  "insight_publico": "Análisis ejecutivo de la respuesta de la audiencia a la estrategia actual."
}

DATOS: ${JSON.stringify(campañasFiltradas, null, 2)}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.2, 
            messages: [
                { role: "system", content: "Eres Luciano Federico Juarez. Estratega senior. Explicas el propósito de la cuenta al cliente sin dar consejos técnicos." },
                { role: "user", content: prompt }
            ]
        });
        const aiRes = JSON.parse(response.choices[0].message.content.replace(/```json|```/g, ""));
        return { ...aiRes, analisis_publico_por_campaña: publicoData };
    } catch (error) {
        console.error("❌ Error IA:", error);
        return { score: scoreBase, urgencia: "ESTABLE", diagnostico_general: "Error al generar narrativa estratégica.", analisis_campañas: [], analisis_publico_por_campaña: publicoData };
    }
}

//////////////////////////////////////////////////////////
// 7. ENDPOINTS Y SERVIDOR
//////////////////////////////////////////////////////////

app.post("/analizar", async (req, res) => {
    try {
        const currency = req.body.currency || "ARS";
        const resultado = await analizarConIA(req.body, currency);
        res.json(resultado);
    } catch (err) {
        console.error("❌ Error Server:", err);
        res.status(500).json({ error: "Fallo en motor estratégico" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 ReportAds Master Auditor Senior activo en puerto ${PORT}`);
});
