import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';

// Cargar variables de entorno
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Inicializar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================================
// SYSTEM PROMPT: EL CONSULTOR ESTRATÉGICO (AUDITORÍA)
// ============================================================================
const SYSTEM_PROMPT = `
Eres Luciano Juárez, Director de Estrategia y Media Buyer Senior. Tu misión es auditar una cuenta de Meta Ads y redactar un Diagnóstico Estratégico para el dueño del negocio.

OBJETIVO DEL DIAGNÓSTICO (Campo diagnostico_general):
1. ESTRATEGIA GLOBAL: Explica la arquitectura de la cuenta (ej. "Estamos ejecutando un ecosistema que combina captación de tráfico con cierre por mensajes").
2. ROL DE LAS CAMPAÑAS: Define para qué sirve cada una (ej. "La campaña A atrae interesados y la campaña B recupera a los que no consultaron").
3. LENGUAJE DE NEGOCIOS: Habla de "rentabilidad", "flujo de ventas", "eficiencia del capital" y "salud del negocio". 
4. FOCO EN EL CLIENTE: El cliente debe sentir que su inversión está bajo una estrategia lógica y segura. Evita tecnicismos que no sumen claridad.

REGLA CRÍTICA DE FORMATO:
Responde ÚNICAMENTE con un objeto JSON válido.
Estructura exacta:
{
  "score": 0.0,
  "urgencia": "ESTABLE | PRECAUCIÓN | CRÍTICO",
  "diagnostico_general": "Aquí va el análisis de alto nivel sobre la estrategia global y el rol de las campañas en el negocio.",
  "analisis_campañas": [
    { "id": "", "status_ia": "success/warning/danger", "feedback_ia": "Análisis estratégico de esta campaña puntual." }
  ],
  "analisis_publico_por_campaña": [
    { "id": "", "mejor_segmento_edad": "", "mejor_genero": "", "top_3_paises": [], "top_3_ciudades_por_pais": {} }
  ]
}
`;

// RUTA PARA EL FRONTEND DE REPORTADS
app.post('/analizar', async (req, res) => {
  try {
    const { campañas_detalle, currency } = req.body;

    console.log("⏳ Generando Auditoría Estratégica con visión de negocio...");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Analiza este ecosistema de campañas en ${currency}: ${JSON.stringify(campañas_detalle)}` }
      ]
    });

    const aiRes = JSON.parse(response.choices[0].message.content);
    res.json(aiRes);

  } catch (error) {
    console.error("❌ Error en Auditoría:", error);
    res.status(500).json({ error: "No se pudo generar el diagnóstico estratégico." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ReportAds Auditor Backend corriendo en puerto ${PORT}`);
});
