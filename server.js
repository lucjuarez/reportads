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

const SYSTEM_PROMPT = `
Eres un Media Buyer Senior y Copywriter de respuesta directa experto en Meta Ads. 
Tu trabajo es analizar la información de un negocio y crear una estrategia y 3 variantes de anuncios enfocados en conversión.

Reglas de Copywriting:
1. primary_text: Fórmula AIDA, máximo 3 párrafos cortos.
2. headline: Directo, máximo 5 palabras.
3. text_for_image: Máximo 6 palabras, diseñado para llamar la atención haciendo scroll.
4. image_generation_prompt: EN INGLÉS. Describe la escena fotográfica o diseño. MUY IMPORTANTE: Especifica que debe haber "completely empty negative space" (espacio vacío) para superponer texto después.

REGLA CRÍTICA DE FORMATO:
Debes responder ÚNICAMENTE con un objeto JSON válido. No uses bloques de código markdown (\`\`\`json).
Estructura exacta:
{ 
  "campaign": { "objective": "", "daily_budget": 0 }, 
  "ad_set": { "audience": { "age_min": 0, "age_max": 0, "locations": [], "interests": [] } }, 
  "ads": [ 
    { "ad_name": "", "primary_text": "", "headline": "", "image_generation_prompt": "", "text_for_image": "" } 
  ] 
}
`;

// ============================================================================
// ENDPOINT 1: GENERAR ESTRATEGIA (OPENAI)
// ============================================================================
app.post('/api/generate-campaign', async (req, res) => {
  try {
    const { businessContext } = req.body;

    if (!businessContext) {
      return res.status(400).json({ error: "Falta el contexto del negocio" });
    }

    console.log("⏳ Generando estructura de campaña con IA...");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Contexto del negocio: ${businessContext}` }
      ]
    });

    const aiResponseText = response.choices[0].message.content;
    const campaignData = JSON.parse(aiResponseText);

    res.json(campaignData);

  } catch (error) {
    console.error("❌ Error en Fase 1:", error);
    res.status(500).json({ error: "Ocurrió un error al procesar la estrategia." });
  }
});

// ============================================================================
// ENDPOINT 2: GENERAR IMAGEN (DALL-E 3)
// ============================================================================
app.post('/api/generate-creative', async (req, res) => {
  try {
    const { imagePrompt, imageText } = req.body;

    if (!imagePrompt || !imageText) {
      return res.status(400).json({ error: "Faltan datos para generar la imagen" });
    }

    console.log(`🎨 Llamando a DALL-E 3...`);

    const imageResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: imagePrompt + ". IMPORTANT: Leave an empty solid color negative space perfectly clear to overlay the following text later: '" + imageText + "'.",
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
    res.status(500).json({ error: "Ocurrió un error al generar el creativo visual." });
  }
});

// ============================================================================
// ENDPOINT 3: PUBLICAR EN META ADS (ACTUALIZADO PARA MÚLTIPLES USUARIOS)
// ============================================================================
app.post('/api/publish-campaign', async (req, res) => {
  try {
    // Ahora el backend espera recibir las llaves desde el frontend
    const { campaignName, objective, userAccessToken, userAccountId } = req.body;
    
    // Si el cliente envía sus propias llaves, las usamos. Si no, usamos las tuyas de prueba en Render (como respaldo).
    const ACCESS_TOKEN = userAccessToken || process.env.META_ACCESS_TOKEN;
    const AD_ACCOUNT_ID = userAccountId || process.env.META_AD_ACCOUNT_ID;

    if (!ACCESS_TOKEN || !AD_ACCOUNT_ID) {
      console.error("❌ Faltan credenciales. Token:", !!ACCESS_TOKEN, "Cuenta:", !!AD_ACCOUNT_ID);
      return res.status(400).json({ error: "Faltan las credenciales de Meta (Token o ID de cuenta)." });
    }

    console.log(`🚀 [FASE 3] Creando campaña en Meta... Objetivo: ${objective}`);

    // Llamada HTTP a la Graph API de Meta
    const metaResponse = await fetch(`https://graph.facebook.com/v19.0/${AD_ACCOUNT_ID}/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: campaignName || "Campaña Generada por IA - Ads Creator",
        objective: objective || "OUTCOME_LEADS",
        status: "PAUSED", // SIEMPRE en pausa por seguridad
        special_ad_categories: [], // Obligatorio para la API
        access_token: ACCESS_TOKEN
      })
    });

    const metaData = await metaResponse.json();

    if (metaData.error) {
      console.error("❌ Error de Meta:", metaData.error);
      return res.status(400).json({ error: metaData.error.message });
    }

    console.log("✅ [FASE 3] Campaña creada con éxito. ID:", metaData.id);

    res.json({
      success: true,
      campaign_id: metaData.id,
      message: "Campaña creada en modo borrador"
    });

  } catch (error) {
    console.error("❌ Error interno:", error);
    res.status(500).json({ error: "Ocurrió un error al conectar con Meta." });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Ads Creator Backend corriendo en el puerto: ${PORT}`);
});
