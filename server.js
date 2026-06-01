import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

let authClient;

try {
  console.log('🔐 Cargando credenciales...');
  
  const credentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  
  if (!credentialsBase64) {
    throw new Error('GCP_CREDENTIALS_BASE64 no está configurado');
  }
  
  const credentialsJson = Buffer.from(credentialsBase64, 'base64').toString('utf-8');
  const credentials = JSON.parse(credentialsJson);
  
  authClient = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
  
  console.log('✅ Auth inicializado');
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

async function getGA4Data(metric, dimension, days = 7) {
  try {
    const propertyId = process.env.GA4_PROPERTY_ID;
    
    if (!propertyId) {
      throw new Error('GA4_PROPERTY_ID no configurado');
    }

    const token = await authClient.getAccessToken();
    const accessToken = token.token;

    const response = await axios.post(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
      {
        dateRanges: [
          {
            startDate: getDateDaysAgo(days),
            endDate: 'today',
          },
        ],
        metrics: [{ name: metric }],
        dimensions: dimension ? [{ name: dimension }] : [],
        limit: 10,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const rows = response.data.rows || [];
    const results = [];

    rows.forEach((row) => {
      const obj = {};
      
      response.data.dimensionHeaders?.forEach((dim, idx) => {
        obj[dim.name] = row.dimensionValues[idx]?.value || 'N/A';
      });
      
      response.data.metricHeaders?.forEach((metric, idx) => {
        obj[metric.name] = row.metricValues[idx]?.value || 0;
      });
      
      results.push(obj);
    });

    return results;
  } catch (error) {
    console.error('❌ Error GA4:', error.message);
    if (error.response?.data) {
      console.error('Detalles:', error.response.data);
    }
    throw error;
  }
}

async function processWithClaude(question, gaData) {
  try {
    const key = process.env.CLAUDE_API_KEY;
    
    if (!key) {
      throw new Error('CLAUDE_API_KEY no configurado');
    }
    
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-opus-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Eres analista de datos. Pregunta: "${question}"\n\nDatos GA4: ${JSON.stringify(gaData)}`
        }],
      },
      {
        headers: {
          'x-api-key': key,
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
      return res.status(400).json({ error: 'Se requiere pregunta' });
    }

    const gaData = await getGA4Data(metric, dimension, days);
    const analysis = await processWithClaude(question, gaData);

    res.json({ success: true, data: gaData, analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});
