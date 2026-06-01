import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Inicializar cliente de Google Analytics
let analyticsDataClient;

try {
  console.log('🔐 Intentando cargar credenciales de GA4...');
  
  const credentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  
  if (!credentialsBase64) {
    throw new Error('GCP_CREDENTIALS_BASE64 no está configurado');
  }
  
  let credentials;
  try {
    // Decodificar Base64
    const credentialsJson = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
    credentials = JSON.parse(credentialsJson);
    console.log(`✅ Credenciales decodificadas. Proyecto: ${credentials.project_id}`);
  } catch (decodeError) {
    console.error('❌ Error decodificando credenciales:', decodeError.message);
    throw new Error(`Error decodificando credenciales: ${decodeError.message}`);
  }
  
  // Inicializar cliente de GA4
  analyticsDataClient = new BetaAnalyticsDataClient({
    credentials: credentials,
    projectId: credentials.project_id
  });
  
  console.log(`✅ Cliente de GA4 configurado para proyecto: ${credentials.project_id}`);
} catch (error) {
  console.error('❌ Error fatal inicializando GA4:', error.message);
  process.exit(1);
}

async function getGA4Data(metric, dimension, days = 7) {
  try {
    const propertyId = process.env.GA4_PROPERTY_ID;
    
    if (!propertyId) {
      throw new Error('GA4_PROPERTY_ID no está configurado');
    }
    
    console.log(`Consultando GA4: metric=${metric}, dimension=${dimension}, days=${days}`);
    
    const response = await analyticsDataClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges: [
        {
          startDate: getDateDaysAgo(days),
          endDate: 'today',
        },
      ],
      dimensions: dimension ? [{ name: dimension }] : [],
      metrics: [{ name: metric }],
      limit: 10,
    });

    return parseGA4Response(response);
  } catch (error) {
    console.error('Error GA4:', error.message);
    throw error;
  }
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

function parseGA4Response(response) {
  const results = [];
  
  response.rows?.forEach((row) => {
    const obj = {};
    
    response.dimensionHeaders?.forEach((header, idx) => {
      obj[header.name] = row.dimensionValues?.[idx]?.value || 'N/A';
    });
    
    response.metricHeaders?.forEach((header, idx) => {
      obj[header.name] = row.metricValues?.[idx]?.value || 0;
    });
    
    results.push(obj);
  });
  
  return results;
}

async function processQuestionWithClaude(question, gaData) {
  try {
    const claudeApiKey = process.env.CLAUDE_API_KEY;
    
    if (!claudeApiKey) {
      throw new Error('CLAUDE_API_KEY no está configurado');
    }
    
    const prompt = `
Eres un analista de datos experto en Google Analytics 4.

La pregunta del usuario es: "${question}"

Aquí están los datos de GA4:
${JSON.stringify(gaData, null, 2)}

Por favor:
1. Analiza estos datos en detalle
2. Responde la pregunta del usuario de forma clara
3. Proporciona insights valiosos y recomendaciones
4. Si faltan datos, menciona qué información adicional sería útil

Responde en un formato profesional y fácil de entender.
`;

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );

    return response.data.content[0].text;
  } catch (error) {
    console.error('Error Claude:', error.message);
    throw error;
  }
}

app.post('/api/ask', async (req, res) => {
  try {
    const { question, metric = 'activeUsers', dimension = null, days = 7 } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Se requiere una pregunta' });
    }

    console.log('📊 Obteniendo datos de GA4...');
    const gaData = await getGA4Data(metric, dimension, days);

    console.log('🤖 Procesando con Claude...');
    const analysis = await processQuestionWithClaude(question, gaData);

    res.json({ success: true, question, data: gaData, analysis });
  } catch (error) {
    console.error('Error en /api/ask:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'MCP GA4 activo ✅' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor MCP GA4 corriendo en puerto ${PORT}`);
  console.log(`📊 Property ID configurado: ${process.env.GA4_PROPERTY_ID}`);
});
