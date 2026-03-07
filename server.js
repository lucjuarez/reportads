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

// SYSTEM PROMPT ACTUALIZADO: Enfoque en Diagnóstico Estratégico para el Cliente
const SYSTEM_PROMPT = `
Eres un Director de Estrategia (Head of Growth) y Media Buyer Senior experto en Meta Ads. 
Tu objetivo es analizar un negocio y devolver un plan de pauta profesional expresado en términos que un dueño de negocio valore.

REGLAS PARA EL DIAGNÓSTICO ESTRATÉGICO:
1. Explica la "Estrategia Global": ¿Es un embudo de captación?, ¿Es venta directa?, ¿Es posicionamiento local?
2. Justifica los "Tipos de Campañas": Por qué usamos tráfico, leads o ventas y cómo se conectan entre sí.
3. Foco en el Cliente: Habla de rentabilidad, flujo de prospectos y protección del presupuesto. Evita tecnicismos vacíos; dale claridad y seguridad.

REGLAS DE COPYWRITING PARA ANUNCIOS:
1. primary_text: Fórmula AIDA, máximo 3 párrafos cortos.
2. headline: Directo, máximo 5 palabras.
3. text_for_image: Máximo 6 palabras, diseñado para frenar el scroll.
4. image_generation_prompt: EN INGLÉS. Describe la escena. Especifica "completely empty negative space" para texto.

REGLA CRÍTICA DE FORMATO:
Responde ÚNICAMENTE con un objeto JSON válido. Sin bloques de código markdown.
Estructura exacta:
{ 
  "diagnostico_estrategico": {
    "resumen_ejecutivo": "Explicación de la estrategia global enfocada en el dueño del negocio",
    "logica_de_embudo": "Cómo se conectan las campañas para mover al usuario de desconocido a cliente",
    "proximos_pasos": "Qué esperamos lograr y cómo vamos a escalar"
  },
  "campaign": { "objective": "", "daily_budget": 0 }, 
  "ad_set": { "audience": { "age_min": 0, "age_max": 0, "locations": [], "interests": [] } }, 
  "ads": [ 
    { "ad_name": "", "primary_text": "", "headline": "", "image_generation_prompt": "", "text_for_image": "" } 
  ] 
}
`;

// ============================================================================
// ENDPOINT 1: GENERAR ESTRATEGIA Y DIAGNÓSTICO
// ============================================================================
app.post('/api/generate-campaign', async (req, res) => {
  try {
    const { businessContext } = req.body;

    if (!businessContext) {
      return res.status(400).json({ error: "Falta el contexto del negocio" });
    }

    console.log("⏳ Generando Diagnóstico Estratégico y Campaña...");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Contexto del negocio y objetivos: ${businessContext}` }
      ]
    });

    const aiResponseText = response.choices[0].message.content;
    const campaignData = JSON.parse(aiResponseText);

    res.json(campaignData);

  } catch (error) {
    console.error("❌ Error en Fase 1:", error);
    res.status(500).json({ error: "Error al procesar la estrategia." });
  }
});

// ============================================================================
// ENDPOINT 2: GENERAR IMAGEN (DALL-E 3)
// ============================================================================
app.post('/api/generate-creative', async (req, res) => {
  try {
    const { imagePrompt, imageText } = req.body;

    if (!imagePrompt || !imageText) {
      return res.status(400).json({ error: "Faltan datos para la imagen" });
    }

    console.log(`🎨 Generando imagen con DALL-E 3...`);

    const imageResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: `${imagePrompt}. IMPORTANT: Leave an empty solid color or clean negative space to overlay the following text: '${imageText}'.`,
      n: 1,
      size: "1024x1024",
      quality: "standard",
    });

    const backgroundImageUrl = imageResponse.data[0].url;

    res.json({
      success: true,
      original_background: backgroundImageUrl,
      final_creative_url: backgroundImageUrl, 
      applied_text: imageText
    });

  } catch (error) {
    console.error("❌ Error en Fase 2:", error);
    res.status(500).json({ error: "Error al generar el creativo visual." });
  }
});

// ============================================================================
// ENDPOINT 3: PUBLICAR EN META ADS
// ============================================================================
app.post('/api/publish-campaign', async (req, res) => {
  try {
    const { campaignName, objective, userAccessToken, userAccountId } = req.body;
    
    const ACCESS_TOKEN = userAccessToken || process.env.META_ACCESS_TOKEN;
    const AD_ACCOUNT_ID = userAccountId || process.env.META_AD_ACCOUNT_ID;

    if (!ACCESS_TOKEN || !AD_ACCOUNT_ID) {
      return res.status(400).json({ error: "Faltan credenciales de Meta." });
    }

    console.log(`🚀 Publicando campaña: ${campaignName}`);

    const metaResponse = await fetch(`https://graph.facebook.com/v19.0/${AD_ACCOUNT_ID}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: campaignName || "Campaña Estratégica - ReportAds",
        objective: objective || "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: [],
        access_token: ACCESS_TOKEN
      })
    });

    const metaData = await metaResponse.json();

    if (metaData.error) {
      return res.status(400).json({ error: metaData.error.message });
    }

    res.json({
      success: true,
      campaign_id: metaData.id,
      message: "Campaña creada en borrador exitosamente."
    });

  } catch (error) {
    console.error("❌ Error en Fase 3:", error);
    res.status(500).json({ error: "Error al conectar con Meta." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Back-End de ReportAds corriendo en el puerto: ${PORT}`);
});
