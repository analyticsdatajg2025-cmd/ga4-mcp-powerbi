import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

let analyticsDataClient;

try {
  console.log('🔐 Cargando credenciales de GA4...');
  
  const credentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  
  if (!credentialsBase64) {
    throw new Error('GCP_CREDENTIALS_BASE64 no está configurado');
  }
  
  const credentialsJson = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
  const credentials = JSON.parse(credentialsJson);
  
  // Usar GoogleAuth para mejor compatibilidad
  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/analytics',
    ],
  });
  
  analyticsDataClient = new BetaAnalyticsDataClient({
    auth: auth,
  });
  
  console.log(`✅ Cliente GA4 inicializado correctamente`);
} catch (error) {
  console.error('❌ Error inicializando GA4:', error.message);
  process.exit(1);
}

async function getGA4Data(metric, dimension, days = 7) {
  try {
    const propertyId = process.env.GA4_PROPERTY_ID;
    
    if (!propertyId) {
      throw new Error('GA4_PROPERTY_ID no está configurado');
    }
    
    console.log(`📊 Consultando GA4: metric=${metric}, dimension=${dimension}`);
    
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
    console.error('❌ Error GA4:', error.message);
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

Pregunta: "${question}"

Datos de GA4:
${JSON.stringify(gaData, null, 2)}

Analiza estos datos y responde la pregunta de forma clara, profesional y con insights valiosos.
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
    console.error('❌ Error Claude:', error.message);
    throw error;
  }
}

app.post('/api/ask', async (req, res) => {
  try {
    const { question, metric = 'activeUsers', dimension = null, days = 7 } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Se requiere una pregunta' });
    }

    const gaData = await getGA4Data(metric, dimension, days);
    const analysis = await processQuestionWithClaude(question, gaData);

    res.json({ success: true, question, data: gaData, analysis });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'MCP GA4 activo ✅' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});
