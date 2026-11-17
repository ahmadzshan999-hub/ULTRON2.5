import 'dotenv/config';

import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authenticate } from './auth.js';
import { streamAnswer } from './ai.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const currentDirectory = path.dirname(
  fileURLToPath(import.meta.url)
);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.use(
  '/api/',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1
  },
  fileFilter(req, file, callback) {
    const allowed = ['.txt', '.md', '.csv', '.pdf', '.docx'];
    const extension = path.extname(file.originalname).toLowerCase();

    if (!allowed.includes(extension)) {
      const err = new Error(
        'Unsupported file type. Use TXT, MD, CSV, PDF or DOCX.'
      );
      err.status = 400;
      return callback(err);
    }

    callback(null, true);
  }
});

async function extractFile(file) {
  if (!file) return '';

  const extension = path.extname(file.originalname).toLowerCase();

  if (extension === '.pdf') {
    const result = await pdfParse(file.buffer);
    return (result.text || '').slice(0, 30000);
  }

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({
      buffer: file.buffer
    });
    return (result.value || '').slice(0, 30000);
  }

  return file.buffer.toString('utf8').slice(0, 30000);
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    name: 'ULTRON API'
  });
});

app.post(
  '/api/chat',
  authenticate,
  upload.single('file'),
  async (req, res) => {
    const abortController = new AbortController();

    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const message = String(req.body?.message || '').trim();
      const fileText = await extractFile(req.file);

      if (!message && !fileText) {
        return res.status(400).json({
          error: 'Write a message or attach a document.'
        });
      }

      let history = [];

      try {
        const parsed = JSON.parse(req.body?.history || '[]');

        if (Array.isArray(parsed)) {
          history = parsed
            .filter(
              (item) =>
                item &&
                ['user', 'assistant'].includes(item.role) &&
                typeof item.content === 'string'
            )
            .slice(-12);
        }
      } catch {
        return res.status(400).json({
          error: 'Conversation history is invalid.'
        });
      }

      const prompt = [
        message || 'Please analyze the attached document.',
        fileText
          ? `\n\nDocument: ${req.file.originalname}\n\n${fileText}`
          : ''
      ].join('');

      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      await streamAnswer(res, history, prompt, abortController.signal);

      if (!res.writableEnded) {
        res.end();
      }
    } catch (error) {
      if (error.name === 'AbortError') return;

      console.error('Chat endpoint error:', error);

      if (res.headersSent) {
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({
              error: error.message || 'AI request failed.'
            })}\n\n`
          );
          res.end();
        }
      } else {
        res.status(500).json({
          error: error.message || 'AI request failed.'
        });
      }
    }
  }
);

app.use((error, req, res, next) => {
  console.error('Server error:', error);

  if (res.headersSent) return next(error);

  const statusCode =
    error instanceof multer.MulterError ? 400 : error.status || 500;

  res.status(statusCode).json({
    error: error.message || 'Unexpected server error.'
  });
});

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(currentDirectory, '../client/dist');

  app.use(express.static(clientDist));

  app.use((req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`ULTRON API listening on port ${PORT}`);
});
