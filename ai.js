import OpenAI from 'openai';

let client;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('The server owner has not configured OPENAI_API_KEY.');
    error.status = 503;
    throw error;
  }
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export async function streamAnswer(res, history, message) {
  const api = getOpenAIClient();
  const stream = await api.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    instructions: 'You are ULTRON, a helpful, accurate, friendly AI assistant. Be clear and useful. If you are uncertain, say so.',
    input: [...history, { role: 'user', content: message }],
    stream: true
  });

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      res.write(`data: ${JSON.stringify({ delta: event.delta })}\n\n`);
    } else if (event.type === 'response.failed') {
      const errorMessage = event.response?.error?.message || 'The AI response failed.';
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      res.end();
      return;
    } else if (event.type === 'error') {
      res.write(`data: ${JSON.stringify({ error: event.message || 'The AI stream failed.' })}\n\n`);
      res.end();
      return;
    }
  }

  if (!res.writableEnded) {
    res.write('data: {"done":true}\n\n');
    res.end();
  }
}
