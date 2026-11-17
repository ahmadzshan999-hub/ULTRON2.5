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

export async function streamAnswer(res, history = [], message = '') {
  try {
    if (!message || typeof message !== 'string') {
      throw new Error('A valid user message is required.');
    }

    const openai = getOpenAI();

    // Ensure history is an array of valid { role, content } objects
    const formattedHistory = Array.isArray(history)
      ? history
          .filter((item) => item && item.role && item.content)
          .map((item) => ({
            role: item.role,
            content: String(item.content)
          }))
      : [];

    const stream = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      instructions: [
        'You are ULTRON, a helpful personal AI assistant.',
        'Be clear, accurate, friendly and useful.',
        'Do not claim to perform actions you have not performed.',
        'If you are unsure, say so.'
      ].join(' '),
      input: [
        ...formattedHistory,
        {
          role: 'user',
          content: message
        }
      ],
      stream: true
    });

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        res.write(`data: ${JSON.stringify({ delta: event.delta })}\n\n`);
      }

      if (event.type === 'response.failed' || event.type === 'error') {
        const errorMessage =
          event.response?.error?.message ||
          event.error?.message ||
          'The AI request failed.';

        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
        return;
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    const errorMessage = err?.message || 'An unexpected server error occurred.';
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
