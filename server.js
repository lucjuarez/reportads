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
        console.log("⚠️ Error en API de divisas, usando 1:1");
        return 1;
    }
}

//////////////////////////////////////////////////////////
// 3. DETECCIÓN DE OBJETIVOS (PRIORIDAD AL NOMBRE)
//////////////////////////////////////////////////////////

function detectarObjetivo(c) {
    const objective = (c.objective || "").toUpperCase();
    const optGoal = (c.optimization_goal || "").toUpperCase();
    const convLocation = (c.conversion_location || "").toUpperCase();
    const perfGoal = (c.performance_goal || "").toUpperCase();
    const convEvent = (c.conversion_event || "").toUpperCase();
    const campName = (c.name || "").toUpperCase(); 

    // A. PRIORIDAD ABSOLUTA: LA INTENCIÓN DEL USUARIO EN EL NOMBRE
    // Evaluamos en un orden lógico para evitar choques (ej: "Trafico WSP" es Mensaje, no LPV)
    
    if (campName.includes("MENSAJE") || campName.includes("WSP") || campName.includes("WHA") || campName.includes("CHAT") || campName.includes("DM")) return "message";
    
    // Si dice IG o Perfil, es profile_visit (gana sobre la palabra "Trafico")
    if (campName.includes("IG") || campName.includes("INSTA") || campName.includes("PERFIL")) return "profile_visit";
    
    if (campName.includes("COMPRA") || campName.includes("PURCHASE") || campName.includes("VENTA")) return "purchase";
    
    if (campName.includes("LEAD") || campName.includes("POTENCIAL") || campName.includes("FORMULARIO")) return "lead";
    
    // Si dice Web, View Content o LPV
    if (campName.includes("WEB") || campName.includes("VIEW CONTENT") || campName.includes("LPV") || campName.includes("LANDING") || campName.includes("TRAFICO")) return "lpv";

    // B. PRIORIDAD 2: EVENTOS TÉCNICOS EXPLÍCITOS
    if (convEvent === "PURCHASE" || convEvent === "COMPRA") return "purchase";
    if (convEvent === "LEAD" || convEvent === "CONTACTO") return "lead";
    if (convEvent === "VIEW_CONTENT" || convEvent === "CONTENT_VIEW") return "lpv";
    if (convEvent === "ADD_TO_CART") return "cart";

    // C. PRIORIDAD 3: METAS Y UBICACIONES (MÁS AMBIGUO EN META)
    if (perfGoal.includes("INSTAGRAM_PROFILE_VISIT") || perfGoal.includes("PROFILE_VISIT")) return "profile_visit";
    if (optGoal.includes("LANDING_PAGE_VIEWS")) return "lpv";
    if (convLocation.includes("WHATSAPP") || convLocation.includes("INSTAGRAM_DIRECT")) return "message";

    // D. FALLBACK: OBJETIVOS GENERALES DE CAMPAÑA
    if (objective.includes("OUTCOME_TRAFFIC") || objective.includes("TRAFFIC")) return "lpv";
    if (objective.includes("OUTCOME_LEADS") || objective.includes("LEADS")) return "lead";
    if (objective.includes("OUTCOME_SALES") || objective.includes("CONVERSIONS")) return "purchase";
    if (objective.includes("OUTCOME_ENGAGEMENT") || objective.includes("MESSAGES")) return "message";

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
// 4. ANÁLISIS DE PÚBLICOS (EDAD, GÉNERO, GEOGRAFÍA)
//////////////////////////////////////////////////////////

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
// 5. MOTOR DE SCORE MATEMÁTICO
//////////////////////////////////////////////////////////

async function calcularScoreMatematico(data, currency) {
    const rate = await obtenerTipoCambio(currency);
    let score = 5.5; 

    for (const c of data.campañas_detalle || []) {
        const spend = n(c.spend);
        const objetivo = detectarObjetivo(c);
        let resultados = 0;

        // Extraemos el resultado real que corresponde al objetivo
        if (objetivo === "message") resultados = n(c.msg) || n(c.resultados_obj);
        else if (objetivo === "lead") resultados = n(c.leads) || n(c.resultados_obj);
        else if (objetivo === "purchase") resultados = n(c.pur) || n(c.resultados_obj);
        else if (objetivo === "lpv") resultados = n(c.view_content) || n(c.lpv) || n(c.resultados_obj) || n(c.clicks);
        else if (objetivo === "profile_visit") resultados = n(c.resultados_obj) || n(c.clicks);
        else resultados = n(c.clicks);

        const costoARS = resultados > 0 ? (spend / resultados) * rate : null;
        const nivel = evaluarCalidadCosto(objetivo, costoARS);

        if (nivel === "success") score += 0.8;
        if (nivel === "warning") score -= 0.4;
        if (nivel === "danger") score -= 1.2;
        if (spend > 0 && resultados === 0) score -= 1.8;

        const freq = n(c.freq);
        if (freq > 2.0 && freq <= 2.5) score -= 0.5; 
        if (freq > 2.5 && freq <= 3.0) score -= 1.2; 
        if (freq > 3.0) score -= 2.0; 

        if (objetivo === "purchase" && spend > 0) {
            const roas = n(c.val) / spend;
            if (roas >= 2.5) score += 1.0;
            if (roas < 1.0) score -= 1.5;
        }
    }
    return Number(Math.min(10, Math.max(0, score)).toFixed(1));
}

//////////////////////////////////////////////////////////
// 6. MOTOR IA: ESTRATEGIA Y ARQUITECTURA (BLINDADA)
//////////////////////////////////////////////////////////

async function analizarConIA(data, currency) {
    const scoreBase = await calcularScoreMatematico(data, currency);
    const publicoData = analizarPublicoPorCampaña(data);

    // Filtrado riguroso: Solo mandamos el resultado que importa
    const campañasFiltradas = (data.campañas_detalle || []).map(c => {
        const obj = detectarObjetivo(c);
        let resultado_principal = n(c.resultados_obj) || 0;
        
        if (obj === "message") resultado_principal = n(c.msg) || n(c.resultados_obj);
        else if (obj === "lead") resultado_principal = n(c.leads) || n(c.resultados_obj);
        else if (obj === "purchase") resultado_principal = n(c.pur) || n(c.resultados_obj);
        else if (obj === "lpv") resultado_principal = n(c.view_content) || n(c.lpv) || n(c.resultados_obj) || n(c.clicks);
        else if (obj === "profile_visit") resultado_principal = n(c.resultados_obj) || n(c.clicks);

        return {
            id: c.id,
            name: c.name,
            objetivo_asignado: obj,
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

DICCIONARIO DE OBJETIVOS (CÓMO DEBES EXPLICARLOS):
- Si objetivo_asignado es 'message': El propósito es captar MENSAJES y conversaciones directas para el equipo de ventas. (Prohibido decir "interacción").
- Si objetivo_asignado es 'lpv': El propósito es llevar TRÁFICO A LA WEB (View Content / Landing Page) para captar intención de compra o alimentar el ecosistema.
- Si objetivo_asignado es 'profile_visit': El propósito es llevar visitas al PERFIL DE INSTAGRAM para generar autoridad y retargeting.
- Si objetivo_asignado es 'purchase': El propósito es generar VENTAS E-COMMERCE.
- Si objetivo_asignado es 'lead': El propósito es captar CONTACTOS calificados.

REGLAS DE ORO:
1. NO MEZCLAR: Solo habla del resultado_principal asignado. No hables de leads en una campaña de web, ni de ventas en una de mensajes.
2. NO OPTIMIZAR: Prohibido dar consejos de "mejorar la creatividad" o "cambiar el público". Solo explica qué se hace y el propósito.
3. FRECUENCIA: 1.0 a 2.0 es "Aceptable/Sana". 2.1 a 2.5 es "Síntomas de saturación". Más de 2.5 es "Alerta".

Devuelve JSON:
{
  "score": ${scoreBase},
  "urgencia": "string (de la escala de 10 niveles arriba)",
  "diagnostico_general": "Narrativa sobre la arquitectura estratégica global de la cuenta y el propósito de la inversión conjunta.",
  "analisis_campañas": [
    { 
      "id": "string", 
      "feedback_ia": "Explica el propósito de esta campaña basado estrictamente en su 'objetivo_asignado' y cómo se desempeñó. Sin dar soluciones.", 
      "status_ia": "success/warning/danger" 
    }
  ],
  "insight_publico": "Análisis ejecutivo de la respuesta de la audiencia."
}

DATOS ESTRUCTURADOS DE CAMPAÑAS:
${JSON.stringify(campañasFiltradas, null, 2)}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0.1, // Temperatura reducida a 0.1 para que se ciña 100% al diccionario de objetivos
            messages: [
                { role: "system", content: "Eres Luciano Federico Juarez. Estratega senior. Te enfocas exclusivamente en explicar propósitos estratégicos sin mezclar conceptos." },
                { role: "user", content: prompt }
            ]
        });
        const aiRes = JSON.parse(response.choices[0].message.content.replace(/```json|```/g, ""));
        return { ...aiRes, analisis_publico_por_campaña: publicoData };
    } catch (error) {
        return { score: scoreBase, urgencia: "ESTABLE", diagnostico_general: "Error al generar narrativa estratégica.", analisis_campañas: [], analisis_publico_por_campaña: publicoData };
    }
}

//////////////////////////////////////////////////////////
// 7. ENDPOINTS Y SERVIDOR
//////////////////////////////////////////////////////////

app.post("/analizar", async (req, res) => {
    try {
        const resultado = await analizarConIA(req.body, req.body.currency || "ARS");
        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: "Fallo en motor estratégico" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 ReportAds Master Auditor Senior activo en puerto ${PORT}`);
});
