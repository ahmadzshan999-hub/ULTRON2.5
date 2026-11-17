
import OpenAI from 'openai';

let client = null;

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('The OpenAI API key is missing on the server.');
  }

  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  return client;
}

export async function streamAnswer(res, history, message) {
  const openai = getOpenAI();

  const stream = await openai.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.5',
    instructions: [
      'You are ULTRON, a helpful personal AI assistant.',
      'Be clear, accurate, friendly and useful.',
      'Do not claim to perform actions you have not performed.',
      'If you are unsure, say so.'
    ].join(' '),
    input: [
      ...history,
      {
        role: 'user',
        content: message
      }
    ],
    stream: true
  });

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      res.write(
        `data: ${JSON.stringify({ delta: event.delta })}\n\n`
      );
    }

    if (event.type === 'response.failed') {
      const message =
        event.response?.error?.message || 'The AI request failed.';

      res.write(
        `data: ${JSON.stringify({ error: message })}\n\n`
      );

      return;
    }
  }

  res.write('data: {"done":true}\n\n');
}
