import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../src/services/DatabaseService';

// Provide a minimal window object for DatabaseService
(globalThis as any).window = {};

const app = express();
app.use(express.json());

const API_KEY = process.env.API_KEY || '';

// Simple API key authentication middleware
app.use((req, res, next) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.post('/v1/chat/completions', async (req, res) => {
  const { model, messages } = req.body;
  if (!model || !messages) {
    return res.status(400).json({ error: 'model and messages are required' });
  }

  const userMessage = messages[messages.length - 1]?.content || '';

  try {
    const db = DatabaseService.getInstance();
    const entries = await db.loadEntriesWithLimit(userMessage, 5);
    const content = entries.map(e => e.title).join('\n') || 'No entries found.';

    const response = {
      id: `chatcmpl-${uuidv4()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
    };

    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`OpenAI-compatible server listening on port ${port}`);
});
