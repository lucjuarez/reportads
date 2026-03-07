import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `
Eres Luciano Juárez, Director de Estrategia Senior. Tu misión es auditar cuentas de Meta Ads.

REGLAS PARA EL SCORE (0.0 a 10.0):
- No pongas 0.0 a menos que no haya datos de gasto.
- Evalúa la EFICIENCIA: Si hay mucho gasto y pocos resultados, el score es bajo (2.0 - 4.0).
- Si la cuenta está bien estructurada pero el mercado está difícil, sé justo (5.0 - 7.0).
- Si el ROAS o CPA son excelentes, apunta al (8.0 - 10.0).

DIAGNÓSTICO ESTRATÉGICO (Campo diagnostico_general):
- Explica la arquitectura global (Embudo, tipos de campañas).
- Habla como un socio de negocio: "rentabilidad", "flujo de prospectos", "salud de la cuenta".
- Enfócate en lo que el dueño del negocio (el cliente) necesita entender para valorar tu trabajo.

REGLA DE FORMATO:
Responde ÚNICAMENTE con JSON válido.
{
  "score": 5.0,
  "urgencia": "ESTABLE | PRECAUCIÓN | CRÍTICO",
  "diagnostico_general": "Narrativa estratégica global...",
  "analisis_campañas": [
    { "id": "ID_DE_CAMPAÑA", "status_ia": "success/warning/danger", "feedback_ia": "Análisis táctico..." }
  ],
  "analisis_publico_por_campaña": [
    { "id": "ID_DE_CAMPAÑA", "mejor_segmento_edad": "", "mejor_genero": "", "top_3_paises": [], "top_3_ciudades_por_pais": {} }
  ]
}
`;

// Asegúrate de que en Render el "Web Service" apunte a esta ruta
app.post('/analizar', async (req, res) => {
  try {
    const { campañas_detalle, currency } = req.body;

    if (!campañas_detalle || campañas_detalle.length === 0) {
      return res.status(400).json({ error: "No se recibieron datos de campañas para analizar." });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.5, // Bajamos la temperatura para que sea más preciso con los números
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Moneda: ${currency}. Datos: ${JSON.stringify(campañas_detalle)}` }
      ]
    });

    res.json(JSON.parse(response.choices[0].message.content));

  } catch (error) {
    console.error("❌ Error en OpenAI:", error);
    res.status(500).json({ error: "Fallo el análisis estratégico de la IA." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Auditor funcionando en puerto ${PORT}`));
