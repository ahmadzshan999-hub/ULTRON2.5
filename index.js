import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';
import { streamAnswer } from './ai.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const currentDir = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);
app.use(cors({ origin: isProduction ? false : true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/', rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
}));

const allowedExtensions = new Set(['.txt', '.md', '.csv', '.pdf', '.docx']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return callback(new Error('Unsupported file type. Upload TXT, MD, CSV, PDF or DOCX.'));
    }
    callback(null, true);
  }
});

async function extractFile(file) {
  if (!file) return '';
  const extension = path.extname(file.originalname).toLowerCase();
  if (extension === '.pdf') {
    const parsed = await pdfParse(file.buffer);
    return parsed.text.slice(0, 30_000);
  }
  if (extension === '.docx') {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    return parsed.value.slice(0, 30_000);
  }
  return file.buffer.toString('utf8').slice(0, 30_000);
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'ULTRON',
    configuration: {
      supabase: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY)),
      openai: Boolean(process.env.OPENAI_API_KEY)
    }
  });
});

app.post('/api/chat', authenticate, upload.single('file'), async (req, res, next) => {
  try {
    const message = String(req.body.message || '').trim();
    const fileText = await extractFile(req.file);
    if (!message && !fileText) {
      return res.status(400).json({ error: 'Write a message or attach a supported file.' });
    }

    let history;
    try {
      history = JSON.parse(req.body.history || '[]');
    } catch {
      return res.status(400).json({ error: 'Chat history was not valid JSON.' });
    }
    if (!Array.isArray(history)) history = [];
    history = history
      .filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
      .slice(-16)
      .map(item => ({ role: item.role, content: item.content.slice(0, 12_000) }));

    const prompt = `${message || 'Please analyse the attached file.'}${fileText ? `\n\nAttached file: ${req.file.originalname}\n\n${fileText}` : ''}`;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    await streamAnswer(res, history, prompt);
  } catch (error) {
    next(error);
  }
});

if (isProduction) {
  const clientDist = path.resolve(currentDir, '../client/dist');
  app.use(express.static(clientDist, { index: false }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'), error => {
      if (error && !res.headersSent) res.status(500).send('ULTRON frontend build is missing. The deployment build did not complete.');
    });
  });
}

app.use((error, _req, res, _next) => {
  console.error('[ULTRON API]', error);
  if (res.headersSent) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: error.message || 'Request failed.' })}\n\n`);
      res.end();
    }
    return;
  }
  const status = Number(error.status) || (error instanceof multer.MulterError ? 400 : 500);
  res.status(status).json({ error: error.message || 'An unexpected server error occurred.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ULTRON server listening on port ${PORT}`);
});
