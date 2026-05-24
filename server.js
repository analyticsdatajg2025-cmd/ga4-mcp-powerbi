import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const analyticsDataClient = new BetaAnalyticsDataClient();

async function getGA4Data(metric, dimension, days = 7) {
  try {
    const propertyId = process.env.GA4_PROPERTY_ID;
    
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
    console.error('Error GA4:', error);
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
    const prompt = `
Eres analista de datos experto en GA4. Pregunta: "${question}"

Datos de GA4:
${JSON.stringify(gaData, null, 2)}

Responde:
1. Análisis de los datos
2. Respuesta clara a la pregunta
3. Insights valiosos
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
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );

    return response.data.content[0].text;
  } catch (error) {
    console.error('Error Claude:', error);
    throw error;
  }
}

app.post('/api/ask', async (req, res) => {
  try {
    const { question, metric = 'activeUsers', dimension = null, days = 7 } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Se requiere pregunta' });
    }

    console.log('📊 Obteniendo datos GA4...');
    const gaData = await getGA4Data(metric, dimension, days);

    console.log('🤖 Procesando con Claude...');
    const analysis = await processQuestionWithClaude(question, gaData);

    res.json({ success: true, question, data: gaData, analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'MCP GA4 activo ✅' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
