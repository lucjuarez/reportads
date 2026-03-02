import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

//////////////////////////////////////////////////////////
// UTILIDADES
//////////////////////////////////////////////////////////

const n = (v) => Number(v) || 0;

//////////////////////////////////////////////////////////
// ANALISIS DE PUBLICO POR CAMPAÑA
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

        if (!ciudadesPorPais[b.country]) {
          ciudadesPorPais[b.country] = {};
        }

        if (b.city) {
          ciudadesPorPais[b.country][b.city] =
            (ciudadesPorPais[b.country][b.city] || 0) + resultados;
        }
      }
    });

    const topEdad =
      Object.entries(edades).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

    const topGenero =
      Object.entries(generos).sort((a,b)=>b[1]-a[1])[0]?.[0] || null;

    const topPaises = Object.entries(paises)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,3)
      .map(p=>p[0]);

    const topCiudadesPorPais = {};

    topPaises.forEach(pais => {
      const ciudades = ciudadesPorPais[pais] || {};
      topCiudadesPorPais[pais] = Object.entries(ciudades)
        .sort((a,b)=>b[1]-a[1])
        .slice(0,3)
        .map(c=>c[0]);
    });

    return {
      id: c.id,
      mejor_segmento_edad: topEdad,
      mejor_genero: topGenero,
      top_3_paises: topPaises,
      top_3_ciudades_por_pais: topCiudadesPorPais
    };
  });
}

//////////////////////////////////////////////////////////
// MOTOR IA – REPORTADS
//////////////////////////////////////////////////////////

async function generarReporteIA(data) {
  const publicoPorCampaña = analizarPublicoPorCampaña(data);

  const campañasProcesadas = (data.campañas_detalle || []).map(c => {
    const spend = n(c.spend);
    const resultados =
      n(c.msg) + n(c.leads) + n(c.pur) + n(c.cart) + n(c.lpv);

    const roas = spend > 0 ? n(c.val) / spend : 0;
    const cpr = resultados > 0 ? spend / resultados : 0;

    return {
      id: c.id,
      name: c.name,
      inversion: spend,
      resultados,
      roas,
      frecuencia: n(c.freq),
      ctr: n(c.ctr_meta),
      clics: n(c.clicks),
      valor_generado: n(c.val),
      costo_por_resultado: cpr
    };
  });

  const prompt = `
Actúa como Luciano Juárez, especialista en Meta Ads.
Debes explicar resultados de campañas a un cliente NO técnico de forma clara y estratégica.

Devuelve SOLO JSON válido con:

{
  "resumen_ejecutivo": "string",
  "principales_logros": ["string"],
  "oportunidades_mejora": ["string"],
  "recomendacion_proximo_mes": "string",
  "analisis_campañas": [
    {
      "id": "string",
      "comentario": "string"
    }
  ],
  "insight_publico": "string"
}

Datos campañas:
${JSON.stringify(campañasProcesadas, null, 2)}
`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: "Eres experto en performance marketing y comunicación ejecutiva." },
        { role: "user", content: prompt }
      ]
    });

    const text = response.choices[0].message.content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(text);

    return {
      ...parsed,
      analisis_publico_por_campaña: publicoPorCampaña
    };

  } catch (error) {
    console.error("Error IA:", error);

    return {
      resumen_ejecutivo: "Reporte generado automáticamente.",
      principales_logros: [],
      oportunidades_mejora: [],
      recomendacion_proximo_mes: "",
      analisis_campañas: [],
      insight_publico: "",
      analisis_publico_por_campaña: publicoPorCampaña
    };
  }
}

//////////////////////////////////////////////////////////
// ENDPOINT
//////////////////////////////////////////////////////////

app.post("/reporte", async (req, res) => {
  try {
    const resultado = await generarReporteIA(req.body);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () =>
  console.log("🚀 REPORTADS activo en puerto " + PORT)
);